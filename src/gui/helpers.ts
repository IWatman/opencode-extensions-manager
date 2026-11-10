import type { Plugin, SetupContext } from "@opencode/plugin/gui"
import type { RepositoryProposal } from "../rpc"
import { formatCommand } from "../commands.ts"

export type GuiContext = SetupContext<Plugin.Declarations<{}>>

export type RuntimeStatus = "connected" | "pending" | "disabled" | "failed" | "needs_auth" | "unknown"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (isRecord(error) && typeof error.message === "string") return error.message
  return String(error)
}

export { formatCommand, quoteArgument, splitCommand } from "../commands.ts"

export function parsePairs(input: string) {
  const values: Record<string, string> = {}
  const invalid: string[] = []
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator <= 0) {
      invalid.push(line)
      continue
    }
    const key = line.slice(0, separator).trim()
    if (!key) {
      invalid.push(line)
      continue
    }
    values[key] = line.slice(separator + 1).trim()
  }
  return { values, invalid }
}

export function formatPairs(value: unknown) {
  if (!isRecord(value)) return ""
  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, item]) => `${key}=${item}`)
    .join("\n")
}

export function mcpType(config: unknown): "local" | "remote" | "unknown" {
  if (!isRecord(config)) return "unknown"
  if (config.type === "local") return "local"
  if (config.type === "remote") return "remote"
  return "unknown"
}

export function mcpDisabled(config: unknown) {
  return isRecord(config) && config.disabled === true
}

export function mcpSummary(config: unknown) {
  if (!isRecord(config)) return ""
  if (config.type === "local" && Array.isArray(config.command)) {
    return formatCommand(config.command.filter((item): item is string => typeof item === "string"))
  }
  if (config.type === "remote" && typeof config.url === "string") return config.url
  return ""
}

/** One-line description of an install proposal: the plugin package, command, or endpoint. */
export function repositorySummary(proposal: RepositoryProposal) {
  if (proposal.kind === "plugin") return proposal.package ?? ""
  const config = isRecord(proposal.config) ? proposal.config : undefined
  if (!config) return ""
  if (config.type === "remote" && typeof config.url === "string") return config.url
  if (Array.isArray(config.command)) {
    return formatCommand(config.command.filter((item): item is string => typeof item === "string"))
  }
  return ""
}

export function runtimeStatus(value: unknown): { status: RuntimeStatus; error?: string } {
  if (!isRecord(value)) return { status: "unknown" }
  const status = value.status
  if (status === "connected" || status === "pending" || status === "disabled" || status === "failed" || status === "needs_auth") {
    return {
      status,
      ...(typeof value.error === "string" ? { error: value.error } : {}),
    }
  }
  return { status: "unknown" }
}

export function statusClass(status: RuntimeStatus) {
  return `oem-status-${status}`
}

export function statusKey(status: RuntimeStatus) {
  return `status.${status}`
}

export function revealPath(ctx: GuiContext, path: string) {
  if (ctx.desktop) {
    void ctx.desktop.reveal(path)
    return
  }
  void ctx.system.copy(path)
}

export function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Placeholder that replaces credentials in copied MCP configuration. */
export const SECRET_MASK = "***"

/** Header and environment names that usually carry credentials. */
const secretKeyPattern = /(authorization|token|api[-_]?key|secret|password|passwd|cookie)/i

export function isSecretKey(key: string) {
  return secretKeyPattern.test(key.trim())
}

/** True when a config stores at least one credential-like header. */
export function hasSecretHeaders(config: unknown) {
  if (!isRecord(config) || !isRecord(config.headers)) return false
  return Object.keys(config.headers).some(isSecretKey)
}

function stringEntries(value: unknown) {
  if (!isRecord(value)) return []
  return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
}

export function mcpHasPairs(config: unknown) {
  return isRecord(config) && (stringEntries(config.environment).length > 0 || stringEntries(config.headers).length > 0)
}

/**
 * Compact row text for environment variables and headers. Values stay hidden until the user
 * explicitly reveals them, so a screenshot or a shared screen never shows a token by accident.
 */
export function maskedMcpPairs(config: unknown, reveal = false) {
  if (!isRecord(config)) return ""
  const lines: string[] = []
  for (const [label, pairs] of [
    ["environment", config.environment],
    ["headers", config.headers],
  ] as const) {
    for (const [key, value] of stringEntries(pairs)) {
      lines.push(`${label}.${key}=${reveal ? value : SECRET_MASK}`)
    }
  }
  return lines.join("\n")
}

/**
 * Returns a copy of an MCP config with environment values, header values, and an OAuth client
 * secret replaced by `***`. Everything else, such as the command and URL, stays readable so the
 * result can be shared when asking for help.
 */
export function sanitizeMcpConfig(config: unknown): unknown {
  if (!isRecord(config)) return config
  const next: Record<string, unknown> = { ...config }
  for (const field of ["environment", "headers"] as const) {
    const pairs = next[field]
    if (!isRecord(pairs)) continue
    next[field] = Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, typeof value === "string" ? SECRET_MASK : value]),
    )
  }
  if (isRecord(config.oauth) && typeof config.oauth.client_secret === "string") {
    next.oauth = { ...config.oauth, client_secret: SECRET_MASK }
  }
  return next
}

/** The built-in Anthropic marketplace is the only source that does not need a trust prompt. */
export function isBuiltinMarketplaceUrl(url: string) {
  const value = url
    .trim()
    .toLowerCase()
    .replace(/^git\+/, "")
    .replace(/^github:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
  const repository = value.replace(/\/tree\/.*$/, "")
  return (
    repository === "github.com/anthropics/claude-plugins-official" ||
    repository === "anthropics/claude-plugins-official"
  )
}
