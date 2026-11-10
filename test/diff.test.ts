import test from "node:test"
import assert from "node:assert/strict"
import { diffLines, sameLines } from "../src/gui/diff.ts"

test("diffLines reports common, removed, and added lines with line numbers", () => {
  const lines = diffLines("{\n  \"a\": 1,\n  \"b\": 2\n}\n", "{\n  \"a\": 1,\n  \"b\": 3,\n  \"c\": 4\n}\n")

  assert.deepEqual(
    lines.map((line) => `${line.kind}:${line.text}`),
    [
      "context:{",
      "context:  \"a\": 1,",
      "remove:  \"b\": 2",
      "add:  \"b\": 3,",
      "add:  \"c\": 4",
      "context:}",
    ],
  )
  assert.deepEqual(
    lines.map((line) => [line.oldLine, line.newLine]),
    [
      [1, 1],
      [2, 2],
      [3, undefined],
      [undefined, 3],
      [undefined, 4],
      [4, 5],
    ],
  )
})

test("diffLines treats CRLF and LF as the same lines", () => {
  assert.equal(sameLines("a\r\nb\r\nc\r\n", "a\nb\nc\n"), true)
  assert.deepEqual(diffLines("a\r\nb", "a\nc"), [
    { kind: "context", text: "a", oldLine: 1, newLine: 1 },
    { kind: "remove", text: "b", oldLine: 2 },
    { kind: "add", text: "c", newLine: 2 },
  ])
})

test("diffLines handles empty and unrelated documents", () => {
  assert.deepEqual(diffLines("", ""), [])
  assert.deepEqual(
    diffLines("", "one\ntwo\n"),
    [
      { kind: "add", text: "one", newLine: 1 },
      { kind: "add", text: "two", newLine: 2 },
    ],
  )
  assert.deepEqual(
    diffLines("one\ntwo\n", ""),
    [
      { kind: "remove", text: "one", oldLine: 1 },
      { kind: "remove", text: "two", oldLine: 2 },
    ],
  )
  assert.equal(sameLines("one\ntwo", "one\ntwo\n"), true)
})

test("diffLines keeps a shared middle and reports only the changed line", () => {
  const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n")
  const after = before.replace("line 10", "line ten")
  const lines = diffLines(before, after)

  assert.equal(lines.filter((line) => line.kind === "context").length, 19)
  assert.deepEqual(
    lines.filter((line) => line.kind !== "context"),
    [
      { kind: "remove", text: "line 10", oldLine: 10 },
      { kind: "add", text: "line ten", newLine: 10 },
    ],
  )
})
