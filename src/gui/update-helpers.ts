/**
 * Pure helpers used by the unified update center. They deliberately avoid GUI and OpenCode
 * imports so they can be unit-tested without a running app.
 */

export interface PackageSourceLike {
  readonly type: string
  readonly target?: string
  readonly version?: string
  readonly outdated?: boolean
  readonly path?: string
}

export interface PluginInfoLike {
  readonly source: PackageSourceLike
}

export interface PackageUpdate {
  readonly target: string
  readonly version?: string
}

/** Package plugins that OpenCode's plugin service reported as outdated. */
export function packageUpdates(plugins: readonly PluginInfoLike[]): PackageUpdate[] {
  const seen = new Set<string>()
  const result: PackageUpdate[] = []
  for (const plugin of plugins) {
    const source = plugin.source
    if (source.type !== "package" || source.outdated !== true || !source.target) continue
    if (seen.has(source.target)) continue
    seen.add(source.target)
    result.push({ target: source.target, ...(source.version ? { version: source.version } : {}) })
  }
  return result.sort((left, right) => left.target.localeCompare(right.target))
}

export interface ClaudeCandidateLike {
  readonly id: string
  readonly name: string
  readonly displayName?: string
  readonly version?: string
  readonly installedKey?: string
}

export interface InstalledClaudeLike {
  readonly key: string
  readonly marketplace: string
  readonly version?: string
  readonly adapt?: boolean
}

export interface ClaudeUpdate {
  readonly key: string
  readonly id: string
  readonly name: string
  readonly currentVersion: string
  readonly latestVersion: string
  readonly scope: "global" | "project"
  readonly project?: string
  readonly adapt?: boolean
}

export interface ClaudeUpdateScope {
  readonly scope: "global" | "project"
  readonly project?: string
  readonly marketplace?: string
}

/**
 * Compares Claude Code cache candidates with the manager's import records. A candidate is an
 * update only when it is installed, both sides carry a version, and the versions differ.
 */
export function claudeUpdates(
  candidates: readonly ClaudeCandidateLike[],
  installed: readonly InstalledClaudeLike[],
  options: ClaudeUpdateScope,
): ClaudeUpdate[] {
  const marketplace = options.marketplace ?? "claude-code"
  const byKey = new Map(
    installed.filter((record) => record.marketplace === marketplace).map((record) => [record.key, record]),
  )
  const seen = new Set<string>()
  const result: ClaudeUpdate[] = []
  for (const candidate of candidates) {
    if (!candidate.installedKey || !candidate.version) continue
    const record = byKey.get(candidate.installedKey)
    if (!record?.version || record.version === candidate.version) continue
    if (seen.has(record.key)) continue
    seen.add(record.key)
    result.push({
      key: record.key,
      id: candidate.id,
      name: candidate.displayName ?? candidate.name,
      currentVersion: record.version,
      latestVersion: candidate.version,
      scope: options.scope,
      ...(options.project ? { project: options.project } : {}),
      ...(record.adapt ? { adapt: true } : {}),
    })
  }
  return result.sort((left, right) => left.name.localeCompare(right.name))
}
