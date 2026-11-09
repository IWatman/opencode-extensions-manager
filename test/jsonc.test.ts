import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  listMcp,
  listPlugins,
  readScope,
  removeMcp,
  removePlugin,
  removePluginPackage,
  saveMcp,
  savePlugin,
  updateScope,
} from "../src/config.ts"
import { tempScope } from "./support/temp-scope.ts"

const MCP_CONFIG = `{
  // top-level comment
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      // keep this server comment
      "existing": {
        "type": "local",
        // keep the command comment
        "command": ["echo", "hi"],
        "customField": 1
      }
    }
  }
}
`

test("saveMcp appends an entry, keeps comments, and writes a .bak", async (t) => {
  const scope = await tempScope(t, MCP_CONFIG)

  await saveMcp(scope.paths, {
    name: "remote-one",
    config: { type: "remote", url: "https://example.com/mcp", headers: { A: "b" }, oauth: false },
  })

  const text = await readFile(scope.configPath, "utf8")
  assert.match(text, /\/\/ top-level comment/)
  assert.match(text, /\/\/ keep this server comment/)
  assert.match(text, /remote-one/)

  const document = await readScope(scope.paths)
  assert.deepEqual(document.errors, [])
  assert.deepEqual(
    listMcp(document.data).map((entry) => entry.name),
    ["existing", "remote-one"],
  )
  assert.equal(await readFile(`${scope.configPath}.bak`, "utf8"), MCP_CONFIG)
})

test("saveMcp merges an existing server and keeps hand-written fields", async (t) => {
  const scope = await tempScope(t, MCP_CONFIG)

  await saveMcp(scope.paths, {
    name: "existing",
    originalName: "existing",
    config: {
      type: "local",
      command: ["echo", "hello"],
      disabled: true,
      cwd: "C:\\work",
      environment: { A: "1" },
    },
  })

  const document = await readScope(scope.paths)
  const existing = listMcp(document.data).find((entry) => entry.name === "existing")
  assert.deepEqual(existing?.config, {
    type: "local",
    command: ["echo", "hello"],
    customField: 1,
    disabled: true,
    cwd: "C:\\work",
    environment: { A: "1" },
  })

  const text = await readFile(scope.configPath, "utf8")
  assert.match(text, /\/\/ top-level comment/)
  assert.match(text, /\/\/ keep this server comment/)
})

test("clearing optional MCP fields removes them from the document", async (t) => {
  const scope = await tempScope(
    t,
    `{
  "mcp": {
    "servers": {
      "existing": {
        "type": "local",
        "command": ["echo"],
        "cwd": "C:\\\\work",
        "environment": { "A": "1" }
      }
    }
  }
}
`,
  )

  await saveMcp(scope.paths, {
    name: "existing",
    originalName: "existing",
    config: { type: "local", command: ["echo"], cwd: null, environment: null },
  })

  const document = await readScope(scope.paths)
  assert.deepEqual(listMcp(document.data)[0]?.config, { type: "local", command: ["echo"] })
})

test("renaming and removing an MCP server keeps unrelated comments", async (t) => {
  const scope = await tempScope(t, MCP_CONFIG)

  await saveMcp(scope.paths, {
    name: "renamed",
    originalName: "existing",
    config: { type: "local", command: ["echo", "renamed"] },
  })

  let document = await readScope(scope.paths)
  assert.deepEqual(
    listMcp(document.data).map((entry) => entry.name),
    ["renamed"],
  )
  const renamed = listMcp(document.data)[0]?.config as Record<string, unknown>
  assert.equal(renamed.customField, 1)

  const afterRename = await readFile(scope.configPath, "utf8")
  assert.match(afterRename, /\/\/ top-level comment/)

  await removeMcp(scope.paths, "renamed")
  document = await readScope(scope.paths)
  assert.deepEqual(listMcp(document.data), [])
  const afterRemove = await readFile(scope.configPath, "utf8")
  assert.match(afterRemove, /\/\/ top-level comment/)
  assert.doesNotMatch(afterRemove, /renamed/)
})

test("plugin append, update, and removal preserve array comments", async (t) => {
  const scope = await tempScope(
    t,
    `{
  // plugin list comment
  "plugins": [
    // first plugin comment
    "opencode-one",
    // second plugin comment
    { "package": "opencode-two", "options": { "keep": true } }
  ]
}
`,
  )

  await savePlugin(scope.paths, { package: "opencode-three", options: { added: true } })
  let document = await readScope(scope.paths)
  assert.deepEqual(
    listPlugins(document.data).map((entry) => entry.package),
    ["opencode-one", "opencode-two", "opencode-three"],
  )
  let text = await readFile(scope.configPath, "utf8")
  assert.match(text, /\/\/ plugin list comment/)
  assert.match(text, /\/\/ first plugin comment/)
  assert.match(text, /\/\/ second plugin comment/)

  await savePlugin(scope.paths, { index: 1, package: "opencode-two", options: { keep: false } })
  document = await readScope(scope.paths)
  assert.deepEqual(listPlugins(document.data)[1]?.options, { keep: false })

  // jsonc-parser replaces the whole array element, so the comment immediately above the edited
  // entry is dropped; comments elsewhere in the document must survive.
  text = await readFile(scope.configPath, "utf8")
  assert.match(text, /\/\/ plugin list comment/)
  assert.match(text, /\/\/ first plugin comment/)

  await removePlugin(scope.paths, 0)
  document = await readScope(scope.paths)
  assert.deepEqual(
    listPlugins(document.data).map((entry) => entry.package),
    ["opencode-two", "opencode-three"],
  )
  text = await readFile(scope.configPath, "utf8")
  assert.match(text, /\/\/ plugin list comment/)
  assert.doesNotMatch(text, /opencode-one/)
})

test("removePluginPackage removes every matching entry and leaves comments alone", async (t) => {
  const scope = await tempScope(
    t,
    `{
  // keep this comment
  "plugins": [
    "opencode-keep",
    { "package": "opencode-duplicate", "options": { "n": 1 } },
    "opencode-duplicate"
  ]
}
`,
  )

  await removePluginPackage(scope.paths, "opencode-duplicate")

  const document = await readScope(scope.paths)
  assert.deepEqual(
    listPlugins(document.data).map((entry) => entry.package),
    ["opencode-keep"],
  )
  assert.match(await readFile(scope.configPath, "utf8"), /\/\/ keep this comment/)
})

test("invalid plugin indices are rejected without touching the file", async (t) => {
  const scope = await tempScope(
    t,
    `{
  // keep this fixture
  "plugins": ["opencode-one"]
}
`,
  )
  const before = await readFile(scope.configPath, "utf8")

  await assert.rejects(() => removePlugin(scope.paths, 5), /no longer exists/)
  await assert.rejects(
    () => savePlugin(scope.paths, { index: 5, package: "opencode-two" }),
    /no longer exists/,
  )
  assert.equal(await readFile(scope.configPath, "utf8"), before)
})

test("updateScope preserves CRLF line endings", async (t) => {
  const original = `{\r\n  // crlf comment\r\n  "plugins": []\r\n}\r\n`
  const scope = await tempScope(t, original)

  await savePlugin(scope.paths, { package: "opencode-crlf" })

  const text = await readFile(scope.configPath, "utf8")
  assert.match(text, /\/\/ crlf comment/)
  assert.ok(text.includes("\r\n"), "expected CRLF line endings")
  assert.equal(text.replaceAll("\r\n", "").includes("\n"), false, "found a lone LF in a CRLF document")
})

test("invalid JSONC is rejected and never overwritten", async (t) => {
  const broken = `{ "mcp": { "servers": {`
  const scope = await tempScope(t, broken)

  await assert.rejects(
    () => saveMcp(scope.paths, { name: "new", config: { type: "local", command: ["echo"] } }),
    /Cannot edit/,
  )
  assert.equal(await readFile(scope.configPath, "utf8"), broken)
})

test("a failed update leaves the previous file and backup intact", async (t) => {
  const scope = await tempScope(t, MCP_CONFIG)
  await saveMcp(scope.paths, {
    name: "remote",
    config: { type: "remote", url: "https://example.com/mcp" },
  })
  const before = await readFile(scope.configPath, "utf8")
  const backup = await readFile(`${scope.configPath}.bak`, "utf8")

  await assert.rejects(
    () => saveMcp(scope.paths, { name: "existing", config: { type: "local", command: ["echo"] } }),
    /already exists/,
  )
  assert.equal(await readFile(scope.configPath, "utf8"), before)
  assert.equal(await readFile(`${scope.configPath}.bak`, "utf8"), backup)
})

test("savePlugin creates a plugins array when the document has none", async (t) => {
  const scope = await tempScope(t, `{\n  // empty config\n}\n`)

  await savePlugin(scope.paths, { package: "opencode-new" })

  const document = await readScope(scope.paths)
  assert.deepEqual(
    listPlugins(document.data).map((entry) => entry.package),
    ["opencode-new"],
  )
  assert.match(await readFile(scope.configPath, "utf8"), /\/\/ empty config/)
})

test("updateScope does not write when there is nothing to change", async (t) => {
  const scope = await tempScope(t, MCP_CONFIG)
  await updateScope(scope.paths, () => [])

  assert.equal(await readFile(scope.configPath, "utf8"), MCP_CONFIG)
  await assert.rejects(() => readFile(`${scope.configPath}.bak`, "utf8"))
})

test("savePlugin creates the config file on the first write without a backup", async (t) => {
  const scope = await tempScope(t)
  assert.equal(scope.paths.configExists, false)

  await savePlugin(scope.paths, { package: "opencode-first" })

  assert.deepEqual(
    listPlugins((await readScope(scope.paths)).data).map((entry) => entry.package),
    ["opencode-first"],
  )
  await assert.rejects(() => readFile(`${scope.configPath}.bak`, "utf8"))
})
