import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { type TestContext } from "node:test"
import { listMcp, readScope, resolveScope, saveMcp, saveSkill } from "../src/config.ts"
import {
  addMarketplace,
  checkMarketplaceUpdates,
  inspectPluginFolder,
  installMarketplacePlugin,
  normalizeInstalledMcpUrls,
  readRegistry,
  uninstallMarketplacePlugin,
  updateMarketplacePlugins,
  writeRegistry,
} from "../src/marketplaces.ts"

async function writeFileAt(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, "utf8")
}

async function writeMarketplace(
  marketplace: string,
  plugins: readonly { name: string; version: string; description: string }[],
) {
  await writeFileAt(
    path.join(marketplace, ".claude-plugin", "marketplace.json"),
    JSON.stringify(
      {
        name: "update-test",
        description: "Update center test marketplace",
        owner: { name: "Tester" },
        plugins: plugins.map((plugin) => ({
          name: plugin.name,
          displayName: `${plugin.name} plugin`,
          description: plugin.description,
          version: plugin.version,
          source: `./plugins/${plugin.name}`,
        })),
      },
      null,
      2,
    ),
  )
}

async function writePlugin(
  marketplace: string,
  name: string,
  version: string,
  options: { extraSkill?: string; resourceVersion?: string } = {},
) {
  const plugin = path.join(marketplace, "plugins", name)
  await writeFileAt(
    path.join(plugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name, version, description: `${name} ${version}` }),
  )
  await writeFileAt(
    path.join(plugin, ".mcp.json"),
    JSON.stringify({ mcpServers: { [name]: { type: "http", url: `https://example.com/${name}-${version}` } } }),
  )
  await writeFileAt(
    path.join(plugin, "skills", "hello", "SKILL.md"),
    `---\nname: Hello\ndescription: ${name} ${version}\n---\n\nBody ${version}.\n`,
  )
  if (options.resourceVersion) {
    await writeFileAt(
      path.join(plugin, "skills", "hello", "scripts", "run.sh"),
      `#!/bin/sh\necho ${options.resourceVersion}\n`,
    )
  }
  if (options.extraSkill) {
    await writeFileAt(
      path.join(plugin, "skills", options.extraSkill, "SKILL.md"),
      `---\nname: ${options.extraSkill}\ndescription: Added in ${version}\n---\n\nNew skill.\n`,
    )
  }
}

async function setup(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "oem-updates-"))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const marketplace = path.join(root, "marketplace")
  const project = path.join(root, "project")
  process.env.OPENCODE_CONFIG_DIR = path.join(root, "config")
  process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY = path.join(root, "registry.json")
  await mkdir(path.join(root, ".opencode"), { recursive: true })
  await mkdir(path.join(project, ".opencode"), { recursive: true })
  return { root, marketplace, project }
}

test("update check and batch update report per-plugin success, failure, and skipped artifacts", async (t) => {
  const { marketplace, project } = await setup(t)
  await writeMarketplace(marketplace, [
    { name: "alpha", version: "1.0.0", description: "Alpha one" },
    { name: "beta", version: "1.0.0", description: "Beta one" },
  ])
  await writePlugin(marketplace, "alpha", "1.0.0", { resourceVersion: "1" })
  await writePlugin(marketplace, "beta", "1.0.0")

  const added = await addMarketplace(marketplace)
  assert.ok(added.record)
  const id = added.record.id
  await installMarketplacePlugin({ marketplace: id, plugin: "alpha", scope: "project", project })
  await installMarketplacePlugin({ marketplace: id, plugin: "beta", scope: "project", project })

  let check = await checkMarketplaceUpdates()
  assert.equal(check.plugins.length, 2)
  assert.equal(check.plugins.every((item) => item.status === "current"), true)
  assert.deepEqual(await updateMarketplacePlugins(), [])

  const paths = await resolveScope("project", project)
  assert.equal(
    await readFile(path.join(paths.skillsDir, "alpha__hello", "scripts", "run.sh"), "utf8"),
    "#!/bin/sh\necho 1\n",
  )
  const registryFile = process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY!
  const registryBefore = await readFile(registryFile, "utf8")

  // Publish v2 for both. Beta also adds a skill, so a successful apply changes more than the
  // previous artifacts and the rollback path has to restore all of it.
  await writeMarketplace(marketplace, [
    { name: "alpha", version: "2.0.0", description: "Alpha two" },
    { name: "beta", version: "2.0.0", description: "Beta two" },
  ])
  await writePlugin(marketplace, "alpha", "2.0.0", { resourceVersion: "2" })
  await writePlugin(marketplace, "beta", "2.0.0", { extraSkill: "newblock" })

  // A user edit after installation must be kept and reported, not silently deleted by the update.
  await saveSkill(paths, {
    id: "alpha__hello",
    originalId: "alpha__hello",
    content: "---\nname: Hello\ndescription: Edited by the user\n---\n\nUser text.\n",
  })

  check = await checkMarketplaceUpdates()
  assert.equal(check.plugins.length, 2)
  assert.equal(check.plugins.every((item) => item.status === "outdated"), true)
  assert.equal(check.plugins.every((item) => item.currentVersion === "1.0.0"), true)
  assert.equal(check.plugins.every((item) => item.latestVersion === "2.0.0"), true)
  assert.equal(await readFile(registryFile, "utf8"), registryBefore)

  let registry = (await readRegistry()).registry
  const alphaKey = registry.installed.find((item) => item.plugin === "alpha")!.key
  const betaKey = registry.installed.find((item) => item.plugin === "beta")!.key

  // Block the registry commit point. Artifacts are applied before the registry is written, so the
  // failure happens after the old version was removed and must roll back to it.
  const registryBackup = `${registryFile}.bak`
  await rm(registryBackup, { recursive: true, force: true })
  await mkdir(registryBackup, { recursive: true })

  const failed = await updateMarketplacePlugins([betaKey])
  assert.equal(failed.length, 1)
  assert.equal(failed[0]?.ok, false)
  assert.ok((failed[0]?.error ?? "").length > 0)
  assert.equal(await readFile(registryFile, "utf8"), registryBefore)
  let document = await readScope(paths)
  let servers = Object.fromEntries(listMcp(document.data).map((server) => [server.name, server.config]))
  assert.equal((servers.beta as Record<string, unknown>).url, "https://example.com/beta-1.0.0")
  assert.match(
    await readFile(path.join(paths.skillsDir, "beta__hello", "SKILL.md"), "utf8"),
    /Body 1\.0\.0\./,
  )
  await assert.rejects(() => stat(path.join(paths.skillsDir, "beta__newblock")))
  await rm(registryBackup, { recursive: true, force: true })

  // With the obstacle removed, a single-key batch retries only the requested plugin.
  const retry = await updateMarketplacePlugins([betaKey, "missing/key"])
  assert.equal(retry.length, 2)
  const retried = retry.find((item) => item.key === betaKey)
  const missing = retry.find((item) => item.key === "missing/key")
  assert.equal(retried?.ok, true)
  assert.equal(missing?.ok, false)
  assert.match(missing?.error ?? "", /not found/i)

  registry = (await readRegistry()).registry
  assert.equal(registry.installed.find((item) => item.plugin === "alpha")?.version, "1.0.0")
  assert.equal(registry.installed.find((item) => item.plugin === "beta")?.version, "2.0.0")

  // The edited skill makes alpha's old skill unremovable; the update keeps it and installs a new
  // copy under a unique id instead of deleting user text.
  const alphaResult = (await updateMarketplacePlugins([alphaKey])).find((item) => item.key === alphaKey)
  assert.equal(alphaResult?.ok, true)
  assert.ok(alphaResult?.skipped?.some((item) => item.includes('Skill "alpha__hello"')))
  assert.match(
    await readFile(path.join(paths.skillsDir, "alpha__hello", "SKILL.md"), "utf8"),
    /User text\./,
  )
  assert.match(
    await readFile(path.join(paths.skillsDir, "alpha__hello-2", "SKILL.md"), "utf8"),
    /Body 2\.0\.0\./,
  )
  assert.equal(
    await readFile(path.join(paths.skillsDir, "alpha__hello-2", "scripts", "run.sh"), "utf8"),
    "#!/bin/sh\necho 2\n",
  )

  registry = (await readRegistry()).registry
  assert.equal(registry.installed.find((item) => item.plugin === "alpha")?.version, "2.0.0")
  document = await readScope(paths)
  servers = Object.fromEntries(listMcp(document.data).map((server) => [server.name, server.config]))
  assert.equal((servers.alpha as Record<string, unknown>).url, "https://example.com/alpha-2.0.0")
  assert.equal((servers.beta as Record<string, unknown>).url, "https://example.com/beta-2.0.0")
})

test("skill resources are installed and user files survive uninstall", async (t) => {
  const { marketplace, project } = await setup(t)
  await writeMarketplace(marketplace, [{ name: "gamma", version: "1.0.0", description: "Gamma one" }])
  await writePlugin(marketplace, "gamma", "1.0.0", { resourceVersion: "1" })

  const added = await addMarketplace(marketplace)
  assert.ok(added.record)
  await installMarketplacePlugin({ marketplace: added.record.id, plugin: "gamma", scope: "project", project })

  const paths = await resolveScope("project", project)
  const skillDir = path.join(paths.skillsDir, "gamma__hello")
  assert.equal(await readFile(path.join(skillDir, "scripts", "run.sh"), "utf8"), "#!/bin/sh\necho 1\n")

  await mkdir(path.join(skillDir, "notes"), { recursive: true })
  await writeFile(path.join(skillDir, "notes", "mine.txt"), "keep me\n", "utf8")

  const registry = (await readRegistry()).registry
  const key = registry.installed.find((item) => item.plugin === "gamma")!.key
  const skipped = await uninstallMarketplacePlugin(key)
  assert.ok(skipped.some((item) => item.includes('Skill "gamma__hello"')))
  assert.equal(await readFile(path.join(skillDir, "notes", "mine.txt"), "utf8"), "keep me\n")
  assert.match(await readFile(path.join(skillDir, "SKILL.md"), "utf8"), /Body 1\.0\.0\./)
})

test("an existing skill folder without SKILL.md is never deleted", async (t) => {
  const { marketplace, project } = await setup(t)
  await writeMarketplace(marketplace, [{ name: "delta", version: "1.0.0", description: "Delta one" }])
  await writePlugin(marketplace, "delta", "1.0.0", { extraSkill: "blocked" })

  const paths = await resolveScope("project", project)
  const blocked = path.join(paths.skillsDir, "delta__blocked")
  await mkdir(blocked, { recursive: true })
  await writeFile(path.join(blocked, "user-note.txt"), "keep this\n", "utf8")

  const added = await addMarketplace(marketplace)
  assert.ok(added.record)
  await installMarketplacePlugin({ marketplace: added.record.id, plugin: "delta", scope: "project", project })

  assert.equal(await readFile(path.join(blocked, "user-note.txt"), "utf8"), "keep this\n")
  assert.match(
    await readFile(path.join(paths.skillsDir, "delta__blocked-2", "SKILL.md"), "utf8"),
    /Added in 1\.0\.0/,
  )
})

test("URL normalization refreshes the ownership fingerprint", async (t) => {
  const { marketplace, project } = await setup(t)
  await writeMarketplace(marketplace, [{ name: "epsilon", version: "1.0.0", description: "Epsilon one" }])
  await writeFileAt(
    path.join(marketplace, "plugins", "epsilon", ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "epsilon", version: "1.0.0", description: "Epsilon one" }),
  )
  await writeFileAt(
    path.join(marketplace, "plugins", "epsilon", ".mcp.json"),
    JSON.stringify({
      mcpServers: { epsilon: { type: "http", url: "https://example.com/mcp" } },
    }),
  )

  const added = await addMarketplace(marketplace)
  assert.ok(added.record)
  await installMarketplacePlugin({ marketplace: added.record.id, plugin: "epsilon", scope: "project", project })

  const paths = await resolveScope("project", project)
  // Simulate a record written before the automatic URL migration existed: the config and its
  // fingerprint both contain the Claude client parameter.
  const legacyUrl = "https://example.com/mcp?client=claude-code-plugin"
  await saveMcp(paths, { name: "epsilon", originalName: "epsilon", config: { type: "remote", url: legacyUrl } })
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ type: "remote", url: legacyUrl }, ["type", "url"]))
    .digest("hex")
  const registry = (await readRegistry()).registry
  const key = registry.installed.find((item) => item.plugin === "epsilon")!.key
  await writeRegistry({
    ...registry,
    installed: registry.installed.map((item) =>
      item.key === key
        ? {
            ...item,
            fingerprints: {
              mcp: { ...item.fingerprints?.mcp, epsilon: fingerprint },
              skills: item.fingerprints?.skills ?? {},
              plugins: item.fingerprints?.plugins ?? {},
            },
          }
        : item,
    ),
  })

  assert.equal(await normalizeInstalledMcpUrls(), true)
  let document = await readScope(paths)
  assert.equal(
    (listMcp(document.data)[0]?.config as Record<string, unknown>).url,
    "https://example.com/mcp",
  )

  const skipped = await uninstallMarketplacePlugin(key)
  assert.equal(skipped.some((item) => item.includes("MCP server")), false)
  document = await readScope(paths)
  assert.equal(listMcp(document.data).length, 0)
})

test("a direct .mcp.json server dictionary is imported", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oem-direct-mcp-"))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const plugin = path.join(root, "plugin")
  await writeFileAt(
    path.join(plugin, ".mcp.json"),
    JSON.stringify({ demo: { command: "node", args: ["server.js"] } }),
  )

  const extracted = await inspectPluginFolder(plugin)
  assert.equal(extracted.mcp.length, 1)
  assert.equal(extracted.mcp[0]?.name, "demo")
  assert.deepEqual(extracted.mcp[0]?.config.command, ["node", "server.js"])
})
