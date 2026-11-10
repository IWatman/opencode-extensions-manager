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
  selfUpdateInfo,
  shortCommit,
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

  const result = await applySelfUpdate(work, "acme/test")
  assert.equal(result.ok, true)
  assert.equal(result.restartRequired, true)
  assert.equal(result.version, "1.1.0")
  assert.equal(await git(work, ["rev-parse", "HEAD"]), await git(publisher, ["rev-parse", "HEAD"]))

  const after = await checkSelfUpdate(work, "acme/test")
  assert.equal(after.updateAvailable, false)
  assert.equal(after.behind, 0)
})
