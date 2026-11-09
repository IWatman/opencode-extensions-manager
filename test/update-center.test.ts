import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { type TestContext } from "node:test"
import { listMcp, readScope, resolveScope, saveSkill } from "../src/config.ts"
import {
  addMarketplace,
  checkMarketplaceUpdates,
  installMarketplacePlugin,
  readRegistry,
  updateMarketplacePlugins,
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
  options: { extraSkill?: string } = {},
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
  await writePlugin(marketplace, "alpha", "1.0.0")
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
  const registryBefore = await readFile(process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY!, "utf8")

  // Publish v2 for both. Beta also adds a skill whose destination is blocked below, so its update
  // fails after the old artifacts were removed and must roll back.
  await writeMarketplace(marketplace, [
    { name: "alpha", version: "2.0.0", description: "Alpha two" },
    { name: "beta", version: "2.0.0", description: "Beta two" },
  ])
  await writePlugin(marketplace, "alpha", "2.0.0")
  await writePlugin(marketplace, "beta", "2.0.0", { extraSkill: "newblock" })
  await mkdir(path.join(paths.skillsDir, "beta__newblock"), { recursive: true })

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
  assert.equal(await readFile(process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY!, "utf8"), registryBefore)

  const results = await updateMarketplacePlugins()
  assert.equal(results.length, 2)
  const alphaResult = results.find((item) => item.plugin === "alpha")
  const betaResult = results.find((item) => item.plugin === "beta")
  assert.ok(alphaResult)
  assert.ok(betaResult)
  assert.equal(alphaResult.ok, true)
  assert.ok(alphaResult.skipped?.some((item) => item.includes('Skill "alpha__hello"')))
  assert.equal(betaResult.ok, false)
  assert.match(betaResult.error ?? "", /already exists/)

  // The successful item advanced while the failed item kept its previous version and artifacts.
  let registry = (await readRegistry()).registry
  const alphaRecord = registry.installed.find((item) => item.plugin === "alpha")
  const betaRecord = registry.installed.find((item) => item.plugin === "beta")
  assert.equal(alphaRecord?.version, "2.0.0")
  assert.equal(betaRecord?.version, "1.0.0")
  let document = await readScope(paths)
  const servers = Object.fromEntries(listMcp(document.data).map((server) => [server.name, server.config]))
  assert.equal((servers.alpha as Record<string, unknown>).url, "https://example.com/alpha-2.0.0")
  assert.equal((servers.beta as Record<string, unknown>).url, "https://example.com/beta-1.0.0")

  // With the obstacle removed, a single-key batch retries only the failed plugin.
  await rm(path.join(paths.skillsDir, "beta__newblock"), { recursive: true, force: true })
  const betaKey = betaRecord!.key
  const retry = await updateMarketplacePlugins([betaKey, "missing/key"])
  assert.equal(retry.length, 2)
  const retried = retry.find((item) => item.key === betaKey)
  const missing = retry.find((item) => item.key === "missing/key")
  assert.equal(retried?.ok, true)
  assert.equal(missing?.ok, false)
  assert.match(missing?.error ?? "", /not found/i)

  registry = (await readRegistry()).registry
  assert.equal(registry.installed.find((item) => item.plugin === "beta")?.version, "2.0.0")
  document = await readScope(paths)
  const updatedServers = Object.fromEntries(listMcp(document.data).map((server) => [server.name, server.config]))
  assert.equal((updatedServers.beta as Record<string, unknown>).url, "https://example.com/beta-2.0.0")
})
