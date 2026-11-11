import test from "node:test"
import assert from "node:assert/strict"
import {
  formatCommand,
  formatPairs,
  hasSecretHeaders,
  isBuiltinMarketplaceUrl,
  isSecretKey,
  maskedMcpPairs,
  mcpDisabled,
  mcpHasPairs,
  parsePairs,
  quoteArgument,
  sanitizeMcpConfig,
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
    "line one\nline two",
    "tab\there",
    "carriage\rreturn",
    "C:\\Program Files\\node.exe",
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

test("isSecretKey recognizes credential-like environment and header names", () => {
  for (const key of ["Authorization", "X-Api-Key", "api_key", "ACCESS_TOKEN", "client_secret", "password", "Cookie"]) {
    assert.equal(isSecretKey(key), true, key)
  }
  for (const key of ["Accept", "Content-Type", "X-Test", "PORT", "DEBUG"]) {
    assert.equal(isSecretKey(key), false, key)
  }
})

test("mcp row values stay masked until revealed", () => {
  const config = {
    type: "remote",
    url: "https://example.com/mcp",
    environment: { PORT: "8080", ACCESS_TOKEN: "abc" },
    headers: { Authorization: "Bearer abc", "X-Test": "yes" },
  }
  assert.equal(mcpHasPairs(config), true)
  assert.equal(mcpHasPairs({ type: "remote", url: "https://example.com/mcp" }), false)
  assert.equal(
    maskedMcpPairs(config),
    ["environment.PORT=***", "environment.ACCESS_TOKEN=***", "headers.Authorization=***", "headers.X-Test=***"].join(
      "\n",
    ),
  )
  assert.equal(
    maskedMcpPairs(config, true),
    ["environment.PORT=8080", "environment.ACCESS_TOKEN=abc", "headers.Authorization=Bearer abc", "headers.X-Test=yes"].join(
      "\n",
    ),
  )
})

test("sanitizeMcpConfig replaces environment, header, and OAuth secrets without touching the input", () => {
  const config = {
    type: "remote",
    url: "https://example.com/mcp",
    environment: { PORT: "8080", ACCESS_TOKEN: "abc" },
    headers: { Authorization: "Bearer abc", "X-Test": "yes" },
    oauth: { client_id: "public", client_secret: "hidden" },
    disabled: true,
  }
  const sanitized = sanitizeMcpConfig(config) as Record<string, unknown>
  assert.deepEqual(sanitized.environment, { PORT: "***", ACCESS_TOKEN: "***" })
  assert.deepEqual(sanitized.headers, { Authorization: "***", "X-Test": "***" })
  assert.deepEqual(sanitized.oauth, { client_id: "public", client_secret: "***" })
  assert.equal(sanitized.url, "https://example.com/mcp")
  assert.equal(sanitized.disabled, true)
  // The installed config must not be modified by copying it.
  assert.deepEqual(config.environment, { PORT: "8080", ACCESS_TOKEN: "abc" })
  assert.equal(config.headers.Authorization, "Bearer abc")
  assert.equal(config.oauth.client_secret, "hidden")
  assert.equal(sanitizeMcpConfig(null), null)
})

test("hasSecretHeaders only reports credential-like header names", () => {
  assert.equal(hasSecretHeaders({ headers: { Authorization: "Bearer x" } }), true)
  assert.equal(hasSecretHeaders({ headers: { "X-Api-Key": "x" } }), true)
  assert.equal(hasSecretHeaders({ headers: { Accept: "application/json" } }), false)
  assert.equal(hasSecretHeaders({ environment: { TOKEN: "x" } }), false)
  assert.equal(hasSecretHeaders(null), false)
})

test("isBuiltinMarketplaceUrl accepts only the official Anthropic marketplace", () => {
  for (const url of [
    "https://github.com/anthropics/claude-plugins-official",
    "https://github.com/anthropics/claude-plugins-official/",
    "http://github.com/anthropics/claude-plugins-official.git",
    "anthropics/claude-plugins-official",
    "github:anthropics/claude-plugins-official",
    "https://github.com/anthropics/claude-plugins-official/tree/main",
  ]) {
    assert.equal(isBuiltinMarketplaceUrl(url), true, url)
  }
  for (const url of [
    "https://github.com/someone/other-marketplace",
    "someone/other-marketplace",
    "https://github.com/anthropics/claude-plugins-official-fork",
  ]) {
    assert.equal(isBuiltinMarketplaceUrl(url), false, url)
  }
})
