import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { listMcp, listSkills, readScope, resolveScope, saveMcp, saveSkill } from "../src/config.ts"
import {
  addMarketplace,
  getCatalog,
  inspectMarketplacePlugin,
  installMarketplacePlugin,
  normalizeInstalledMcpUrls,
  readRegistry,
  rollbackMarketplacePlugin,
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

// A local `.opencode` keeps project scope inside the temporary directory. Without it,
// projectConfigDir walks up and would use the developer's real global `.opencode` folder.
await mkdir(path.join(root, ".opencode"), { recursive: true })
await mkdir(path.join(marketplace, ".claude-plugin"), { recursive: true })
await mkdir(path.join(plugin, ".claude-plugin"), { recursive: true })
await mkdir(path.join(plugin, "skills", "hello"), { recursive: true })
await mkdir(path.join(plugin, "skills", "broken"), { recursive: true })
await mkdir(path.join(plugin, "commands"), { recursive: true })
await mkdir(project, { recursive: true })

// Legacy registry keys did not carry scope. They must migrate to the scope-aware format using the
// record's own scope/project, without dropping any other field.
const registryFile = process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY!
const legacyTime = "2025-01-01T00:00:00.000Z"
const legacyRecord = (plugin: string, scope: "global" | "project") => ({
  key: `legacy/${plugin}`,
  marketplace: "legacy",
  marketplaceName: "Legacy marketplace",
  plugin,
  scope,
  ...(scope === "project" ? { project } : {}),
  enabled: true,
  installedAt: legacyTime,
  updatedAt: legacyTime,
  mcp: [],
  skills: [],
  plugins: [],
  unsupported: [],
})
await writeFile(
  registryFile,
  JSON.stringify({
    version: 1,
    marketplaces: [],
    installed: [legacyRecord("global-one", "global"), legacyRecord("project-one", "project")],
  }),
)
let migrated = await readRegistry()
assert.equal(migrated.registry.installed.length, 2)
assert.equal(migrated.registry.installed[0].key, "legacy/global-one@global")
assert.equal(
  migrated.registry.installed[1].key,
  `legacy/project-one@project:${encodeURIComponent(path.resolve(project))}`,
)
assert.equal(migrated.registry.installed[1].marketplaceName, "Legacy marketplace")
assert.equal(migrated.registry.installed[1].installedAt, legacyTime)
await rm(registryFile, { force: true })

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
assert.ok(registry.registry.installed[0].fingerprints?.mcp.demo)
assert.ok(registry.registry.installed[0].fingerprints?.skills.demo__hello)
assert.equal(registry.registry.installed[0].version, "1.0.0")
assert.equal(registry.registry.installed[0].previousVersion, undefined)
assert.equal(registry.registry.installed[0].previousCommit, undefined)

const projectKey = `local-marketplace/demo@project:${encodeURIComponent(path.resolve(project))}`
assert.equal(registry.registry.installed[0].key, projectKey)
assert.equal(registry.registry.installed[0].scope, "project")
assert.equal(registry.registry.installed[0].project, path.resolve(project))

// The same marketplace plugin must coexist as a global install and a project install.
await installMarketplacePlugin({ marketplace: id, plugin: "demo", scope: "global", adapt: true })
registry = await readRegistry()
assert.equal(registry.registry.installed.length, 2)
const globalRecord = registry.registry.installed.find((item) => item.scope === "global")
const projectRecord = registry.registry.installed.find((item) => item.scope === "project")
assert.equal(globalRecord?.key, "local-marketplace/demo@global")
assert.equal(projectRecord?.key, projectKey)

const globalCatalog = await getCatalog(id, false, { scope: "global" })
assert.equal(globalCatalog[0].installedKey, "local-marketplace/demo@global")
const projectCatalog = await getCatalog(id, false, { scope: "project", project })
assert.equal(projectCatalog[0].installedKey, projectKey)
const otherProject = path.join(root, "other-project")
await mkdir(otherProject, { recursive: true })
const otherCatalog = await getCatalog(id, false, { scope: "project", project: otherProject })
assert.equal(otherCatalog[0].installedKey, undefined)

assert.deepEqual(await uninstallMarketplacePlugin("local-marketplace/demo@global"), [])
registry = await readRegistry()
assert.equal(registry.registry.installed.length, 1)
assert.equal(registry.registry.installed[0].key, projectKey)

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
const beforeFailure = registry.registry.installed[0]

// Publishing a new version that fails halfway must leave the working install untouched. An empty
// directory where the new skill wants to go makes saveSkill fail after the old artifacts were
// removed; the snapshot has to put the config, skills, and registry back.
const helloBefore = skills.find((skill) => skill.id === "demo__hello")?.content ?? ""
const configBeforeFailure = await readFile(paths.configPath, "utf8")
const registryBeforeFailure = await readFile(registryFile, "utf8")
await writeFile(
  path.join(plugin, ".mcp.json"),
  JSON.stringify({ mcpServers: { demo: { type: "http", url: "https://example.com/mcp-v2" } } }),
)
await writeFile(
  path.join(plugin, "skills", "hello", "SKILL.md"),
  `---\nname: Hello\ndescription: Says hello.\n---\n\nSay hello from version two.\n`,
)
await mkdir(path.join(plugin, "skills", "newblock"), { recursive: true })
await writeFile(
  path.join(plugin, "skills", "newblock", "SKILL.md"),
  `---\nname: New block\ndescription: A skill that cannot be installed.\n---\n\nBlocked.\n`,
)
await mkdir(path.join(paths.skillsDir, "demo__newblock"), { recursive: true })
await assert.rejects(() => updateMarketplacePlugin(installed.key))
document = await readScope(paths)
assert.equal(
  (listMcp(document.data)[0].config as Record<string, unknown>).url,
  "https://example.com/mcp",
)
assert.equal(await readFile(paths.configPath, "utf8"), configBeforeFailure)
assert.equal(await readFile(registryFile, "utf8"), registryBeforeFailure)
skills = await listSkills(paths.skillsDir)
assert.equal(skills.find((skill) => skill.id === "demo__hello")?.content, helloBefore)
assert.equal(skills.length, 2)
registry = await readRegistry()
assert.equal(registry.registry.installed[0].key, beforeFailure.key)
assert.deepEqual(registry.registry.installed[0].fingerprints, beforeFailure.fingerprints)

// With the obstacle gone the same update succeeds and replaces both artifacts and fingerprints.
await rm(path.join(paths.skillsDir, "demo__newblock"), { recursive: true, force: true })
// Bump the published version so the successful update records the revision it replaced.
await writeFile(
  path.join(plugin, ".claude-plugin", "plugin.json"),
  JSON.stringify({ name: "demo", description: "A demo plugin", version: "1.1.0" }),
)
const marketplacePath = path.join(marketplace, ".claude-plugin", "marketplace.json")
const marketplaceManifest = JSON.parse(await readFile(marketplacePath, "utf8"))
marketplaceManifest.plugins[0].version = "1.1.0"
await writeFile(marketplacePath, JSON.stringify(marketplaceManifest, null, 2))
await updateMarketplacePlugin(installed.key)
document = await readScope(paths)
assert.equal(
  (listMcp(document.data)[0].config as Record<string, unknown>).url,
  "https://example.com/mcp-v2",
)
skills = await listSkills(paths.skillsDir)
assert.equal(skills.length, 3)
const helloV2 = skills.find((skill) => skill.id === "demo__hello")?.content ?? ""
assert.match(helloV2, /version two/)
registry = await readRegistry()
assert.notEqual(registry.registry.installed[0].fingerprints?.mcp.demo, beforeFailure.fingerprints?.mcp.demo)
assert.equal(registry.registry.installed[0].version, "1.1.0")
assert.equal(registry.registry.installed[0].previousVersion, "1.0.0")
assert.equal(registry.registry.installed[0].previousCommit, undefined)

// A local marketplace cannot retrieve the files of version 1.0.0 once the manifest offers 1.1.0.
// Rollback must fail before touching the config or the registry.
const rollbackConfigBefore = await readFile(paths.configPath, "utf8")
const rollbackRegistryBefore = await readFile(registryFile, "utf8")
await assert.rejects(
  () => rollbackMarketplacePlugin(installed.key),
  /Cannot resolve previous version 1\.0\.0/,
)
assert.equal(await readFile(paths.configPath, "utf8"), rollbackConfigBefore)
assert.equal(await readFile(registryFile, "utf8"), rollbackRegistryBefore)

// User edits after installation are not managed content anymore: uninstall keeps them and reports
// exactly which artifacts it skipped.
const editedHello = `${helloV2}\nUser edit that must survive.\n`
await saveSkill(paths, { id: "demo__hello", originalId: "demo__hello", content: editedHello })
const currentMcp = (listMcp((await readScope(paths)).data)[0].config as Record<string, unknown>)
await saveMcp(paths, {
  name: "demo",
  originalName: "demo",
  config: { ...currentMcp, url: "https://user.example/mcp" },
})
const skipped = await uninstallMarketplacePlugin(installed.key)
assert.ok(skipped.some((item) => item.includes('Skill "demo__hello"')))
assert.ok(skipped.some((item) => item.includes('MCP server "demo"')))
registry = await readRegistry()
assert.equal(registry.registry.installed.length, 0)
document = await readScope(paths)
assert.equal((listMcp(document.data)[0].config as Record<string, unknown>).url, "https://user.example/mcp")
skills = await listSkills(paths.skillsDir)
assert.deepEqual(skills.map((skill) => skill.id), ["demo__hello"])
assert.equal(skills[0].content, editedHello)

const text = await readFile(paths.configPath, "utf8")
assert.match(text, /"mcp"/)

console.log("marketplace smoke ok:", root)
