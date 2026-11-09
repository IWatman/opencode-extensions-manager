import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { listMcp, listSkills, readScope, resolveScope, saveMcp } from "../src/config.ts"
import {
  addMarketplace,
  getCatalog,
  inspectMarketplacePlugin,
  installMarketplacePlugin,
  normalizeInstalledMcpUrls,
  readRegistry,
  setMarketplacePluginEnabled,
  uninstallMarketplacePlugin,
  updateMarketplacePlugin,
} from "../src/marketplaces.ts"

const root = await mkdtemp(path.join(tmpdir(), "oem-market-"))
process.env.OPENCODE_CONFIG_DIR = path.join(root, "config")
process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY = path.join(root, "registry.json")

const marketplace = path.join(root, "marketplace")
const plugin = path.join(marketplace, "plugins", "demo")
const project = path.join(root, "project")

await mkdir(path.join(marketplace, ".claude-plugin"), { recursive: true })
await mkdir(path.join(plugin, ".claude-plugin"), { recursive: true })
await mkdir(path.join(plugin, "skills", "hello"), { recursive: true })
await mkdir(path.join(plugin, "skills", "broken"), { recursive: true })
await mkdir(path.join(plugin, "commands"), { recursive: true })
await mkdir(project, { recursive: true })

await writeFile(
  path.join(marketplace, ".claude-plugin", "marketplace.json"),
  JSON.stringify(
    {
      name: "test-marketplace",
      description: "Local test marketplace",
      owner: { name: "Tester" },
      plugins: [
        {
          name: "demo",
          displayName: "Demo plugin",
          description: "A demo plugin with MCP and a skill",
          author: { name: "Tester" },
          version: "1.0.0",
          source: "./plugins/demo",
        },
      ],
    },
    null,
    2,
  ),
)
await writeFile(
  path.join(plugin, ".claude-plugin", "plugin.json"),
  JSON.stringify({ name: "demo", description: "A demo plugin", version: "1.0.0" }),
)
await writeFile(
  path.join(plugin, ".mcp.json"),
  JSON.stringify({
    mcpServers: {
      demo: { type: "http", url: "https://example.com/mcp", headers: { "X-Test": "yes" } },
    },
  }),
)
await writeFile(
  path.join(plugin, "skills", "hello", "SKILL.md"),
  `---
name: Hello
description: Says hello.
---

Say hello.
`,
)
await writeFile(
  path.join(plugin, "skills", "broken", "SKILL.md"),
  `# Broken skill

This skill has no frontmatter and needs adaptation.
`,
)
await writeFile(path.join(plugin, "commands", "hello.md"), "# Hello command\n")
await writeFile(path.join(plugin, "README.md"), "# Demo plugin\n\nThis is documentation, not a skill.\n")

const added = await addMarketplace(marketplace)
assert.ok(added.record)
const id = added.record.id
assert.equal(id, "local-marketplace")

const catalog = await getCatalog(id)
assert.equal(catalog.length, 1)
assert.equal(catalog[0].name, "demo")

const inspection = await inspectMarketplacePlugin(id, "demo")
assert.equal(inspection.mcp.length, 1)
assert.equal(inspection.skills.length, 1)
assert.equal(inspection.adaptable.length, 1)
assert.equal(inspection.adaptable[0].id, "broken")
assert.deepEqual(inspection.unsupported, ["commands"])
assert.deepEqual(inspection.warnings, [])

await installMarketplacePlugin({ marketplace: id, plugin: "demo", scope: "project", project, adapt: true })
let registry = await readRegistry()
assert.equal(registry.registry.installed.length, 1)
assert.deepEqual(registry.registry.installed[0].mcp, ["demo"])
assert.deepEqual([...registry.registry.installed[0].skills].sort(), ["demo__broken", "demo__hello"])

const paths = await resolveScope("project", project)
let document = await readScope(paths)
assert.equal(listMcp(document.data).length, 1)
assert.equal(listMcp(document.data)[0].name, "demo")
let skills = await listSkills(paths.skillsDir)
assert.equal(skills.length, 2)
const broken = skills.find((skill) => skill.id === "demo__broken")
assert.ok(broken)
assert.match(broken.content, /^---/)
assert.match(broken.content, /name: "broken"/)
assert.match(broken.content, /Broken skill/)
assert.equal(broken.disabled, false)
assert.equal(skills.find((skill) => skill.id === "demo__hello")?.disabled, false)

// Claude marketplace URLs often carry ?client=claude-code-plugin; the migration must strip it.
const installedConfig = listMcp(document.data)[0].config as Record<string, unknown>
await saveMcp(paths, {
  name: "demo",
  originalName: "demo",
  config: { ...installedConfig, url: "https://example.com/mcp?client=claude-code-plugin" },
})
assert.equal(await normalizeInstalledMcpUrls(), true)
document = await readScope(paths)
assert.equal(
  (listMcp(document.data)[0].config as Record<string, unknown>).url,
  "https://example.com/mcp",
)

const installed = registry.registry.installed[0]
await setMarketplacePluginEnabled(installed.key, false)
registry = await readRegistry()
assert.equal(registry.registry.installed[0].enabled, false)
document = await readScope(paths)
assert.equal((listMcp(document.data)[0].config as Record<string, unknown>).disabled, true)
skills = await listSkills(paths.skillsDir)
assert.equal(skills.every((skill) => skill.disabled), true)

await setMarketplacePluginEnabled(installed.key, true)
document = await readScope(paths)
assert.equal((listMcp(document.data)[0].config as Record<string, unknown>).disabled, undefined)
skills = await listSkills(paths.skillsDir)
assert.equal(skills.every((skill) => skill.disabled), false)

await updateMarketplacePlugin(installed.key)
registry = await readRegistry()
assert.equal(registry.registry.installed.length, 1)
assert.equal(registry.registry.installed[0].enabled, true)
assert.equal(registry.registry.installed[0].adapt, true)
skills = await listSkills(paths.skillsDir)
assert.equal(skills.length, 2)

await uninstallMarketplacePlugin(installed.key)
registry = await readRegistry()
assert.equal(registry.registry.installed.length, 0)
document = await readScope(paths)
assert.equal(listMcp(document.data).length, 0)
skills = await listSkills(paths.skillsDir)
assert.equal(skills.length, 0)

const text = await readFile(paths.configPath, "utf8")
assert.match(text, /"mcp"/)

console.log("marketplace smoke ok:", root)
