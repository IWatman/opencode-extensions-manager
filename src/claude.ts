import { readFile, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { expandHome, isDirectory, isFile, isRecord } from "./config.ts"
import {
  CLAUDE_IMPORT_MARKETPLACE,
  CLAUDE_IMPORT_MARKETPLACE_NAME,
  inspectPluginFolder,
  installedKey,
  installExtractedPlugin,
  readRegistry,
  type Extracted,
} from "./marketplaces.ts"
import type { ClaudePluginCandidate, ClaudePreview, Scope } from "./rpc"

/**
 * Claude Code keeps downloaded plugins under `<config>/plugins/cache`. The scanner only reads that
 * tree; it never writes to the Claude Code configuration or installs anything during preview.
 */
export function claudeConfigDir() {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim()
  return configured ? path.resolve(expandHome(configured)) : path.join(homedir(), ".claude")
}

export function claudeCacheDir() {
  return path.join(claudeConfigDir(), "plugins", "cache")
}

export interface ClaudeScanCandidate {
  readonly id: string
  readonly name: string
  readonly displayName?: string
  readonly description?: string
  readonly version?: string
  readonly marketplace?: string
  readonly source: string
  readonly extracted: Extracted
  readonly warnings: readonly string[]
  readonly error?: string
}

export interface ClaudeScanResult {
  readonly cacheDir: string
  readonly exists: boolean
  readonly candidates: readonly ClaudeScanCandidate[]
  readonly warnings: readonly string[]
  readonly error?: string
}

const maxScanDepth = 6
const maxCandidates = 250

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "plugin"
  )
}

function isVersionSegment(value: string) {
  return /^v?\d+(?:[._-]\d+)*(?:[-+][\w.-]+)?$/i.test(value) || /^[0-9a-f]{7,40}$/i.test(value)
}

/**
 * Builds an id from the cache-relative path with a trailing version segment removed, so a later
 * cached version of the same plugin updates the existing import record instead of creating another.
 */
function candidateId(relative: string, name: string, version?: string) {
  const segments = relative.replace(/\\/g, "/").split("/").filter(Boolean)
  const manifestVersion = version?.trim()
  while (segments.length > 1) {
    const last = segments[segments.length - 1]
    if (!isVersionSegment(last) && (!manifestVersion || (last !== manifestVersion && last !== `v${manifestVersion}`))) {
      break
    }
    segments.pop()
  }
  if (segments.length > 0) {
    const last = segments[segments.length - 1].replace(/@[^/]+$/, "")
    if (last) segments[segments.length - 1] = last
    else segments.pop()
  }
  return slug(segments.filter(Boolean).join("-") || name || "claude-plugin")
}

async function readJsonFile(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

async function readPluginManifest(directory: string) {
  for (const file of [".claude-plugin/plugin.json", "plugin.json"]) {
    const value = await readJsonFile(path.join(directory, file))
    if (value) return value
  }
  return undefined
}

async function looksLikePluginRoot(directory: string) {
  return (
    (await isFile(path.join(directory, ".claude-plugin", "plugin.json"))) ||
    (await isFile(path.join(directory, "plugin.json"))) ||
    (await isFile(path.join(directory, ".mcp.json"))) ||
    (await isDirectory(path.join(directory, "skills"))) ||
    (await isDirectory(path.join(directory, "commands"))) ||
    (await isDirectory(path.join(directory, "agents"))) ||
    (await isDirectory(path.join(directory, "hooks")))
  )
}

interface PluginRoot {
  readonly directory: string
  readonly relative: string
  readonly modified: number
}

async function findPluginRoots(cacheDir: string): Promise<{ roots: PluginRoot[]; warnings: string[] }> {
  const roots: PluginRoot[] = []
  const warnings: string[] = []
  const queue: { directory: string; relative: string; depth: number }[] = [
    { directory: cacheDir, relative: "", depth: 0 },
  ]

  while (queue.length > 0) {
    const current = queue.shift()!
    let entries
    try {
      entries = await readdir(current.directory, { withFileTypes: true })
    } catch (error) {
      if (current.relative === "") throw error
      warnings.push(`${current.directory}: ${message(error)}`)
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) continue
      const directory = path.join(current.directory, entry.name)
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name
      if (await looksLikePluginRoot(directory)) {
        const info = await stat(directory).catch(() => undefined)
        roots.push({ directory, relative, modified: info?.mtimeMs ?? 0 })
        continue
      }
      if (current.depth >= maxScanDepth) {
        warnings.push(`Skipped deep cache folder: ${directory}`)
        continue
      }
      queue.push({ directory, relative, depth: current.depth + 1 })
    }
  }
  return { roots, warnings }
}

interface GroupedRoot {
  readonly relative: string
  readonly directory: string
  readonly modified: number
}

/**
 * Scans a Claude Code plugin cache. `cacheDir` exists so tests and custom setups can point at a
 * temporary fixture; production calls omit it and get `CLAUDE_CONFIG_DIR` or `~/.claude`.
 */
export async function scanClaudePlugins(options: { cacheDir?: string } = {}): Promise<ClaudeScanResult> {
  const cacheDir = path.resolve(expandHome(options.cacheDir?.trim() || claudeCacheDir()))
  if (!(await isDirectory(cacheDir))) {
    return {
      cacheDir,
      exists: false,
      candidates: [],
      warnings: [],
      error: `Claude Code plugin cache not found: ${cacheDir}`,
    }
  }

  let scanned: { roots: PluginRoot[]; warnings: string[] }
  try {
    scanned = await findPluginRoots(cacheDir)
  } catch (error) {
    return {
      cacheDir,
      exists: true,
      candidates: [],
      warnings: [],
      error: `${cacheDir}: ${message(error)}`,
    }
  }

  const warnings = [...scanned.warnings]
  const groups = new Map<string, GroupedRoot[]>()
  for (const root of scanned.roots) {
    const manifest = await readPluginManifest(root.directory)
    const name =
      (isRecord(manifest) && typeof manifest.name === "string" && manifest.name.trim()) ||
      path.basename(root.directory) ||
      "claude-plugin"
    const version = isRecord(manifest) && typeof manifest.version === "string" ? manifest.version : undefined
    const id = candidateId(root.relative, name, version)
    const group = groups.get(id) ?? []
    group.push({ relative: root.relative, directory: root.directory, modified: root.modified })
    groups.set(id, group)
  }

  const candidates: ClaudeScanCandidate[] = []
  for (const [id, group] of groups) {
    // Several cached versions map to the same id. The newest folder wins; the rest stay reported so
    // the user can see why the chosen source was used.
    const ordered = [...group].sort(
      (left, right) => right.modified - left.modified || right.relative.localeCompare(left.relative),
    )
    const chosen = ordered[0]
    const manifest = await readPluginManifest(chosen.directory)
    const displayName =
      isRecord(manifest) && typeof manifest.displayName === "string" ? manifest.displayName : undefined
    const description =
      isRecord(manifest) && typeof manifest.description === "string" ? manifest.description : undefined
    const version =
      isRecord(manifest) && typeof manifest.version === "string" ? manifest.version : undefined
    const marketplace =
      chosen.relative.split("/").filter(Boolean).length > 1 ? chosen.relative.split("/")[0] : undefined
    const localWarnings: string[] = []
    if (ordered.length > 1) {
      localWarnings.push(
        `Multiple cached versions found; using ${chosen.directory}` +
          ` (also: ${ordered.slice(1).map((item) => item.directory).join(", ")})`,
      )
    }
    try {
      const extracted = await inspectPluginFolder(chosen.directory)
      if (extracted.plugins.length > 0) {
        localWarnings.push(
          "OpenCode plugin entries point at the Claude Code cache folder; copy the plugin somewhere stable if the cache may be cleaned.",
        )
      }
      const name =
        (isRecord(manifest) && typeof manifest.name === "string" && manifest.name.trim()) ||
        path.basename(chosen.directory) ||
        id
      candidates.push({
        id,
        name,
        ...(displayName ? { displayName } : {}),
        ...(description ? { description } : {}),
        ...(version ?? extracted.version ? { version: version ?? extracted.version } : {}),
        ...(marketplace ? { marketplace } : {}),
        source: chosen.directory,
        extracted,
        warnings: localWarnings,
      })
    } catch (error) {
      const name =
        (isRecord(manifest) && typeof manifest.name === "string" && manifest.name.trim()) ||
        path.basename(chosen.directory) ||
        id
      candidates.push({
        id,
        name,
        ...(displayName ? { displayName } : {}),
        ...(description ? { description } : {}),
        ...(version ? { version } : {}),
        ...(marketplace ? { marketplace } : {}),
        source: chosen.directory,
        extracted: { mcp: [], skills: [], adaptable: [], plugins: [], unsupported: [], warnings: [] },
        warnings: [...localWarnings, message(error)],
        error: message(error),
      })
    }
    if (candidates.length >= maxCandidates) {
      warnings.push(`Stopped after ${maxCandidates} cached plugins`)
      break
    }
  }

  return {
    cacheDir,
    exists: true,
    candidates: candidates.sort((left, right) => left.name.localeCompare(right.name)),
    warnings,
  }
}

function mcpSummary(config: Record<string, unknown>) {
  if (config.type === "remote" && typeof config.url === "string") return config.url
  if (Array.isArray(config.command)) {
    return config.command.filter((item): item is string => typeof item === "string").join(" ")
  }
  return ""
}

function projectRoot(project: string | undefined) {
  return path.resolve(expandHome(project?.trim() || process.cwd()))
}

export function toClaudeCandidate(
  candidate: ClaudeScanCandidate,
  installedKeyValue?: string,
): ClaudePluginCandidate {
  const { extracted } = candidate
  return {
    id: candidate.id,
    name: candidate.name,
    ...(candidate.displayName ? { displayName: candidate.displayName } : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
    ...(candidate.version ? { version: candidate.version } : {}),
    ...(candidate.marketplace ? { marketplace: candidate.marketplace } : {}),
    source: candidate.source,
    mcp: extracted.mcp.map((server) => ({ name: server.name, summary: mcpSummary(server.config) })),
    skills: extracted.skills.map((skill) => ({
      id: skill.id,
      ...(skill.name ? { name: skill.name } : {}),
      ...(skill.description ? { description: skill.description } : {}),
    })),
    adaptable: extracted.adaptable.map((skill) => ({
      id: skill.id,
      ...(skill.name ? { name: skill.name } : {}),
      ...(skill.description ? { description: skill.description } : {}),
      ...(skill.reason ? { reason: skill.reason } : {}),
    })),
    plugins: [...extracted.plugins],
    unsupported: [...extracted.unsupported],
    warnings: [...candidate.warnings, ...extracted.warnings],
    ...(installedKeyValue ? { installedKey: installedKeyValue } : {}),
    ...(candidate.error ? { error: candidate.error } : {}),
  }
}

async function installedClaudeIDs(scope: Scope, project: string | undefined) {
  const root = scope === "project" ? projectRoot(project) : undefined
  const { registry } = await readRegistry()
  const ids = new Set<string>()
  for (const record of registry.installed) {
    if (record.marketplace !== CLAUDE_IMPORT_MARKETPLACE) continue
    if (record.scope !== scope) continue
    if (scope === "project" && (!record.project || !root || path.resolve(record.project) !== root)) continue
    ids.add(record.plugin)
  }
  return ids
}

/** Read-only preview: candidates, compatible parts, unsupported parts, and source paths. */
export async function previewClaudePlugins(options: {
  cacheDir?: string
  scope: Scope
  project?: string
}): Promise<ClaudePreview> {
  const scan = await scanClaudePlugins({ ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}) })
  const installed = await installedClaudeIDs(options.scope, options.project)
  const root = options.scope === "project" ? projectRoot(options.project) : undefined
  return {
    cacheDir: scan.cacheDir,
    exists: scan.exists,
    candidates: scan.candidates.map((candidate) =>
      toClaudeCandidate(
        candidate,
        installed.has(candidate.id)
          ? installedKey(CLAUDE_IMPORT_MARKETPLACE, candidate.id, options.scope, root)
          : undefined,
      ),
    ),
    warnings: [...scan.warnings],
    ...(scan.error ? { error: scan.error } : {}),
  }
}

/**
 * Installs one scanned candidate through the shared marketplace transaction: snapshot, ownership
 * fingerprints, and a registry commit point.
 */
export async function installClaudeCandidate(
  candidate: ClaudeScanCandidate,
  input: { scope: Scope; project?: string; adapt?: boolean },
): Promise<{ key: string; skipped: string[] }> {
  if (candidate.error) throw new Error(candidate.error)
  return installExtractedPlugin({
    marketplace: CLAUDE_IMPORT_MARKETPLACE,
    marketplaceName: CLAUDE_IMPORT_MARKETPLACE_NAME,
    plugin: candidate.id,
    displayName: candidate.displayName ?? candidate.name,
    ...(candidate.description ? { description: candidate.description } : {}),
    ...(candidate.version ? { version: candidate.version } : {}),
    scope: input.scope,
    ...(input.project ? { project: input.project } : {}),
    extracted: candidate.extracted,
    ...(input.adapt === undefined ? {} : { adapt: input.adapt }),
  })
}
