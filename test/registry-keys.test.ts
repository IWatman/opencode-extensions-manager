import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { installedKey, normalizeRegistry, rollbackRevision } from "../src/marketplaces.ts"

async function tempDir(t: import("node:test").TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "oem-registry-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function registry(installed: readonly unknown[]) {
  return normalizeRegistry({ version: 1, marketplaces: [], installed })
}

test("global keys are stable and do not include a project", () => {
  assert.equal(
    installedKey("anthropics/claude-plugins-official", "demo", "global"),
    "anthropics/claude-plugins-official/demo@global",
  )
})

test("project keys include the resolved project directory", async (t) => {
  const root = await tempDir(t)
  const key = installedKey("owner/repo", "demo", "project", root)
  assert.equal(key, `owner/repo/demo@project:${encodeURIComponent(path.resolve(root))}`)
})

test("the same plugin can be installed globally and in a project at once", async (t) => {
  const root = await tempDir(t)
  const migrated = registry([
    { key: "owner/repo/demo", marketplace: "owner/repo", plugin: "demo", scope: "global" },
    {
      key: "owner/repo/demo",
      marketplace: "owner/repo",
      plugin: "demo",
      scope: "project",
      project: root,
    },
  ])
  assert.equal(migrated.installed.length, 2)
  assert.deepEqual(
    migrated.installed.map((entry) => entry.key),
    [
      "owner/repo/demo@global",
      `owner/repo/demo@project:${encodeURIComponent(path.resolve(root))}`,
    ],
  )
})

test("different projects get different keys for the same plugin", async (t) => {
  const first = await tempDir(t)
  const second = await tempDir(t)
  assert.notEqual(
    installedKey("owner/repo", "demo", "project", first),
    installedKey("owner/repo", "demo", "project", second),
  )
})

test("equivalent project paths collapse to one key", async (t) => {
  const root = await tempDir(t)
  const plain = installedKey("owner/repo", "demo", "project", root)
  const dotted = installedKey("owner/repo", "demo", "project", `${root}${path.sep}nested${path.sep}..`)
  const trailing = installedKey("owner/repo", "demo", "project", `${root}${path.sep}`)
  assert.equal(dotted, plain)
  assert.equal(trailing, plain)

  const migrated = registry([
    { key: plain, marketplace: "owner/repo", plugin: "demo", scope: "project", project: root },
    {
      key: dotted,
      marketplace: "owner/repo",
      plugin: "demo",
      scope: "project",
      project: `${root}${path.sep}nested${path.sep}..`,
    },
  ])
  assert.equal(migrated.installed.length, 1)
  assert.equal(migrated.installed[0]?.key, plain)
})

test("legacy marketplace/plugin keys migrate to global keys", () => {
  const migrated = registry([
    {
      key: "anthropics/claude-plugins-official/demo",
      marketplace: "anthropics/claude-plugins-official",
      plugin: "demo",
      scope: "global",
    },
  ])
  assert.equal(migrated.installed.length, 1)
  assert.equal(migrated.installed[0]?.key, "anthropics/claude-plugins-official/demo@global")
  assert.equal(migrated.installed[0]?.scope, "global")
})

test("legacy project entries keep their scope and gain a project-qualified key", async (t) => {
  const root = await tempDir(t)
  const migrated = registry([
    {
      key: "owner/repo/demo",
      marketplace: "owner/repo",
      plugin: "demo",
      scope: "project",
      project: root,
    },
  ])
  assert.equal(migrated.installed.length, 1)
  assert.equal(
    migrated.installed[0]?.key,
    `owner/repo/demo@project:${encodeURIComponent(path.resolve(root))}`,
  )
  assert.equal(migrated.installed[0]?.scope, "project")
  assert.equal(migrated.installed[0]?.project, path.resolve(root))
})

test("already-scoped keys are left alone and duplicates keep the last record", async (t) => {
  const root = await tempDir(t)
  const key = installedKey("owner/repo", "demo", "project", root)
  const migrated = registry([
    {
      key,
      marketplace: "owner/repo",
      plugin: "demo",
      scope: "project",
      project: root,
      version: "1.0.0",
    },
    {
      key,
      marketplace: "owner/repo",
      plugin: "demo",
      scope: "project",
      project: root,
      version: "2.0.0",
    },
  ])
  assert.equal(migrated.installed.length, 1)
  assert.equal(migrated.installed[0]?.version, "2.0.0")
})

test("unreadable registry entries are dropped instead of crashing the migration", () => {
  const migrated = registry([
    null,
    42,
    { key: "missing-plugin", marketplace: "owner/repo" },
    { key: "owner/repo/demo", marketplace: "owner/repo", plugin: "demo", scope: "global" },
  ])
  assert.deepEqual(
    migrated.installed.map((entry) => entry.key),
    ["owner/repo/demo@global"],
  )
})

test("previous rollback revision survives registry normalization", () => {
  const migrated = registry([
    {
      key: "owner/repo/demo@global",
      marketplace: "owner/repo",
      plugin: "demo",
      scope: "global",
      version: "2.0.0",
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      previousVersion: "1.0.0",
      previousCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ])
  const record = migrated.installed[0]
  assert.equal(record?.version, "2.0.0")
  assert.equal(record?.commit, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
  assert.equal(record?.previousVersion, "1.0.0")
  assert.equal(record?.previousCommit, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
})

test("records without a previous revision stay unchanged", () => {
  const migrated = registry([
    {
      key: "owner/repo/demo@global",
      marketplace: "owner/repo",
      plugin: "demo",
      scope: "global",
      version: "1.0.0",
    },
  ])
  assert.equal(migrated.installed[0]?.previousVersion, undefined)
  assert.equal(migrated.installed[0]?.previousCommit, undefined)
})

test("rollbackRevision accepts version, commit, or both", () => {
  assert.deepEqual(rollbackRevision({ previousVersion: "1.0.0" }), { version: "1.0.0" })
  assert.deepEqual(rollbackRevision({ previousCommit: "abcdef1" }), { commit: "abcdef1" })
  assert.deepEqual(rollbackRevision({ previousVersion: "1.0.0", previousCommit: "abcdef1" }), {
    version: "1.0.0",
    commit: "abcdef1",
  })
  assert.throws(() => rollbackRevision({}), /No previous revision/)
})
