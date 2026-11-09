import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  listMcp,
  listPlugins,
  listSkills,
  readScope,
  removeMcp,
  removePlugin,
  removeSkill,
  resolveScope,
  saveMcp,
  savePlugin,
  saveSkill,
  setMcpEnabled,
  setSkillEnabled,
} from "../src/config.ts"

const root = await mkdtemp(path.join(tmpdir(), "oem-smoke-"))
const configDir = path.join(root, ".opencode")
await mkdir(configDir, { recursive: true })

const original = `{
  // keep this comment
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "existing": {
        "type": "local",
        "command": ["echo", "hi"],
        "customField": 1
      }
    }
  }
}
`
await writeFile(path.join(configDir, "opencode.jsonc"), original)

const paths = await resolveScope("project", root)
assert.equal(paths.configPath, path.join(configDir, "opencode.jsonc"))

let document = await readScope(paths)
assert.deepEqual(document.errors, [])
assert.equal(listMcp(document.data).length, 1)

await saveMcp(paths, {
  name: "remote-one",
  config: { type: "remote", url: "https://example.com/mcp", headers: { A: "b" }, oauth: false },
})
let text = await readFile(paths.configPath, "utf8")
assert.match(text, /keep this comment/)
assert.match(text, /remote-one/)
assert.ok(await readFile(`${paths.configPath}.bak`, "utf8").then((value) => value === original))

await saveMcp(paths, {
  name: "existing",
  originalName: "existing",
  config: { type: "local", command: ["echo", "hello"], disabled: true, cwd: "C:\\work", environment: { A: "1" } },
})
document = await readScope(paths)
const existing = listMcp(document.data).find((entry) => entry.name === "existing")
assert.deepEqual(existing?.config, {
  type: "local",
  command: ["echo", "hello"],
  customField: 1,
  disabled: true,
  cwd: "C:\\work",
  environment: { A: "1" },
})

await setMcpEnabled(paths, "existing", true)
document = await readScope(paths)
assert.equal(
  (listMcp(document.data).find((entry) => entry.name === "existing")?.config as Record<string, unknown>).disabled,
  undefined,
)

await saveMcp(paths, {
  name: "existing",
  originalName: "existing",
  config: { type: "local", command: ["echo", "hello"], disabled: true, cwd: null, environment: null },
})
document = await readScope(paths)
assert.deepEqual(listMcp(document.data).find((entry) => entry.name === "existing")?.config, {
  type: "local",
  command: ["echo", "hello"],
  customField: 1,
  disabled: true,
})

await assert.rejects(() =>
  saveMcp(paths, { name: "existing", config: { type: "local", command: ["echo", "again"] } }),
)

await saveMcp(paths, {
  name: "remote-one",
  originalName: "remote-one",
  config: {
    type: "remote",
    url: "https://example.com/mcp",
    oauth: {
      client_id: "client-id",
      client_secret: "client-secret",
      scope: "tools:read tools:execute",
      callback_port: 1455,
      redirect_uri: "http://127.0.0.1:1455/callback",
      auth_server_metadata_url: "https://example.com/.well-known/oauth-authorization-server",
    },
  },
})
document = await readScope(paths)
assert.deepEqual(
  (listMcp(document.data).find((entry) => entry.name === "remote-one")?.config as Record<string, unknown>).oauth,
  {
    client_id: "client-id",
    client_secret: "client-secret",
    scope: "tools:read tools:execute",
    callback_port: 1455,
    redirect_uri: "http://127.0.0.1:1455/callback",
    auth_server_metadata_url: "https://example.com/.well-known/oauth-authorization-server",
  },
)

await assert.rejects(() =>
  saveMcp(paths, {
    name: "remote-one",
    originalName: "remote-one",
    config: { type: "remote", url: "https://example.com/mcp", oauth: { callback_port: -1 } },
  }),
)

await saveMcp(paths, {
  name: "remote-one",
  originalName: "remote-one",
  config: { type: "remote", url: "https://example.com/mcp", oauth: null },
})
document = await readScope(paths)
assert.equal(
  (listMcp(document.data).find((entry) => entry.name === "remote-one")?.config as Record<string, unknown>).oauth,
  undefined,
)

await savePlugin(paths, { package: "opencode-test", options: { a: 1 } })
await savePlugin(paths, { package: "-opencode-hidden" })
document = await readScope(paths)
assert.deepEqual(
  listPlugins(document.data).map((entry) => [entry.package, entry.removal]),
  [
    ["opencode-test", false],
    ["opencode-hidden", true],
  ],
)
await removePlugin(paths, 1)

const skillContent = `---
name: sample
description: A sample skill
---

Do the thing.
`
await saveSkill(paths, { id: "sample", content: skillContent })
let skills = await listSkills(paths.skillsDir)
assert.equal(skills.length, 1)
assert.equal(skills[0].name, "sample")

await setSkillEnabled(paths, "sample", false)
skills = await listSkills(paths.skillsDir)
assert.equal(skills[0].disabled, true)
assert.ok((await readdir(path.join(paths.skillsDir, ".disabled"))).includes("sample"))

await saveSkill(paths, { id: "renamed", originalId: "sample", content: skillContent })
skills = await listSkills(paths.skillsDir)
assert.deepEqual(
  skills.map((skill) => [skill.id, skill.disabled]),
  [["renamed", true]],
)

await setSkillEnabled(paths, "renamed", true)
skills = await listSkills(paths.skillsDir)
assert.equal(skills[0].disabled, false)

await removeSkill(paths, "renamed")
assert.deepEqual(await listSkills(paths.skillsDir), [])

await removeMcp(paths, "remote-one")
document = await readScope(paths)
assert.equal(listMcp(document.data).length, 1)

console.log("smoke ok:", root)
