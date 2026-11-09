import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { TestContext } from "node:test"
import { resolveScope, type ScopePaths } from "../../src/config.ts"

export interface TempScope {
  /** Project root passed to `resolveScope`. */
  readonly root: string
  /** `<root>/.opencode`, the directory OpenCode loads for this project. */
  readonly configDir: string
  readonly paths: ScopePaths
  readonly configPath: string
}

/**
 * Creates an isolated project with an `.opencode` directory and an optional `opencode.jsonc`.
 * `t.after` removes the whole tree, so tests do not depend on the working directory.
 */
export async function tempScope(t: TestContext, config?: string): Promise<TempScope> {
  const root = await mkdtemp(path.join(tmpdir(), "oem-test-"))
  const configDir = path.join(root, ".opencode")
  await mkdir(configDir, { recursive: true })
  if (config !== undefined) await writeFile(path.join(configDir, "opencode.jsonc"), config, "utf8")
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const paths = await resolveScope("project", root)
  return { root, configDir, paths, configPath: paths.configPath }
}
