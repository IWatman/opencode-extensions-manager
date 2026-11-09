import path from "node:path"

/**
 * Provisional scope-aware registry key contract.
 *
 * `feat/server-core` is not merged into `feat/tests-ci` yet, so `src/marketplaces.ts` still uses the
 * legacy `${marketplace}/${plugin}` key and has no exported migration helper. These functions keep
 * the expected workstream-1 behaviour under test until that branch lands. When it does, delete this
 * file and test the real exported helpers instead.
 *
 * Contract:
 * - global installs:  `global:<marketplace>/<plugin>`
 * - project installs: `project:<normalized project dir>:<marketplace>/<plugin>`
 * - legacy keys are migrated once, and a project install never collides with a global one.
 */

export type InstallScope = "global" | "project"

export interface ScopedRegistryEntry {
  readonly key: string
  readonly marketplace: string
  readonly plugin: string
  readonly scope: InstallScope
  readonly project?: string
  readonly [field: string]: unknown
}

export interface ScopedKeyInput {
  readonly scope: InstallScope
  readonly marketplace: string
  readonly plugin: string
  readonly project?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Absolute, forward-slash project path. Windows paths are compared case-insensitively. */
export function normalizeProject(project: string) {
  const resolved = path.resolve(project).replaceAll("\\", "/").replace(/\/+$/, "")
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export function installedKey(input: ScopedKeyInput): string {
  if (!input.marketplace.trim() || !input.plugin.trim()) {
    throw new Error("Registry keys need a marketplace and a plugin name")
  }
  const target = `${input.marketplace}/${input.plugin}`
  if (input.scope === "global") return `global:${target}`
  if (!input.project?.trim()) throw new Error("Project installs need a project directory")
  return `project:${normalizeProject(input.project)}:${target}`
}

export function isScopedKey(key: string) {
  return key.startsWith("global:") || key.startsWith("project:")
}

export function migrateInstalledKeys(entries: readonly unknown[]): {
  readonly entries: ScopedRegistryEntry[]
  readonly migrated: number
} {
  const byKey = new Map<string, ScopedRegistryEntry>()
  let migrated = 0

  for (const raw of entries) {
    if (!isRecord(raw)) continue
    if (typeof raw.marketplace !== "string" || typeof raw.plugin !== "string") continue
    const marketplace = raw.marketplace
    const plugin = raw.plugin
    const scope: InstallScope = raw.scope === "project" ? "project" : "global"
    const project = scope === "project" && typeof raw.project === "string" ? raw.project : undefined
    const expected = installedKey({
      scope,
      marketplace,
      plugin,
      ...(project === undefined ? {} : { project }),
    })
    const key = typeof raw.key === "string" && isScopedKey(raw.key) ? raw.key : expected
    if (key !== raw.key) migrated += 1
    // A duplicated key can only be the same install; last write wins, matching registry updates.
    byKey.set(key, {
      ...raw,
      key,
      marketplace,
      plugin,
      scope,
      ...(project === undefined ? {} : { project: normalizeProject(project) }),
    })
  }

  return { entries: [...byKey.values()], migrated }
}
