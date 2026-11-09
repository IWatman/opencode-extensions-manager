import test from "node:test"
import assert from "node:assert/strict"
import {
  formatCommand,
  formatPairs,
  mcpDisabled,
  parsePairs,
  quoteArgument,
  splitCommand,
} from "../src/gui/helpers.ts"

test("splitCommand keeps Windows drive paths intact", () => {
  assert.deepEqual(splitCommand(String.raw`npx -y pkg C:\work`), ["npx", "-y", "pkg", String.raw`C:\work`])
  assert.deepEqual(splitCommand(String.raw`C:\tools\server.exe --root D:\data`), [
    String.raw`C:\tools\server.exe`,
    "--root",
    String.raw`D:\data`,
  ])
})

test("splitCommand understands double quotes around Windows paths", () => {
  assert.deepEqual(splitCommand(String.raw`npx -y pkg "C:\Program Files\x"`), [
    "npx",
    "-y",
    "pkg",
    String.raw`C:\Program Files\x`,
  ])
  assert.deepEqual(splitCommand(String.raw`"C:\Program Files\node.exe" --flag`), [
    String.raw`C:\Program Files\node.exe`,
    "--flag",
  ])
})

test("splitCommand treats backslash-escaped spaces as one argument", () => {
  assert.deepEqual(splitCommand(String.raw`npx -y pkg C:\Program\ Files\x`), [
    "npx",
    "-y",
    "pkg",
    String.raw`C:\Program Files\x`,
  ])
})

test("splitCommand keeps backslashes inside single quotes", () => {
  assert.deepEqual(splitCommand(String.raw`tool 'C:\Program Files\x'`), ["tool", String.raw`C:\Program Files\x`])
})

test("splitCommand handles empty, adjacent, and escaped quotes", () => {
  assert.deepEqual(splitCommand(`tool ""`), ["tool", ""])
  assert.deepEqual(splitCommand(`tool "" ""`), ["tool", "", ""])
  assert.deepEqual(splitCommand(`tool pre"fix mid"suffix`), ["tool", "prefix midsuffix"])
  assert.deepEqual(splitCommand(String.raw`tool "a\"b"`), ["tool", 'a"b'])
})

test("splitCommand keeps a trailing backslash and rejects an unterminated quote", () => {
  assert.deepEqual(splitCommand("tool C:\\folder\\"), ["tool", "C:\\folder\\"])
  assert.throws(() => splitCommand(`tool "unfinished`), /Unterminated quote/)
  assert.throws(() => splitCommand(`tool 'unfinished`), /Unterminated quote/)
})

test("quoteArgument and formatCommand round-trip paths and whitespace", () => {
  const arguments_ = [
    "npx",
    "-y",
    "",
    "C:\\work",
    "C:\\Program Files\\x",
    "back\\slash",
    'quote"inside',
    "two  spaces",
  ]
  assert.deepEqual(splitCommand(formatCommand(arguments_)), arguments_)
  assert.equal(quoteArgument("plain"), "plain")
  assert.equal(quoteArgument("C:\\work"), String.raw`"C:\\work"`)
})

test("parsePairs and formatPairs keep values and report invalid lines", () => {
  const parsed = parsePairs(
    ["# comment", "", "A=1", "TOKEN=a=b", "  PADDED = value  ", "missing", "=empty-key"].join("\n"),
  )
  assert.deepEqual(parsed.values, { A: "1", TOKEN: "a=b", PADDED: "value" })
  assert.deepEqual(parsed.invalid, ["missing", "=empty-key"])
  assert.equal(formatPairs({ A: "1", B: 2, C: "three" }), "A=1\nC=three")
  assert.equal(formatPairs(undefined), "")
})

test("mcpDisabled only treats the boolean true as disabled", () => {
  assert.equal(mcpDisabled({ type: "local", command: ["x"], disabled: true }), true)
  assert.equal(mcpDisabled({ type: "local", command: ["x"], disabled: false }), false)
  assert.equal(mcpDisabled({ type: "local", command: ["x"], disabled: "true" }), false)
  assert.equal(mcpDisabled(null), false)
})
