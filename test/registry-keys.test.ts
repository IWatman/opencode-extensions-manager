import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { installedKey, isScopedKey, migrateInstalledKeys, normalizeProject } from "./support/registry-keys.ts"

/*
 * These tests cover the scope-aware registry contract that `feat/server-core` owns. That branch is
 * not merged here yet, so they exercise `test/support/registry-keys.ts` rather than production code.
 * Replace the helper import with the real server-core exports once they exist.
 */

async function tempDir(t: import("node:test").TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "oem-registry-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test("global keys are stable and do not include a project", () => {
  const key = installedKey({ scope: "global", marketplace: "anthropics/claude-plugins-official", plugin: "demo" })
  assert.equal(key, "global:anthropics/claude-plugins-official/demo")
  assert.equal(isScopedKey(key), true)
})

test("project keys include the normalized project directory", async (t) => {
  const root = await tempDir(t)
  const key = installedKey({ scope: "project", marketplace: "owner/repo", plugin: "demo", project: root })
  assert.equal(key, `project:${normalizeProject(root)}:owner/repo/demo`)
  assert.equal(isScopedKey(key), true)
})

test("the same plugin can be installed globally and in a project at once", async (t) => {
  const root = await tempDir(t)
  const base = { marketplace: "owner/repo", plugin: "demo" }
  const globalKey = installedKey({ ...base, scope: "global" })
  const projectKey = installedKey({ ...base, scope: "project", project: root })
  assert.notEqual(globalKey, projectKey)

  const { entries, migrated } = migrateInstalledKeys([
    { ...base, key: globalKey, scope: "global" },
    { ...base, key: projectKey, scope: "project", project: root },
  ])
  assert.equal(migrated, 0)
  assert.deepEqual(
    entries.map((entry) => entry.key),
    [globalKey, projectKey],
  )
})

test("different projects get different keys for the same plugin", async (t) => {
  const first = await tempDir(t)
  const second = await tempDir(t)
  const base = { scope: "project" as const, marketplace: "owner/repo", plugin: "demo" }
  assert.notEqual(
    installedKey({ ...base, project: first }),
    installedKey({ ...base, project: second }),
  )
})

test("equivalent project paths collapse to one key", async (t) => {
  const root = await tempDir(t)
  const base = { scope: "project" as const, marketplace: "owner/repo", plugin: "demo" }
  const plain = installedKey({ ...base, project: root })
  const dotted = installedKey({ ...base, project: `${root}${path.sep}nested${path.sep}..` })
  const trailing = installedKey({ ...base, project: `${root}${path.sep}` })
  assert.equal(dotted, plain)
  assert.equal(trailing, plain)

  const { entries } = migrateInstalledKeys([
    { ...base, key: plain, project: root, marketplace: "owner/repo", plugin: "demo" },
    {
      ...base,
      key: dotted,
      project: `${root}${path.sep}nested${path.sep}..`,
      marketplace: "owner/repo",
      plugin: "demo",
    },
  ])
  assert.equal(entries.length, 1)
})

test("project keys require a project directory", () => {
  assert.throws(
    () => installedKey({ scope: "project", marketplace: "owner/repo", plugin: "demo" }),
    /Project installs need a project directory/,
  )
  assert.throws(
    () => installedKey({ scope: "project", marketplace: "owner/repo", plugin: "demo", project: "  " }),
    /Project installs need a project directory/,
  )
  assert.throws(() => installedKey({ scope: "global", marketplace: "", plugin: "demo" }), /marketplace and a plugin/)
})

test("legacy marketplace/plugin keys migrate to global keys", () => {
  const { entries, migrated } = migrateInstalledKeys([
    { key: "anthropics/claude-plugins-official/demo", marketplace: "anthropics/claude-plugins-official", plugin: "demo" },
  ])
  assert.equal(migrated, 1)
  assert.equal(entries[0]?.key, "global:anthropics/claude-plugins-official/demo")
  assert.equal(entries[0]?.scope, "global")
})

test("legacy project entries keep their scope and gain a project-qualified key", async (t) => {
  const root = await tempDir(t)
  const { entries, migrated } = migrateInstalledKeys([
    {
      key: "owner/repo/demo",
      marketplace: "owner/repo",
      plugin: "demo",
      scope: "project",
      project: root,
    },
  ])
  assert.equal(migrated, 1)
  assert.equal(entries[0]?.key, `project:${normalizeProject(root)}:owner/repo/demo`)
  assert.equal(entries[0]?.scope, "project")
  assert.equal(entries[0]?.project, normalizeProject(root))
})

test("already-scoped keys are left alone and duplicates keep the last record", async (t) => {
  const root = await tempDir(t)
  const key = installedKey({ scope: "project", marketplace: "owner/repo", plugin: "demo", project: root })
  const { entries, migrated } = migrateInstalledKeys([
    { key, marketplace: "owner/repo", plugin: "demo", scope: "project", project: root, version: "1.0.0" },
    { key, marketplace: "owner/repo", plugin: "demo", scope: "project", project: root, version: "2.0.0" },
  ])
  assert.equal(migrated, 0)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.version, "2.0.0")
})

test("unreadable registry entries are dropped instead of crashing the migration", () => {
  const { entries } = migrateInstalledKeys([
    null,
    42,
    { key: "missing-plugin", marketplace: "owner/repo" },
    { key: "owner/repo/demo", marketplace: "owner/repo", plugin: "demo" },
  ])
  assert.deepEqual(
    entries.map((entry) => entry.key),
    ["global:owner/repo/demo"],
  )
})
