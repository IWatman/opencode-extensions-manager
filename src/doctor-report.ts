import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { listConfigBackups } from "./backups.ts"
import { expandHome, isRecord, type ScopePaths } from "./config.ts"
import type { Scope } from "./rpc"

interface DoctorReportInput {
  readonly scope: Scope
  readonly paths: ScopePaths
  readonly project?: string
  readonly state: unknown
  readonly now?: Date
}

function valueText(value: unknown, fallback = "—") {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return fallback
}

function cell(value: unknown) {
  return valueText(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, " ")
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

/** Keeps credentials out of a report the user may share. */
function redact(text: string) {
  return text.replace(
    /\b(token|api[_-]?key|secret|password|authorization)\b([ \t]*[=:][ \t]*)(?:(?:bearer|basic)[ \t]+)?[^\s&]+/gi,
    (_match, name: string, separator: string) => `${name}${separator}***`,
  )
}

/** Masks `user:password@` and token-only userinfo in URLs embedded in paths or diagnostics. */
function redactUrlCredentials(text: string) {
  return text.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi,
    (_match, scheme: string) => `${scheme}***@`,
  )
}

function redactSecrets(text: string) {
  return redact(redactFlags(redactUrlCredentials(text)))
}

/** Masks `--token VALUE` and `-password VALUE` forms that appear in commands and diagnostics. */
function redactFlags(text: string) {
  return text.replace(
    /(?<![\w-])(--?(?:token|api[_-]?key|secret|password|authorization|auth))\b([ \t]+)(?:(?:bearer|basic)[ \t]+)?(?:"[^"]*"|'[^']*'|\S+)/gi,
    (_match, name: string, separator: string) => `${name}${separator}***`,
  )
}

function redactCommand(command: unknown) {
  if (!Array.isArray(command)) return "no command"
  const secretFlag = /^(?:--)?(?:token|api[_-]?key|secret|password|authorization)$/i
  return redact(
    command
      .filter((part): part is string => typeof part === "string")
      .map((part, index, parts) => (index > 0 && secretFlag.test(parts[index - 1] ?? "") ? "***" : part))
      .join(" "),
  )
}

function mcpSummary(config: unknown) {
  if (!isRecord(config)) return "invalid"
  if (config.type === "local") {
    return redactCommand(config.command)
  }
  if (config.type === "remote") return redact(typeof config.url === "string" ? config.url : "no URL")
  return "invalid"
}

function table(header: readonly string[], body: readonly (readonly string[])[]) {
  if (body.length === 0) return "_None._"
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n")
}

/** OpenCode's temporary folder, overridable for tests and unusual installations. */
export function doctorReportDir() {
  const configured = process.env.OPENCODE_TEMP_DIR?.trim()
  return configured ? path.resolve(expandHome(configured)) : path.join(tmpdir(), "opencode")
}

export async function writeDoctorReport(input: DoctorReportInput): Promise<string> {
  const state = isRecord(input.state) ? input.state : {}
  const now = input.now ?? new Date()
  const diagnostics = rows(state.diagnostics)
  const mcp = rows(state.mcp)
  const plugins = rows(state.plugins)
  const skills = rows(state.skills)
  const marketplaces = rows(state.marketplaces)
  const installed = rows(state.installedPlugins)

  const scopes: Record<string, unknown>[] = [isRecord(state.global) ? state.global : {}]
  if (isRecord(state.project)) scopes.push(state.project)

  const backups = await listConfigBackups(input.scope, input.project).catch(() => [])

  const markdown = redactSecrets([
    "# Extensions Manager — Doctor report",
    "",
    `- Generated: ${now.toISOString()}`,
    `- Scope: ${input.scope}`,
    `- Project: ${input.project?.trim() || input.paths.root}`,
    `- Config file: ${input.paths.configPath}`,
    `- Config exists: ${input.paths.configExists ? "yes" : "no"}`,
    `- Skills folder: ${input.paths.skillsDir}`,
    "",
    "## Summary",
    "",
    `- Diagnostics: ${diagnostics.length}`,
    `- MCP servers: ${mcp.length}`,
    `- Plugin entries: ${plugins.length}`,
    `- Skills: ${skills.length}`,
    `- Marketplaces: ${marketplaces.length}`,
    `- Installed marketplace plugins: ${installed.length}`,
    `- Backup files: ${backups.length}`,
    ...(typeof state.projectError === "string" ? [`- Project error: ${state.projectError}`] : []),
    ...(typeof state.marketplaceError === "string" ? [`- Marketplace error: ${state.marketplaceError}`] : []),
    "",
    "## Scope paths",
    "",
    table(
      ["Scope", "Root", "Config directory", "Config file", "Config exists", "Skills directory"],
      scopes.map((info) => [
        valueText(info === scopes[0] ? "global" : "project"),
        valueText(info.root),
        valueText(info.configDir),
        valueText(info.configPath),
        info.configExists === true ? "yes" : "no",
        valueText(info.skillsDir),
      ]),
    ),
    "",
    "## Diagnostics",
    "",
    diagnostics.length === 0
      ? "_None._"
      : diagnostics.map((item) => `- [${valueText(item.scope)}] ${valueText(item.message)}`).join("\n"),
    "",
    "## MCP servers",
    "",
    table(
      ["Scope", "Name", "Type", "Summary"],
      mcp.map((entry) => [
        valueText(entry.scope),
        valueText(entry.name),
        valueText(isRecord(entry.config) ? entry.config.type : "invalid"),
        mcpSummary(entry.config),
      ]),
    ),
    "",
    "## Plugin entries",
    "",
    table(
      ["Scope", "Index", "Package", "Removal"],
      plugins.map((entry) => [
        valueText(entry.scope),
        valueText(entry.index),
        valueText(entry.package),
        entry.removal === true ? "yes" : "no",
      ]),
    ),
    "",
    "## Skills",
    "",
    table(
      ["Scope", "ID", "Name", "Kind", "Disabled", "Path"],
      skills.map((entry) => [
        valueText(entry.scope),
        valueText(entry.id),
        valueText(entry.name),
        valueText(entry.kind),
        entry.disabled === true ? "yes" : "no",
        valueText(entry.path),
      ]),
    ),
    "",
    "## Marketplaces",
    "",
    table(
      ["ID", "Name", "URL", "Built-in"],
      marketplaces.map((entry) => [
        valueText(entry.id),
        valueText(entry.name),
        valueText(entry.url),
        entry.builtin === true ? "yes" : "no",
      ]),
    ),
    "",
    "## Installed marketplace plugins",
    "",
    table(
      ["Key", "Marketplace", "Plugin", "Scope", "Enabled", "Version"],
      installed.map((entry) => [
        valueText(entry.key),
        valueText(entry.marketplaceName ?? entry.marketplace),
        valueText(entry.plugin),
        valueText(entry.scope),
        entry.enabled === true ? "yes" : "no",
        valueText(entry.version),
      ]),
    ),
    "",
    "## Backup files",
    "",
    table(
      ["Kind", "Scope", "Modified", "Size", "Path"],
      backups.map((entry) => [
        entry.kind,
        entry.scope,
        entry.modifiedAt,
        `${entry.size} bytes`,
        entry.path,
      ]),
    ),
    "",
    "## Notes",
    "",
    "- Environment variables, headers, and secrets are not included; MCP summaries redact common credential fields.",
    "- This report is read-only. Doctor did not change the configuration while creating it.",
    "",
  ].join("\n"))

  const directory = doctorReportDir()
  await mkdir(directory, { recursive: true })
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(".", "-")
  const file = path.join(directory, `extensions-manager-doctor-${stamp}.md`)
  await writeFile(file, markdown, "utf8")
  return file
}
