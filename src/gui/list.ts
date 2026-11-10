/**
 * Pure sorting and selection helpers shared by the extension lists. Keeping them free of Solid
 * and OpenCode imports makes them straightforward to unit-test.
 */

export const sortKeys = ["name", "scope", "status"] as const
export type SortKey = (typeof sortKeys)[number]

export function isSortKey(value: string | null | undefined): value is SortKey {
  return value === "name" || value === "scope" || value === "status"
}

export function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })
}

export interface SortGetters<T> {
  readonly name: (item: T) => string
  /** Scope label or numeric rank; "global" sorts before "project" with text comparison. */
  readonly scope?: (item: T) => string
  /** Numeric rank where 0 sorts first. */
  readonly status?: (item: T) => number
}

/** Stable ascending sort with a name tie-breaker so equal ranks stay predictable. */
export function sortItems<T>(items: readonly T[], key: SortKey, getters: SortGetters<T>): T[] {
  const result = [...items]
  result.sort((left, right) => {
    let compared = 0
    if (key === "scope" && getters.scope) {
      compared = compareText(getters.scope(left), getters.scope(right))
    } else if (key === "status" && getters.status) {
      compared = getters.status(left) - getters.status(right)
    }
    if (compared === 0) compared = compareText(getters.name(left), getters.name(right))
    return compared
  })
  return result
}

export interface ReadStorage {
  getItem(key: string): string | null
}

export interface WriteStorage {
  setItem(key: string, value: string): void
}

/** Reads a persisted sort key, falling back when storage is unavailable or holds an unknown value. */
export function readSortPreference(
  storage: ReadStorage | undefined,
  key: string,
  allowed: readonly SortKey[],
  fallback: SortKey,
): SortKey {
  try {
    const value = storage?.getItem(key)
    return isSortKey(value) && allowed.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}

export function writeSortPreference(storage: WriteStorage | undefined, key: string, value: SortKey) {
  try {
    storage?.setItem(key, value)
  } catch {
    // A full or blocked localStorage must never break the settings page.
  }
}

export type Selection = ReadonlySet<string>

export function toggleSelected(selection: Selection, key: string, checked: boolean): Set<string> {
  const next = new Set(selection)
  if (checked) next.add(key)
  else next.delete(key)
  return next
}

/** Adds or removes every visible key while preserving keys from other lists. */
export function selectAllSelected(selection: Selection, keys: readonly string[], checked: boolean): Set<string> {
  const next = new Set(selection)
  for (const key of keys) {
    if (checked) next.add(key)
    else next.delete(key)
  }
  return next
}

/** Drops keys that are no longer present after a refresh or a bulk delete. */
export function pruneSelected(selection: Selection, available: ReadonlySet<string>): Selection {
  let changed = false
  const next = new Set<string>()
  for (const key of selection) {
    if (available.has(key)) next.add(key)
    else changed = true
  }
  return changed ? next : selection
}

export function allSelected(selection: Selection, keys: readonly string[]) {
  return keys.length > 0 && keys.every((key) => selection.has(key))
}

export function selectedCount(selection: Selection, keys: readonly string[]) {
  return keys.reduce((count, key) => count + (selection.has(key) ? 1 : 0), 0)
}

export function selectedKeys(selection: Selection, keys: readonly string[]) {
  return keys.filter((key) => selection.has(key))
}

/**
 * Plugin entries are addressed by their array index, so deleting several has to walk from the
 * end of the list to keep the remaining indices valid.
 */
export function descendingByIndex<T extends { readonly index: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => right.index - left.index)
}
