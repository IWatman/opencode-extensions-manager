import { build } from "esbuild"
import { rm } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const outfile = path.join("scripts", ".tmp-marketplace-smoke.mjs")
try {
  await build({
    entryPoints: ["scripts/marketplace-smoke.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["jsonc-parser"],
    outfile,
    logLevel: "silent",
  })
  await import(pathToFileURL(path.resolve(outfile)).href)
} finally {
  await rm(outfile, { force: true })
}
