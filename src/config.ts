import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser"
import type { Scope } from "./rpc"

/** One edit of the JSONC document, applied in order. `undefined` removes a value. */
export interface Mutation {
  readonly path: readonly (string | number)[]
  readonly value: unknown
}

export interface ScopePaths {
  readonly scope: Scope
  /** Global config directory, or the project root. */
  readonly root: string
  /** Directory that holds the config file. */
  readonly configDir: string
  readonly configPath: string
  readonly configExists: boolean
  readonly skillsDir: string
}

export interface ScopeDocument {
  readonly paths: ScopePaths
  readonly exists: boolean
  readonly text: string
  readonly data: Record<string, unknown>
  readonly errors: readonly string[]
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isFile(value: string) {
  return stat(value).then(
    (info) => info.isFile(),
    () => false,
  )
}

export function isDirectory(value: string) {
  return stat(value).then(
    (info) => info.isDirectory(),
    () => false,
  )
}

export function expandHome(input: string) {
  if (input === "~") return homedir()
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(homedir(), input.slice(2))
  return input
}

/** `OPENCODE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`. */
export function globalConfigDir() {
  const configured = process.env.OPENCODE_CONFIG_DIR?.trim()
  if (configured) return path.resolve(expandHome(configured))
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  const base = xdg ? path.resolve(expandHome(xdg)) : path.join(homedir(), ".config")
  return path.join(base, "opencode")
}

/**
 * The nearest `.opencode` directory at or above the project, matching how OpenCode discovers a
 * project's configuration. When there is none, returns `<project>/.opencode` for the first write.
 */
export async function projectConfigDir(projectRoot: string) {
  let directory = projectRoot
  for (;;) {
    const candidate = path.join(directory, ".opencode")
    if (await isDirectory(candidate)) return candidate
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return path.join(projectRoot, ".opencode")
}

async function pickConfigPath(directory: string) {
  const jsonc = path.join(directory, "opencode.jsonc")
  const json = path.join(directory, "opencode.json")
  // `opencode.jsonc` loads after `opencode.json`, so edit it when both exist.
  if (await isFile(jsonc)) return jsonc
  if (await isFile(json)) return json
  return json
}

export async function resolveScope(scope: Scope, project?: string): Promise<ScopePaths> {
  if (scope === "global") {
    const root = globalConfigDir()
    const configPath = await pickConfigPath(root)
    return {
      scope,
      root,
      configDir: root,
      configPath,
      configExists: await isFile(configPath),
      skillsDir: path.join(root, "skills"),
    }
  }

  const projectRoot = path.resolve(expandHome(project?.trim() || process.cwd()))
  if (!(await isDirectory(projectRoot))) {
    throw new Error(`Project directory not found: ${projectRoot}`)
  }
  const configDir = await projectConfigDir(projectRoot)
  const configPath = await pickConfigPath(configDir)
  return {
    scope,
    root: projectRoot,
    configDir,
    configPath,
    configExists: await isFile(configPath),
    skillsDir: path.join(configDir, "skills"),
  }
}

export async function readScope(paths: ScopePaths): Promise<ScopeDocument> {
  const exists = await isFile(paths.configPath)
  const text = exists ? await readFile(paths.configPath, "utf8") : ""
  const parseErrors: ParseError[] = []
  const errors: string[] = []
  let data: Record<string, unknown> = {}

  if (text.trim()) {
    const parsed = parse(text, parseErrors, { allowTrailingComma: true })
    if (isRecord(parsed)) data = parsed
    else if (parsed !== undefined) errors.push("The document root must be a JSON object")
  }

  errors.push(...parseErrors.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`))

  return {
    paths,
    exists,
    text,
    data,
    errors,
  }
}

function detectEol(text: string) {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

/** Applies mutations to a document without writing it, so previews use the same code as saves. */
function applyMutations(text: string, mutations: readonly Mutation[]) {
  let next = text.trim() ? text : "{}\n"
  const eol = detectEol(text)
  for (const mutation of mutations) {
    const edits = modify(next, mutation.path as (string | number)[], mutation.value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol },
    })
    next = applyEdits(next, edits)
  }
  if (!next.endsWith("\n")) next += eol
  return next
}

/** Writes through a temporary file, keeping the previous contents as `<file>.bak`. */
export async function writeAtomic(file: string, content: string, backup = true) {
  await mkdir(path.dirname(file), { recursive: true })
  if (backup && (await isFile(file))) {
    await copyFile(file, `${file}.bak`)
  }
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, content, "utf8")
  try {
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function updateScope(
  paths: ScopePaths,
  build: (data: Record<string, unknown>) => readonly Mutation[],
): Promise<void> {
  const current = await readScope(paths)
  if (current.errors.length > 0) {
    throw new Error(`Cannot edit ${paths.configPath}: ${current.errors.join("; ")}`)
  }
  const mutations = build(current.data)
  if (mutations.length === 0) return
  await writeAtomic(paths.configPath, applyMutations(current.text, mutations), current.exists)
}

/**
 * Creates the folders a scope writes to and an empty config when it has none. Existing files are
 * never changed; `wx` closes the small race between checking and creating the config.
 */
export async function ensureScope(paths: ScopePaths) {
  await mkdir(paths.configDir, { recursive: true })
  await mkdir(paths.skillsDir, { recursive: true })
  if (await isFile(paths.configPath)) return
  try {
    await writeFile(paths.configPath, "{}\n", { encoding: "utf8", flag: "wx" })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Write serialization                                                                             */
/* ---------------------------------------------------------------------------------------------- */

let writeTail: Promise<unknown> = Promise.resolve()

/** Serializes read-modify-write sequences, so two quick clicks cannot lose an edit. */
export function withWriteLock<T>(work: () => Promise<T>): Promise<T> {
  const run = writeTail.then(work, work)
  writeTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/* ---------------------------------------------------------------------------------------------- */
/* MCP servers                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

export interface McpRecord {
  readonly name: string
  readonly config: unknown
}

export function mcpServers(data: Record<string, unknown>): Record<string, unknown> {
  const mcp = isRecord(data.mcp) ? data.mcp : undefined
  const servers = mcp && isRecord(mcp.servers) ? mcp.servers : undefined
  return servers ?? {}
}

export function listMcp(data: Record<string, unknown>): McpRecord[] {
  return Object.entries(mcpServers(data)).map(([name, config]) => ({ name, config }))
}

function safeKey(name: string, label: string) {
  if (!name) throw new Error(`${label} must not be empty`)
  if (name !== name.trim()) throw new Error(`${label} must not start or end with whitespace`)
  if (name === "." || name === "..") throw new Error(`${label} is invalid: ${name}`)
  if (name.startsWith(".")) throw new Error(`${label} must not start with a dot: ${name}`)
  if (/[\\/\0]/.test(name)) throw new Error(`${label} must not contain path separators: ${name}`)
}

function assertStringMap(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`${label} must be an object of strings`)
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new Error(`${label} contains a reserved key: ${key}`)
    }
    if (typeof item !== "string") throw new Error(`${label}.${key} must be a string`)
    result[key] = item
  }
  return result
}

export function validateMcpConfig(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) throw new Error("MCP configuration must be an object")
  const type = input.type
  if (type !== "local" && type !== "remote") {
    throw new Error('MCP configuration must have type "local" or "remote"')
  }

  if (type === "local") {
    if (!Array.isArray(input.command) || input.command.length === 0) {
      throw new Error("A local MCP server needs a command")
    }
    if (input.command.some((part) => typeof part !== "string" || part.length === 0)) {
      throw new Error("Every command argument must be a non-empty string")
    }
    if (input.cwd !== undefined && typeof input.cwd !== "string") {
      throw new Error("cwd must be a string")
    }
    if (input.environment !== undefined) assertStringMap(input.environment, "environment")
  } else {
    if (typeof input.url !== "string" || !input.url.trim()) {
      throw new Error("A remote MCP server needs a URL")
    }
    if (input.headers !== undefined) assertStringMap(input.headers, "headers")
    if (input.oauth !== undefined && input.oauth !== false) {
      if (!isRecord(input.oauth)) throw new Error("oauth must be an object or false")
      for (const key of ["client_id", "client_secret", "scope", "redirect_uri", "auth_server_metadata_url"] as const) {
        if (input.oauth[key] !== undefined && typeof input.oauth[key] !== "string") {
          throw new Error(`oauth.${key} must be a string`)
        }
      }
      const port = input.oauth.callback_port
      if (
        port !== undefined &&
        (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535)
      ) {
        throw new Error("oauth.callback_port must be an integer between 1 and 65535")
      }
    }
  }

  if (input.disabled !== undefined && typeof input.disabled !== "boolean") {
    throw new Error("disabled must be a boolean")
  }

  return input
}

/** Keeps hand-written fields (protocol, pool, timeouts…) when the type stays the same. */
function mergeMcpConfig(existing: unknown, next: Record<string, unknown>, removals: readonly string[]) {
  if (isRecord(existing) && existing.type === next.type) {
    const merged = { ...existing, ...next }
    for (const key of removals) delete merged[key]
    return merged
  }
  return next
}

interface PreparedMcp {
  readonly name: string
  readonly originalName?: string
  readonly config: Record<string, unknown>
  readonly removals: readonly string[]
}

function prepareMcp(input: { name: string; originalName?: string; config: unknown }): PreparedMcp {
  const name = input.name
  const originalName = input.originalName
  safeKey(name, "MCP server name")
  if (originalName !== undefined) safeKey(originalName, "MCP server name")
  if (!isRecord(input.config)) throw new Error("MCP configuration must be an object")

  // A GUI sends `null` for an optional field the user cleared: strip it before validation and
  // delete it from the stored object so clearing a working directory or a header really clears it.
  const desired: Record<string, unknown> = {}
  const removals: string[] = []
  for (const [key, value] of Object.entries(input.config)) {
    if (value === null) removals.push(key)
    else desired[key] = value
  }
  const config = validateMcpConfig(desired)
  return {
    name,
    ...(originalName === undefined ? {} : { originalName }),
    config,
    removals,
  }
}

function mcpMutations(data: Record<string, unknown>, prepared: PreparedMcp): Mutation[] {
  const { name, originalName, config, removals } = prepared
  const servers = mcpServers(data)
  if (originalName === undefined) {
    if (servers[name] !== undefined) throw new Error(`MCP server "${name}" already exists`)
  } else if (originalName !== name && servers[name] !== undefined) {
    throw new Error(`MCP server "${name}" already exists`)
  }
  const existing = servers[originalName ?? name]
  const merged = mergeMcpConfig(existing, config, removals)
  if (originalName !== undefined && originalName !== name) {
    return [
      { path: ["mcp", "servers", originalName], value: undefined },
      { path: ["mcp", "servers", name], value: merged },
    ]
  }
  if (!isRecord(existing) || existing.type !== config.type) {
    return [{ path: ["mcp", "servers", name], value: merged }]
  }
  // Patch the fields instead of replacing the object, so comments and formatting inside it survive where possible.
  const mutations: Mutation[] = Object.entries(merged).map(([key, value]) => ({
    path: ["mcp", "servers", name, key],
    value,
  }))
  for (const key of Object.keys(existing)) {
    if (!Object.hasOwn(merged, key)) {
      mutations.push({ path: ["mcp", "servers", name, key], value: undefined })
    }
  }
  return mutations
}

export async function saveMcp(
  paths: ScopePaths,
  input: { name: string; originalName?: string; config: unknown },
) {
  const prepared = prepareMcp(input)
  await updateScope(paths, (data) => mcpMutations(data, prepared))
}

export interface ConfigPreview {
  readonly before: string
  readonly after: string
  readonly path: string
}

/** Renders the config a save would write, without touching the file or creating a backup. */
export async function previewMcp(
  paths: ScopePaths,
  input: { name: string; originalName?: string; config: unknown },
): Promise<ConfigPreview> {
  const prepared = prepareMcp(input)
  const current = await readScope(paths)
  if (current.errors.length > 0) {
    throw new Error(`Cannot edit ${paths.configPath}: ${current.errors.join("; ")}`)
  }
  const mutations = mcpMutations(current.data, prepared)
  return {
    before: current.text,
    after: mutations.length > 0 ? applyMutations(current.text, mutations) : current.text,
    path: paths.configPath,
  }
}

export async function removeMcp(paths: ScopePaths, name: string) {
  safeKey(name, "MCP server name")
  await updateScope(paths, (data) => {
    if (mcpServers(data)[name] === undefined) throw new Error(`MCP server not found: ${name}`)
    return [{ path: ["mcp", "servers", name], value: undefined }]
  })
}

export async function setMcpEnabled(paths: ScopePaths, name: string, enabled: boolean) {
  safeKey(name, "MCP server name")
  await updateScope(paths, (data) => {
    const existing = mcpServers(data)[name]
    if (!isRecord(existing)) throw new Error(`MCP server not found: ${name}`)
    // Edit the single field instead of replacing the object, so comments inside it survive.
    return [{ path: ["mcp", "servers", name, "disabled"], value: enabled ? undefined : true }]
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Plugins                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

export interface PluginRecord {
  readonly index: number
  readonly raw: unknown
  readonly package: string
  readonly options?: unknown
  readonly removal: boolean
}

export function listPlugins(data: Record<string, unknown>): PluginRecord[] {
  const entries = Array.isArray(data.plugins) ? data.plugins : []
  return entries.map((raw, index) => {
    if (typeof raw === "string") {
      const removal = raw.startsWith("-") && raw.length > 1
      return {
        index,
        raw,
        package: removal ? raw.slice(1) : raw,
        removal,
      }
    }
    if (isRecord(raw) && typeof raw.package === "string") {
      return {
        index,
        raw,
        package: raw.package,
        ...(raw.options === undefined ? {} : { options: raw.options }),
        removal: false,
      }
    }
    return { index, raw, package: "", removal: false }
  })
}

function assertPluginOptions(options: unknown): Record<string, unknown> | undefined {
  if (options === undefined) return undefined
  if (!isRecord(options)) throw new Error("Plugin options must be a JSON object")
  return options
}

export async function savePlugin(
  paths: ScopePaths,
  input: { index?: number; package: string; options?: unknown },
) {
  const target = input.package.trim()
  if (!target) throw new Error("Plugin package must not be empty")
  if (/[\0]/.test(target)) throw new Error("Plugin package contains an invalid character")
  const options = assertPluginOptions(input.options)
  const entry = options === undefined ? target : { package: target, options }

  await updateScope(paths, (data) => {
    if (!Array.isArray(data.plugins)) return [{ path: ["plugins"], value: [entry] }]
    if (input.index === undefined) {
      // Append at the array's current length instead of replacing the array, so comments inside it survive.
      return [{ path: ["plugins", data.plugins.length], value: entry }]
    }
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= data.plugins.length) {
      throw new Error("Plugin entry no longer exists, refresh the page")
    }
    return [{ path: ["plugins", input.index], value: entry }]
  })
}

export async function removePlugin(paths: ScopePaths, index: number) {
  await updateScope(paths, (data) => {
    const plugins = Array.isArray(data.plugins) ? data.plugins : []
    if (!Number.isInteger(index) || index < 0 || index >= plugins.length) {
      throw new Error("Plugin entry no longer exists, refresh the page")
    }
    return [{ path: ["plugins", index], value: undefined }]
  })
}

/** The package or local path of a plugin entry, or undefined for an entry this manager cannot read. */
export function pluginTarget(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw.startsWith("-") ? raw.slice(1) : raw
  if (isRecord(raw) && typeof raw.package === "string") return raw.package
  return undefined
}

export function hasPlugin(paths: ScopeDocument, target: string) {
  return listPlugins(paths.data).some((plugin) => plugin.package === target)
}

/** Removes every `plugins` entry whose package or path equals `target`. */
export async function removePluginPackage(paths: ScopePaths, target: string) {
  await updateScope(paths, (data) => {
    if (!Array.isArray(data.plugins)) return []
    // Remove from the end so earlier indices stay valid while the edits are applied in order.
    return data.plugins
      .flatMap((entry, index) => (pluginTarget(entry) === target ? [{ path: ["plugins", index], value: undefined }] : []))
      .reverse()
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Skills                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

export interface SkillRecord {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly path: string
  readonly dir: string
  readonly kind: "dir" | "file"
  readonly disabled: boolean
  readonly content: string
}

export interface Frontmatter {
  readonly valid: boolean
  readonly name?: string
  readonly description?: string
}

function stripQuotes(value: string) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'")
  }
  return value
}

/** Minimal frontmatter reader: the `name` and `description` keys OpenCode's skill parser uses. */
export function parseFrontmatter(content: string): Frontmatter {
  const normalized = content.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n")
  const lines = normalized.split("\n")
  let index = 0
  while (index < lines.length && lines[index].trim() === "") index++
  if (lines[index]?.trim() !== "---") return { valid: false }

  const header: string[] = []
  index++
  let closed = false
  for (; index < lines.length; index++) {
    const line = lines[index]
    if (line.trim() === "---" || line.trim() === "...") {
      closed = true
      break
    }
    header.push(line)
  }
  if (!closed) return { valid: false }

  const values: Record<string, string> = {}
  for (let line = 0; line < header.length; line++) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(header[line])
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()

    if (/^[|>][+-]?$/.test(value)) {
      const folded = value.startsWith(">")
      const block: string[] = []
      let cursor = line + 1
      for (; cursor < header.length; cursor++) {
        const next = header[cursor]
        if (next.trim() === "") {
          block.push("")
          continue
        }
        if (!/^\s/.test(next)) break
        block.push(next)
      }
      line = cursor - 1
      const indented = block.filter((item) => item.trim() !== "")
      const indent = indented.length
        ? Math.min(...indented.map((item) => /^\s*/.exec(item)?.[0].length ?? 0))
        : 0
      const contentLines = block.map((item) => item.slice(indent).trimEnd())
      values[key] = folded
        ? contentLines.join(" ").replace(/\s+/g, " ").trim()
        : contentLines.join("\n").trim()
      continue
    }

    // Drop an unquoted trailing comment, keeping `#` inside quoted values.
    if (!value.startsWith('"') && !value.startsWith("'")) {
      value = value.replace(/\s+#.*$/, "")
    }
    values[key] = stripQuotes(value).trim()
  }

  return {
    valid: true,
    ...(values.name ? { name: values.name } : {}),
    ...(values.description ? { description: values.description } : {}),
  }
}

async function readTextFile(file: string) {
  try {
    return await readFile(file, "utf8")
  } catch {
    return undefined
  }
}

function skillRecord(
  id: string,
  dir: string,
  file: string,
  kind: "dir" | "file",
  disabled: boolean,
  content: string,
): SkillRecord {
  const frontmatter = parseFrontmatter(content)
  return {
    id,
    name: frontmatter.name ?? id,
    ...(frontmatter.description ? { description: frontmatter.description } : {}),
    path: file,
    dir,
    kind,
    disabled,
    content,
  }
}

async function collectSkills(directory: string, disabled: boolean, into: SkillRecord[]) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const file = path.join(full, "SKILL.md")
      const content = await readTextFile(file)
      if (content !== undefined) into.push(skillRecord(entry.name, full, file, "dir", disabled, content))
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue
    const content = await readTextFile(full)
    if (content !== undefined) {
      into.push(skillRecord(entry.name.slice(0, -3), full, full, "file", disabled, content))
    }
  }
}

/** Active skills, then the ones parked in `<skillsDir>/.disabled`. The scanner ignores dot directories. */
export async function listSkills(skillsDir: string): Promise<SkillRecord[]> {
  const result: SkillRecord[] = []
  await collectSkills(skillsDir, false, result)
  const active = new Set(result.map((skill) => skill.id))
  const disabled: SkillRecord[] = []
  await collectSkills(path.join(skillsDir, ".disabled"), true, disabled)
  // A copy left in both places would produce two rows with the same id; the active one wins.
  result.push(...disabled.filter((skill) => !active.has(skill.id)))
  return result.sort((left, right) => left.id.localeCompare(right.id))
}

function assertSkillId(id: string) {
  if (!id) throw new Error("Skill id must not be empty")
  if (id !== id.trim()) throw new Error("Skill id must not start or end with whitespace")
  if (id === "." || id === "..") throw new Error(`Skill id is invalid: ${id}`)
  if (id.startsWith(".")) throw new Error("Skill id must not start with a dot")
  if (/[\\/\0]/.test(id)) throw new Error("Skill id must not contain path separators")
}

function skillNodeName(skill: { id: string; kind: "dir" | "file" }) {
  return skill.kind === "file" ? `${skill.id}.md` : skill.id
}

async function findSkill(skillsDir: string, id: string) {
  const found = (await listSkills(skillsDir)).find((skill) => skill.id === id)
  if (!found) throw new Error(`Skill not found: ${id}`)
  return found
}

export async function saveSkill(
  paths: ScopePaths,
  input: { id: string; originalId?: string; content: string },
) {
  assertSkillId(input.id)
  if (!input.content.trim()) throw new Error("Skill content must not be empty")
  if (!parseFrontmatter(input.content).valid) {
    throw new Error("SKILL.md must start with a YAML frontmatter block delimited by ---")
  }

  const skillsDir = paths.skillsDir
  await mkdir(skillsDir, { recursive: true })

  if (input.originalId) {
    const existing = await findSkill(skillsDir, input.originalId)
    let directory = existing.dir
    if (existing.id !== input.id) {
      const parent = existing.disabled ? path.join(skillsDir, ".disabled") : skillsDir
      const destination = path.join(parent, skillNodeName({ id: input.id, kind: existing.kind }))
      if (destination !== existing.dir && (await isDirectory(destination) || (await isFile(destination)))) {
        throw new Error(`A skill with id "${input.id}" already exists`)
      }
      await rename(existing.dir, destination)
      directory = destination
    }
    const file = existing.kind === "file" ? directory : path.join(directory, "SKILL.md")
    await writeAtomic(file, input.content, true)
    return
  }

  const directory = path.join(skillsDir, input.id)
  const file = path.join(skillsDir, `${input.id}.md`)
  if ((await isDirectory(directory)) || (await isFile(file))) {
    throw new Error(`A skill with id "${input.id}" already exists`)
  }
  await mkdir(directory, { recursive: true })
  await writeAtomic(path.join(directory, "SKILL.md"), input.content, false)
}

export async function removeSkill(paths: ScopePaths, id: string) {
  const skill = await findSkill(paths.skillsDir, id)
  await rm(skill.dir, { recursive: true, force: true })
}

export async function setSkillEnabled(paths: ScopePaths, id: string, enabled: boolean) {
  const skill = await findSkill(paths.skillsDir, id)
  if (skill.disabled === !enabled) return
  const parent = enabled ? paths.skillsDir : path.join(paths.skillsDir, ".disabled")
  await mkdir(parent, { recursive: true })
  const destination = path.join(parent, skillNodeName(skill))
  if ((await isDirectory(destination)) || (await isFile(destination))) {
    throw new Error(`Cannot move skill "${id}": ${destination} already exists`)
  }
  await rename(skill.dir, destination)
}
