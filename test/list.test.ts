import assert from "node:assert/strict"
import test from "node:test"
import {
  allSelected,
  descendingByIndex,
  pruneSelected,
  readSortPreference,
  selectAllSelected,
  selectedCount,
  selectedKeys,
  sortItems,
  toggleSelected,
  writeSortPreference,
  type ReadStorage,
  type WriteStorage,
} from "../src/gui/list.ts"

interface Row {
  readonly name: string
  readonly scope: string
  readonly status: number
}

const rows: Row[] = [
  { name: "item 10", scope: "project", status: 2 },
  { name: "Item 2", scope: "global", status: 1 },
  { name: "alpha", scope: "project", status: 1 },
  { name: "Beta", scope: "global", status: 0 },
]

test("sortItems sorts names case-insensitively and numerically", () => {
  const sorted = sortItems(rows, "name", { name: (row) => row.name })
  assert.deepEqual(sorted.map((row) => row.name), ["alpha", "Beta", "Item 2", "item 10"])
})

test("sortItems sorts global scope before project and then by name", () => {
  const sorted = sortItems(rows, "scope", { name: (row) => row.name, scope: (row) => row.scope })
  assert.deepEqual(sorted.map((row) => row.scope), ["global", "global", "project", "project"])
  assert.deepEqual(sorted.map((row) => row.name), ["Beta", "Item 2", "alpha", "item 10"])
})

test("sortItems sorts status ranks and falls back to the name", () => {
  const sorted = sortItems(rows, "status", { name: (row) => row.name, status: (row) => row.status })
  assert.deepEqual(sorted.map((row) => row.name), ["Beta", "alpha", "Item 2", "item 10"])
})

test("sortItems falls back to the name when the getter is absent", () => {
  const sorted = sortItems(rows, "status", { name: (row) => row.name })
  assert.deepEqual(sorted.map((row) => row.name), ["alpha", "Beta", "Item 2", "item 10"])
})

test("readSortPreference accepts allowed values and rejects the rest", () => {
  const storage: ReadStorage = {
    getItem: (key) => (key === "sort" ? "status" : null),
  }
  assert.equal(readSortPreference(storage, "sort", ["name", "status"], "name"), "status")
  assert.equal(readSortPreference(storage, "sort", ["name", "scope"], "name"), "name")
  assert.equal(readSortPreference(storage, "missing", ["name"], "name"), "name")
  assert.equal(readSortPreference(undefined, "sort", ["name"], "name"), "name")
})

test("readSortPreference survives a blocked localStorage", () => {
  const storage: ReadStorage = {
    getItem: () => {
      throw new Error("blocked")
    },
  }
  assert.equal(readSortPreference(storage, "sort", ["name"], "name"), "name")
})

test("writeSortPreference stores the value and ignores failures", () => {
  let written: [string, string] | undefined
  const storage: WriteStorage = {
    setItem: (key, value) => {
      written = [key, value]
    },
  }
  writeSortPreference(storage, "oem.sort.mcp", "status")
  assert.deepEqual(written, ["oem.sort.mcp", "status"])

  const blocked: WriteStorage = {
    setItem: () => {
      throw new Error("blocked")
    },
  }
  assert.doesNotThrow(() => writeSortPreference(blocked, "oem.sort.mcp", "name"))
})

test("selection helpers toggle, select visible keys and count", () => {
  const keys = ["a", "b", "c"]
  let selection = toggleSelected(new Set<string>(), "b", true)
  assert.deepEqual([...selection], ["b"])
  assert.equal(allSelected(selection, keys), false)
  assert.equal(selectedCount(selection, keys), 1)
  assert.deepEqual(selectedKeys(selection, keys), ["b"])

  selection = selectAllSelected(selection, keys, true)
  assert.deepEqual([...selection].sort(), ["a", "b", "c"])
  assert.equal(allSelected(selection, keys), true)

  selection = selectAllSelected(selection, ["b", "c"], false)
  assert.deepEqual([...selection], ["a"])
  assert.equal(allSelected(selection, keys), false)

  selection = toggleSelected(selection, "a", false)
  assert.equal(selection.size, 0)
})

test("selectAllSelected keeps selections outside the visible list", () => {
  const selection = selectAllSelected(new Set(["hidden"]), ["a", "b"], true)
  assert.deepEqual([...selection].sort(), ["a", "b", "hidden"])
})

test("pruneSelected drops stale keys and keeps identity when nothing changed", () => {
  const available = new Set(["a", "c"])
  const stale = pruneSelected(new Set(["a", "b"]), available)
  assert.deepEqual([...stale], ["a"])

  const current = new Set(["a"])
  assert.equal(pruneSelected(current, available), current)
})

test("descendingByIndex keeps plugin indices valid while deleting", () => {
  const items = [{ index: 0 }, { index: 5 }, { index: 2 }]
  assert.deepEqual(descendingByIndex(items).map((item) => item.index), [5, 2, 0])
  assert.deepEqual(items.map((item) => item.index), [0, 5, 2])
})
