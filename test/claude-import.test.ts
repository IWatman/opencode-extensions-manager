import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { type TestContext } from "node:test"
import {
  claudeCacheDir,
  installClaudeCandidate,
  previewClaudePlugins,
  scanClaudePlugins,
} from "../src/claude.ts"
import { readRegistry } from "../src/marketplaces.ts"

async function tempRoot(t: TestContext, name: string) {
  const root = await mkdtemp(path.join(tmpdir(), `oem-${name}-`))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  return root
}

async function writeFileAt(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, "utf8")
}

const skill = (description: string, body: string) =>
  `---\nname: Hello\ndescription: ${description}\n---\n\n${body}\n`

test("claudeCacheDir respects CLAUDE_CONFIG_DIR", async (t) => {
  const root = await tempRoot(t, "claude-env")
  const previous = process.env.CLAUDE_CONFIG_DIR
  try {
    process.env.CLAUDE_CONFIG_DIR = root
    assert.equal(claudeCacheDir(), path.join(path.resolve(root), "plugins", "cache"))
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
  }
})

test("Claude preview extracts compatible parts and does not install", async (t) => {
  const root = await tempRoot(t, "claude-preview")
  const cache = path.join(root, "cache")
  const config = path.join(root, "config")
  const registry = path.join(root, "registry.json")
  process.env.OPENCODE_CONFIG_DIR = config
  process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY = registry

  const demoV1 = path.join(cache, "market", "demo", "1.0.0")
  const demoV2 = path.join(cache, "market", "demo", "2.0.0")
  await writeFileAt(
    path.join(demoV1, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "demo", version: "1.0.0", description: "Version one" }),
  )
  await writeFileAt(
    path.join(demoV1, ".mcp.json"),
    JSON.stringify({ mcpServers: { demo: { type: "http", url: "https://example.com/mcp-v1" } } }),
  )
  await writeFileAt(path.join(demoV1, "skills", "hello", "SKILL.md"), skill("Version one", "First."))
  await writeFileAt(path.join(demoV1, "commands", "run.md"), "# Run\n")

  await writeFileAt(
    path.join(demoV2, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "demo", version: "2.0.0", description: "Version two" }),
  )
  await writeFileAt(
    path.join(demoV2, ".mcp.json"),
    JSON.stringify({ mcpServers: { demo: { type: "http", url: "https://example.com/mcp-v2" } } }),
  )
  await writeFileAt(path.join(demoV2, "skills", "hello", "SKILL.md"), skill("Version two", "Second."))
  await writeFileAt(path.join(demoV2, "skills", "loose", "SKILL.md"), "# Loose skill\n\nNeeds frontmatter.\n")
  await writeFileAt(path.join(demoV2, "commands", "run.md"), "# Run\n")
  const old = new Date("2024-01-01T00:00:00Z")
  const recent = new Date("2024-06-01T00:00:00Z")
  await utimes(demoV1, old, old)
  await utimes(demoV2, recent, recent)

  const standalone = path.join(cache, "standalone")
  await writeFileAt(
    path.join(standalone, "plugin.json"),
    JSON.stringify({ name: "standalone", version: "0.1.0", description: "An OpenCode plugin" }),
  )
  await writeFileAt(
    path.join(standalone, "package.json"),
    JSON.stringify({ name: "opencode-standalone", keywords: ["opencode-plugin"] }),
  )
  await writeFileAt(
    path.join(standalone, ".mcp.json"),
    JSON.stringify({ mcpServers: { local: { command: "node", args: ["server.js"] } } }),
  )

  const broken = path.join(cache, "broken")
  await writeFileAt(path.join(broken, "plugin.json"), JSON.stringify({ name: "broken", version: "1.0.0" }))
  await writeFileAt(path.join(broken, ".mcp.json"), "[]")

  const scan = await scanClaudePlugins({ cacheDir: cache })
  assert.equal(scan.exists, true)
  assert.equal(scan.error, undefined)
  assert.equal(scan.candidates.length, 3)

  const demo = scan.candidates.find((candidate) => candidate.id === "market-demo")
  assert.ok(demo)
  assert.equal(demo.version, "2.0.0")
  assert.equal(demo.description, "Version two")
  assert.equal(demo.marketplace, "market")
  assert.equal(demo.source, demoV2)
  assert.equal(demo.extracted.mcp.length, 1)
  assert.equal(demo.extracted.mcp[0].config.url, "https://example.com/mcp-v2")
  assert.deepEqual(demo.extracted.skills.map((item) => item.id), ["hello"])
  assert.deepEqual(demo.extracted.adaptable.map((item) => item.id), ["loose"])
  assert.deepEqual(demo.extracted.unsupported, ["commands"])
  assert.ok(demo.warnings.some((warning) => warning.includes("Multiple cached versions")))

  const standaloneCandidate = scan.candidates.find((candidate) => candidate.id === "standalone")
  assert.ok(standaloneCandidate)
  assert.deepEqual(standaloneCandidate.extracted.plugins, [standalone])

  const brokenCandidate = scan.candidates.find((candidate) => candidate.id === "broken")
  assert.ok(brokenCandidate)
  assert.ok(brokenCandidate.extracted.warnings.some((warning) => warning.includes("not a JSON object")))

  const preview = await previewClaudePlugins({ cacheDir: cache, scope: "global" })
  assert.equal(preview.cacheDir, path.resolve(cache))
  assert.equal(preview.candidates.length, 3)
  const previewDemo = preview.candidates.find((candidate) => candidate.id === "market-demo")
  assert.ok(previewDemo)
  assert.equal(previewDemo.mcp[0].summary, "https://example.com/mcp-v2")
  assert.equal(previewDemo.skills[0].id, "hello")
  assert.equal(previewDemo.adaptable[0].id, "loose")
  assert.deepEqual(previewDemo.unsupported, ["commands"])
  assert.equal("extracted" in previewDemo, false)
  assert.equal(previewDemo.installedKey, undefined)
  // Preview is read-only: no import record is written.
  assert.equal((await readRegistry()).registry.installed.length, 0)
})

test("installing a Claude candidate uses the shared transaction and fingerprints", async (t) => {
  const root = await tempRoot(t, "claude-install")
  const cache = path.join(root, "cache")
  const config = path.join(root, "config")
  const registry = path.join(root, "registry.json")
  const project = path.join(root, "project")
  process.env.OPENCODE_CONFIG_DIR = config
  process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY = registry
  await mkdir(path.join(project, ".opencode"), { recursive: true })

  const pluginRoot = path.join(cache, "market", "demo", "1.0.0")
  await writeFileAt(
    path.join(pluginRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "demo", version: "1.0.0", description: "Import me" }),
  )
  await writeFileAt(
    path.join(pluginRoot, ".mcp.json"),
    JSON.stringify({ mcpServers: { demo: { type: "http", url: "https://example.com/mcp" } } }),
  )
  await writeFileAt(path.join(pluginRoot, "skills", "hello", "SKILL.md"), skill("Imported", "Hello."))
  await writeFileAt(path.join(pluginRoot, "commands", "run.md"), "# Run\n")

  const scan = await scanClaudePlugins({ cacheDir: cache })
  const candidate = scan.candidates.find((item) => item.id === "market-demo")
  assert.ok(candidate)
  const installed = await installClaudeCandidate(candidate, { scope: "project", project })
  assert.equal(installed.key, `claude-code/market-demo@project:${encodeURIComponent(path.resolve(project))}`)

  const record = (await readRegistry()).registry.installed[0]
  assert.ok(record)
  assert.equal(record.marketplace, "claude-code")
  assert.equal(record.marketplaceName, "Claude Code")
  assert.equal(record.plugin, "market-demo")
  assert.equal(record.version, "1.0.0")
  assert.deepEqual(record.mcp, ["demo"])
  assert.deepEqual(record.skills, ["market-demo__hello"])
  assert.deepEqual(record.unsupported, ["commands"])
  assert.ok(record.fingerprints?.mcp.demo)
  assert.ok(record.fingerprints?.skills["market-demo__hello"])

  const preview = await previewClaudePlugins({ cacheDir: cache, scope: "project", project })
  assert.equal(
    preview.candidates.find((item) => item.id === "market-demo")?.installedKey,
    installed.key,
  )
})
