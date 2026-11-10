/**
 * A tiny line diff for previews. It uses a longest-common-subsequence table over the changed
 * middle of the two texts, so unchanged prefixes and suffixes cost no memory. No dependencies.
 */

export type DiffKind = "context" | "add" | "remove"

export interface DiffLine {
  readonly kind: DiffKind
  readonly text: string
  /** 1-based line number in the "before" text; absent for added lines. */
  readonly oldLine?: number
  /** 1-based line number in the "after" text; absent for removed lines. */
  readonly newLine?: number
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n")
  if (normalized === "") return []
  const lines = normalized.split("\n")
  // A trailing newline is a terminator, not an extra empty line the reader needs to see.
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

interface RawLine {
  readonly kind: Exclude<DiffKind, "context"> | "context"
  readonly text: string
}

function changedMiddle(before: readonly string[], after: readonly string[]): RawLine[] {
  if (before.length === 0 || after.length === 0) {
    return [
      ...before.map((text) => ({ kind: "remove" as const, text })),
      ...after.map((text) => ({ kind: "add" as const, text })),
    ]
  }

  // Refuse to allocate an enormous table for two unrelated files; a plain replacement is still
  // a correct, readable diff.
  if (before.length * after.length > 4_000_000) {
    return [
      ...before.map((text) => ({ kind: "remove" as const, text })),
      ...after.map((text) => ({ kind: "add" as const, text })),
    ]
  }

  const table: Uint32Array[] = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1))
  for (let left = before.length - 1; left >= 0; left--) {
    for (let right = after.length - 1; right >= 0; right--) {
      table[left][right] =
        before[left] === after[right]
          ? table[left + 1][right + 1] + 1
          : Math.max(table[left + 1][right], table[left][right + 1])
    }
  }

  const result: RawLine[] = []
  let left = 0
  let right = 0
  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) {
      result.push({ kind: "context", text: before[left] })
      left++
    } else if (table[left + 1][right] >= table[left][right + 1]) {
      result.push({ kind: "remove", text: before[left] })
      left++
    } else {
      result.push({ kind: "add", text: after[right] })
      right++
    }
  }
  while (left < before.length) result.push({ kind: "remove", text: before[left++] })
  while (right < after.length) result.push({ kind: "add", text: after[right++] })
  return result
}

/**
 * Returns every line of a unified diff, without hunk headers or context collapsing. Line numbers
 * refer to the original texts, so the GUI can render a readable gutter.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)

  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++
  }

  const middle = changedMiddle(
    oldLines.slice(prefix, oldLines.length - suffix),
    newLines.slice(prefix, newLines.length - suffix),
  )
  const raw: RawLine[] = [
    ...oldLines.slice(0, prefix).map((text) => ({ kind: "context" as const, text })),
    ...middle,
    ...oldLines.slice(oldLines.length - suffix).map((text) => ({ kind: "context" as const, text })),
  ]

  const result: DiffLine[] = []
  let oldLine = 1
  let newLine = 1
  for (const line of raw) {
    if (line.kind === "context") {
      result.push({ kind: "context", text: line.text, oldLine, newLine })
      oldLine++
      newLine++
    } else if (line.kind === "remove") {
      result.push({ kind: "remove", text: line.text, oldLine })
      oldLine++
    } else {
      result.push({ kind: "add", text: line.text, newLine })
      newLine++
    }
  }
  return result
}

/** True when both texts contain exactly the same lines (ignoring line-ending style). */
export function sameLines(before: string, after: string): boolean {
  return diffLines(before, after).every((line) => line.kind === "context")
}
