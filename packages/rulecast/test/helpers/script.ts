import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = fileURLToPath(new URL("../../", import.meta.url))

/** Runs one of packages/rulecast/scripts/*.ts with tsx and resolves its exit code. */
export function run(script: string, args: string[] = ["--check"]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(packageDir, "node_modules/.bin/tsx"), [script, ...args], {
      cwd: packageDir,
      stdio: "ignore",
    })
    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? -1))
  })
}
