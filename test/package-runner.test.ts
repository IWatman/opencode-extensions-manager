import test from "node:test"
import assert from "node:assert/strict"
import { isPackageRunner, packageRunnerSpec, prewarmPackageRunner } from "../src/package-runner.ts"

test("packageRunnerSpec reads the package from npx-style commands", () => {
  assert.equal(packageRunnerSpec(["npx", "-y", "computer-use-mcp"]), "computer-use-mcp")
  assert.equal(packageRunnerSpec(["npx", "--yes", "@scope/server"]), "@scope/server")
  assert.equal(packageRunnerSpec(["npx", "--", "left-pad"]), "left-pad")
  assert.equal(packageRunnerSpec(["npx", "-y", "-p", "some-package", "some-command"]), "some-package")
  assert.equal(
    packageRunnerSpec(["C:\\Program Files\\nodejs\\npx.cmd", "-y", "computer-use-mcp"]),
    "computer-use-mcp",
  )
})

test("packageRunnerSpec reads npm exec, bunx, pnpm dlx, and yarn dlx", () => {
  assert.equal(packageRunnerSpec(["npm", "exec", "--yes", "computer-use-mcp"]), "computer-use-mcp")
  assert.equal(packageRunnerSpec(["npm", "x", "--yes", "--package=some-package", "--", "node", "-e", ""]), "some-package")
  assert.equal(packageRunnerSpec(["bunx", "computer-use-mcp"]), "computer-use-mcp")
  assert.equal(packageRunnerSpec(["pnpm", "dlx", "computer-use-mcp"]), "computer-use-mcp")
  assert.equal(packageRunnerSpec(["yarn", "dlx", "@scope/server"]), "@scope/server")
})

test("packageRunnerSpec ignores ordinary commands and missing packages", () => {
  assert.equal(packageRunnerSpec(["node", "server.js"]), undefined)
  assert.equal(packageRunnerSpec(["npx"]), undefined)
  assert.equal(packageRunnerSpec(["npm", "install"]), undefined)
  assert.equal(packageRunnerSpec(["pnpm", "run", "dev"]), undefined)
  assert.equal(packageRunnerSpec([]), undefined)
  assert.equal(isPackageRunner(["npx", "-y", "computer-use-mcp"]), true)
  assert.equal(isPackageRunner(["node", "server.js"]), false)
})

test("prewarmPackageRunner skips specs with shell metacharacters", async () => {
  assert.equal(await prewarmPackageRunner(["npx", "-y", "foo&calc"]), undefined)
  assert.equal(await prewarmPackageRunner(["node", "server.js"]), undefined)
})
