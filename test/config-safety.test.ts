import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { TestContext } from "node:test"
import { configBackupDiff, listConfigBackups, restoreConfigBackup } from "../src/backups.ts"
import { writeDoctorReport } from "../src/doctor-report.ts"
import {
  ensureScope,
  isFile,
  previewMcp,
  readScope,
  resolveScope,
  savePlugin,
  writeAtomic,
} from "../src/config.ts"
import { normalizeRegistry, writeRegistry } from "../src/marketplaces.ts"
import { tempScope } from "./support/temp-scope.ts"

async function registryIn(t: TestContext, root: string) {
  const previous = process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY
  const registry = path.join(root, "registry.json")
  process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY = registry
  t.after(() => {
    if (previous === undefined) delete process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY
    else process.env.OPENCODE_EXTENSIONS_MANAGER_REGISTRY = previous
  })
  return registry
}

test("listConfigBackups returns config and registry backups with metadata", async (t) => {
  const scope = await tempScope(t, `{\n  "plugins": []\n}\n`)
  const registry = await registryIn(t, scope.root)

  await savePlugin(scope.paths, { package: "opencode-one" })
  const jsonBackup = path.join(scope.configDir, "opencode.json.bak")
  await writeFile(jsonBackup, `{\n  "plugins": ["older"]\n}\n`, "utf8")
  await writeFile(registry, `{"version":1,"marketplaces":[],"installed":[]}\n`, "utf8")
  await writeFile(`${registry}.bak`, `{"version":1,"marketplaces":[],"installed":[]}\n`, "utf8")

  const backups = await listConfigBackups("project", scope.root)
  const byPath = new Map(backups.map((backup) => [backup.path, backup]))

  assert.ok(byPath.has(`${scope.configPath}.bak`))
  assert.ok(byPath.has(jsonBackup))
  assert.ok(byPath.has(`${registry}.bak`))
  for (const backup of backups) {
    assert.ok(Number.isFinite(backup.size) && backup.size > 0)
    assert.ok(!Number.isNaN(new Date(backup.modifiedAt).getTime()))
    assert.equal(await isFile(backup.path), true)
  }
  assert.equal(byPath.get(`${scope.configPath}.bak`)?.kind, "config")
  assert.equal(byPath.get(`${registry}.bak`)?.kind, "registry")
  assert.equal(byPath.get(`${registry}.bak`)?.scope, "global")
  assert.equal(byPath.get(`${registry}.bak`)?.target, registry)
})

test("configBackupDiff compares the live file with the selected backup", async (t) => {
  const scope = await tempScope(t, `{\n  "current": true\n}\n`)
  await registryIn(t, scope.root)
  const backupPath = `${scope.configPath}.bak`
  const backup = `{\n  "fromBackup": true\n}\n`
  await writeFile(backupPath, backup, "utf8")

  const diff = await configBackupDiff("project", scope.root, backupPath)
  assert.equal(diff.before, `{\n  "current": true\n}\n`)
  assert.equal(diff.after, backup)
  assert.equal(diff.path, scope.configPath)
  assert.equal(diff.backupPath, backupPath)

  // The path alone is enough: the diff endpoint searches known global and project locations.
  const inferred = await configBackupDiff(undefined, scope.root, backupPath)
  assert.deepEqual(inferred, diff)
})

test("configBackupDiff and restore reject paths outside the known backup locations", async (t) => {
  const scope = await tempScope(t, `{\n  "plugins": []\n}\n`)
  await registryIn(t, scope.root)
  const unknown = path.join(scope.configDir, "opencode.json.bak.old")
  await writeFile(unknown, `{"ok":true}\n`, "utf8")

  await assert.rejects(() => configBackupDiff("project", scope.root, unknown), /Not a known config backup/)
  await assert.rejects(() => restoreConfigBackup("project", scope.root, unknown), /Not a known config backup/)
  await assert.rejects(
    () => restoreConfigBackup("project", scope.root, path.join(scope.root, "..", "opencode.jsonc.bak")),
    /Not a known config backup/,
  )
})

test("restoreConfigBackup keeps the current file as .bak and restores valid JSONC", async (t) => {
  const current = `{\n  // current comment\n  "plugins": ["current"]\n}\n`
  const backup = `{\n  // backup comment\n  "plugins": ["from-backup"]\n}\n`
  const scope = await tempScope(t, current)
  await registryIn(t, scope.root)
  await writeFile(`${scope.configPath}.bak`, backup, "utf8")

  const target = await restoreConfigBackup("project", scope.root, `${scope.configPath}.bak`)

  assert.equal(target, scope.configPath)
  assert.equal(await readFile(scope.configPath, "utf8"), backup)
  // The selected backup is replaced by the previous live file, matching the normal write path.
  assert.equal(await readFile(`${scope.configPath}.bak`, "utf8"), current)
  assert.deepEqual((await readScope(scope.paths)).errors, [])
})

test("restoreConfigBackup refuses invalid JSONC and leaves both files untouched", async (t) => {
  const current = `{\n  // keep me\n  "plugins": []\n}\n`
  const broken = `{ "plugins": [`
  const scope = await tempScope(t, current)
  await registryIn(t, scope.root)
  await writeFile(`${scope.configPath}.bak`, broken, "utf8")

  await assert.rejects(
    () => restoreConfigBackup("project", scope.root, `${scope.configPath}.bak`),
    /invalid JSONC/,
  )
  assert.equal(await readFile(scope.configPath, "utf8"), current)
  assert.equal(await readFile(`${scope.configPath}.bak`, "utf8"), broken)
})

test("restoreConfigBackup refuses a backup whose root is not a JSON object", async (t) => {
  const scope = await tempScope(t, `{\n  "plugins": []\n}\n`)
  await registryIn(t, scope.root)
  await writeFile(`${scope.configPath}.bak`, `[1, 2, 3]\n`, "utf8")

  await assert.rejects(
    () => restoreConfigBackup("project", scope.root, `${scope.configPath}.bak`),
    /root must be a JSON object/,
  )
})

test("previewMcp renders before and after without writing or creating a backup", async (t) => {
  const original = `{\n  // keep this comment\n  "mcp": { "servers": {} }\n}\n`
  const scope = await tempScope(t, original)

  const preview = await previewMcp(scope.paths, {
    name: "previewed",
    config: { type: "remote", url: "https://example.com/mcp" },
  })

  assert.equal(preview.before, original)
  assert.match(preview.after, /previewed/)
  assert.match(preview.after, /\/\/ keep this comment/)
  assert.equal(preview.path, scope.configPath)
  assert.equal(await readFile(scope.configPath, "utf8"), original)
  await assert.rejects(() => stat(`${scope.configPath}.bak`))
})

test("previewMcp does not create a missing config file", async (t) => {
  const scope = await tempScope(t)

  const preview = await previewMcp(scope.paths, {
    name: "new-server",
    config: { type: "local", command: ["echo", "hi"] },
  })

  assert.equal(preview.before, "")
  assert.match(preview.after, /new-server/)
  assert.equal(await isFile(scope.configPath), false)
})

test("previewMcp validates duplicate names exactly like saveMcp", async (t) => {
  const original = `{\n  "mcp": { "servers": { "one": { "type": "local", "command": ["echo"] } } }\n}\n`
  const scope = await tempScope(t, original)

  await assert.rejects(
    () =>
      previewMcp(scope.paths, {
        name: "one",
        config: { type: "local", command: ["echo", "other"] },
      }),
    /already exists/,
  )
  assert.equal(await readFile(scope.configPath, "utf8"), original)
})

test("ensureScope creates missing folders and an empty config without overwriting", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oem-ensure-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = await resolveScope("project", root)
  assert.equal(await isFile(paths.configPath), false)

  await ensureScope(paths)

  assert.equal(await isFile(paths.configPath), true)
  assert.equal(await readFile(paths.configPath, "utf8"), "{}\n")
  assert.deepEqual((await readScope(paths)).data, {})
  assert.equal(await isFile(path.join(paths.skillsDir, ".keep")), false)
  assert.equal((await stat(paths.skillsDir)).isDirectory(), true)

  const custom = `{\n  // untouched\n  "plugins": ["keep"]\n}\n`
  await writeFile(paths.configPath, custom, "utf8")
  const skillFile = path.join(paths.skillsDir, "keep.md")
  await writeFile(skillFile, "keep", "utf8")
  await ensureScope(paths)

  assert.equal(await readFile(paths.configPath, "utf8"), custom)
  assert.equal(await readFile(skillFile, "utf8"), "keep")
})

test("ensureScope leaves an existing config directory and file alone", async (t) => {
  const original = `{\n  // existing\n  "plugins": []\n}\n`
  const scope = await tempScope(t, original)

  await ensureScope(scope.paths)

  assert.equal(await readFile(scope.configPath, "utf8"), original)
  assert.equal((await stat(scope.paths.skillsDir)).isDirectory(), true)
})

test("writeDoctorReport writes readable Markdown and redacts credentials", async (t) => {
  const scope = await tempScope(t, `{\n  "plugins": []\n}\n`)
  const previous = process.env.OPENCODE_TEMP_DIR
  const directory = path.join(scope.root, "opencode-temp")
  process.env.OPENCODE_TEMP_DIR = directory
  t.after(() => {
    if (previous === undefined) delete process.env.OPENCODE_TEMP_DIR
    else process.env.OPENCODE_TEMP_DIR = previous
  })

  const report = await writeDoctorReport({
    scope: "project",
    paths: scope.paths,
    project: scope.root,
    state: {
      global: {
        root: "global",
        configDir: "global",
        configPath: "global/opencode.json",
        configExists: true,
        skillsDir: "global/skills",
      },
      project: {
        root: scope.root,
        configDir: scope.configDir,
        configPath: scope.configPath,
        configExists: true,
        skillsDir: scope.paths.skillsDir,
      },
      diagnostics: [
        {
          scope: "project",
          message:
            "failed https://user:hunter2@example.com/diag token=abc123 --token DEMO_SECRET Authorization=Bearer topsecret",
        },
      ],
      projectError: "project https://alice:swordfish@example.com/repo",
      marketplaceError: "marketplace token=feed-secret",
      mcp: [
        {
          scope: "project",
          name: "remote",
          config: {
            type: "remote",
            url: "https://user:hunter2@example.com/mcp?api_key=secret",
          },
        },
        {
          scope: "project",
          name: "local",
          config: {
            type: "local",
            command: ["demo-server", "--token", "DEMO_SECRET"],
          },
        },
      ],
      plugins: [{ scope: "project", index: 0, raw: "opencode-one", package: "opencode-one", removal: false }],
      skills: [],
      marketplaces: [],
      installedPlugins: [],
    },
  })

  assert.equal(path.dirname(report), directory)
  const text = await readFile(report, "utf8")
  assert.match(text, /# Extensions Manager — Doctor report/)
  assert.match(text, /## Diagnostics/)
  assert.match(text, /example diagnostic|failed https:\/\/\*\*\*@example\.com\/diag/)
  assert.match(text, /api_key=\*\*\*/)
  assert.doesNotMatch(text, /api_key=secret/)
  assert.doesNotMatch(text, /hunter2|swordfish|abc123|feed-secret|topsecret|DEMO_SECRET/)
  assert.match(text, /Authorization=\*\*\*/)
  assert.match(text, /https:\/\/\*\*\*@example\.com/)
})

test("writeAtomic keeps the existing POSIX mode", async (t) => {
  if (process.platform === "win32") return
  const scope = await tempScope(t)
  const file = path.join(scope.root, "mode.json")
  await writeFile(file, "{}\n", { mode: 0o640 })
  await writeAtomic(file, '{ "changed": true }\n')
  assert.equal((await stat(file)).mode & 0o777, 0o640)
  assert.equal((await stat(`${file}.bak`)).mode & 0o777, 0o640)
})

test("writeRegistry refuses to overwrite a corrupt registry", async (t) => {
  const scope = await tempScope(t)
  const registry = await registryIn(t, scope.root)
  const broken = "{ this is not json"
  await writeFile(registry, broken, "utf8")

  await assert.rejects(() => writeRegistry(normalizeRegistry({})), /Cannot modify registry/)
  assert.equal(await readFile(registry, "utf8"), broken)
})
