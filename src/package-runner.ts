import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

/** OpenCode's default MCP startup timeout is 30 seconds, which is too short for a cold package install. */
export const PACKAGE_RUNNER_STARTUP_TIMEOUT = 180_000

const PREWARM_TIMEOUT = 5 * 60_000
const MAX_OUTPUT = 2 * 1024 * 1024

function executableName(value: unknown) {
  if (typeof value !== "string") return undefined
  return value.split(/[\\/]/).pop()?.toLowerCase().replace(/\.(cmd|exe|bat)$/, "")
}

function runnerStart(name: string, args: readonly string[]) {
  if (name === "npx" || name === "bunx" || name === "pnpx") return 0
  if (name === "npm" && (args[0] === "exec" || args[0] === "x")) return 1
  if ((name === "pnpm" || name === "yarn") && args[0] === "dlx") return 1
  return undefined
}

/**
 * Returns the package spec a command runner would install, for example `computer-use-mcp` from
 * `npx -y computer-use-mcp`. Commands that are not package runners return `undefined`.
 */
export function packageRunnerSpec(command: readonly unknown[]): string | undefined {
  const name = executableName(command[0])
  if (!name) return undefined
  const args = command.slice(1).filter((value): value is string => typeof value === "string")
  const start = runnerStart(name, args)
  if (start === undefined) return undefined

  const packages: string[] = []
  let positional: string | undefined
  const takesValue = new Set(["-p", "--package", "-c", "--call", "--node-options"])
  for (let index = start; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--") {
      // `npx -- package` / `npm exec -- package` still name a package after the option terminator.
      const value = args[index + 1]
      if (packages.length === 0 && !positional && value && !value.startsWith("-")) positional = value
      break
    }
    if (argument.startsWith("--package=")) {
      packages.push(argument.slice("--package=".length))
      continue
    }
    if (argument === "-p" || argument === "--package") {
      const value = args[index + 1]
      if (value && !value.startsWith("-")) {
        packages.push(value)
        index += 1
      }
      continue
    }
    if (argument.startsWith("-")) {
      if (takesValue.has(argument)) index += 1
      continue
    }
    if (!positional) positional = argument
  }
  return packages[0] ?? positional
}

/** True when the command starts a package through a known runner such as `npx` or `bunx`. */
export function isPackageRunner(command: readonly unknown[]) {
  return packageRunnerSpec(command) !== undefined
}

/** True when the command uses npm's `_npx` cache, which can be pre-filled before OpenCode starts it. */
function usesNpmCache(command: readonly unknown[]) {
  const name = executableName(command[0])
  const subcommand = typeof command[1] === "string" ? command[1] : ""
  return name === "npx" || (name === "npm" && (subcommand === "exec" || subcommand === "x"))
}

function runNpm(args: readonly string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string; message?: string }> {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm"
  const finalArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...args] : [...args]
  return new Promise((resolve) => {
    execFile(
      command,
      finalArgs,
      {
        cwd,
        timeout: PREWARM_TIMEOUT,
        windowsHide: true,
        maxBuffer: MAX_OUTPUT,
        env: {
          ...process.env,
          NO_COLOR: "1",
          npm_config_update_notifier: "false",
          npm_config_fund: "false",
        },
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          ...(error ? { message: error.message } : {}),
        })
      },
    )
  })
}

/**
 * Downloads a package-runner MCP before its config is written. This turns a slow first launch into
 * a visible installation step and prevents OpenCode from killing npm halfway through unpacking.
 * The package is installed into npm's shared `_npx` cache, so the later `npx` launch starts at once.
 */
export async function prewarmPackageRunner(command: readonly unknown[]): Promise<string | undefined> {
  const spec = packageRunnerSpec(command)
  if (!spec || !usesNpmCache(command)) return undefined
  // The spec comes from an inspected repository. Reject shell metacharacters instead of passing
  // them to cmd.exe; such specs simply skip prewarming and are handled by npm during the launch.
  if (/[\s"'`&|<>^%!]/.test(spec)) return undefined
  const cwd = await mkdtemp(path.join(tmpdir(), "oem-prewarm-"))
  try {
    const result = await runNpm(["exec", "--yes", `--package=${spec}`, "--", "node", "-e", "0"], cwd)
    if (result.code !== 0) {
      const detail = (result.stderr.trim() || result.stdout.trim() || result.message || "").slice(0, 4000)
      throw new Error(`Failed to download ${spec}: ${detail || `npm exited with code ${result.code}`}`)
    }
    return spec
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}
