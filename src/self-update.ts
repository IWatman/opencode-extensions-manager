import { execFile } from "node:child_process"
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { globalConfigDir, isRecord } from "./config.ts"
import type {
  SelfUpdateChannel,
  SelfUpdateCheck,
  SelfUpdateCommit,
  SelfUpdateHistoryEntry,
  SelfUpdateInfo,
  SelfUpdateInstallKind,
  SelfUpdateResult,
} from "./rpc"

/**
 * Self-update is deliberately limited to the official repository. The plugin runs arbitrary code
 * from this checkout, so an update must never be able to follow an arbitrary remote.
 */
export const SELF_UPDATE_REPO = "IWatman/opencode-extensions-manager"
export const SELF_UPDATE_REPO_URL = `https://github.com/${SELF_UPDATE_REPO}`

/** File name inside the global OpenCode config directory. */
export const SELF_UPDATE_HISTORY_FILE = "extensions-manager-updates.json"
/** Number of newest entries kept in the history file. */
export const SELF_UPDATE_HISTORY_LIMIT = 20
/** Number of commits returned by a check for the "what's new" list. */
export const SELF_UPDATE_CHANGELOG_LIMIT = 20

const gitTimeout = 45_000
const installTimeout = 300_000
const buildTimeout = 180_000
const maxLogLength = 8_000
const logSeparator = "\u001f"
const packageFiles = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"])

interface CommandResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

interface PackageJson {
  readonly name?: string
  readonly version?: string
  readonly description?: string
  readonly author?: string | { readonly name?: string }
  readonly license?: string
  readonly homepage?: string
  readonly repository?: string | { readonly url?: string }
  readonly bugs?: string | { readonly url?: string }
}

interface AppInfo {
  readonly name: string
  readonly version: string
  readonly channel: string
}

interface GitInfo {
  readonly kind: SelfUpdateInstallKind
  readonly path: string
  readonly branch?: string
  readonly commit?: string
  readonly remote?: string
  readonly dirty: boolean
  readonly canUpdate: boolean
  readonly reason?: string
}

interface StableTarget {
  readonly tag: string
  readonly commit: string
}

interface StableTag {
  readonly tag: string
  readonly version: string
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly (string | number)[]
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function trimLog(value: string) {
  const text = value.trim()
  if (text.length <= maxLogLength) return text
  return `${text.slice(0, maxLogLength)}\n…`
}

/** Resolves the package root from this module, for both a checkout and an installed package. */
export function pluginRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
}

function run(command: string, args: readonly string[], cwd: string, timeout: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        cwd,
        timeout,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          NO_COLOR: "1",
        },
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        })
      },
    )
  })
}

async function git(cwd: string, args: readonly string[], timeout = gitTimeout): Promise<string> {
  const result = await run("git", args, cwd, timeout)
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`
    throw new Error(detail)
  }
  return result.stdout.trim()
}

async function npm(cwd: string, args: readonly string[], timeout: number): Promise<CommandResult> {
  // execFile cannot start npm.cmd directly on Windows; cmd.exe resolves the shim without a shell.
  if (process.platform === "win32") {
    const command = process.env.ComSpec ?? "cmd.exe"
    return run(command, ["/d", "/s", "/c", "npm", ...args], cwd, timeout)
  }
  return run("npm", args, cwd, timeout)
}

async function readPackage(root: string): Promise<PackageJson> {
  try {
    const value: unknown = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
    return typeof value === "object" && value !== null ? (value as PackageJson) : {}
  } catch {
    return {}
  }
}

function repositoryUrl(input: string | { readonly url?: string } | undefined) {
  const value = typeof input === "string" ? input : input?.url
  if (!value) return undefined
  const parsed = githubRepoFromUrl(value)
  if (!parsed) return undefined
  if (parsed === SELF_UPDATE_REPO.toLowerCase()) return SELF_UPDATE_REPO_URL
  const normalized = value.trim().replace(/^git\+/, "").replace(/\.git$/, "")
  return normalized.startsWith("http") ? normalized : `https://github.com/${parsed}`
}

function authorName(input: PackageJson["author"]) {
  if (typeof input === "string") return input
  return input?.name
}

function issuesUrl(input: PackageJson["bugs"], fallback: string | undefined) {
  if (typeof input === "string") return input
  return input?.url ?? (fallback ? `${fallback}/issues` : undefined)
}

/** Normalizes GitHub remotes (`https`, `git@`, `git+https`, `github:owner/repo`) to `owner/repo`. */
export function githubRepoFromUrl(input: string | undefined): string | undefined {
  let value = input?.trim()
  if (!value) return undefined
  value = value.replace(/^git\+/, "").replace(/\.git$/, "")
  if (value.startsWith("git@github.com:")) value = `https://github.com/${value.slice("git@github.com:".length)}`
  if (value.startsWith("github:")) value = `https://github.com/${value.slice("github:".length)}`
  if (value.startsWith("github.com/")) value = `https://${value}`
  if (!value.includes("://") && /^[\w.-]+\/[\w.-]+$/.test(value)) value = `https://github.com/${value}`
  try {
    const url = new URL(value)
    if (url.hostname.toLowerCase() !== "github.com") return undefined
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/")
    const owner = parts[0]
    const repo = parts[1]
    if (!owner || !repo) return undefined
    return `${owner.toLowerCase()}/${repo.toLowerCase()}`
  } catch {
    return undefined
  }
}

async function samePath(left: string, right: string) {
  const normalize = (value: string) =>
    process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value)
  try {
    const [resolvedLeft, resolvedRight] = await Promise.all([realpath(left), realpath(right)])
    return normalize(resolvedLeft) === normalize(resolvedRight)
  } catch {
    return normalize(left) === normalize(right)
  }
}

function inferInstallKind(root: string): SelfUpdateInstallKind {
  const value = root.replaceAll("\\", "/").toLowerCase()
  if (value.includes("/node_modules/") || value.includes("/.cache/opencode/") || value.includes("/opencode/plugins/")) {
    return "package"
  }
  return "directory"
}

export function shortCommit(value: string | undefined) {
  if (!value) return undefined
  return value.length > 10 ? value.slice(0, 7) : value
}

async function readGitInfo(root: string, expectedRepo: string): Promise<GitInfo> {
  const kind = inferInstallKind(root)
  try {
    const top = await git(root, ["rev-parse", "--show-toplevel"], 5_000)
    if (!(await samePath(top, root))) {
      return {
        kind,
        path: root,
        dirty: false,
        canUpdate: false,
        reason: "The plugin folder is inside a larger Git repository.",
      }
    }
    const branch = await git(root, ["branch", "--show-current"], 5_000)
    const commit = await git(root, ["rev-parse", "HEAD"], 5_000)
    const remote = await git(root, ["config", "--get", "remote.origin.url"], 5_000).catch(() => "")
    const status = await git(root, ["status", "--porcelain"], 5_000)
    const dirty = status.length > 0
    const official = githubRepoFromUrl(remote) === expectedRepo.toLowerCase()
    let reason: string | undefined
    if (!official) reason = "The origin remote is not the official repository."
    else if (!branch) reason = "The checkout is in detached HEAD state."
    else if (branch !== "main") reason = `The checkout is on branch "${branch}", not main.`
    else if (dirty) reason = "The checkout has local changes."
    return {
      kind: "git",
      path: root,
      ...(branch ? { branch } : {}),
      commit,
      ...(remote ? { remote } : {}),
      dirty,
      canUpdate: official && branch === "main" && !dirty,
      ...(reason ? { reason } : {}),
    }
  } catch {
    return {
      kind,
      path: root,
      dirty: false,
      canUpdate: false,
      reason:
        kind === "package"
          ? "Package installations are updated through OpenCode's plugin service."
          : "The plugin folder is not a Git checkout.",
    }
  }
}

async function packageVersion(root: string) {
  return (await readPackage(root)).version
}

async function showVersion(root: string, ref: string) {
  try {
    const raw = await git(root, ["show", `${ref}:package.json`], 10_000)
    const value: unknown = JSON.parse(raw)
    if (typeof value === "object" && value !== null && typeof (value as PackageJson).version === "string") {
      return (value as PackageJson).version
    }
  } catch {
    // A version is optional; the commit still identifies an update.
  }
  return undefined
}

// --- Update history --------------------------------------------------------

/** `extensions-manager-updates.json` inside the global OpenCode config directory. */
export function selfUpdateHistoryPath() {
  return path.join(globalConfigDir(), SELF_UPDATE_HISTORY_FILE)
}

function normalizeHistoryEntry(value: unknown): SelfUpdateHistoryEntry | undefined {
  if (!isRecord(value)) return undefined
  const { commit, version, at, action, previousCommit, note } = value
  if (typeof commit !== "string" || !commit.trim()) return undefined
  if (typeof version !== "string") return undefined
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return undefined
  if (action !== "update" && action !== "rollback") return undefined
  return {
    commit,
    version,
    at,
    action,
    ...(typeof previousCommit === "string" && previousCommit.trim() ? { previousCommit } : {}),
    ...(typeof note === "string" && note.trim() ? { note } : {}),
  }
}

/** Reads the newest history entries. A missing or malformed file reads as an empty history. */
export async function readSelfUpdateHistory(
  file = selfUpdateHistoryPath(),
): Promise<readonly SelfUpdateHistoryEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"))
    const raw = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.entries)
        ? parsed.entries
        : []
    const entries: SelfUpdateHistoryEntry[] = []
    for (const item of raw) {
      const entry = normalizeHistoryEntry(item)
      if (entry) entries.push(entry)
      if (entries.length >= SELF_UPDATE_HISTORY_LIMIT) break
    }
    return entries
  } catch {
    return []
  }
}

/** Prepends an entry and keeps the newest `SELF_UPDATE_HISTORY_LIMIT` entries. */
export async function recordSelfUpdateHistory(
  entry: SelfUpdateHistoryEntry,
  file = selfUpdateHistoryPath(),
): Promise<readonly SelfUpdateHistoryEntry[]> {
  const existing = await readSelfUpdateHistory(file)
  const entries = [entry, ...existing].slice(0, SELF_UPDATE_HISTORY_LIMIT)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8")
  await rename(temporary, file)
  return entries
}

// --- Changelog and release channels ---------------------------------------

/** Parses the NUL-safe `git log` format used by `commitsBetween`. */
export function parseCommitLog(raw: string, limit = SELF_UPDATE_CHANGELOG_LIMIT): readonly SelfUpdateCommit[] {
  const commits: SelfUpdateCommit[] = []
  if (limit <= 0) return commits
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [sha, date, ...rest] = line.split(logSeparator)
    if (!sha || !date) continue
    commits.push({
      sha,
      date,
      message: rest.join(logSeparator).trim() || "(no message)",
    })
    if (commits.length >= limit) break
  }
  return commits
}

async function commitsBetween(root: string, from: string, to: string) {
  const raw = await git(
    root,
    ["log", `--max-count=${SELF_UPDATE_CHANGELOG_LIMIT}`, `--format=%H%x1f%cI%x1f%s`, `${from}..${to}`],
    10_000,
  ).catch(() => "")
  return parseCommitLog(raw)
}

/** Parses `v0.2.0`, `0.2.0`, and prerelease suffixes such as `1.0.0-rc.1`. */
export function parseStableTag(input: string): StableTag | undefined {
  const tag = input.trim()
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag)
  if (!match) return undefined
  const major = Number.parseInt(match[1] ?? "", 10)
  const minor = Number.parseInt(match[2] ?? "", 10)
  const patch = Number.parseInt(match[3] ?? "", 10)
  if (![major, minor, patch].every(Number.isFinite)) return undefined
  const prereleaseText = match[4] ?? ""
  const prerelease = prereleaseText
    ? prereleaseText.split(".").map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : part))
    : []
  return {
    tag,
    version: `${major}.${minor}.${patch}${prereleaseText ? `-${prereleaseText}` : ""}`,
    major,
    minor,
    patch,
    prerelease,
  }
}

function compareStableTags(left: StableTag, right: StableTag) {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  // A release outranks a prerelease with the same core version.
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const a = left.prerelease[index]
    const b = right.prerelease[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNumber = typeof a === "number"
    const bNumber = typeof b === "number"
    if (aNumber && bNumber) return a - b
    if (aNumber) return -1
    if (bNumber) return 1
    return String(a) < String(b) ? -1 : 1
  }
  return 0
}

/** Picks the highest release tag; prerelease tags are not part of the stable channel. */
export function selectStableTag(tags: readonly string[]): string | undefined {
  let best: StableTag | undefined
  for (const tag of tags) {
    const parsed = parseStableTag(tag)
    if (!parsed || parsed.prerelease.length > 0) continue
    if (!best || compareStableTags(parsed, best) > 0) best = parsed
  }
  return best?.tag
}

/** Extracts tag names from `git ls-remote --tags --refs origin` output. */
export function parseRemoteTags(raw: string): readonly string[] {
  const tags: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const ref = line.trim().split(/\s+/)[1]
    if (!ref?.startsWith("refs/tags/")) continue
    const tag = ref.slice("refs/tags/".length)
    if (tag) tags.push(tag)
  }
  return tags
}

async function findStableTarget(root: string): Promise<StableTarget | undefined> {
  const remote = await git(root, ["ls-remote", "--tags", "--refs", "origin"], gitTimeout)
  const tag = selectStableTag(parseRemoteTags(remote))
  if (!tag) return undefined
  await git(root, ["fetch", "--quiet", "--tags", "--force", "origin"], gitTimeout)
  const commit = await git(root, ["rev-parse", `refs/tags/${tag}^{commit}`], 10_000)
  return { tag, commit }
}

async function stableTargetOrThrow(root: string) {
  const target = await findStableTarget(root)
  if (!target) throw new Error("No stable release tags were found in the official repository.")
  return target
}

// --- Self-update info and check -------------------------------------------

export async function selfUpdateInfo(
  app: AppInfo,
  root = pluginRoot(),
  expectedRepo = SELF_UPDATE_REPO,
): Promise<SelfUpdateInfo> {
  const pkg = await readPackage(root)
  const repository = repositoryUrl(pkg.repository) ?? SELF_UPDATE_REPO_URL
  const install = await readGitInfo(root, expectedRepo)
  return {
    name: pkg.name ?? "opencode-extensions-manager",
    version: pkg.version ?? "0.0.0",
    ...(pkg.description ? { description: pkg.description } : {}),
    ...(authorName(pkg.author) ? { author: authorName(pkg.author)! } : {}),
    ...(pkg.license ? { license: pkg.license } : {}),
    repository,
    ...(pkg.homepage ? { homepage: pkg.homepage } : {}),
    ...(issuesUrl(pkg.bugs, repository) ? { issues: issuesUrl(pkg.bugs, repository)! } : {}),
    app,
    install,
  }
}

export async function checkSelfUpdate(
  root = pluginRoot(),
  expectedRepo = SELF_UPDATE_REPO,
  channel: SelfUpdateChannel = "main",
): Promise<SelfUpdateCheck> {
  const checkedAt = new Date().toISOString()
  const info = await selfUpdateInfo({ name: "", version: "", channel: "" }, root, expectedRepo).catch(
    () => undefined,
  )
  const currentVersion = info?.version ?? (await packageVersion(root))
  const base: SelfUpdateCheck = {
    checkedAt,
    ...(currentVersion ? { currentVersion } : {}),
    ...(info?.install.commit ? { currentCommit: info.install.commit } : {}),
    ahead: 0,
    behind: 0,
    updateAvailable: false,
    canUpdate: false,
    ...(info?.install.reason ? { reason: info.install.reason } : {}),
  }
  if (!info || info.install.kind !== "git" || !info.install.canUpdate) return base

  try {
    const currentCommit = await git(root, ["rev-parse", "HEAD"], 10_000)
    const currentDate = await git(root, ["log", "-1", "--format=%cI", "HEAD"], 10_000).catch(() => "")
    let targetCommit: string
    let latestVersion: string | undefined
    let targetLabel: string | undefined
    if (channel === "stable") {
      const target = await findStableTarget(root)
      if (!target) {
        return {
          ...base,
          currentVersion,
          currentCommit,
          ...(currentDate ? { currentDate } : {}),
          reason: "No stable release tags were found in the official repository.",
        }
      }
      targetCommit = target.commit
      latestVersion = parseStableTag(target.tag)?.version ?? (await showVersion(root, target.tag))
      targetLabel = target.tag
    } else {
      await git(root, ["fetch", "--quiet", "origin", "main"], gitTimeout)
      targetCommit = await git(root, ["rev-parse", "origin/main"], 10_000)
      latestVersion = await showVersion(root, "origin/main")
    }
    const counts = await git(root, ["rev-list", "--left-right", "--count", `HEAD...${targetCommit}`], 10_000)
    const [ahead = 0, behind = 0] = counts.split(/\s+/).map((value) => Number.parseInt(value, 10) || 0)
    const latestDate = await git(root, ["log", "-1", "--format=%cI", targetCommit], 10_000).catch(() => "")
    const latestMessage = await git(root, ["log", "-1", "--format=%s", targetCommit], 10_000).catch(() => "")
    const updateAvailable = behind > 0
    const stableSuffix = targetLabel ? `stable release ${targetLabel}` : "origin/main"
    let reason: string | undefined
    if (!updateAvailable) {
      if (channel === "stable" && ahead > 0) reason = `The checkout is ahead of the latest ${stableSuffix}.`
      else reason = "Already up to date."
    } else if (ahead > 0) {
      reason = `Local commits diverge from ${stableSuffix}, so a fast-forward update is not possible.`
    }
    return {
      ...base,
      currentVersion,
      currentCommit,
      ...(currentDate ? { currentDate } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      latestCommit: targetCommit,
      ...(latestDate ? { latestDate } : {}),
      ...(latestMessage ? { latestMessage } : {}),
      commits: await commitsBetween(root, "HEAD", targetCommit),
      ahead,
      behind,
      updateAvailable,
      canUpdate: updateAvailable && ahead === 0,
      ...(reason ? { reason } : {}),
    }
  } catch (error) {
    // A failed fetch means the answer is unknown, not that the checkout is current. The GUI keeps
    // the last successful check visible and reports this error separately.
    throw new Error(`Cannot check for updates: ${message(error)}`)
  }
}

// --- Apply and rollback ----------------------------------------------------

let updating = false

async function needsInstall(root: string, from: string, to: string) {
  const changed = await git(root, ["diff", "--name-only", from, to], 10_000)
  return changed
    .split(/\r?\n/)
    .map((file) => file.trim())
    .some((file) => packageFiles.has(file))
}

async function installAndBuild(root: string, log: string[], phase: "update" | "rollback") {
  const built = await npm(root, ["run", "build"], buildTimeout)
  log.push(built.stdout, built.stderr)
  if (built.code !== 0) {
    return `The GUI bundle could not be rebuilt after the ${phase}.`
  }
  return undefined
}

export async function applySelfUpdate(
  root = pluginRoot(),
  expectedRepo = SELF_UPDATE_REPO,
  channel: SelfUpdateChannel = "main",
  historyFile = selfUpdateHistoryPath(),
): Promise<SelfUpdateResult> {
  if (updating) {
    return {
      ok: false,
      previousCommit: "",
      commit: "",
      version: (await packageVersion(root)) ?? "0.0.0",
      restartRequired: false,
      error: "An update is already running.",
    }
  }
  updating = true
  const log: string[] = []
  let previousCommit = ""
  try {
    const info = await selfUpdateInfo({ name: "", version: "", channel: "" }, root, expectedRepo)
    if (info.install.kind !== "git") throw new Error("The plugin is not installed from a Git checkout.")
    if (!info.install.canUpdate) throw new Error(info.install.reason ?? "An automatic update is not available.")
    previousCommit = info.install.commit ?? (await git(root, ["rev-parse", "HEAD"], 10_000))
    let targetCommit: string
    let targetTag: string | undefined
    if (channel === "stable") {
      const target = await stableTargetOrThrow(root)
      targetCommit = target.commit
      targetTag = target.tag
      if (targetCommit === previousCommit) {
        return {
          ok: true,
          previousCommit,
          commit: previousCommit,
          version: (await packageVersion(root)) ?? "0.0.0",
          restartRequired: false,
        }
      }
      const ancestor = await run("git", ["merge-base", "--is-ancestor", previousCommit, targetCommit], root, 10_000)
      if (ancestor.code !== 0) {
        throw new Error(`The stable release ${targetTag} is not ahead of the current checkout.`)
      }
    } else {
      await git(root, ["fetch", "--quiet", "origin", "main"], gitTimeout)
      const counts = await git(root, ["rev-list", "--left-right", "--count", "HEAD...origin/main"], 10_000)
      const [ahead = 0, behind = 0] = counts.split(/\s+/).map((value) => Number.parseInt(value, 10) || 0)
      if (behind === 0) {
        return {
          ok: true,
          previousCommit,
          commit: previousCommit,
          version: (await packageVersion(root)) ?? "0.0.0",
          restartRequired: false,
        }
      }
      if (ahead > 0) throw new Error("Local commits diverge from origin/main, so a fast-forward update is not possible.")
      targetCommit = await git(root, ["rev-parse", "origin/main"], 10_000)
    }
    await git(root, ["merge", "--ff-only", targetCommit], 60_000)
    const commit = await git(root, ["rev-parse", "HEAD"], 10_000)
    if (await needsInstall(root, previousCommit, commit)) {
      const installed = await npm(root, ["install", "--no-audit", "--no-fund"], installTimeout)
      log.push(installed.stdout, installed.stderr)
      if (installed.code !== 0) throw new Error("npm install failed after the update.")
    }
    const buildError = await installAndBuild(root, log, "update")
    if (buildError) {
      return {
        ok: false,
        previousCommit,
        commit,
        version: (await packageVersion(root)) ?? "0.0.0",
        restartRequired: true,
        error: buildError,
        ...(log.join("\n").trim() ? { log: trimLog(log.join("\n")) } : {}),
      }
    }
    const version = (await packageVersion(root)) ?? "0.0.0"
    await recordSelfUpdateHistory(
      {
        commit,
        version,
        at: new Date().toISOString(),
        action: "update",
        previousCommit,
        ...(targetTag ? { note: `stable ${targetTag}` } : {}),
      },
      historyFile,
    ).catch(() => undefined)
    return {
      ok: true,
      previousCommit,
      commit,
      version,
      restartRequired: true,
      ...(log.join("\n").trim() ? { log: trimLog(log.join("\n")) } : {}),
    }
  } catch (error) {
    const commit = await git(root, ["rev-parse", "HEAD"], 5_000).catch(() => previousCommit)
    return {
      ok: false,
      previousCommit,
      commit,
      version: (await packageVersion(root)) ?? "0.0.0",
      restartRequired: Boolean(commit && previousCommit && commit !== previousCommit),
      error: message(error),
      ...(log.join("\n").trim() ? { log: trimLog(log.join("\n")) } : {}),
    }
  } finally {
    updating = false
  }
}

export async function rollbackSelfUpdate(
  commit: string,
  root = pluginRoot(),
  expectedRepo = SELF_UPDATE_REPO,
  historyFile = selfUpdateHistoryPath(),
): Promise<SelfUpdateResult> {
  if (updating) {
    return {
      ok: false,
      previousCommit: "",
      commit: "",
      version: (await packageVersion(root)) ?? "0.0.0",
      restartRequired: false,
      error: "An update is already running.",
    }
  }
  updating = true
  const log: string[] = []
  let previousCommit = ""
  try {
    const target = commit.trim()
    if (!/^[0-9a-f]{7,40}$/i.test(target)) {
      throw new Error("The rollback target is not a valid commit SHA.")
    }
    const info = await selfUpdateInfo({ name: "", version: "", channel: "" }, root, expectedRepo)
    if (info.install.kind !== "git") throw new Error("The plugin is not installed from a Git checkout.")
    if (!info.install.canUpdate) {
      throw new Error(`Rollback is not available: ${info.install.reason ?? "the checkout is not an official main checkout."}`)
    }
    previousCommit = info.install.commit ?? (await git(root, ["rev-parse", "HEAD"], 10_000))
    const exists = await run("git", ["rev-parse", "--verify", "--quiet", `${target}^{commit}`], root, 10_000)
    if (exists.code !== 0 || !exists.stdout.trim()) {
      throw new Error(`Commit ${shortCommit(target) ?? target} was not found in the local repository.`)
    }
    const resolved = exists.stdout.trim()
    if (resolved === previousCommit) throw new Error("The checkout is already at this commit.")
    const ancestor = await run("git", ["merge-base", "--is-ancestor", resolved, previousCommit], root, 10_000)
    if (ancestor.code !== 0) {
      throw new Error("The selected commit is not an ancestor of the current HEAD.")
    }
    const changed = await needsInstall(root, resolved, previousCommit)
    await git(root, ["reset", "--hard", resolved], 30_000)
    const current = await git(root, ["rev-parse", "HEAD"], 10_000)
    if (changed) {
      const installed = await npm(root, ["install", "--no-audit", "--no-fund"], installTimeout)
      log.push(installed.stdout, installed.stderr)
      if (installed.code !== 0) throw new Error("npm install failed after the rollback.")
    }
    const buildError = await installAndBuild(root, log, "rollback")
    if (buildError) {
      return {
        ok: false,
        previousCommit,
        commit: current,
        version: (await packageVersion(root)) ?? "0.0.0",
        restartRequired: true,
        error: buildError,
        ...(log.join("\n").trim() ? { log: trimLog(log.join("\n")) } : {}),
      }
    }
    const version = (await packageVersion(root)) ?? "0.0.0"
    await recordSelfUpdateHistory(
      {
        commit: current,
        version,
        at: new Date().toISOString(),
        action: "rollback",
        previousCommit,
      },
      historyFile,
    ).catch(() => undefined)
    return {
      ok: true,
      previousCommit,
      commit: current,
      version,
      restartRequired: true,
      ...(log.join("\n").trim() ? { log: trimLog(log.join("\n")) } : {}),
    }
  } catch (error) {
    const commit = await git(root, ["rev-parse", "HEAD"], 5_000).catch(() => previousCommit)
    return {
      ok: false,
      previousCommit,
      commit,
      version: (await packageVersion(root)) ?? "0.0.0",
      restartRequired: Boolean(commit && previousCommit && commit !== previousCommit),
      error: message(error),
      ...(log.join("\n").trim() ? { log: trimLog(log.join("\n")) } : {}),
    }
  } finally {
    updating = false
  }
}
