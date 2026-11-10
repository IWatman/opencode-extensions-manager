import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import { splitCommand } from "./commands.ts"
import {
  expandHome,
  globalConfigDir,
  hasPlugin,
  isDirectory,
  isFile,
  isRecord,
  listPlugins,
  listSkills,
  mcpServers,
  parseFrontmatter,
  pluginTarget,
  readScope,
  removePluginPackage,
  removeMcp,
  removeSkill,
  resolveScope,
  saveMcp,
  savePlugin,
  saveSkill,
  setMcpEnabled,
  setSkillEnabled,
  updateScope,
  validateMcpConfig,
  writeAtomic,
  type Mutation,
  type ScopePaths,
} from "./config.ts"
import { prewarmPackageRunner } from "./package-runner.ts"
import type {
  BatchUpdateResult,
  InstalledPlugin,
  MarketplaceInfo,
  MarketplacePlugin,
  MarketplaceUpdate,
  PluginInspection,
  RepositoryInspection,
  RepositoryProposal,
  Scope,
} from "./rpc"

/* ---------------------------------------------------------------------------------------------- */
/* Registry                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export const DEFAULT_MARKETPLACE_URL = "https://github.com/anthropics/claude-plugins-official"

/** Synthetic marketplace id for plugins imported from a Claude Code cache. */
export const CLAUDE_IMPORT_MARKETPLACE = "claude-code"
export const CLAUDE_IMPORT_MARKETPLACE_NAME = "Claude Code"

export interface MarketplaceRecord {
  readonly id: string
  readonly url: string
  readonly name: string
  readonly description?: string
  readonly ref?: string
  readonly builtin?: boolean
  readonly addedAt: string
}

/**
 * Content hashes for every artifact this manager owns. Keys are the installed MCP name, skill id,
 * or plugin package target. A missing hash means the artifact predates fingerprinting.
 */
export interface ArtifactFingerprints {
  readonly mcp: Readonly<Record<string, string>>
  readonly skills: Readonly<Record<string, string>>
  readonly plugins: Readonly<Record<string, string>>
}

export interface InstalledRecord {
  readonly key: string
  readonly marketplace: string
  readonly marketplaceName: string
  readonly plugin: string
  readonly displayName?: string
  readonly description?: string
  readonly scope: Scope
  readonly project?: string
  readonly enabled: boolean
  readonly adapt?: boolean
  readonly installedAt: string
  readonly updatedAt: string
  readonly version?: string
  readonly commit?: string
  /** Revision installed before the most recent successful update, used by rollback. */
  readonly previousVersion?: string
  readonly previousCommit?: string
  readonly mcp: readonly string[]
  readonly skills: readonly string[]
  readonly plugins: readonly string[]
  readonly unsupported: readonly string[]
  readonly fingerprints?: ArtifactFingerprints
  /** Artifacts left in place because the user changed them after installation. */
  readonly skipped?: readonly string[]
  readonly error?: string
}

export interface Registry {
  readonly version: 1
  readonly marketplaces: readonly MarketplaceRecord[]
  readonly installed: readonly InstalledRecord[]
}

export const BUILTIN_MARKETPLACE: MarketplaceRecord = {
  id: "claude-plugins-official",
  url: DEFAULT_MARKETPLACE_URL,
  name: "claude-plugins-official",
  description:
    "Directory of popular Claude Code extensions including development tools, productivity plugins, and MCP integrations",
  builtin: true,
  addedAt: "",
}

function emptyRegistry(): Registry {
  return { version: 1, marketplaces: [], installed: [] }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function registryPath() {
  const custom = process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY?.trim()
  return custom || path.join(globalConfigDir(), "extensions-manager.json")
}

/** Exposed so a failed install can restore the registry exactly as it was before the attempt. */
export function registryFilePath() {
  return registryPath()
}

function normalizeProjectPath(project: string | undefined) {
  return path.resolve(expandHome(project?.trim() || process.cwd()))
}

/**
 * Installed records are keyed by marketplace, plugin, scope, and (for project installs) the
 * resolved project directory. Scope in the key lets one plugin be installed globally and in any
 * number of projects at the same time. The project path is URI-encoded so it cannot introduce key
 * separators on Windows (`C:\work`) or POSIX (`/home/me/work`).
 */
export function installedKey(marketplace: string, plugin: string, scope: Scope, project?: string) {
  const base = `${marketplace}/${plugin}`
  if (scope === "global") return `${base}@global`
  return `${base}@project:${encodeURIComponent(normalizeProjectPath(project))}`
}

function stringHashMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") result[key] = item
  }
  return result
}

function normalizeFingerprints(value: unknown): ArtifactFingerprints | undefined {
  if (!isRecord(value)) return undefined
  const mcp = stringHashMap(value.mcp)
  const skills = stringHashMap(value.skills)
  const plugins = stringHashMap(value.plugins)
  if (!mcp && !skills && !plugins) return undefined
  return { mcp: mcp ?? {}, skills: skills ?? {}, plugins: plugins ?? {} }
}

export function normalizeRegistry(input: unknown): Registry {
  if (!isRecord(input)) return emptyRegistry()
  const marketplaces = Array.isArray(input.marketplaces)
    ? input.marketplaces.filter(isRecord).flatMap((entry) => {
        if (typeof entry.url !== "string") return []
        const url = entry.url
        return [
          {
            id: typeof entry.id === "string" ? entry.id : marketplaceID(url),
            url,
            name: typeof entry.name === "string" ? entry.name : marketplaceID(url),
            ...(typeof entry.description === "string" ? { description: entry.description } : {}),
            ...(typeof entry.ref === "string" ? { ref: entry.ref } : {}),
            ...(entry.builtin === true ? { builtin: true } : {}),
            addedAt: typeof entry.addedAt === "string" ? entry.addedAt : new Date().toISOString(),
          } satisfies MarketplaceRecord,
        ]
      })
    : []
  const installed = Array.isArray(input.installed)
    ? input.installed.filter(isRecord).flatMap((entry) => {
        if (
          typeof entry.key !== "string" ||
          typeof entry.marketplace !== "string" ||
          typeof entry.plugin !== "string" ||
          (entry.scope !== "global" && entry.scope !== "project")
        ) {
          return []
        }
        const scope = entry.scope
        const storedProject = typeof entry.project === "string" ? entry.project : undefined
        // Resolve the project path once so legacy relative paths match the installed key and the
        // GUI's comparison with the current project root.
        const project = scope === "project" && storedProject ? normalizeProjectPath(storedProject) : storedProject
        const fingerprints = normalizeFingerprints(entry.fingerprints)
        return [
          {
            // Legacy keys were `${marketplace}/${plugin}`; recompute every key so old records move
            // to the scope-aware format exactly once while keeping all of their other fields.
            key: installedKey(entry.marketplace, entry.plugin, scope, project),
            marketplace: entry.marketplace,
            marketplaceName: typeof entry.marketplaceName === "string" ? entry.marketplaceName : entry.marketplace,
            plugin: entry.plugin,
            ...(typeof entry.displayName === "string" ? { displayName: entry.displayName } : {}),
            ...(typeof entry.description === "string" ? { description: entry.description } : {}),
            scope,
            ...(project ? { project } : {}),
            enabled: entry.enabled !== false,
            ...(entry.adapt === true ? { adapt: true } : {}),
            installedAt: typeof entry.installedAt === "string" ? entry.installedAt : new Date().toISOString(),
            updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
            ...(typeof entry.version === "string" ? { version: entry.version } : {}),
            ...(typeof entry.commit === "string" ? { commit: entry.commit } : {}),
            ...(typeof entry.previousVersion === "string" ? { previousVersion: entry.previousVersion } : {}),
            ...(typeof entry.previousCommit === "string" ? { previousCommit: entry.previousCommit } : {}),
            mcp: Array.isArray(entry.mcp) ? entry.mcp.filter((value): value is string => typeof value === "string") : [],
            skills: Array.isArray(entry.skills)
              ? entry.skills.filter((value): value is string => typeof value === "string")
              : [],
            plugins: Array.isArray(entry.plugins)
              ? entry.plugins.filter((value): value is string => typeof value === "string")
              : [],
            unsupported: Array.isArray(entry.unsupported)
              ? entry.unsupported.filter((value): value is string => typeof value === "string")
              : [],
            ...(fingerprints ? { fingerprints } : {}),
            ...(Array.isArray(entry.skipped)
              ? { skipped: entry.skipped.filter((value): value is string => typeof value === "string") }
              : {}),
            ...(typeof entry.error === "string" ? { error: entry.error } : {}),
          } satisfies InstalledRecord,
        ]
      })
    : []
  // A registry written by a newer build may contain duplicate keys. Keep the newest record for a
  // key instead of returning two rows that would make uninstall ambiguous.
  const unique = new Map<string, InstalledRecord>()
  for (const record of installed) {
    unique.delete(record.key)
    unique.set(record.key, record)
  }
  return { version: 1, marketplaces, installed: [...unique.values()] }
}

export async function readRegistry(): Promise<{ registry: Registry; error?: string }> {
  const file = registryPath()
  if (!(await isFile(file))) return { registry: emptyRegistry() }
  try {
    return { registry: normalizeRegistry(JSON.parse(await readFile(file, "utf8"))) }
  } catch (error) {
    return { registry: emptyRegistry(), error: `${file}: ${message(error)}` }
  }
}

export async function writeRegistry(registry: Registry) {
  const next: Registry = {
    version: 1,
    marketplaces: registry.marketplaces,
    installed: registry.installed,
  }
  await writeAtomic(registryPath(), `${JSON.stringify(next, null, 2)}\n`, true)
}

export function marketplaceRecords(registry: Registry): MarketplaceRecord[] {
  const extra = registry.marketplaces.filter(
    (record) => record.id !== BUILTIN_MARKETPLACE.id && record.url !== BUILTIN_MARKETPLACE.url,
  )
  return [BUILTIN_MARKETPLACE, ...extra]
}

export function findMarketplace(registry: Registry, id: string) {
  return marketplaceRecords(registry).find((record) => record.id === id)
}

export function installedRecords(registry: Registry): InstalledPlugin[] {
  return registry.installed.map((record) => ({ ...record }))
}

export function marketplaceInfo(record: MarketplaceRecord, extra: Partial<MarketplaceInfo> = {}): MarketplaceInfo {
  return {
    id: record.id,
    name: record.name,
    url: record.url,
    builtin: record.builtin === true,
    ...(record.description ? { description: record.description } : {}),
    ...(record.ref ? { ref: record.ref } : {}),
    ...extra,
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Source locations                                                                                */
/* ---------------------------------------------------------------------------------------------- */

interface GithubLocation {
  readonly kind: "github"
  readonly owner: string
  readonly repo: string
  readonly ref: string
  readonly subpath: string
  readonly canonical: string
}

interface LocalLocation {
  readonly kind: "local"
  readonly localPath: string
  readonly canonical: string
}

type Location = GithubLocation | LocalLocation

class NotAMarketplaceError extends Error {}

function isPathLike(input: string) {
  return (
    input.startsWith("file://") ||
    input.startsWith("/") ||
    input.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(input) ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    input.startsWith("~")
  )
}

function parseGithub(input: string): GithubLocation | undefined {
  let value = input.trim().replace(/^git\+/, "").replace(/^github:/, "")
  if (value.startsWith("git@github.com:")) value = value.slice("git@github.com:".length)
  if (value.startsWith("github.com/")) value = `https://${value}`
  if (!value.startsWith("http://") && !value.startsWith("https://") && /^[\w.-]+\/[\w.-]+/.test(value)) {
    value = `https://github.com/${value}`
  }
  if (!value.startsWith("https://github.com/") && !value.startsWith("http://github.com/")) return undefined
  const url = new URL(value.replace(/^http:\/\/github\.com\//, "https://github.com/"))
  const parts = url.pathname
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean)
  const owner = parts[0]
  const repo = parts[1]
  if (!owner || !repo) return undefined
  let ref = ""
  let subpath = ""
  if (parts[2] === "tree" && parts[3]) {
    ref = decodeURIComponent(parts[3])
    subpath = parts.slice(4).map(decodeURIComponent).join("/")
  }
  return {
    kind: "github",
    owner,
    repo,
    ref,
    subpath,
    canonical: ref
      ? `https://github.com/${owner}/${repo}/tree/${ref}${subpath ? `/${subpath}` : ""}`
      : `https://github.com/${owner}/${repo}`,
  }
}

function parseLocation(input: string, ref?: string): Location {
  const value = input.trim()
  if (!value) throw new Error("Marketplace URL must not be empty")
  if (isPathLike(value)) {
    const localPath = value.startsWith("file://")
      ? fileURLToPath(value)
      : path.resolve(expandHome(value))
    return {
      kind: "local",
      localPath,
      canonical: localPath,
    }
  }
  const github = parseGithub(value)
  if (!github) throw new Error(`Unsupported marketplace URL: ${value}`)
  return {
    ...github,
    ref: ref || github.ref,
  }
}

function cloneLocation(location: Location, ref: string): Location {
  if (location.kind === "local") return location
  return { ...location, ref: ref || location.ref }
}

function joinSubpath(prefix: string, suffix: string) {
  const parts = [prefix, suffix].flatMap((part) =>
    part
      .replace(/\\/g, "/")
      .split("/")
      .filter((segment) => segment.length > 0 && segment !== "."),
  )
  if (parts.some((segment) => segment === "..")) throw new Error("Marketplace source escapes its root")
  return parts.join("/")
}

function marketplaceID(url: string) {
  const github = parseGithub(url)
  if (github) return `${github.owner}/${github.repo}`
  const local = parseLocation(url)
  if (local.kind === "local") {
    return `local-${path.basename(local.localPath).replace(/[^a-zA-Z0-9._-]+/g, "-") || "marketplace"}`
  }
  return "marketplace"
}

/* ---------------------------------------------------------------------------------------------- */
/* Network                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

interface FetchResult {
  readonly ok: boolean
  readonly status: number
  readonly text?: string
  readonly error?: string
}

async function fetchText(url: string, timeout = 12_000): Promise<FetchResult> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "opencode-extensions-manager" },
      signal: AbortSignal.timeout(timeout),
    })
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `${response.status} ${response.statusText}`,
      }
    }
    return { ok: true, status: response.status, text: await response.text() }
  } catch (error) {
    return { ok: false, status: 0, error: message(error) }
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const result = await fetchText(url)
  if (!result.ok) {
    if (result.status === 403 || result.status === 429) {
      throw new Error(
        `GitHub API rate limit or access error (${result.status}). Try again later or add the marketplace locally. ${url}`,
      )
    }
    throw new Error(`Failed to load ${url}: ${result.error ?? result.status}`)
  }
  return JSON.parse(result.text ?? "null") as T
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const current = index++
      if (current >= items.length) return
      result[current] = await run(items[current])
    }
  })
  await Promise.all(workers)
  return result
}

const commitCache = new Map<string, { at: number; sha?: string }>()
const commitCacheTTL = 60 * 1000

/**
 * Resolves a branch or tag to the commit GitHub currently points at. Update checks store commit SHA
 * values so a branch that moved can be detected even when the plugin does not bump its version.
 */
async function githubCommitSha(
  owner: string,
  repo: string,
  ref: string,
  force = false,
): Promise<string | undefined> {
  const key = `${owner}/${repo}@${ref}`
  const cached = commitCache.get(key)
  if (!force && cached && Date.now() - cached.at < commitCacheTTL) return cached.sha
  try {
    const data = await fetchJson<{ sha?: string }>(
      `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
    )
    const sha = typeof data.sha === "string" && data.sha.length > 0 ? data.sha : undefined
    commitCache.set(key, { at: Date.now(), sha })
    return sha
  } catch {
    // Version metadata still works when the GitHub API is rate-limited or offline.
    commitCache.set(key, { at: Date.now(), sha: undefined })
    return undefined
  }
}

function isCommitSha(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value)
}

/* ---------------------------------------------------------------------------------------------- */
/* Marketplace manifests                                                                           */
/* ---------------------------------------------------------------------------------------------- */

interface MarketplacePluginRaw {
  readonly name?: string
  readonly displayName?: string
  readonly description?: string
  readonly author?: unknown
  readonly category?: string
  readonly homepage?: string
  readonly version?: string
  readonly source?: unknown
  readonly skills?: readonly string[]
  readonly mcpServers?: unknown
  readonly strict?: boolean
  readonly hooks?: unknown
  readonly lspServers?: unknown
}

interface MarketplaceManifest {
  readonly name?: string
  readonly description?: string
  readonly owner?: unknown
  readonly plugins?: readonly MarketplacePluginRaw[]
}

interface LoadedMarketplace {
  readonly record: MarketplaceRecord
  readonly manifest: MarketplaceManifest
  readonly location: Location
}

const marketplaceCache = new Map<string, { at: number; value: LoadedMarketplace }>()
const marketplaceCacheTTL = 5 * 60 * 1000

function cacheKey(record: MarketplaceRecord) {
  // The same repository can be browsed at different refs; keep their manifests apart.
  return `${record.id}\n${record.url}\n${record.ref ?? ""}`
}

async function readLocalManifest(location: LocalLocation): Promise<MarketplaceManifest | undefined> {
  const candidates = [
    path.join(location.localPath, ".claude-plugin", "marketplace.json"),
    path.join(location.localPath, "marketplace.json"),
  ]
  for (const candidate of candidates) {
    if (!(await isFile(candidate))) continue
    try {
      return JSON.parse(await readFile(candidate, "utf8")) as MarketplaceManifest
    } catch (error) {
      throw new Error(`${candidate}: ${message(error)}`)
    }
  }
  return undefined
}

async function readGithubManifest(
  location: GithubLocation,
  storedRef?: string,
): Promise<{ ref: string; manifest: MarketplaceManifest } | undefined> {
  const refs = [storedRef, location.ref, "main", "master"].filter(
    (ref, index, list): ref is string => typeof ref === "string" && ref.length > 0 && list.indexOf(ref) === index,
  )
  for (const ref of refs) {
    const base = `https://raw.githubusercontent.com/${location.owner}/${location.repo}/${ref}`
    const prefix = location.subpath ? `${location.subpath}/` : ""
    for (const candidate of [
      `${base}/${prefix}.claude-plugin/marketplace.json`,
      `${base}/${prefix}marketplace.json`,
    ]) {
      const result = await fetchText(candidate)
      if (!result.ok) {
        if (result.status === 0) {
          throw new Error(`Failed to connect to GitHub: ${result.error ?? "network error"}`)
        }
        if (result.status === 404) continue
        throw new Error(`Failed to load marketplace ${candidate}: ${result.error ?? result.status}`)
      }
      try {
        return { ref, manifest: JSON.parse(result.text ?? "null") as MarketplaceManifest }
      } catch (error) {
        throw new Error(`${candidate}: ${message(error)}`)
      }
    }
  }
  return undefined
}

function ownerName(owner: unknown) {
  if (typeof owner === "string") return owner
  if (isRecord(owner) && typeof owner.name === "string") return owner.name
  return undefined
}

export async function loadMarketplace(record: MarketplaceRecord, force = false): Promise<LoadedMarketplace> {
  const key = cacheKey(record)
  const cached = marketplaceCache.get(key)
  if (!force && cached && Date.now() - cached.at < marketplaceCacheTTL) return cached.value

  const location = parseLocation(record.url, record.ref)
  let manifest: MarketplaceManifest | undefined
  let finalLocation: Location = location
  if (location.kind === "local") {
    manifest = await readLocalManifest(location)
    if (!manifest) throw new NotAMarketplaceError(`No .claude-plugin/marketplace.json in the folder: ${location.localPath}`)
  } else {
    const loaded = await readGithubManifest(location, record.ref)
    if (!loaded) {
      throw new NotAMarketplaceError(
        `Not a marketplace: ${record.url} has no .claude-plugin/marketplace.json`,
      )
    }
    manifest = loaded.manifest
    finalLocation = cloneLocation(location, loaded.ref)
  }

  const plugins = Array.isArray(manifest.plugins) ? manifest.plugins : []
  const value: LoadedMarketplace = {
    record: {
      ...record,
      name: manifest.name || record.name || marketplaceID(record.url),
      ...(manifest.description || record.description ? { description: manifest.description ?? record.description } : {}),
      ...(finalLocation.kind === "github" && finalLocation.ref ? { ref: finalLocation.ref } : {}),
    },
    manifest: { ...manifest, plugins },
    location: finalLocation,
  }
  // Keep the owner separately for the UI without widening the registry shape.
  Object.defineProperty(value, "owner", { value: ownerName(manifest.owner), enumerable: false })
  marketplaceCache.set(key, { at: Date.now(), value })
  return value
}

export function marketplaceOwner(loaded: LoadedMarketplace) {
  return (loaded as LoadedMarketplace & { owner?: string }).owner
}

export async function listMarketplaces(force = false): Promise<MarketplaceInfo[]> {
  const { registry } = await readRegistry()
  const records = marketplaceRecords(registry)
  const loaded = await Promise.all(
    records.map(async (record) => {
      try {
        const value = await loadMarketplace(record, force)
        return marketplaceInfo(value.record, {
          pluginCount: value.manifest.plugins?.length ?? 0,
          ...(marketplaceOwner(value) ? { owner: marketplaceOwner(value) } : {}),
        })
      } catch (error) {
        return marketplaceInfo(record, { error: message(error) })
      }
    }),
  )
  return loaded.sort((left, right) => Number(right.builtin) - Number(left.builtin) || left.name.localeCompare(right.name))
}

export async function getCatalog(
  marketplaceIDValue: string,
  force = false,
  target?: { scope: Scope; project?: string },
): Promise<MarketplacePlugin[]> {
  const { registry } = await readRegistry()
  const record = findMarketplace(registry, marketplaceIDValue)
  if (!record) throw new Error(`Marketplace not found: ${marketplaceIDValue}`)
  const loaded = await loadMarketplace(record, force)
  const targetProject = target?.scope === "project" ? normalizeProjectPath(target.project) : undefined
  return (loaded.manifest.plugins ?? []).flatMap((entry) => {
    if (typeof entry.name !== "string" || entry.name.length === 0) return []
    const author = authorName(entry.author)
    const installed = registry.installed.find(
      (item) =>
        item.marketplace === record.id &&
        item.plugin === entry.name &&
        (!target ||
          (item.scope === target.scope &&
            (target.scope === "global" ||
              (item.project !== undefined &&
                targetProject !== undefined &&
                normalizeProjectPath(item.project) === targetProject)))),
    )
    return [
      {
        marketplace: record.id,
        name: entry.name,
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
        ...(entry.description ? { description: entry.description } : {}),
        ...(author ? { author } : {}),
        ...(entry.category ? { category: entry.category } : {}),
        ...(entry.homepage ? { homepage: entry.homepage } : {}),
        ...(entry.version ? { version: entry.version } : {}),
        ...(installed ? { installedKey: installed.key } : {}),
      },
    ]
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Plugin sources                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

interface PluginLocation {
  readonly kind: "github" | "local"
  readonly owner?: string
  readonly repo?: string
  readonly ref?: string
  readonly subpath?: string
  readonly localPath?: string
  readonly sourceLabel: string
}

function authorName(author: unknown) {
  if (typeof author === "string") return author
  if (isRecord(author) && typeof author.name === "string") return author.name
  return undefined
}

function pluginLocation(entry: MarketplacePluginRaw, marketplace: LoadedMarketplace): PluginLocation {
  const source = entry.source
  const root = marketplace.location

  if (typeof source === "string") {
    const value = source.trim()
    if (value.startsWith("./") || value.startsWith("../") || (!value.includes("://") && !value.startsWith("github:"))) {
      if (root.kind === "local") {
        const resolved = path.resolve(root.localPath, value)
        if (resolved !== root.localPath && !resolved.startsWith(`${root.localPath}${path.sep}`)) {
          throw new Error("Plugin source escapes the marketplace root")
        }
        return { kind: "local", localPath: resolved, sourceLabel: resolved }
      }
      const subpath = joinSubpath(root.subpath, value)
      return {
        kind: "github",
        owner: root.owner,
        repo: root.repo,
        ref: root.ref,
        subpath,
        sourceLabel: `https://github.com/${root.owner}/${root.repo}/tree/${root.ref}${subpath ? `/${subpath}` : ""}`,
      }
    }
    return externalLocation(value, root)
  }

  if (isRecord(source)) {
    const url = typeof source.url === "string" ? source.url : undefined
    const repo = typeof source.repo === "string" ? source.repo : undefined
    const ref = typeof source.sha === "string" ? source.sha : typeof source.ref === "string" ? source.ref : undefined
    const subpath = typeof source.path === "string" ? source.path : undefined
    if (url || repo) return externalLocation(url ?? repo!, root, ref, subpath)
    if (typeof source.source === "string" && source.source.startsWith(".")) {
      return pluginLocation({ ...entry, source: source.source }, marketplace)
    }
  }

  // Inline data without a source: the marketplace root is the plugin.
  if (root.kind === "local") return { kind: "local", localPath: root.localPath, sourceLabel: root.localPath }
  return {
    kind: "github",
    owner: root.owner,
    repo: root.repo,
    ref: root.ref,
    subpath: root.subpath,
    sourceLabel: `https://github.com/${root.owner}/${root.repo}`,
  }
}

function externalLocation(value: string, root: Location, ref?: string, subpath?: string): PluginLocation {
  const parsed = parseLocation(value, ref)
  if (parsed.kind === "local") {
    return { kind: "local", localPath: parsed.localPath, sourceLabel: parsed.localPath }
  }
  const finalSubpath = subpath ? joinSubpath(parsed.subpath, subpath) : parsed.subpath
  return {
    kind: "github",
    owner: parsed.owner,
    repo: parsed.repo,
    ref: ref || parsed.ref || (root.kind === "github" ? root.ref : "main"),
    subpath: finalSubpath,
    sourceLabel: `https://github.com/${parsed.owner}/${parsed.repo}${ref ? `/tree/${ref}` : ""}${finalSubpath ? `/${finalSubpath}` : ""}`,
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Fetching plugin files                                                                           */
/* ---------------------------------------------------------------------------------------------- */

interface TreeEntry {
  readonly path: string
  readonly type: "blob" | "tree"
}

const treeCache = new Map<string, { at: number; value: TreeEntry[] }>()
const treeCacheTTL = 5 * 60 * 1000

async function githubTree(location: PluginLocation, force = false): Promise<TreeEntry[]> {
  const owner = location.owner
  const repo = location.repo
  const ref = location.ref
  if (!owner || !repo || !ref) throw new Error("Could not determine the plugin's GitHub repository")
  const key = `${owner}/${repo}@${ref}`
  const cached = treeCache.get(key)
  if (!force && cached && Date.now() - cached.at < treeCacheTTL) return cached.value
  const data = await fetchJson<{ tree?: TreeEntry[]; truncated?: boolean; message?: string }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  )
  if (!Array.isArray(data.tree)) throw new Error(data.message ?? `Failed to fetch the tree for ${owner}/${repo}`)
  const value = data.tree.filter((entry) => entry.type === "blob" || entry.type === "tree")
  treeCache.set(key, { at: Date.now(), value })
  return value
}

export function clearTreeCache() {
  treeCache.clear()
  commitCache.clear()
}

interface PluginFiles {
  readonly location: PluginLocation
  readonly paths: readonly string[]
  readonly text: ReadonlyMap<string, string>
}

function isTextFile(value: string) {
  return /\.(md|json|jsonc|ya?ml|txt|toml|mjs|cjs|js|ts|tsx|jsx)$/i.test(value)
}

async function readLocalPluginFiles(location: PluginLocation, root: string): Promise<PluginFiles> {
  const paths: string[] = []
  const text = new Map<string, string>()
  const queue = [{ dir: root, prefix: "" }]
  while (queue.length > 0) {
    const item = queue.shift()!
    let entries
    try {
      entries = await readdir(item.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue
      const relative = item.prefix ? `${item.prefix}/${entry.name}` : entry.name
      const full = path.join(item.dir, entry.name)
      if (entry.isDirectory()) {
        queue.push({ dir: full, prefix: relative })
        continue
      }
      if (!entry.isFile()) continue
      paths.push(relative)
      if (!isTextFile(relative)) continue
      try {
        const content = await readFile(full, "utf8")
        if (content.length <= 1_000_000) text.set(relative, content)
      } catch {
        // A binary or unreadable file is not needed for compatibility.
      }
    }
  }
  return { location, paths, text }
}

function normalizeSkillPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "")
  if (!normalized || normalized.split("/").includes("..")) return undefined
  return normalized
}

async function fetchGithubPluginFiles(
  location: PluginLocation,
  force = false,
  entry?: MarketplacePluginRaw,
): Promise<PluginFiles> {
  const tree = await githubTree(location, force)
  const prefix = location.subpath ? `${location.subpath}/` : ""
  const all = tree
    .filter((entry) => entry.type === "blob" && entry.path.startsWith(prefix))
    .map((entry) => entry.path.slice(prefix.length))
  const paths = all.filter((entry) => entry.length > 0)
  const needed = new Set<string>()
  for (const entryPath of paths) {
    if (
      entryPath === ".mcp.json" ||
      entryPath === "package.json" ||
      entryPath === "README.md" ||
      entryPath === "plugin.json" ||
      entryPath === ".claude-plugin/plugin.json" ||
      /(^|\/)skills\/.+\.md$/i.test(entryPath) ||
      /(^|\/)SKILL\.md$/i.test(entryPath) ||
      /^[^/]+\.md$/i.test(entryPath)
    ) {
      needed.add(entryPath)
    }
  }
  if (entry && Array.isArray(entry.skills)) {
    for (const raw of entry.skills) {
      if (typeof raw !== "string") continue
      const value = normalizeSkillPath(raw)
      if (!value) continue
      if (value.endsWith(".md")) needed.add(value)
      else needed.add(`${value}/SKILL.md`)
    }
  }
  const owner = location.owner!
  const repo = location.repo!
  const ref = location.ref!
  const text = new Map<string, string>()
  await mapLimit([...needed], 6, async (entryPath) => {
    const fullPath = prefix ? `${prefix}${entryPath}` : entryPath
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${fullPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`
    const result = await fetchText(url)
    if (result.ok && result.text !== undefined && result.text.length <= 1_000_000) text.set(entryPath, result.text)
  })
  return { location, paths, text }
}

async function pluginFiles(location: PluginLocation, force = false, entry?: MarketplacePluginRaw): Promise<PluginFiles> {
  if (location.kind === "local") {
    if (!location.localPath || !(await isDirectory(location.localPath))) {
      throw new Error(`Plugin folder not found: ${location.localPath ?? ""}`)
    }
    return readLocalPluginFiles(location, location.localPath)
  }
  return fetchGithubPluginFiles(location, force, entry)
}

/* ---------------------------------------------------------------------------------------------- */
/* Compatibility extraction                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export interface SkillSource {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly content: string
}

export interface SkillCandidate extends SkillSource {
  readonly reason?: string
}

export interface Extracted {
  readonly mcp: readonly { name: string; config: Record<string, unknown> }[]
  readonly skills: readonly SkillSource[]
  readonly adaptable: readonly SkillCandidate[]
  readonly plugins: readonly string[]
  readonly unsupported: readonly string[]
  readonly warnings: readonly string[]
  readonly version?: string
  readonly description?: string
}

function stringMap(value: unknown) {
  if (!isRecord(value)) return undefined
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") result[key] = item
  }
  return result
}

function opencodeRemoteUrl(value: string) {
  try {
    const url = new URL(value)
    const client = url.searchParams.get("client")
    // Claude Code plugins often add ?client=claude-code-plugin. OpenCode authenticates as its own
    // client, and the server may reject that pre-registered Claude client during OAuth registration.
    if (client?.toLowerCase().startsWith("claude")) url.searchParams.delete("client")
    return url.toString()
  } catch {
    return value
  }
}

function nonEmptyStringMap(value: unknown) {
  const map = stringMap(value)
  return map && Object.keys(map).length > 0 ? map : undefined
}

function mapMcpServer(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return
  const type = value.type
  const args = Array.isArray(value.args)
    ? value.args.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  const command = Array.isArray(value.command)
    ? value.command.filter((item): item is string => typeof item === "string" && item.length > 0)
    : typeof value.command === "string"
      ? [value.command, ...args]
      : []
  if (type === "stdio" || type === "local" || (type === undefined && command.length > 0)) {
    if (command.length === 0) return
    const environment = nonEmptyStringMap(value.environment) ?? nonEmptyStringMap(value.env)
    return {
      type: "local",
      command,
      ...(environment ? { environment } : {}),
      ...(typeof value.cwd === "string" && value.cwd ? { cwd: value.cwd } : {}),
      ...(value.disabled === true ? { disabled: true } : {}),
      ...(isRecord(value.timeout) ? { timeout: value.timeout } : {}),
    }
  }
  if (type === "http" || type === "sse" || type === "remote" || (type === undefined && typeof value.url === "string")) {
    if (typeof value.url !== "string" || !value.url) return
    return {
      type: "remote",
      url: opencodeRemoteUrl(value.url),
      ...(nonEmptyStringMap(value.headers) ? { headers: nonEmptyStringMap(value.headers) } : {}),
      ...(value.oauth === false || isRecord(value.oauth) ? { oauth: value.oauth } : {}),
      ...(value.disabled === true ? { disabled: true } : {}),
      ...(isRecord(value.timeout) ? { timeout: value.timeout } : {}),
    }
  }
  return
}

function mcpServersFrom(value: unknown): { name: string; config: Record<string, unknown> }[] {
  if (!isRecord(value)) return []
  const candidates: unknown[] = []
  if (isRecord(value.mcpServers)) candidates.push(value.mcpServers)
  if (isRecord(value.mcp) && isRecord(value.mcp.servers)) candidates.push(value.mcp.servers)
  if (isRecord(value.servers)) candidates.push(value.servers)
  if (isRecord(value.mcp) && !isRecord(value.mcp.servers)) candidates.push(value.mcp)
  if (candidates.length === 0) candidates.push(value)

  const seen = new Set<string>()
  const result: { name: string; config: Record<string, unknown> }[] = []
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    for (const [name, config] of Object.entries(candidate)) {
      if (seen.has(name)) continue
      const mapped = mapMcpServer(config)
      if (!mapped) continue
      seen.add(name)
      result.push({ name, config: mapped })
    }
  }
  return result
}

function readJsonText(files: PluginFiles, file: string): unknown {
  const text = files.text.get(file)
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function readPluginJson(files: PluginFiles) {
  for (const file of [".claude-plugin/plugin.json", "plugin.json"]) {
    const value = readJsonText(files, file)
    if (isRecord(value)) return value
  }
  return undefined
}

function skillFromContent(id: string, content: string): SkillSource | undefined {
  const frontmatter = parseFrontmatter(content)
  if (!frontmatter.valid) return undefined
  return {
    id,
    name: frontmatter.name ?? id,
    ...(frontmatter.description ? { description: frontmatter.description } : {}),
    content,
  }
}

function bodyWithoutFrontmatter(content: string) {
  const normalized = content.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n")
  const lines = normalized.split("\n")
  let index = 0
  while (index < lines.length && lines[index].trim() === "") index++
  if (lines[index]?.trim() !== "---") return normalized.trimStart()
  let end = -1
  for (let cursor = index + 1; cursor < lines.length; cursor++) {
    if (lines[cursor].trim() === "---" || lines[cursor].trim() === "...") {
      end = cursor
      break
    }
  }
  return (end >= 0 ? lines.slice(end + 1) : lines.slice(index + 1)).join("\n").trimStart()
}

function firstDescription(body: string, id: string) {
  const first = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return first?.replace(/^#+\s*/, "").slice(0, 200) || `Imported skill ${id}`
}

function adaptSkillContent(candidate: SkillCandidate) {
  const body = bodyWithoutFrontmatter(candidate.content)
  const description = candidate.description || firstDescription(body, candidate.id)
  return `---\nname: ${JSON.stringify(candidate.id)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`
}

function extractSkills(
  files: PluginFiles,
  entry: MarketplacePluginRaw,
): { skills: SkillSource[]; adaptable: SkillCandidate[]; warnings: string[] } {
  const warnings: string[] = []
  const skills: SkillSource[] = []
  const adaptable: SkillCandidate[] = []
  const seen = new Set<string>()
  const adaptableSeen = new Set<string>()
  const documentation = /^(readme|changelog|contributing|license|licence|code_of_conduct|security|support|authors|contributors|notice|copying|agents|claude)(\.[a-z0-9]+)?$/i
  const add = (file: string, id: string, mode: "strict" | "silent") => {
    const content = files.text.get(file)
    if (!content) return
    const skill = skillFromContent(id, content)
    if (skill) {
      if (seen.has(skill.id)) return
      seen.add(skill.id)
      skills.push(skill)
      return
    }
    if (mode === "silent") return
    const body = bodyWithoutFrontmatter(content)
    if (!adaptableSeen.has(id)) {
      adaptableSeen.add(id)
      adaptable.push({
        id,
        name: id,
        description: firstDescription(body, id),
        content,
        reason: `No valid YAML frontmatter: ${file}`,
      })
    }
  }

  const explicit = Array.isArray(entry.skills)
    ? entry.skills.filter((value): value is string => typeof value === "string")
    : undefined
  if (explicit && explicit.length > 0) {
    for (const raw of explicit) {
      const value = normalizeSkillPath(raw)
      if (!value) continue
      if (value.endsWith(".md")) {
        add(value, path.posix.basename(value, ".md"), "strict")
        continue
      }
      add(`${value}/SKILL.md`, path.posix.basename(value), "strict")
    }
    if (skills.length > 0 || adaptable.length > 0) return { skills, adaptable, warnings }
  }

  for (const file of files.paths) {
    const normalized = file.replace(/\\/g, "/")
    if (normalized.endsWith("/SKILL.md")) {
      add(normalized, path.posix.basename(path.posix.dirname(normalized)), "strict")
      continue
    }
    if (normalized.endsWith(".md") && !normalized.slice(0, -3).includes("/")) {
      const base = path.posix.basename(normalized)
      if (documentation.test(base)) continue
      // A root SKILL.md is clearly a skill; other root Markdown files are only imported when they
      // already have valid frontmatter, so a README never produces a warning.
      add(normalized, path.posix.basename(normalized, ".md"), base.toLowerCase() === "skill.md" ? "strict" : "silent")
    }
  }
  return { skills, adaptable, warnings }
}

function detectUnsupported(files: PluginFiles, entry: MarketplacePluginRaw) {
  const paths = files.paths.map((item) => item.replace(/\\/g, "/"))
  const result: string[] = []
  const hasDirectory = (name: string) => paths.some((item) => item === name || item.startsWith(`${name}/`))
  if (hasDirectory("commands") || Array.isArray((entry as { commands?: unknown }).commands)) {
    result.push("commands")
  }
  if (hasDirectory("agents") || Array.isArray((entry as { agents?: unknown }).agents)) {
    result.push("agents")
  }
  if (hasDirectory("hooks") || paths.includes("hooks.json") || entry.hooks !== undefined) {
    result.push("hooks")
  }
  if (hasDirectory("lsp") || paths.includes(".lsp.json") || entry.lspServers !== undefined) {
    result.push("lsp")
  }
  return result
}

function detectOpencodePlugin(files: PluginFiles, location: PluginLocation): string | string[] | undefined {
  const manifest = readJsonText(files, "package.json")
  if (!isRecord(manifest)) return
  const keywords = Array.isArray(manifest.keywords)
    ? manifest.keywords.filter((value): value is string => typeof value === "string")
    : []
  const exports = isRecord(manifest.exports) ? manifest.exports : undefined
  const looksLikePlugin =
    keywords.some((value) => value === "opencode" || value === "opencode-plugin" || value.startsWith("opencode-")) ||
    (exports !== undefined && ("./rpc" in exports || "./gui-experimental" in exports)) ||
    (typeof manifest.name === "string" && manifest.name.startsWith("opencode-"))
  if (!looksLikePlugin) return
  if (location.kind === "local" && location.localPath) return location.localPath
  if (!location.owner || !location.repo) return
  if (location.subpath) return ["An OpenCode plugin in a subfolder is not installed automatically; use a local path."]
  return `github:${location.owner}/${location.repo}`
}

function extract(entry: MarketplacePluginRaw, files: PluginFiles): Extracted {
  const warnings: string[] = []
  const mcp: { name: string; config: Record<string, unknown> }[] = []
  const mcpFile = readJsonText(files, ".mcp.json")
  const fromFile = isRecord(mcpFile) && isRecord(mcpFile.mcpServers) ? mcpServersFrom(mcpFile.mcpServers) : []
  const fromEntry = entry.mcpServers !== undefined ? mcpServersFrom(entry.mcpServers) : []
  for (const server of [...fromFile, ...fromEntry]) {
    if (mcp.some((item) => item.name === server.name)) continue
    try {
      validateMcpConfig(server.config)
      mcp.push(server)
    } catch (error) {
      warnings.push(`MCP ${server.name}: ${message(error)}`)
    }
  }
  if (mcpFile !== undefined && !isRecord(mcpFile)) warnings.push(".mcp.json is not a JSON object")

  const { skills, adaptable, warnings: skillWarnings } = extractSkills(files, entry)
  warnings.push(...skillWarnings)
  const unsupported = detectUnsupported(files, entry)
  const detected = detectOpencodePlugin(files, files.location)
  const plugins: string[] = []
  if (typeof detected === "string") plugins.push(detected)
  else if (Array.isArray(detected)) warnings.push(...detected)

  const pluginJson = readPluginJson(files)
  const version =
    entry.version ?? (isRecord(pluginJson) && typeof pluginJson.version === "string" ? pluginJson.version : undefined)
  const description =
    entry.description ??
    (isRecord(pluginJson) && typeof pluginJson.description === "string" ? pluginJson.description : undefined)
  return {
    mcp,
    skills,
    adaptable,
    plugins,
    unsupported,
    warnings,
    ...(version ? { version } : {}),
    ...(description ? { description } : {}),
  }
}

/**
 * Extracts compatible parts from a plugin folder that is already on disk, such as a Claude Code
 * cache entry. It uses the same rules as marketplace inspection but does not require a marketplace
 * manifest or a network connection.
 */
export async function inspectPluginFolder(folder: string): Promise<Extracted> {
  const resolved = path.resolve(expandHome(folder))
  if (!(await isDirectory(resolved))) throw new Error(`Plugin folder not found: ${resolved}`)
  const location: PluginLocation = { kind: "local", localPath: resolved, sourceLabel: resolved }
  const files = await readLocalPluginFiles(location, resolved)
  return extract({}, files)
}

/* ---------------------------------------------------------------------------------------------- */
/* Inspection                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

function findEntry(loaded: LoadedMarketplace, name: string) {
  const plugins = loaded.manifest.plugins ?? []
  return plugins.find((entry) => entry.name === name) ?? plugins.find((entry) => entry.displayName === name)
}

async function inspect(record: MarketplaceRecord, pluginName: string, force = false) {
  const loaded = await loadMarketplace(record, force)
  const entry = findEntry(loaded, pluginName)
  if (!entry) throw new Error(`Plugin not found in marketplace: ${pluginName}`)
  const location = pluginLocation(entry, loaded)
  const files = await pluginFiles(location, force, entry)
  const extracted = extract(entry, files)
  return { loaded, entry, location, files, extracted }
}

export async function inspectMarketplacePlugin(
  marketplaceIDValue: string,
  pluginName: string,
): Promise<PluginInspection> {
  const { registry } = await readRegistry()
  const record = findMarketplace(registry, marketplaceIDValue)
  if (!record) throw new Error(`Marketplace not found: ${marketplaceIDValue}`)
  const { loaded, entry, location, extracted } = await inspect(record, pluginName)
  return {
    marketplace: record.id,
    plugin: entry.name ?? pluginName,
    ...(entry.displayName ? { displayName: entry.displayName } : {}),
    ...(extracted.description ?? entry.description
      ? { description: extracted.description ?? entry.description }
      : {}),
    ...(extracted.version ? { version: extracted.version } : {}),
    source: location.sourceLabel,
    mcp: extracted.mcp.map((server) => ({
      name: server.name,
      summary:
        server.config.type === "remote" && typeof server.config.url === "string"
          ? server.config.url
          : Array.isArray(server.config.command)
            ? server.config.command.join(" ")
            : "",
    })),
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
    warnings: [...extracted.warnings],
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Installation                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "plugin"
  )
}

function uniqueName(base: string, taken: Set<string>) {
  if (!taken.has(base)) return base
  for (let index = 2; index < 100; index++) {
    const candidate = `${base}-${index}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`Could not find a unique name for ${base}`)
}

async function currentNames(paths: ScopePaths) {
  const document = await readScope(paths)
  const mcp = new Set(Object.keys(isRecord(document.data.mcp) && isRecord(document.data.mcp.servers) ? document.data.mcp.servers : {}))
  const plugins = new Set(listPlugins(document.data).map((entry) => entry.package))
  const skills = new Set((await listSkills(paths.skillsDir)).map((skill) => skill.id))
  return { document, mcp, plugins, skills }
}

/* ---------------------------------------------------------------------------------------------- */
/* Ownership fingerprints                                                                          */
/* ---------------------------------------------------------------------------------------------- */

interface AppliedArtifacts {
  readonly mcp: readonly string[]
  readonly skills: readonly string[]
  readonly plugins: readonly string[]
}

/** JSON with sorted object keys, so semantically identical values always hash the same. */
function stableSerialization(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialization(item)).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`)
      .join(",")}}`
  }
  const serialized = JSON.stringify(value)
  return serialized === undefined ? "null" : serialized
}

function hashArtifact(value: unknown) {
  return createHash("sha256").update(stableSerialization(value)).digest("hex")
}

/**
 * `disabled` is toggled by this manager and is not part of the artifact the user can edit, so it
 * must not invalidate the fingerprint when a plugin is disabled and enabled again.
 */
function mcpFingerprintValue(config: unknown) {
  if (!isRecord(config) || !Object.hasOwn(config, "disabled")) return config
  const value = { ...config }
  delete value.disabled
  return value
}

async function captureFingerprints(paths: ScopePaths, applied: AppliedArtifacts): Promise<ArtifactFingerprints> {
  const document = await readScope(paths)
  const servers = mcpServers(document.data)
  const skills = await listSkills(paths.skillsDir)
  const plugins = listPlugins(document.data)
  const mcp: Record<string, string> = {}
  const skillHashes: Record<string, string> = {}
  const pluginHashes: Record<string, string> = {}

  for (const name of applied.mcp) {
    const config = servers[name]
    if (config !== undefined) mcp[name] = hashArtifact(mcpFingerprintValue(config))
  }
  for (const id of applied.skills) {
    const skill = skills.find((item) => item.id === id)
    if (skill) skillHashes[id] = hashArtifact(skill.content)
  }
  for (const target of applied.plugins) {
    // A disabled plugin entry is not written to the config, but re-enabling it restores this value.
    const raw = plugins.find((entry) => pluginTarget(entry.raw) === target)?.raw ?? target
    pluginHashes[target] = hashArtifact(raw)
  }
  return { mcp, skills: skillHashes, plugins: pluginHashes }
}

type RemovalMode = "update" | "remove"

async function removePluginArtifacts(
  paths: ScopePaths,
  record: InstalledRecord,
  mode: RemovalMode,
): Promise<string[]> {
  const skipped: string[] = []
  let document
  try {
    document = await readScope(paths)
  } catch (error) {
    if (mode === "update") throw error
    return skipped
  }

  for (const target of record.plugins) {
    const entries = listPlugins(document.data).filter((entry) => pluginTarget(entry.raw) === target)
    if (entries.length === 0) continue
    const expected = record.fingerprints?.plugins?.[target]
    if (expected === undefined) {
      // A record written before fingerprints existed cannot prove ownership. Updates replace the
      // previous version, but uninstall and disable leave the artifact alone and report it.
      if (mode === "remove") {
        skipped.push(`Plugin "${target}" (no fingerprint)`)
        continue
      }
      await removePluginPackage(paths, target)
      continue
    }
    const removable = entries.filter((entry) => hashArtifact(entry.raw) === expected)
    const edited = entries.filter((entry) => hashArtifact(entry.raw) !== expected)
    if (removable.length > 0) {
      try {
        await updateScope(paths, (data) => {
          if (!Array.isArray(data.plugins)) return []
          // Remove from the end so earlier indices stay valid while the edits are applied in order.
          return data.plugins
            .flatMap((entry, index) =>
              pluginTarget(entry) === target && hashArtifact(entry) === expected
                ? [{ path: ["plugins", index], value: undefined } satisfies Mutation]
                : [],
            )
            .reverse()
        })
      } catch (error) {
        if (mode === "update") throw error
        skipped.push(`Plugin "${target}"`)
      }
    }
    if (edited.length > 0) skipped.push(`Plugin "${target}"`)
  }
  return skipped
}

async function removeArtifacts(
  record: InstalledRecord,
  paths: ScopePaths,
  mode: RemovalMode,
): Promise<string[]> {
  const skipped: string[] = []
  let document
  try {
    document = await readScope(paths)
  } catch (error) {
    if (mode === "update") throw error
    document = undefined
  }

  const servers = document ? mcpServers(document.data) : {}
  for (const name of record.mcp) {
    const config = servers[name]
    if (config === undefined) continue
    const expected = record.fingerprints?.mcp?.[name]
    if (expected === undefined) {
      if (mode === "remove") {
        skipped.push(`MCP server "${name}" (no fingerprint)`)
        continue
      }
      await removeMcp(paths, name)
      continue
    }
    if (hashArtifact(mcpFingerprintValue(config)) !== expected) {
      skipped.push(`MCP server "${name}"`)
      continue
    }
    try {
      await removeMcp(paths, name)
    } catch (error) {
      if (mode === "update") throw error
      skipped.push(`MCP server "${name}"`)
    }
  }

  let skills: Awaited<ReturnType<typeof listSkills>> = []
  try {
    skills = await listSkills(paths.skillsDir)
  } catch (error) {
    if (mode === "update") throw error
    skills = []
  }
  for (const id of record.skills) {
    const skill = skills.find((item) => item.id === id)
    if (!skill) continue
    const expected = record.fingerprints?.skills?.[id]
    if (expected === undefined) {
      if (mode === "remove") {
        skipped.push(`Skill "${id}" (no fingerprint)`)
        continue
      }
      await removeSkill(paths, id)
      continue
    }
    if (hashArtifact(skill.content) !== expected) {
      skipped.push(`Skill "${id}"`)
      continue
    }
    try {
      await removeSkill(paths, id)
    } catch (error) {
      if (mode === "update") throw error
      skipped.push(`Skill "${id}"`)
    }
  }

  skipped.push(...(await removePluginArtifacts(paths, record, mode)))
  return skipped
}

/* ---------------------------------------------------------------------------------------------- */
/* Install snapshots                                                                               */
/* ---------------------------------------------------------------------------------------------- */

interface TextSnapshot {
  readonly file: string
  readonly exists: boolean
  readonly text: string
}

interface SkillSnapshot {
  readonly id: string
  readonly source: string
  readonly backup: string
}

interface InstallSnapshot {
  readonly workspace: string
  readonly config: TextSnapshot
  readonly registry: TextSnapshot
  readonly skills: readonly SkillSnapshot[]
}

async function snapshotText(file: string): Promise<TextSnapshot> {
  try {
    return { file, exists: true, text: await readFile(file, "utf8") }
  } catch {
    return { file, exists: false, text: "" }
  }
}

async function restoreText(snapshot: TextSnapshot) {
  if (snapshot.exists) await writeAtomic(snapshot.file, snapshot.text, false)
  else await rm(snapshot.file, { force: true })
}

async function removeSkillNode(paths: ScopePaths, id: string) {
  for (const root of [paths.skillsDir, path.join(paths.skillsDir, ".disabled")]) {
    await rm(path.join(root, id), { recursive: true, force: true })
    await rm(path.join(root, `${id}.md`), { force: true })
  }
}

/**
 * Captures everything an install can touch: the config file (which holds MCP servers and plugin
 * entries), the managed skill folders, and the registry. Skill folders are copied to a temporary
 * workspace because restoring only names would lose their content.
 */
async function createInstallSnapshot(paths: ScopePaths, previous?: InstalledRecord): Promise<InstallSnapshot> {
  const workspace = await mkdtemp(path.join(tmpdir(), "oem-install-"))
  const skills: SkillSnapshot[] = []
  try {
    if (previous) {
      const current = await listSkills(paths.skillsDir)
      for (const id of previous.skills) {
        const skill = current.find((item) => item.id === id)
        if (!skill) continue
        const backup = path.join(workspace, `skill-${skills.length}`)
        await cp(skill.dir, backup, { recursive: true })
        skills.push({ id, source: skill.dir, backup })
      }
    }
    return {
      workspace,
      config: await snapshotText(paths.configPath),
      registry: await snapshotText(registryFilePath()),
      skills,
    }
  } catch (error) {
    await rm(workspace, { recursive: true, force: true })
    throw error
  }
}

async function restoreInstallSnapshot(paths: ScopePaths, snapshot: InstallSnapshot, applied?: AppliedArtifacts) {
  const failures: string[] = []
  const attempt = async (work: () => Promise<void>) => {
    try {
      await work()
    } catch (error) {
      failures.push(message(error))
    }
  }

  // Remove skills the new version created (including ones that took an old id), then copy the old
  // content back. MCP servers and plugin entries are restored by writing the config snapshot.
  if (applied) {
    for (const id of applied.skills) await attempt(() => removeSkillNode(paths, id))
  }
  for (const skill of snapshot.skills) {
    await attempt(async () => {
      await removeSkillNode(paths, skill.id)
      await cp(skill.backup, skill.source, { recursive: true })
    })
  }
  await attempt(() => restoreText(snapshot.config))
  await attempt(() => restoreText(snapshot.registry))
  if (failures.length > 0) throw new Error(`Rollback failed: ${failures.join("; ")}`)
}

async function applyArtifacts(
  paths: ScopePaths,
  extracted: Extracted,
  pluginSlug: string,
  enabled: boolean,
): Promise<AppliedArtifacts> {
  const taken = await currentNames(paths)
  const mcpNames: string[] = []
  const skillIDs: string[] = []
  const pluginSpecs: string[] = []

  try {
    for (const server of extracted.mcp) {
      const base = slug(server.name)
      const name = uniqueName(base, taken.mcp)
      taken.mcp.add(name)
      await saveMcp(paths, { name, config: server.config })
      if (!enabled) await setMcpEnabled(paths, name, false)
      mcpNames.push(name)
    }
  } catch (error) {
    for (const name of mcpNames) await removeMcp(paths, name).catch(() => undefined)
    throw error
  }

  try {
    for (const skill of extracted.skills) {
      const base = slug(`${pluginSlug}__${skill.id}`)
      const id = uniqueName(base, taken.skills)
      taken.skills.add(id)
      try {
        await saveSkill(paths, { id, content: skill.content })
        if (!enabled) await setSkillEnabled(paths, id, false)
        skillIDs.push(id)
      } catch (error) {
        // saveSkill can fail after creating the folder but before writing SKILL.md; that partial
        // folder is not discoverable by removeSkill, so clean both possible shapes directly.
        await removeSkillNode(paths, id).catch(() => undefined)
        throw error
      }
    }
  } catch (error) {
    for (const id of skillIDs) await removeSkill(paths, id).catch(() => undefined)
    for (const name of mcpNames) await removeMcp(paths, name).catch(() => undefined)
    throw error
  }

  try {
    for (const spec of extracted.plugins) {
      if (taken.plugins.has(spec)) continue
      taken.plugins.add(spec)
      await savePlugin(paths, { package: spec })
      if (!enabled) await removePluginPackage(paths, spec)
      pluginSpecs.push(spec)
    }
  } catch (error) {
    for (const id of skillIDs) await removeSkill(paths, id).catch(() => undefined)
    for (const name of mcpNames) await removeMcp(paths, name).catch(() => undefined)
    for (const spec of pluginSpecs) await removePluginPackage(paths, spec).catch(() => undefined)
    throw error
  }

  return { mcp: mcpNames, skills: skillIDs, plugins: pluginSpecs }
}

interface ExtractedInstallRequest {
  readonly registry?: Registry
  readonly marketplace: string
  readonly marketplaceName: string
  readonly plugin: string
  readonly displayName?: string
  readonly description?: string
  readonly version?: string
  readonly commit?: string
  readonly scope: Scope
  readonly project?: string
  readonly extracted: Extracted
  readonly adapt?: boolean
  /** Records the currently installed version and commit as the rollback target after an update. */
  readonly trackPrevious?: boolean
}

/**
 * Applies extracted parts with the same snapshot, fingerprint, and registry commit point as a
 * marketplace install. Used both by marketplace installs and by Claude Code cache imports.
 */
async function installExtracted(request: ExtractedInstallRequest): Promise<{ key: string; skipped: string[] }> {
  const registry = request.registry ?? (await readRegistry()).registry
  // Scope is part of the key, so installing the same plugin globally and in a project produces two
  // independent records and two independent artifact sets.
  const effectivePaths = await resolveScope(request.scope, request.project)
  const key = installedKey(
    request.marketplace,
    request.plugin,
    effectivePaths.scope,
    effectivePaths.scope === "project" ? effectivePaths.root : undefined,
  )
  const previous = registry.installed.find((item) => item.key === key)
  const adapt = request.adapt ?? previous?.adapt ?? false
  const skills = new Map(request.extracted.skills.map((skill) => [skill.id, skill]))
  if (adapt) {
    for (const candidate of request.extracted.adaptable) {
      if (skills.has(candidate.id)) continue
      skills.set(candidate.id, { ...candidate, content: adaptSkillContent(candidate) })
    }
  }
  const extractedSkills = [...skills.values()]
  if (request.extracted.mcp.length === 0 && extractedSkills.length === 0 && request.extracted.plugins.length === 0) {
    throw new Error(
      "The plugin has no parts compatible with OpenCode (MCP servers, skills, or OpenCode plugins). " +
        "Claude Code commands, agents, hooks, and LSP are not supported.",
    )
  }

  const enabled = previous?.enabled !== false
  const pluginSlug = slug(request.plugin)
  const snapshot = await createInstallSnapshot(effectivePaths, previous)
  let applied: AppliedArtifacts | undefined
  let skipped: string[] = []
  try {
    skipped = previous ? await removeArtifacts(previous, effectivePaths, "update") : []
    applied = await applyArtifacts(
      effectivePaths,
      { ...request.extracted, skills: extractedSkills },
      pluginSlug,
      enabled,
    )
    const fingerprints = await captureFingerprints(effectivePaths, applied)
    const now = new Date().toISOString()
    // A rollback is a normal transactional install too: recording the revision it replaced keeps
    // the same one-step undo available in the opposite direction.
    const previousVersion =
      request.trackPrevious && previous?.version && previous.version !== request.version
        ? previous.version
        : undefined
    const previousCommit =
      request.trackPrevious && previous?.commit && previous.commit !== request.commit
        ? previous.commit
        : undefined
    const next: InstalledRecord = {
      key,
      marketplace: request.marketplace,
      marketplaceName: request.marketplaceName,
      plugin: request.plugin,
      ...(request.displayName ? { displayName: request.displayName } : {}),
      ...(request.description ? { description: request.description } : {}),
      scope: effectivePaths.scope,
      ...(effectivePaths.scope === "project" ? { project: effectivePaths.root } : {}),
      enabled,
      ...(adapt ? { adapt: true } : {}),
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
      ...(request.version ? { version: request.version } : {}),
      ...(request.commit ? { commit: request.commit } : {}),
      ...(previousVersion ? { previousVersion } : {}),
      ...(previousCommit ? { previousCommit } : {}),
      mcp: applied.mcp,
      skills: applied.skills,
      plugins: applied.plugins,
      unsupported: request.extracted.unsupported,
      fingerprints,
      ...(skipped.length > 0 ? { skipped } : {}),
    }
    // The registry is the commit point: it is written only after every artifact was applied.
    await writeRegistry({
      ...registry,
      installed: [...registry.installed.filter((item) => item.key !== next.key), next],
    })
  } catch (error) {
    try {
      await restoreInstallSnapshot(effectivePaths, snapshot, applied)
    } catch (rollbackError) {
      throw new Error(`${message(error)} (${message(rollbackError)})`, { cause: error })
    }
    throw error
  } finally {
    await rm(snapshot.workspace, { recursive: true, force: true }).catch(() => undefined)
  }
  return { key, skipped }
}

export type InstallExtractedPluginInput = Omit<ExtractedInstallRequest, "registry">

/** Installs parts extracted outside the marketplace flow, such as from a Claude Code cache. */
export function installExtractedPlugin(input: InstallExtractedPluginInput): Promise<{ key: string; skipped: string[] }> {
  return installExtracted(input)
}

async function sourceCommit(location: PluginLocation, force = false): Promise<string | undefined> {
  if (location.kind !== "github" || !location.owner || !location.repo || !location.ref) return undefined
  if (/^[0-9a-f]{40}$/i.test(location.ref)) return location.ref
  // Store a commit SHA when GitHub resolves one, so later update checks can notice a moved branch.
  return (await githubCommitSha(location.owner, location.repo, location.ref, force)) ?? location.ref
}

export async function installMarketplacePlugin(input: {
  marketplace: string
  plugin: string
  scope: Scope
  project?: string
  update?: boolean
  adapt?: boolean
}): Promise<void> {
  const { registry } = await readRegistry()
  const record = findMarketplace(registry, input.marketplace)
  if (!record) throw new Error(`Marketplace not found: ${input.marketplace}`)
  const { loaded, entry, location, extracted } = await inspect(record, input.plugin, input.update === true)
  // A forced inspect above already fetched the newest metadata; the commit cache is short-lived and
  // reusing it avoids a second GitHub API call during a batch update.
  const commit = await sourceCommit(location)
  await installExtracted({
    registry,
    marketplace: record.id,
    marketplaceName: loaded.record.name,
    plugin: entry.name ?? input.plugin,
    ...(entry.displayName ? { displayName: entry.displayName } : {}),
    ...(extracted.description ? { description: extracted.description } : {}),
    ...(extracted.version ? { version: extracted.version } : {}),
    ...(commit ? { commit } : {}),
    scope: input.scope,
    ...(input.project ? { project: input.project } : {}),
    extracted,
    adapt: input.adapt,
    ...(input.update === true ? { trackPrevious: true } : {}),
  })
}

export async function uninstallMarketplacePlugin(key: string): Promise<string[]> {
  const { registry } = await readRegistry()
  const record = registry.installed.find((item) => item.key === key)
  if (!record) throw new Error(`Installed plugin not found: ${key}`)
  let skipped: string[] = []
  try {
    const paths = await resolveScope(record.scope, record.project)
    skipped = await removeArtifacts(record, paths, "remove")
  } catch {
    // The project folder may be gone; the registry entry still has to be removable.
  }
  await writeRegistry({ ...registry, installed: registry.installed.filter((item) => item.key !== key) })
  return skipped
}

export async function setMarketplacePluginEnabled(key: string, enabled: boolean): Promise<string[]> {
  const { registry } = await readRegistry()
  const record = registry.installed.find((item) => item.key === key)
  if (!record) throw new Error(`Installed plugin not found: ${key}`)
  if (record.enabled === enabled) return []
  const paths = await resolveScope(record.scope, record.project)
  const skipped: string[] = []

  if (!enabled) {
    // Disabling is destructive for plugin entries and changes MCP/skill state, so only touch
    // artifacts that still match the content this manager installed.
    const document = await readScope(paths)
    const servers = mcpServers(document.data)
    for (const name of record.mcp) {
      const config = servers[name]
      if (config === undefined) continue
      const expected = record.fingerprints?.mcp?.[name]
      if (expected === undefined) {
        skipped.push(`MCP server "${name}" (no fingerprint)`)
        continue
      }
      if (hashArtifact(mcpFingerprintValue(config)) !== expected) {
        skipped.push(`MCP server "${name}"`)
        continue
      }
      try {
        await setMcpEnabled(paths, name, false)
      } catch {
        skipped.push(`MCP server "${name}"`)
      }
    }

    let skills: Awaited<ReturnType<typeof listSkills>> = []
    try {
      skills = await listSkills(paths.skillsDir)
    } catch {
      skills = []
    }
    for (const id of record.skills) {
      const skill = skills.find((item) => item.id === id)
      if (!skill) continue
      const expected = record.fingerprints?.skills?.[id]
      if (expected === undefined) {
        skipped.push(`Skill "${id}" (no fingerprint)`)
        continue
      }
      if (hashArtifact(skill.content) !== expected) {
        skipped.push(`Skill "${id}"`)
        continue
      }
      try {
        await setSkillEnabled(paths, id, false)
      } catch {
        skipped.push(`Skill "${id}"`)
      }
    }

    skipped.push(...(await removePluginArtifacts(paths, record, "remove")))
  } else {
    for (const name of record.mcp) {
      try {
        await setMcpEnabled(paths, name, true)
      } catch {
        // The server may have been edited or removed by hand.
      }
    }
    for (const id of record.skills) {
      try {
        await setSkillEnabled(paths, id, true)
      } catch {
        // The skill may have been edited or removed by hand.
      }
    }
    for (const spec of record.plugins) {
      try {
        const document = await readScope(paths)
        if (!hasPlugin(document, spec)) await savePlugin(paths, { package: spec })
      } catch {
        // The plugin entry may have been edited by hand.
      }
    }
  }

  await writeRegistry({
    ...registry,
    installed: registry.installed.map((item) => {
      if (item.key !== key) return item
      const { skipped: _previous, ...rest } = item
      return {
        ...rest,
        enabled,
        updatedAt: new Date().toISOString(),
        ...(skipped.length > 0 ? { skipped } : {}),
      }
    }),
  })
  return skipped
}

export async function updateMarketplacePlugin(key: string): Promise<void> {
  const { registry } = await readRegistry()
  const record = registry.installed.find((item) => item.key === key)
  if (!record) throw new Error(`Installed plugin not found: ${key}`)
  await installMarketplacePlugin({
    marketplace: record.marketplace,
    plugin: record.plugin,
    scope: record.scope,
    ...(record.project ? { project: record.project } : {}),
    update: true,
  })
}

/**
 * The previous revision recorded by the latest successful update. Validation happens before any
 * artifact is touched so an unavailable revision cannot leave a half-rolled-back install.
 */
export function rollbackRevision(
  record: Pick<InstalledRecord, "previousVersion" | "previousCommit">,
): { version?: string; commit?: string } {
  if (!record.previousCommit && !record.previousVersion) {
    throw new Error("No previous revision is recorded for this plugin; nothing was changed.")
  }
  return {
    ...(record.previousVersion ? { version: record.previousVersion } : {}),
    ...(record.previousCommit ? { commit: record.previousCommit } : {}),
  }
}

/**
 * Reinstalls an installed marketplace plugin from the revision stored by its last update. A commit
 * is fetched directly from GitHub, so the old files remain available even after a branch moves. A
 * version-only record can roll back only while the marketplace still offers that version. Every
 * check runs before `installExtracted`, which keeps the usual snapshot-based transaction.
 */
export async function rollbackMarketplacePlugin(key: string): Promise<BatchUpdateResult> {
  const { registry } = await readRegistry()
  const record = registry.installed.find((item) => item.key === key)
  if (!record) throw new Error(`Installed plugin not found: ${key}`)
  const revision = rollbackRevision(record)
  const marketplace = findMarketplace(registry, record.marketplace)
  if (!marketplace) {
    throw new Error(`Cannot roll back ${record.plugin}: marketplace not found: ${record.marketplace}`)
  }

  const loaded = await loadMarketplace(marketplace, true)
  const entry = findEntry(loaded, record.plugin)
  if (!entry) {
    throw new Error(
      `Cannot roll back ${record.plugin}: the marketplace ${loaded.record.name} no longer offers it. Nothing was changed.`,
    )
  }

  let location: PluginLocation
  let extracted: Extracted
  if (revision.commit) {
    // For a plugin that lives in the marketplace repository, the old manifest describes the files
    // at that commit too, including inline mcpServers and a source folder that may have moved.
    let sourceEntry = entry
    let sourceLoaded = loaded
    if (loaded.location.kind === "github") {
      try {
        const old = await readGithubManifest(
          { ...loaded.location, ref: revision.commit },
          revision.commit,
        )
        if (old && old.ref === revision.commit) {
          const oldLoaded: LoadedMarketplace = {
            record: loaded.record,
            manifest: old.manifest,
            location: cloneLocation(loaded.location, old.ref),
          }
          const oldEntry = findEntry(oldLoaded, record.plugin)
          if (oldEntry) {
            sourceEntry = oldEntry
            sourceLoaded = oldLoaded
          }
        }
      } catch {
        // Fall back to the current manifest entry and let pluginFiles report the real failure.
      }
    }

    const source = pluginLocation(sourceEntry, sourceLoaded)
    if (source.kind !== "github" || !source.owner || !source.repo) {
      throw new Error(
        `Cannot resolve previous commit ${revision.commit}: the plugin source is not a GitHub repository. Nothing was changed.`,
      )
    }
    location = { ...source, ref: revision.commit }
    let files: PluginFiles
    try {
      files = await pluginFiles(location, true, sourceEntry)
    } catch (error) {
      throw new Error(
        `Cannot resolve previous commit ${revision.commit}: ${message(error)}. Nothing was changed.`,
        { cause: error },
      )
    }
    // The current manifest's version describes the latest release, not the files at the old
    // commit, so let the old plugin.json supply the version when the record has none.
    extracted = extract({ ...sourceEntry, version: undefined }, files)
  } else {
    const current = pluginLocation(entry, loaded)
    const files = await pluginFiles(current, true, entry)
    const currentExtracted = extract(entry, files)
    const latest = currentExtracted.version ?? entry.version
    if (!revision.version || latest !== revision.version) {
      throw new Error(
        `Cannot resolve previous version ${revision.version ?? "unknown"}: the marketplace now offers ${latest ?? "no version"}. Nothing was changed.`,
      )
    }
    location = current
    extracted = currentExtracted
  }

  const version = revision.version ?? extracted.version ?? record.version
  const commit = revision.commit ?? (await sourceCommit(location, true))
  const installed = await installExtracted({
    registry,
    marketplace: marketplace.id,
    marketplaceName: loaded.record.name,
    plugin: entry.name ?? record.plugin,
    ...(entry.displayName ? { displayName: entry.displayName } : {}),
    ...(extracted.description ? { description: extracted.description } : {}),
    ...(version ? { version } : {}),
    ...(commit ? { commit } : {}),
    scope: record.scope,
    ...(record.project ? { project: record.project } : {}),
    extracted,
    adapt: record.adapt,
    trackPrevious: true,
  })
  return {
    ...updateBase(record),
    ok: true,
    ...(installed.skipped.length > 0 ? { skipped: installed.skipped } : {}),
  }
}

function updateBase(record: InstalledRecord) {
  return {
    key: record.key,
    marketplace: record.marketplace,
    marketplaceName: record.marketplaceName,
    plugin: record.plugin,
    ...(record.displayName ? { displayName: record.displayName } : {}),
    scope: record.scope,
    ...(record.project ? { project: record.project } : {}),
  }
}

/**
 * Checks every installed marketplace plugin against its current source. Version changes are
 * authoritative when the manifest or plugin.json carries a version; commit changes are reported
 * when both the recorded and current values are real commit SHAs.
 */
export async function checkMarketplaceUpdates(): Promise<{ checkedAt: string; plugins: MarketplaceUpdate[] }> {
  const { registry } = await readRegistry()
  const marketplaceIDs = new Set(marketplaceRecords(registry).map((record) => record.id))
  const installed = registry.installed.filter((record) => marketplaceIDs.has(record.marketplace))
  const plugins = await mapLimit(installed, 4, async (record): Promise<MarketplaceUpdate> => {
    const base = {
      ...updateBase(record),
      ...(record.version ? { currentVersion: record.version } : {}),
      ...(record.commit ? { currentCommit: record.commit } : {}),
    }
    const marketplace = findMarketplace(registry, record.marketplace)
    if (!marketplace) {
      return {
        ...base,
        updateAvailable: false,
        status: "skipped",
        error: `Marketplace not found: ${record.marketplace}`,
      }
    }
    try {
      const { entry, location, extracted } = await inspect(marketplace, record.plugin, true)
      const latestVersion = extracted.version ?? entry.version
      const latestCommit = location.kind === "github" ? await sourceCommit(location, true) : undefined
      const versionChanged = latestVersion !== undefined && latestVersion !== record.version
      const commitChanged =
        isCommitSha(record.commit) && isCommitSha(latestCommit) && record.commit !== latestCommit
      const updateAvailable = versionChanged || commitChanged
      return {
        ...base,
        ...(latestVersion ? { latestVersion } : {}),
        ...(latestCommit ? { latestCommit } : {}),
        source: location.sourceLabel,
        updateAvailable,
        status: updateAvailable ? "outdated" : "current",
      }
    } catch (error) {
      return {
        ...base,
        updateAvailable: false,
        status: "error",
        error: message(error),
      }
    }
  })
  return { checkedAt: new Date().toISOString(), plugins }
}

/**
 * Updates marketplace plugins one by one. A failure is recorded and the next plugin still runs, so
 * one broken source cannot block the rest of the batch. Without `keys`, the batch first checks all
 * installed marketplace plugins and updates only the outdated ones.
 */
export async function updateMarketplacePlugins(keys?: readonly string[]): Promise<BatchUpdateResult[]> {
  const { registry } = await readRegistry()
  const marketplaceIDs = new Set(marketplaceRecords(registry).map((record) => record.id))
  const results: BatchUpdateResult[] = []
  const targetKeys: string[] = []

  if (keys && keys.length > 0) {
    for (const key of [...new Set(keys)]) {
      const record = registry.installed.find((item) => item.key === key)
      if (!record) {
        results.push({
          key,
          marketplace: "",
          marketplaceName: "",
          plugin: key,
          scope: "global",
          ok: false,
          error: `Installed plugin not found: ${key}`,
        })
        continue
      }
      if (!marketplaceIDs.has(record.marketplace)) {
        results.push({
          ...updateBase(record),
          ok: false,
          error: `Not a marketplace plugin: ${record.marketplace}`,
        })
        continue
      }
      targetKeys.push(key)
    }
  } else {
    const check = await checkMarketplaceUpdates()
    targetKeys.push(...check.plugins.filter((item) => item.status === "outdated").map((item) => item.key))
  }

  for (const key of targetKeys) {
    // Re-read for every item: a successful update rewrites the registry, and a failed one may have
    // rolled its artifacts back.
    const current = (await readRegistry()).registry.installed.find((item) => item.key === key)
    if (!current) {
      results.push({
        key,
        marketplace: "",
        marketplaceName: "",
        plugin: key,
        scope: "global",
        ok: false,
        error: `Installed plugin not found: ${key}`,
      })
      continue
    }
    try {
      await updateMarketplacePlugin(key)
      const updated = (await readRegistry()).registry.installed.find((item) => item.key === key)
      results.push({
        ...updateBase(current),
        ok: true,
        ...(updated?.skipped && updated.skipped.length > 0 ? { skipped: [...updated.skipped] } : {}),
      })
    } catch (error) {
      results.push({
        ...updateBase(current),
        ok: false,
        error: message(error),
      })
    }
  }
  return results
}

export async function addMarketplace(
  url: string,
  ref?: string,
): Promise<{ record?: MarketplaceRecord; repository?: RepositoryInspection }> {
  const value = url.trim()
  if (!value) throw new Error("Marketplace URL must not be empty")
  const requestedRef = ref?.trim() || undefined
  const location = parseLocation(value, requestedRef)
  const id = marketplaceID(value)
  const candidate: MarketplaceRecord = {
    id,
    url: parseGithub(value)?.canonical ?? (location.kind === "local" ? location.localPath : value),
    name: id,
    ...(location.kind === "github" && requestedRef ? { ref: requestedRef } : {}),
    addedAt: new Date().toISOString(),
  }
  const { registry } = await readRegistry()
  const existing = marketplaceRecords(registry).find(
    (record) => record.id === candidate.id || record.url === candidate.url,
  )
  if (existing) {
    const loaded = await loadMarketplace(existing)
    return { record: loaded.record }
  }

  try {
    const loaded = await loadMarketplace(candidate, true)
    await writeRegistry({
      ...registry,
      marketplaces: [...registry.marketplaces, loaded.record],
    })
    return { record: loaded.record }
  } catch (error) {
    if (!(error instanceof NotAMarketplaceError)) throw error
    if (location.kind !== "github") throw error
    const repository = await inspectRepository(value)
    return { repository }
  }
}

export async function removeMarketplace(id: string): Promise<void> {
  const { registry } = await readRegistry()
  const record = findMarketplace(registry, id)
  if (!record) throw new Error(`Marketplace not found: ${id}`)
  if (record.builtin) throw new Error("The built-in marketplace cannot be removed")
  const installed = registry.installed.filter((item) => item.marketplace === id)
  if (installed.length > 0) {
    throw new Error(
      `Remove the plugins installed from it first: ${installed.map((item) => item.plugin).join(", ")}`,
    )
  }
  marketplaceCache.delete(cacheKey(record))
  await writeRegistry({
    ...registry,
    marketplaces: registry.marketplaces.filter((item) => item.id !== id),
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Non-marketplace GitHub repositories                                                             */
/* ---------------------------------------------------------------------------------------------- */

function parseConfigText(text: string | undefined): unknown {
  if (!text) return undefined
  const trimmed = text.replace(/^\uFEFF/, "").trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined
  const errors: ParseError[] = []
  const value = parseJsonc(trimmed, errors, { allowTrailingComma: true })
  return errors.length === 0 ? value : undefined
}

const repositoryMcpFiles = [".mcp.json", "mcp.json", "opencode.json", "opencode.jsonc"] as const
const repositoryManifestFiles = ["package.json", "npm/package.json"] as const

/** Returns the index of the brace that closes the object opened at `start`, ignoring strings. */
function balancedJsonEnd(text: string, start: number): number | undefined {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const character = text[index]!
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === "{") depth++
    else if (character === "}") {
      depth--
      if (depth === 0) return index
    }
  }
  return undefined
}

/** Returns true when a JSON snippet declares MCP servers rather than arbitrary command output. */
function looksLikeMcpConfigText(text: string) {
  return (
    /"mcpServers"\s*:/.test(text) ||
    /"mcp"\s*:\s*\{/.test(text) ||
    /"servers"\s*:\s*\{/.test(text) ||
    /"url"\s*:\s*"https?:\/\/[^"]*\/mcp\b/.test(text)
  )
}

/** Extracts JSON and JSONC configs from Markdown code blocks and inline snippets. */
function configsFromText(text: string): unknown[] {
  const candidates = new Set<string>()
  for (const match of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    const body = match[1]?.trim()
    if (body && (body.startsWith("{") || body.startsWith("[")) && looksLikeMcpConfigText(body)) {
      candidates.add(body)
    }
  }
  let skipUntil = 0
  for (let index = 0; index < text.length; index++) {
    if (index < skipUntil) continue
    if (text[index] !== "{") continue
    if (!/mcp/i.test(text.slice(index, index + 400))) continue
    const end = balancedJsonEnd(text, index)
    if (end === undefined) continue
    skipUntil = end + 1
    const candidate = text.slice(index, end + 1).trim()
    if (looksLikeMcpConfigText(candidate)) candidates.add(candidate)
  }
  const values: unknown[] = []
  for (const candidate of candidates) {
    const value = parseConfigText(candidate)
    if (value !== undefined) values.push(value)
  }
  return values
}

/** Rewrites a documented CLI command to npx when the repository publishes that CLI to npm. */
function runnableMcpConfig(
  config: Record<string, unknown>,
  manifest: Record<string, unknown>,
): { config: Record<string, unknown>; viaNpx: boolean } {
  const command = Array.isArray(config.command)
    ? config.command.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  const executable = command[0]
  if (!executable || executable.includes("/") || executable.includes("\\") || executable.startsWith(".")) {
    return { config, viaNpx: false }
  }
  const name = typeof manifest.name === "string" ? manifest.name : undefined
  if (!name || manifest.private === true) return { config, viaNpx: false }
  const bin = manifest.bin
  const bins = isRecord(bin) ? Object.keys(bin) : typeof bin === "string" ? [name.split("/").pop() ?? name] : []
  if (executable !== name && !bins.includes(executable)) return { config, viaNpx: false }
  return { config: { ...config, command: ["npx", "-y", name, ...command.slice(1)] }, viaNpx: true }
}

export async function inspectRepository(url: string): Promise<RepositoryInspection> {
  const location = parseGithub(url)
  if (!location) throw new Error("GitHub repository URLs are supported")
  const refs = [location.ref, "main", "master"].filter(
    (ref, index, list): ref is string => typeof ref === "string" && ref.length > 0 && list.indexOf(ref) === index,
  )
  const folder = location.subpath.replace(/^\/+|\/+$/g, "")
  let ref = refs[0] ?? "main"
  let packageJson: unknown
  let readme: string | undefined
  let configs: { file: string; value: unknown }[] = []
  for (const candidate of refs) {
    const base = `https://raw.githubusercontent.com/${location.owner}/${location.repo}/${candidate}${folder ? `/${folder}` : ""}`
    const [readmeResult, ...manifestAndConfigResults] = await Promise.all([
      fetchText(`${base}/README.md`),
      ...repositoryManifestFiles.map((file) => fetchText(`${base}/${file}`)),
      ...repositoryMcpFiles.map((file) => fetchText(`${base}/${file}`)),
    ])
    const manifestResults = manifestAndConfigResults.slice(0, repositoryManifestFiles.length)
    const configResults = manifestAndConfigResults.slice(repositoryManifestFiles.length)
    const results = [readmeResult, ...manifestAndConfigResults]
    if (results.every((result) => !result.ok && result.status === 0)) {
      throw new Error(
        `Failed to connect to GitHub: ${results.find((result) => result.error)?.error ?? "network error"}`
      )
    }
    if (results.some((result) => result.ok)) {
      ref = candidate
      packageJson = manifestResults
        .map((result) => (result.ok ? parseConfigText(result.text) : undefined))
        .find((value) => value !== undefined)
      readme = readmeResult.ok ? readmeResult.text : undefined
      configs = configResults.flatMap((result, index) =>
        result.ok ? [{ file: repositoryMcpFiles[index]!, value: parseConfigText(result.text) }] : [],
      )
      break
    }
  }

  const manifest = isRecord(packageJson) ? packageJson : {}
  const proposals: RepositoryProposal[] = []
  const notes: string[] = []
  const addMcp = (name: string, config: Record<string, unknown>, reason: string) => {
    if (proposals.some((item) => item.kind === "mcp" && item.name === name)) return
    proposals.push({ kind: "mcp", name, config, reason })
  }
  const addPlugin = (target: string, reason: string) => {
    if (proposals.some((item) => item.kind === "plugin" && item.package === target)) return
    proposals.push({ kind: "plugin", package: target, reason })
  }

  for (const entry of configs) {
    for (const server of mcpServersFrom(entry.value)) {
      addMcp(server.name, server.config, `${entry.file} found in the repository`)
    }
  }

  if (readme) {
    for (const value of configsFromText(readme)) {
      const parsed = proposalsFromConfig(value, "MCP server found in README")
      for (const proposal of parsed.proposals) {
        if (!proposal.name || !isRecord(proposal.config)) continue
        const runnable = runnableMcpConfig(proposal.config, manifest)
        addMcp(
          proposal.name,
          runnable.config,
          runnable.viaNpx
            ? "MCP server found in README; the CLI runs through npx"
            : "MCP server found in README",
        )
      }
      if (parsed.skipped.length > 0) {
        notes.push(`Skipped invalid MCP server configuration in README: ${parsed.skipped.join(", ")}.`)
      }
    }
  }

  const mcpUrl = readme?.match(/https?:\/\/[^\s"'<>)]+\/mcp(?:\?[^\s"'<>)]*)?/i)?.[0]
  if (mcpUrl) {
    addMcp(location.repo, { type: "remote", url: mcpUrl }, "MCP server URL found in README")
  }

  const packageName = typeof manifest.name === "string" ? manifest.name : undefined
  const keywords = Array.isArray(manifest.keywords)
    ? manifest.keywords.filter((value): value is string => typeof value === "string")
    : []
  const exports = isRecord(manifest.exports) ? manifest.exports : undefined
  const isPrivate = manifest.private === true
  const hasBin = manifest.bin !== undefined
  const packageInstalled = proposals.some(
    (item) =>
      item.kind === "mcp" &&
      isRecord(item.config) &&
      Array.isArray(item.config.command) &&
      item.config.command.includes(packageName),
  )
  if (
    packageName &&
    !isPrivate &&
    !packageInstalled &&
    (hasBin || keywords.some((value) => value === "mcp" || value.includes("modelcontextprotocol")))
  ) {
    addMcp(location.repo, { type: "local", command: ["npx", "-y", packageName] }, `Package ${packageName} runs through npx`)
  }
  if (
    keywords.some((value) => value === "opencode" || value === "opencode-plugin" || value.startsWith("opencode-")) ||
    (exports !== undefined && ("./rpc" in exports || "./gui-experimental" in exports))
  ) {
    addPlugin(`github:${location.owner}/${location.repo}`, "Repository looks like an OpenCode plugin")
  }

  if (proposals.length === 0) {
    notes.push("Could not detect an MCP server or OpenCode plugin automatically.")
  }
  notes.push("Claude Code commands, agents, and hooks are not carried over to OpenCode.")

  return {
    url: `https://github.com/${location.owner}/${location.repo}`,
    owner: location.owner,
    repo: location.repo,
    name: packageName ?? location.repo,
    ...(typeof manifest.description === "string" ? { description: manifest.description } : {}),
    proposals,
    notes,
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* MCP sources: GitHub links, npm packages, JSON configs, docs pages, endpoints, and local files  */
/* ---------------------------------------------------------------------------------------------- */

interface GithubBlobLocation {
  readonly owner: string
  readonly repo: string
  readonly ref: string
  readonly file: string
  readonly canonical: string
}

function encodePath(value: string) {
  return value
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/")
}

function parseGithubBlob(input: string): GithubBlobLocation | undefined {
  let value = input.trim()
  if (value.startsWith("github.com/")) value = `https://${value}`
  if (!/^https?:\/\/(?:www\.)?github\.com\//i.test(value)) return
  let url: URL
  try {
    url = new URL(value.replace(/^http:/i, "https:"))
  } catch {
    return
  }
  const parts = url.pathname.split("/").filter(Boolean)
  const owner = parts[0]
  const repo = parts[1]?.replace(/\.git$/, "")
  const mode = parts[2]
  if (!owner || !repo || (mode !== "blob" && mode !== "raw") || !parts[3]) return
  const ref = decodeURIComponent(parts[3])
  const file = parts.slice(4).map(decodeURIComponent).join("/")
  if (!ref || !file) return
  return {
    owner,
    repo,
    ref,
    file,
    canonical: `https://github.com/${owner}/${repo}/blob/${ref}/${file}`,
  }
}

function githubRawUrl(blob: GithubBlobLocation) {
  return `https://raw.githubusercontent.com/${blob.owner}/${blob.repo}/${encodePath(blob.ref)}/${encodePath(blob.file)}`
}

interface NpmSource {
  readonly name: string
  readonly version?: string
  readonly url: string
}

function parseNpmSource(input: string): NpmSource | undefined {
  const value = input.trim()
  if (!value) return
  if (/^https?:\/\//i.test(value)) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return
    }
    const host = url.hostname.toLowerCase()
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part))
    if (host === "npmjs.com" || host === "www.npmjs.com") {
      if (parts[0] !== "package" || !parts[1]) return
      const scoped = parts[1].startsWith("@")
      const name = scoped ? `${parts[1]}/${parts[2] ?? ""}` : parts[1]
      if (!name || name.endsWith("/")) return
      const versionIndex = scoped ? 3 : 2
      const version = parts[versionIndex] === "v" ? parts[versionIndex + 1] : undefined
      return {
        name,
        ...(version ? { version } : {}),
        url: `https://www.npmjs.com/package/${name}`,
      }
    }
    if (host === "registry.npmjs.org") {
      const name = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1] ?? ""}` : parts[0]
      if (!name || name.endsWith("/")) return
      return { name, url: `https://www.npmjs.com/package/${name}` }
    }
    return
  }

  const spec = value.replace(/^npm:/i, "")
  const match = /^(@[^/@\s]+\/[^@\s]+|[^@/\s]+)(?:@([^\s]+))?$/.exec(spec)
  if (!match) return
  const name = match[1]!
  const version = match[2]
  if (!/^[a-zA-Z0-9@/._-]+$/.test(name)) return
  return {
    name,
    ...(version ? { version } : {}),
    url: `https://www.npmjs.com/package/${name}`,
  }
}

function mcpServerName(value: string, fallback = "mcp-server") {
  const name = value
    .trim()
    .replace(/^@/, "")
    .replace(/[\\/\s]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
  return name || fallback
}

function remoteMcpName(url: URL) {
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/\./g, "-")
    .replace(/^mcp-/, "")
    .replace(/-mcp$/, "")
    .replace(/^-+|-+$/g, "")
  return mcpServerName(host, "remote-mcp")
}

function mcpInspection(input: {
  url: string
  owner?: string
  repo?: string
  name?: string
  description?: string
  proposals: RepositoryProposal[]
  notes?: string[]
}): RepositoryInspection {
  const repo = input.repo ?? ""
  return {
    url: input.url,
    owner: input.owner ?? "",
    repo,
    name: input.name ?? (repo || input.url),
    ...(input.description ? { description: input.description } : {}),
    proposals: input.proposals,
    notes: input.notes ?? [],
  }
}

function proposalsFromConfig(value: unknown, reason: string) {
  const proposals: RepositoryProposal[] = []
  const skipped: string[] = []
  const seen = new Set<string>()
  const servers = mcpServersFrom(value)
  if (servers.length === 0) {
    const single = mapMcpServer(value)
    if (single) servers.push({ name: "mcp-server", config: single })
  }
  for (const server of servers) {
    const name = mcpServerName(server.name)
    if (seen.has(name)) continue
    try {
      validateMcpConfig(server.config)
    } catch {
      skipped.push(server.name)
      continue
    }
    seen.add(name)
    proposals.push({ kind: "mcp", name, config: server.config, reason })
  }
  return { proposals, skipped }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&(?:amp|#38);/gi, "&")
    .replace(/&(?:lt|#60);/gi, "<")
    .replace(/&(?:gt|#62);/gi, ">")
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

function htmlToPlainText(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|pre|code|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
}

function commandsFromText(value: string) {
  const result: string[][] = []
  const seen = new Set<string>()
  const runner = /^(?:npx|bunx|pnpm\s+d[lx]x|yarn\s+dlx|npm\s+exec)\b/i
  for (const line of value.split(/\r?\n/)) {
    const candidates: string[] = []
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      if (match[1]) candidates.push(match[1])
    }
    const direct = line
      .trim()
      .replace(/^[\s$>#-]+/, "")
      .replace(/^`+|`+$/g, "")
      .trim()
    if (runner.test(direct)) candidates.push(direct)

    for (const candidate of candidates) {
      if (!runner.test(candidate)) continue
      let parts: string[]
      try {
        parts = splitCommand(candidate)
      } catch {
        continue
      }
      if (parts.length < 2 || parts.some((part) => part.length === 0)) continue
      const key = parts.join("\u0000")
      if (seen.has(key)) continue
      seen.add(key)
      result.push(parts)
      if (result.length >= 10) return result
    }
  }
  return result
}

function absoluteHttpUrl(value: string, base?: URL) {
  const trimmed = decodeHtmlEntities(value.trim()).replace(/[.,;]+$/, "")
  if (!trimmed) return
  try {
    const url = base ? new URL(trimmed, base) : new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    return url.toString()
  } catch {
    return
  }
}

function scanMcpText(text: string, base?: URL) {
  const plain = htmlToPlainText(text)
  const endpoints: string[] = []
  const packages: string[] = []
  const jsonLinks: string[] = []
  const endpointSeen = new Set<string>()
  const packageSeen = new Set<string>()
  const linkSeen = new Set<string>()

  for (const match of plain.matchAll(/https?:\/\/[^\s"'<>`)\]]+\/mcp(?:\?[^\s"'<>`)\]]*)?/gi)) {
    const url = absoluteHttpUrl(match[0], base)
    if (!url || endpointSeen.has(url)) continue
    endpointSeen.add(url)
    endpoints.push(url)
  }

  for (const source of [plain, text]) {
    for (const match of source.matchAll(
      /https?:\/\/(?:www\.)?npmjs\.com\/package\/((?:@[^/\s"'<>]+\/)?[^/\s"'<>?#]+)/gi,
    )) {
      const name = decodeURIComponent(match[1] ?? "")
      if (!name || packageSeen.has(name)) continue
      packageSeen.add(name)
      packages.push(name)
    }
  }

  for (const match of plain.matchAll(/(?:https?:\/\/|\/|\.\.?\/)[^\s"'<>`)\]]+\.jsonc?(?:\?[^\s"'<>`)\]]*)?/gi)) {
    const url = absoluteHttpUrl(match[0], base)
    if (!url || linkSeen.has(url)) continue
    linkSeen.add(url)
    jsonLinks.push(url)
  }
  for (const match of text.matchAll(/href\s*=\s*["']([^"']+\.jsonc?)["']/gi)) {
    const url = absoluteHttpUrl(match[1] ?? "", base)
    if (!url || linkSeen.has(url)) continue
    linkSeen.add(url)
    jsonLinks.push(url)
  }

  return {
    endpoints,
    commands: commandsFromText(plain),
    packages,
    jsonLinks: jsonLinks.slice(0, 4),
  }
}

function addScannedProposals(
  proposals: RepositoryProposal[],
  scanned: ReturnType<typeof scanMcpText>,
  notes: string[],
) {
  for (const endpoint of scanned.endpoints) {
    let url: URL
    try {
      url = new URL(endpoint)
    } catch {
      continue
    }
    const name = remoteMcpName(url)
    if (proposals.some((proposal) => proposal.kind === "mcp" && proposal.name === name)) continue
    proposals.push({
      kind: "mcp",
      name,
      config: { type: "remote", url: endpoint },
      reason: "MCP endpoint found in the source",
    })
  }
  for (const command of scanned.commands) {
    const name = mcpServerName(command.slice(0, 3).join("-"), "command-mcp")
    if (proposals.some((proposal) => proposal.kind === "mcp" && proposal.name === name)) continue
    proposals.push({
      kind: "mcp",
      name,
      config: { type: "local", command },
      reason: "Command found in the source",
    })
  }
  for (const packageName of scanned.packages) {
    const name = mcpServerName(packageName)
    if (proposals.some((proposal) => proposal.kind === "mcp" && proposal.name === name)) continue
    proposals.push({
      kind: "mcp",
      name,
      config: { type: "local", command: ["npx", "-y", packageName] },
      reason: `npm package ${packageName} linked from the source`,
    })
  }
  if (proposals.length === 0) notes.push("No MCP servers were detected in this source.")
}

async function inspectJsonText(text: string, label: string) {
  const value = parseConfigText(text)
  if (value === undefined) throw new Error("The source is not valid JSON or JSONC")
  const { proposals, skipped } = proposalsFromConfig(value, `${label} contains an MCP server`)
  const notes: string[] = []
  if (skipped.length > 0) {
    notes.push(`Skipped invalid MCP server configuration: ${skipped.join(", ")}.`)
  }
  if (proposals.length === 0) notes.push("No MCP servers were found in this JSON.")
  return mcpInspection({
    url: label,
    owner: "local",
    repo: "mcp-config",
    name: label,
    proposals,
    notes,
  })
}

async function inspectGithubFile(blob: GithubBlobLocation) {
  const raw = githubRawUrl(blob)
  const result = await fetchText(raw)
  if (!result.ok) {
    throw new Error(`Failed to download ${blob.file}: ${result.error ?? `HTTP ${result.status}`}`)
  }
  const text = result.text ?? ""
  const parsed = parseConfigText(text)
  if (parsed !== undefined) {
    const { proposals, skipped } = proposalsFromConfig(parsed, `${blob.file} contains an MCP server`)
    const notes: string[] = []
    if (skipped.length > 0) notes.push(`Skipped invalid MCP server configuration: ${skipped.join(", ")}.`)
    if (proposals.length === 0) notes.push("No MCP servers were found in this JSON.")
    return mcpInspection({
      url: blob.canonical,
      owner: blob.owner,
      repo: blob.repo,
      name: blob.repo,
      proposals,
      notes,
    })
  }
  const notes: string[] = []
  const proposals: RepositoryProposal[] = []
  addScannedProposals(proposals, scanMcpText(text, new URL(blob.canonical)), notes)
  return mcpInspection({
    url: blob.canonical,
    owner: blob.owner,
    repo: blob.repo,
    name: blob.repo,
    proposals,
    notes,
  })
}

async function inspectNpmPackage(source: NpmSource) {
  const spec = source.version ? `${source.name}@${source.version}` : source.name
  const config = { type: "local", command: ["npx", "-y", spec] }
  validateMcpConfig(config)
  return mcpInspection({
    url: source.url,
    owner: "npm",
    repo: source.name,
    name: source.name,
    proposals: [
      {
        kind: "mcp",
        name: mcpServerName(source.name),
        config,
        reason: `Runs ${spec} through npx`,
      },
    ],
    notes: [
      "The package is downloaded from npm on first start; the first launch can take a while.",
      "Review the publisher before installing. MCP servers run with your user permissions.",
    ],
  })
}

function inspectRemoteEndpoint(url: URL) {
  return mcpInspection({
    url: url.toString(),
    owner: url.hostname,
    repo: "mcp",
    name: remoteMcpName(url),
    proposals: [
      {
        kind: "mcp",
        name: remoteMcpName(url),
        config: { type: "remote", url: url.toString() },
        reason: "Remote MCP endpoint",
      },
    ],
    notes: ["If the endpoint requires authentication, use the Sign in action after installing."],
  })
}

async function inspectUrlSource(url: URL) {
  const result = await fetchText(url.toString())
  if (!result.ok) {
    throw new Error(`Failed to fetch ${url.toString()}: ${result.error ?? `HTTP ${result.status}`}`)
  }
  const text = result.text ?? ""
  const parsed = parseConfigText(text)
  if (parsed !== undefined) {
    const { proposals, skipped } = proposalsFromConfig(parsed, "The source contains an MCP server")
    if (proposals.length > 0) {
      return mcpInspection({
        url: url.toString(),
        owner: url.hostname,
        repo: "mcp",
        name: url.hostname,
        proposals,
        notes: skipped.length > 0 ? [`Skipped invalid MCP server configuration: ${skipped.join(", ")}.`] : [],
      })
    }
  }

  const notes: string[] = []
  const proposals: RepositoryProposal[] = []
  const scanned = scanMcpText(text, url)
  addScannedProposals(proposals, scanned, notes)
  for (const link of scanned.jsonLinks) {
    if (link === url.toString()) continue
    const configResult = await fetchText(link)
    if (!configResult.ok) continue
    const value = parseConfigText(configResult.text)
    if (value === undefined) continue
    const { proposals: found, skipped } = proposalsFromConfig(value, `MCP configuration linked from the source`)
    if (skipped.length > 0) notes.push(`Skipped invalid MCP server configuration in ${link}: ${skipped.join(", ")}.`)
    for (const proposal of found) {
      if (proposals.some((item) => item.kind === "mcp" && item.name === proposal.name)) continue
      proposals.push(proposal)
    }
  }
  if (proposals.length === 0) notes.push("No MCP servers were detected on this page.")
  return mcpInspection({
    url: url.toString(),
    owner: url.hostname,
    repo: "mcp",
    name: url.hostname,
    proposals,
    notes,
  })
}

function isMcpEndpoint(url: URL) {
  const pathname = url.pathname.replace(/\/+$/, "").toLowerCase()
  const host = url.hostname.toLowerCase()
  return (
    /(?:^|\/)mcp(?:\/|$)/.test(pathname) ||
    /(?:^|\/)sse(?:\/|$)/.test(pathname) ||
    url.searchParams.has("mcp") ||
    host.startsWith("mcp.") ||
    host.includes(".mcp.")
  )
}

async function inspectLocalSource(input: string) {
  const localPath = input.startsWith("file://") ? fileURLToPath(input) : path.resolve(expandHome(input))
  if (await isDirectory(localPath)) {
    const files = [
      ...repositoryMcpFiles,
      "claude_desktop_config.json",
      ".cursor/mcp.json",
      ".vscode/mcp.json",
    ]
    const proposals: RepositoryProposal[] = []
    const notes: string[] = []
    for (const file of files) {
      const filePath = path.join(localPath, ...file.split("/"))
      if (!(await isFile(filePath))) continue
      const text = await readFile(filePath, "utf8")
      const value = parseConfigText(text)
      if (value === undefined) continue
      const { proposals: found, skipped } = proposalsFromConfig(value, `${file} found in the folder`)
      if (skipped.length > 0) notes.push(`Skipped invalid MCP server configuration in ${file}: ${skipped.join(", ")}.`)
      for (const proposal of found) {
        if (proposals.some((item) => item.kind === "mcp" && item.name === proposal.name)) continue
        proposals.push(proposal)
      }
    }
    if (proposals.length === 0) notes.push("No MCP configuration files were found in this folder.")
    return mcpInspection({
      url: localPath,
      owner: "local",
      repo: path.basename(localPath),
      name: path.basename(localPath),
      proposals,
      notes,
    })
  }

  if (!(await isFile(localPath))) throw new Error(`Path not found: ${localPath}`)
  const text = await readFile(localPath, "utf8")
  const value = parseConfigText(text)
  if (value !== undefined) {
    const { proposals, skipped } = proposalsFromConfig(value, `${path.basename(localPath)} contains an MCP server`)
    const notes: string[] = []
    if (skipped.length > 0) notes.push(`Skipped invalid MCP server configuration: ${skipped.join(", ")}.`)
    if (proposals.length === 0) notes.push("No MCP servers were found in this JSON.")
    return mcpInspection({
      url: localPath,
      owner: "local",
      repo: path.basename(localPath),
      name: path.basename(localPath),
      proposals,
      notes,
    })
  }
  const notes: string[] = []
  const proposals: RepositoryProposal[] = []
  addScannedProposals(proposals, scanMcpText(text), notes)
  return mcpInspection({
    url: localPath,
    owner: "local",
    repo: path.basename(localPath),
    name: path.basename(localPath),
    proposals,
    notes,
  })
}

/**
 * Finds MCP servers in a GitHub repository, a GitHub or raw JSON file, an npm package, a docs
 * page, a remote endpoint, a local config file, or a pasted JSON document.
 */
export async function inspectMcpSource(source: string): Promise<RepositoryInspection> {
  const value = source.trim()
  if (!value) throw new Error("Enter a GitHub URL, npm package, JSON config, or MCP endpoint")

  if (value.startsWith("{") || value.startsWith("[")) {
    return inspectJsonText(value, "Pasted JSON")
  }

  if (isPathLike(value)) return inspectLocalSource(value)

  const npm = parseNpmSource(value)
  if (npm) return inspectNpmPackage(npm)

  const blob = parseGithubBlob(value)
  if (blob) return inspectGithubFile(blob)

  if (parseGithub(value)) {
    const inspection = await inspectRepository(value)
    const proposals = inspection.proposals.filter((proposal) => proposal.kind === "mcp")
    const notes = [...inspection.notes]
    if (proposals.length === 0) notes.push("No MCP servers were detected in this repository.")
    else notes.push("Only MCP servers are shown here; plugins are installed from the Plugins tab.")
    return { ...inspection, proposals, notes }
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Unsupported source: ${value}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported source: ${value}`)
  }
  if (isMcpEndpoint(url)) return inspectRemoteEndpoint(url)
  return inspectUrlSource(url)
}

export async function installRepository(proposal: RepositoryProposal, scope: Scope, project?: string) {
  const paths = await resolveScope(scope, project)
  if (proposal.kind === "mcp") {
    if (!proposal.name || !proposal.config) throw new Error("No MCP server specified for installation")
    const document = await readScope(paths)
    if (Object.hasOwn(isRecord(document.data.mcp) && isRecord(document.data.mcp.servers) ? document.data.mcp.servers : {}, proposal.name)) {
      throw new Error(`MCP server "${proposal.name}" already exists; rename it manually.`)
    }
    // Download package-runner servers first: OpenCode's 30 second startup limit is shorter than a
    // cold npm install, and killing that install leaves the shared npx cache broken.
    if (isRecord(proposal.config) && Array.isArray(proposal.config.command)) {
      await prewarmPackageRunner(proposal.config.command)
    }
    await saveMcp(paths, { name: proposal.name, config: proposal.config })
    return
  }
  if (!proposal.package) throw new Error("No plugin specified for installation")
  const document = await readScope(paths)
  if (!hasPlugin(document, proposal.package)) await savePlugin(paths, { package: proposal.package })
}

/* ---------------------------------------------------------------------------------------------- */
/* Automatic URL migration                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Claude Code plugins publish URLs like `…/mcp?client=claude-code-plugin`. OpenCode authenticates as its own
 * OAuth client, so that parameter can make the server reject the client registration. Strip it on every
 * remote MCP entry the manager knows about, including entries installed before this fix.
 */
export async function normalizeMcpUrls(paths: ScopePaths, names?: readonly string[]) {
  let changed = false
  await updateScope(paths, (data) => {
    const servers = mcpServers(data)
    const selected = names ?? Object.keys(servers)
    const mutations: Mutation[] = []
    for (const name of selected) {
      const existing = servers[name]
      if (!isRecord(existing) || existing.type !== "remote" || typeof existing.url !== "string") continue
      const url = opencodeRemoteUrl(existing.url)
      if (url === existing.url) continue
      mutations.push({ path: ["mcp", "servers", name], value: { ...existing, url } })
      changed = true
    }
    return mutations
  })
  return changed
}

export async function normalizeInstalledMcpUrls() {
  const { registry } = await readRegistry()
  let changed = false
  const installed: InstalledRecord[] = []
  for (const record of registry.installed) {
    if (record.mcp.length === 0) {
      installed.push(record)
      continue
    }
    try {
      const paths = await resolveScope(record.scope, record.project)
      if (!(await normalizeMcpUrls(paths, record.mcp))) {
        installed.push(record)
        continue
      }
      changed = true
      // This automated URL rewrite is not a user edit: refresh the fingerprints for the managed
      // servers so a later uninstall can still recognize them as owned.
      const document = await readScope(paths)
      const servers = mcpServers(document.data)
      const mcp = { ...record.fingerprints?.mcp }
      for (const name of record.mcp) {
        const config = servers[name]
        if (config !== undefined) mcp[name] = hashArtifact(mcpFingerprintValue(config))
      }
      installed.push({
        ...record,
        fingerprints: {
          mcp,
          skills: record.fingerprints?.skills ?? {},
          plugins: record.fingerprints?.plugins ?? {},
        },
      })
    } catch {
      // A missing project or an unreadable config is not fatal for the migration.
      installed.push(record)
    }
  }
  if (changed) await writeRegistry({ ...registry, installed })
  return changed
}
