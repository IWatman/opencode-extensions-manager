import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import {
  applySelfUpdate,
  checkSelfUpdate,
  githubRepoFromUrl,
  parseCommitLog,
  parseRemoteTags,
  parseStableTag,
  readSelfUpdateHistory,
  recordSelfUpdateHistory,
  rollbackSelfUpdate,
  selectStableTag,
  selfUpdateInfo,
  shortCommit,
  SELF_UPDATE_CHANGELOG_LIMIT,
  SELF_UPDATE_HISTORY_LIMIT,
} from "../src/self-update.ts"

const exec = promisify(execFile)

async function git(cwd: string, args: readonly string[]) {
  const { stdout } = await exec("git", [...args], { cwd, windowsHide: true })
  return stdout.trim()
}

async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

test("githubRepoFromUrl normalizes common GitHub remote forms", () => {
  assert.equal(githubRepoFromUrl("https://github.com/owner/repo"), "owner/repo")
  assert.equal(githubRepoFromUrl("https://github.com/owner/repo.git"), "owner/repo")
  assert.equal(githubRepoFromUrl("git+https://github.com/Owner/Repo.git"), "owner/repo")
  assert.equal(githubRepoFromUrl("git@github.com:owner/repo.git"), "owner/repo")
  assert.equal(githubRepoFromUrl("github:owner/repo"), "owner/repo")
  assert.equal(githubRepoFromUrl("github.com/owner/repo"), "owner/repo")
  assert.equal(githubRepoFromUrl("owner/repo"), "owner/repo")
  assert.equal(githubRepoFromUrl("https://gitlab.com/owner/repo"), undefined)
  assert.equal(githubRepoFromUrl(""), undefined)
})

test("shortCommit shortens long hashes only", () => {
  assert.equal(shortCommit("0123456789abcdef"), "0123456")
  assert.equal(shortCommit("abc123"), "abc123")
  assert.equal(shortCommit(undefined), undefined)
})

test("parseCommitLog parses fields and enforces the changelog limit", () => {
  const lines = Array.from(
    { length: SELF_UPDATE_CHANGELOG_LIMIT + 5 },
    (_, index) =>
      `${String(index).padStart(40, "a")}\u001f2026-11-${String(10 - (index % 9)).padStart(2, "0")}T10:00:00Z\u001fchange ${index}`,
  )
  const all = parseCommitLog(lines.join("\n"))
  assert.equal(all.length, SELF_UPDATE_CHANGELOG_LIMIT)
  assert.equal(all[0]?.message, "change 0")
  assert.equal(all[0]?.sha.length, 40)
  assert.match(all[0]?.date ?? "", /^2026-11-/)
  assert.equal(all.at(-1)?.message, `change ${SELF_UPDATE_CHANGELOG_LIMIT - 1}`)

  const bounded = parseCommitLog(lines.join("\r\n"), 3)
  assert.deepEqual(
    bounded.map((item) => item.message),
    ["change 0", "change 1", "change 2"],
  )
  assert.deepEqual(parseCommitLog("", 3), [])
  assert.deepEqual(parseCommitLog("broken line"), [])
})

test("stable channel selects the highest semver tag and ignores other tags", () => {
  assert.equal(parseStableTag("v1.2.3")?.version, "1.2.3")
  assert.equal(parseStableTag("0.2.0")?.version, "0.2.0")
  assert.equal(parseStableTag("release-1.0.0"), undefined)
  assert.equal(parseStableTag("v1.2")?.version, undefined)

  assert.equal(selectStableTag(["v0.2.0", "0.9.0", "v1.0.0", "v0.10.0"]), "v1.0.0")
  assert.equal(selectStableTag(["v1.0.0", "1.0.0"]), "v1.0.0")
  assert.equal(selectStableTag(["v1.0.0-beta.1", "v0.9.0"]), "v0.9.0")
  assert.equal(selectStableTag(["nightly", "v1.0.0-rc.1"]), undefined)
  assert.equal(selectStableTag([]), undefined)

  assert.deepEqual(
    parseRemoteTags(
      [
        "0123456789abcdef\trefs/tags/v1.0.0",
        "abcdef0123456789\trefs/tags/0.9.0",
        "aaaabbbbccccdddd\trefs/heads/main",
        "",
      ].join("\n"),
    ),
    ["v1.0.0", "0.9.0"],
  )
})

test("update history keeps the newest entries and tolerates a broken file", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oem-self-update-history-"))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const file = path.join(root, "nested", "extensions-manager-updates.json")

  assert.deepEqual(await readSelfUpdateHistory(file), [])

  for (let index = 0; index < SELF_UPDATE_HISTORY_LIMIT + 5; index += 1) {
    await recordSelfUpdateHistory(
      {
        commit: `${index}`.padStart(40, "0"),
        version: `1.0.${index}`,
        at: new Date(2026, 0, index + 1).toISOString(),
        action: index % 2 === 0 ? "update" : "rollback",
        ...(index > 0 ? { previousCommit: `${index - 1}`.padStart(40, "0") } : {}),
        ...(index === SELF_UPDATE_HISTORY_LIMIT + 4 ? { note: "latest" } : {}),
      },
      file,
    )
  }

  const entries = await readSelfUpdateHistory(file)
  assert.equal(entries.length, SELF_UPDATE_HISTORY_LIMIT)
  assert.equal(entries[0]?.version, `1.0.${SELF_UPDATE_HISTORY_LIMIT + 4}`)
  assert.equal(entries[0]?.note, "latest")
  assert.equal(entries[0]?.action, "update")
  assert.equal(entries.at(-1)?.version, "1.0.5")

  await writeFile(file, "not json", "utf8")
  assert.deepEqual(await readSelfUpdateHistory(file), [])

  await writeJson(file, {
    entries: [
      { commit: "zzz", version: "1.0.0", at: "not a date", action: "update" },
      {
        commit: "a".repeat(40),
        version: "1.0.0",
        at: "2026-01-01T00:00:00.000Z",
        action: "update",
      },
    ],
  })
  const recovered = await readSelfUpdateHistory(file)
  assert.equal(recovered.length, 1)
  assert.equal(recovered[0]?.commit, "a".repeat(40))
})

test("self-update detects a checkout behind origin/main and can fast-forward it", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oem-self-update-"))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const remote = path.join(root, "remote.git")
  const work = path.join(root, "work")
  const publisher = path.join(root, "publisher")
  const remoteKey = remote.replaceAll("\\", "/")
  const official = "https://github.com/acme/test.git"
  const configureRewrite = async (cwd: string) => {
    await git(cwd, ["config", `url.${remoteKey}.insteadOf`, official])
  }

  await git(root, ["init", "--bare", remote])
  await mkdir(work)
  await git(work, ["init", "-b", "main"])
  await git(work, ["config", "user.name", "Test"])
  await git(work, ["config", "user.email", "test@example.com"])
  await writeJson(path.join(work, "package.json"), {
    name: "opencode-extensions-manager",
    version: "1.0.0",
    repository: "https://github.com/acme/test",
    scripts: { build: 'node -e "process.exit(0)"' },
  })
  await writeFile(path.join(work, "README.md"), "first\n", "utf8")
  await writeFile(path.join(work, ".gitignore"), "node_modules/\npackage-lock.json\ndist/\n", "utf8")
  await git(work, ["add", "."])
  await git(work, ["commit", "-m", "initial"])
  await git(work, ["remote", "add", "origin", official])
  await configureRewrite(work)
  await git(work, ["push", "-u", "origin", "main"])
  await git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"])

  await git(root, ["clone", remote, publisher])
  await git(publisher, ["config", "user.name", "Publisher"])
  await git(publisher, ["config", "user.email", "publisher@example.com"])
  await git(publisher, ["remote", "set-url", "origin", official])
  await configureRewrite(publisher)
  await writeJson(path.join(publisher, "package.json"), {
    name: "opencode-extensions-manager",
    version: "1.1.0",
    repository: "https://github.com/acme/test",
    scripts: { build: 'node -e "process.exit(0)"' },
  })
  await writeFile(path.join(publisher, "README.md"), "second\n", "utf8")
  await git(publisher, ["add", "."])
  await git(publisher, ["commit", "-m", "second"])
  await git(publisher, ["push", "origin", "main"])

  const info = await selfUpdateInfo(
    { name: "OpenCode", version: "2.2.6", channel: "stable" },
    work,
    "acme/test",
  )
  assert.equal(info.install.kind, "git")
  assert.equal(info.install.branch, "main")
  assert.equal(info.install.dirty, false)
  assert.equal(info.install.canUpdate, true)
  assert.equal(info.repository, "https://github.com/acme/test")

  const check = await checkSelfUpdate(work, "acme/test")
  assert.equal(check.updateAvailable, true)
  assert.equal(check.canUpdate, true)
  assert.equal(check.behind, 1)
  assert.equal(check.ahead, 0)
  assert.equal(check.currentVersion, "1.0.0")
  assert.equal(check.latestVersion, "1.1.0")
  assert.equal(check.commits?.length, 1)
  assert.equal(check.commits?.[0]?.message, "second")

  const stableWithoutTags = await checkSelfUpdate(work, "acme/test", "stable")
  assert.equal(stableWithoutTags.updateAvailable, false)
  assert.equal(stableWithoutTags.canUpdate, false)
  assert.match(stableWithoutTags.reason ?? "", /No stable release tags/)

  const historyFile = path.join(root, "updates", "extensions-manager-updates.json")
  const result = await applySelfUpdate(work, "acme/test", "main", historyFile)
  assert.equal(result.ok, true)
  assert.equal(result.restartRequired, true)
  assert.equal(result.version, "1.1.0")
  assert.equal(await git(work, ["rev-parse", "HEAD"]), await git(publisher, ["rev-parse", "HEAD"]))

  const history = await readSelfUpdateHistory(historyFile)
  assert.equal(history.length, 1)
  assert.equal(history[0]?.action, "update")
  assert.equal(history[0]?.commit, result.commit)
  assert.equal(history[0]?.previousCommit, result.previousCommit)
  assert.equal(history[0]?.version, "1.1.0")

  const after = await checkSelfUpdate(work, "acme/test")
  assert.equal(after.updateAvailable, false)
  assert.equal(after.behind, 0)
  assert.equal(after.commits?.length, 0)
})

test("stable channel checks and applies the highest release tag", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oem-self-update-stable-"))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const remote = path.join(root, "remote.git")
  const work = path.join(root, "work")
  const publisher = path.join(root, "publisher")
  const remoteKey = remote.replaceAll("\\", "/")
  const official = "https://github.com/acme/stable.git"
  const configureRewrite = async (cwd: string) => {
    await git(cwd, ["config", `url.${remoteKey}.insteadOf`, official])
  }

  await git(root, ["init", "--bare", remote])
  await mkdir(work)
  await git(work, ["init", "-b", "main"])
  await git(work, ["config", "user.name", "Test"])
  await git(work, ["config", "user.email", "test@example.com"])
  await writeJson(path.join(work, "package.json"), {
    name: "opencode-extensions-manager",
    version: "1.0.0",
    repository: "https://github.com/acme/stable",
    scripts: { build: 'node -e "process.exit(0)"' },
  })
  await writeFile(path.join(work, "README.md"), "first\n", "utf8")
  await git(work, ["add", "."])
  await git(work, ["commit", "-m", "first"])
  await git(work, ["tag", "v1.0.0"])
  await git(work, ["remote", "add", "origin", official])
  await configureRewrite(work)
  await git(work, ["push", "-u", "origin", "main", "--tags"])
  await git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"])

  await git(root, ["clone", remote, publisher])
  await git(publisher, ["config", "user.name", "Publisher"])
  await git(publisher, ["config", "user.email", "publisher@example.com"])
  await git(publisher, ["remote", "set-url", "origin", official])
  await configureRewrite(publisher)
  await writeFile(path.join(publisher, "README.md"), "second\n", "utf8")
  await git(publisher, ["add", "."])
  await git(publisher, ["commit", "-m", "second"])
  await git(publisher, ["tag", "v1.1.0"])
  await git(publisher, ["push", "origin", "main", "--tags"])

  const check = await checkSelfUpdate(work, "acme/stable", "stable")
  assert.equal(check.updateAvailable, true)
  assert.equal(check.canUpdate, true)
  assert.equal(check.latestVersion, "1.1.0")
  assert.equal(check.latestMessage, "second")
  assert.equal(check.commits?.length, 1)
  assert.equal(check.commits?.[0]?.message, "second")

  const historyFile = path.join(root, "updates.json")
  const result = await applySelfUpdate(work, "acme/stable", "stable", historyFile)
  assert.equal(result.ok, true)
  assert.equal(result.restartRequired, true)
  assert.equal(await git(work, ["rev-parse", "HEAD"]), await git(publisher, ["rev-parse", "HEAD"]))

  const history = await readSelfUpdateHistory(historyFile)
  assert.equal(history[0]?.action, "update")
  assert.equal(history[0]?.note, "stable v1.1.0")

  const after = await checkSelfUpdate(work, "acme/stable", "stable")
  assert.equal(after.updateAvailable, false)
  assert.equal(after.commits?.length, 0)
})

test("rollback validates the checkout and the target, then records the rollback", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oem-self-update-rollback-"))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const remote = path.join(root, "remote.git")
  const work = path.join(root, "work")
  const remoteKey = remote.replaceAll("\\", "/")
  const official = "https://github.com/acme/rollback.git"

  await git(root, ["init", "--bare", remote])
  await mkdir(work)
  await git(work, ["init", "-b", "main"])
  await git(work, ["config", "user.name", "Test"])
  await git(work, ["config", "user.email", "test@example.com"])
  await writeJson(path.join(work, "package.json"), {
    name: "opencode-extensions-manager",
    version: "1.0.0",
    repository: "https://github.com/acme/rollback",
    scripts: { build: 'node -e "process.exit(0)"' },
  })
  await writeFile(path.join(work, "README.md"), "first\n", "utf8")
  await git(work, ["add", "."])
  await git(work, ["commit", "-m", "first"])
  const first = await git(work, ["rev-parse", "HEAD"])
  await git(work, ["remote", "add", "origin", official])
  await git(work, ["config", `url.${remoteKey}.insteadOf`, official])
  await git(work, ["push", "-u", "origin", "main"])
  await git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"])

  await writeFile(path.join(work, "README.md"), "second\n", "utf8")
  await git(work, ["add", "."])
  await git(work, ["commit", "-m", "second"])
  await git(work, ["push", "origin", "main"])

  await writeFile(path.join(work, "README.md"), "third\n", "utf8")
  await git(work, ["add", "."])
  await git(work, ["commit", "-m", "third"])
  const third = await git(work, ["rev-parse", "HEAD"])
  await git(work, ["push", "origin", "main"])

  await git(work, ["checkout", "-b", "side", first])
  await writeFile(path.join(work, "side.txt"), "side\n", "utf8")
  await git(work, ["add", "."])
  await git(work, ["commit", "-m", "side"])
  const side = await git(work, ["rev-parse", "HEAD"])
  await git(work, ["checkout", "main"])

  const historyFile = path.join(root, "updates.json")
  const invalid = await rollbackSelfUpdate("main", work, "acme/rollback", historyFile)
  assert.equal(invalid.ok, false)
  assert.match(invalid.error ?? "", /valid commit SHA/)

  await writeFile(path.join(work, "dirty.txt"), "dirty\n", "utf8")
  const dirty = await rollbackSelfUpdate(first, work, "acme/rollback", historyFile)
  assert.equal(dirty.ok, false)
  assert.match(dirty.error ?? "", /local changes/)
  assert.equal(await git(work, ["rev-parse", "HEAD"]), third)
  await rm(path.join(work, "dirty.txt"), { force: true })

  const nonAncestor = await rollbackSelfUpdate(side, work, "acme/rollback", historyFile)
  assert.equal(nonAncestor.ok, false)
  assert.match(nonAncestor.error ?? "", /not an ancestor/)
  assert.equal(await git(work, ["rev-parse", "HEAD"]), third)

  const result = await rollbackSelfUpdate(first, work, "acme/rollback", historyFile)
  assert.equal(result.ok, true)
  assert.equal(result.previousCommit, third)
  assert.equal(result.commit, first)
  assert.equal(result.restartRequired, true)
  assert.equal(await git(work, ["rev-parse", "HEAD"]), first)

  const history = await readSelfUpdateHistory(historyFile)
  assert.equal(history.length, 1)
  assert.equal(history[0]?.action, "rollback")
  assert.equal(history[0]?.commit, first)
  assert.equal(history[0]?.previousCommit, third)

  const after = await checkSelfUpdate(work, "acme/rollback")
  assert.equal(after.updateAvailable, true)
  assert.equal(after.behind, 2)
  assert.equal(after.commits?.length, 2)
})
