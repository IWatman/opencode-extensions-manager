import { execFile } from "node:child_process"
import { readFile, realpath } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type {
  SelfUpdateCheck,
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

const gitTimeout = 45_000
const installTimeout = 300_000
const buildTimeout = 180_000
const maxLogLength = 8_000

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
    await git(root, ["fetch", "--quiet", "origin", "main"], gitTimeout)
    const currentCommit = await git(root, ["rev-parse", "HEAD"], 10_000)
    const currentDate = await git(root, ["log", "-1", "--format=%cI", "HEAD"], 10_000).catch(() => "")
    const latestCommit = await git(root, ["rev-parse", "origin/main"], 10_000)
    const counts = await git(root, ["rev-list", "--left-right", "--count", "HEAD...origin/main"], 10_000)
    const [ahead = 0, behind = 0] = counts.split(/\s+/).map((value) => Number.parseInt(value, 10) || 0)
    const latestVersion = await showVersion(root, "origin/main")
    const latestDate = await git(root, ["log", "-1", "--format=%cI", "origin/main"], 10_000).catch(() => "")
    const latestMessage = await git(root, ["log", "-1", "--format=%s", "origin/main"], 10_000).catch(() => "")
    const updateAvailable = behind > 0
    let reason: string | undefined
    if (!updateAvailable) reason = "Already up to date."
    else if (ahead > 0) reason = "Local commits diverge from origin/main, so a fast-forward update is not possible."
    return {
      ...base,
      currentVersion,
      currentCommit,
      ...(currentDate ? { currentDate } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      latestCommit,
      ...(latestDate ? { latestDate } : {}),
      ...(latestMessage ? { latestMessage } : {}),
      ahead,
      behind,
      updateAvailable,
      canUpdate: updateAvailable && ahead === 0,
      ...(reason ? { reason } : {}),
    }
  } catch (error) {
    return {
      ...base,
      reason: message(error),
    }
  }
}

let updating = false

export async function applySelfUpdate(
  root = pluginRoot(),
  expectedRepo = SELF_UPDATE_REPO,
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
    await git(root, ["merge", "--ff-only", "origin/main"], 60_000)
    const commit = await git(root, ["rev-parse", "HEAD"], 10_000)
    const changed = await git(root, ["diff", "--name-only", previousCommit, commit], 10_000)
    const packageFiles = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"])
    const needsInstall = changed.split(/\r?\n/).some((file) => packageFiles.has(file.trim()))
    if (needsInstall) {
      const installed = await npm(root, ["install", "--no-audit", "--no-fund"], installTimeout)
      log.push(installed.stdout, installed.stderr)
      if (installed.code !== 0) throw new Error("npm install failed after the update.")
    }
    const built = await npm(root, ["run", "build"], buildTimeout)
    log.push(built.stdout, built.stderr)
    if (built.code !== 0) {
      return {
        ok: false,
        previousCommit,
        commit,
        version: (await packageVersion(root)) ?? "0.0.0",
        restartRequired: true,
        error: "The GUI bundle could not be rebuilt after the update.",
        ...(log.join("\n").trim() ? { log: trimLog(log.join("\n")) } : {}),
      }
    }
    return {
      ok: true,
      previousCommit,
      commit,
      version: (await packageVersion(root)) ?? "0.0.0",
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
