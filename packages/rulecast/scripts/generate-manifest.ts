import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { generateManifest } from "./manifest"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
const target = path.join(repoRoot, ".rulecast-rules.yaml")
const manifest = await generateManifest(repoRoot)

if (process.argv.includes("--check")) {
  const committed = await readFile(target, "utf8").catch(() => null)
  if (committed !== manifest) {
    process.stderr.write(".rulecast-rules.yaml is stale: run pnpm manifest\n")
    process.exitCode = 1
  }
} else {
  await writeFile(target, manifest)
  process.stdout.write("wrote .rulecast-rules.yaml\n")
}
