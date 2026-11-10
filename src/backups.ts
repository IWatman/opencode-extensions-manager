import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser"
import { isFile, isRecord, resolveScope, writeAtomic } from "./config.ts"
import { registryFilePath } from "./marketplaces.ts"
import type { Scope } from "./rpc"

/** One `.bak` file the manager owns, and the live file it would replace. */
export interface ConfigBackup {
  readonly path: string
  readonly target: string
  readonly modifiedAt: string
  readonly size: number
  readonly kind: "config" | "registry"
  readonly scope: Scope
}

export interface ConfigBackupDiff {
  /** Current live file. */
  readonly before: string
  /** Selected backup, which is what a restore would write. */
  readonly after: string
  /** Live file path. */
  readonly path: string
  /** Backup file path. */
  readonly backupPath: string
}

interface KnownBackup {
  readonly backupPath: string
  readonly targetPath: string
  readonly kind: ConfigBackup["kind"]
  readonly scope: Scope
}

const CONFIG_NAMES = ["opencode.json", "opencode.jsonc"] as const

/** The exact backups that may be listed, compared, or restored for a scope. */
async function knownBackups(scope: Scope, project?: string): Promise<KnownBackup[]> {
  const paths = await resolveScope(scope, project)
  const known: KnownBackup[] = CONFIG_NAMES.map((name) => ({
    backupPath: path.join(paths.configDir, `${name}.bak`),
    targetPath: path.join(paths.configDir, name),
    kind: "config",
    scope,
  }))
  const registry = registryFilePath()
  known.push({
    backupPath: `${registry}.bak`,
    targetPath: registry,
    kind: "registry",
    scope: "global",
  })
  return known
}

function samePath(left: string, right: string) {
  const normalize = (value: string) => {
    const resolved = path.resolve(value)
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }
  return normalize(left) === normalize(right)
}

async function findKnownBackup(scope: Scope, project: string | undefined, backupPath: string) {
  if (!backupPath.trim()) throw new Error("Backup path must not be empty")
  const known = await knownBackups(scope, project)
  const found = known.find((entry) => samePath(entry.backupPath, backupPath))
  if (!found) throw new Error(`Not a known config backup: ${backupPath}`)
  return found
}

/** Lists the selected scope's config backups plus the marketplace registry backup, newest first. */
export async function listConfigBackups(scope: Scope, project?: string): Promise<ConfigBackup[]> {
  const known = await knownBackups(scope, project)
  const rows: ConfigBackup[] = []
  await Promise.all(
    known.map(async (entry) => {
      const info = await stat(entry.backupPath).catch(() => undefined)
      if (!info?.isFile()) return
      rows.push({
        path: entry.backupPath,
        target: entry.targetPath,
        modifiedAt: info.mtime.toISOString(),
        size: info.size,
        kind: entry.kind,
        scope: entry.scope,
      })
    }),
  )
  return rows.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
}

/**
 * Compares the live file with a selected backup. Never writes. `scope` may be omitted when the
 * caller only has the path from `configBackups`; both scopes are searched in that case.
 */
export async function configBackupDiff(
  scope: Scope | undefined,
  project: string | undefined,
  backupPath: string,
): Promise<ConfigBackupDiff> {
  let entry: KnownBackup
  if (scope) {
    entry = await findKnownBackup(scope, project, backupPath)
  } else {
    const found: KnownBackup[] = []
    for (const candidate of ["global", "project"] as const) {
      try {
        found.push(await findKnownBackup(candidate, project, backupPath))
      } catch {
        // Keep looking in the other scope.
      }
    }
    if (found.length === 0) throw new Error(`Not a known config backup: ${backupPath}`)
    entry = found[0]
  }
  const after = await readFile(entry.backupPath, "utf8")
  const before = (await isFile(entry.targetPath)) ? await readFile(entry.targetPath, "utf8") : ""
  return {
    before,
    after,
    path: entry.targetPath,
    backupPath: entry.backupPath,
  }
}

function validateRestorable(text: string, file: string) {
  if (!text.trim()) throw new Error(`Cannot restore ${file}: the backup is empty`)
  const errors: ParseError[] = []
  const parsed = parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    const detail = errors.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`).join("; ")
    throw new Error(`Cannot restore ${file}: invalid JSONC (${detail})`)
  }
  if (!isRecord(parsed)) throw new Error(`Cannot restore ${file}: the document root must be a JSON object`)
}

/**
 * Restores a known backup after validating it as JSONC. The live file is kept as `<file>.bak`
 * through the same atomic writer every other config change uses.
 */
export async function restoreConfigBackup(scope: Scope, project: string | undefined, backupPath: string) {
  const entry = await findKnownBackup(scope, project, backupPath)
  const text = await readFile(entry.backupPath, "utf8")
  validateRestorable(text, entry.backupPath)
  const exists = await isFile(entry.targetPath)
  await writeAtomic(entry.targetPath, text, exists)
  return entry.targetPath
}
