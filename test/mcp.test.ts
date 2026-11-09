import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { listMcp, readScope, saveMcp, setMcpEnabled, validateMcpConfig } from "../src/config.ts"
import { tempScope } from "./support/temp-scope.ts"

const REMOTE = { type: "remote", url: "https://example.com/mcp" } as const

test("validateMcpConfig accepts OAuth callback ports from 1 through 65535", () => {
  for (const port of [1, 1455, 65535]) {
    assert.doesNotThrow(
      () => validateMcpConfig({ ...REMOTE, oauth: { callback_port: port } }),
      `expected ${port} to be a valid callback port`,
    )
  }
})

test("validateMcpConfig rejects out-of-range and non-integer OAuth callback ports", () => {
  const invalid = [0, -1, 65536, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1455", null, true]
  for (const port of invalid) {
    assert.throws(
      () => validateMcpConfig({ ...REMOTE, oauth: { callback_port: port } }),
      /callback_port must be an integer between 1 and 65535/,
      `expected ${String(port)} to be rejected`,
    )
  }
})

test("validateMcpConfig checks the OAuth block and remote fields", () => {
  assert.doesNotThrow(() => validateMcpConfig({ ...REMOTE, oauth: false }))
  assert.doesNotThrow(() => validateMcpConfig({ ...REMOTE, oauth: {} }))
  assert.throws(() => validateMcpConfig({ ...REMOTE, oauth: "yes" }), /oauth must be an object or false/)
  assert.throws(() => validateMcpConfig({ ...REMOTE, oauth: { client_id: 1 } }), /oauth\.client_id must be a string/)
  assert.throws(() => validateMcpConfig({ ...REMOTE, oauth: { scope: [] } }), /oauth\.scope must be a string/)
  assert.throws(() => validateMcpConfig({ type: "remote" }), /needs a URL/)
  assert.throws(() => validateMcpConfig({ type: "remote", url: "  " }), /needs a URL/)
  assert.throws(() => validateMcpConfig({ ...REMOTE, headers: { A: 1 } }), /headers\.A must be a string/)
})

test("validateMcpConfig checks local commands and the disabled flag", () => {
  assert.doesNotThrow(() => validateMcpConfig({ type: "local", command: ["node", "server.js"] }))
  assert.throws(() => validateMcpConfig({ type: "local" }), /needs a command/)
  assert.throws(() => validateMcpConfig({ type: "local", command: [] }), /needs a command/)
  assert.throws(() => validateMcpConfig({ type: "local", command: ["node", ""] }), /non-empty string/)
  assert.throws(() => validateMcpConfig({ type: "local", command: ["node"], disabled: "true" }), /disabled must be a boolean/)
  assert.doesNotThrow(() => validateMcpConfig({ type: "local", command: ["node"], disabled: true }))
})

test("setMcpEnabled toggles the disabled field without replacing the server object", async (t) => {
  const scope = await tempScope(
    t,
    `{
  "mcp": {
    "servers": {
      "one": {
        "type": "local",
        // keep the command comment
        "command": ["echo", "one"],
        "custom": true
      }
    }
  }
}
`,
  )

  await setMcpEnabled(scope.paths, "one", false)
  let document = await readScope(scope.paths)
  let config = listMcp(document.data)[0]?.config as Record<string, unknown>
  assert.equal(config.disabled, true)
  assert.deepEqual(config.command, ["echo", "one"])
  assert.equal(config.custom, true)
  let text = await readFile(scope.configPath, "utf8")
  assert.match(text, /"disabled": true/)
  assert.match(text, /\/\/ keep the command comment/)

  await setMcpEnabled(scope.paths, "one", true)
  document = await readScope(scope.paths)
  config = listMcp(document.data)[0]?.config as Record<string, unknown>
  assert.equal(Object.hasOwn(config, "disabled"), false)
  assert.deepEqual(config.command, ["echo", "one"])
  assert.equal(config.custom, true)
  text = await readFile(scope.configPath, "utf8")
  assert.doesNotMatch(text, /"disabled"/)
  assert.match(text, /\/\/ keep the command comment/)
})

test("an invalid callback port is rejected before the config file is touched", async (t) => {
  const original = `{
  // keep me
  "mcp": { "servers": {} }
}
`
  const scope = await tempScope(t, original)

  await assert.rejects(
    () =>
      saveMcp(scope.paths, {
        name: "remote",
        config: { ...REMOTE, oauth: { callback_port: 70000 } },
      }),
    /callback_port/,
  )
  assert.equal(await readFile(scope.configPath, "utf8"), original)
})

test("saveMcp accepts and persists the boundary callback ports", async (t) => {
  const scope = await tempScope(t, `{\n  "mcp": { "servers": {} }\n}\n`)

  await saveMcp(scope.paths, { name: "low", config: { ...REMOTE, oauth: { callback_port: 1 } } })
  await saveMcp(scope.paths, { name: "high", config: { ...REMOTE, oauth: { callback_port: 65535 } } })

  const document = await readScope(scope.paths)
  const ports = Object.fromEntries(
    listMcp(document.data).map((entry) => [
      entry.name,
      (entry.config as { oauth?: { callback_port?: number } }).oauth?.callback_port,
    ]),
  )
  assert.deepEqual(ports, { low: 1, high: 65535 })
})
