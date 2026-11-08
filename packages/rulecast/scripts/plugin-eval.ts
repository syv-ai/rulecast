import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Runs the Claude Code plugin's eval suite: `pnpm plugin-eval [claude plugin eval flags]`, such as
 * `pnpm plugin-eval --scaffold --allow-tools Edit Write`.
 *
 * The cases live in evals/rulecast-plugin/, not in the plugin: Claude Code installs a plugin by
 * copying its directory, and the suite is for maintainers, not for everyone who installs it. But
 * `claude plugin eval` only reads cases from inside the plugin (`--eval-dir` refuses `..`). So this
 * assembles the plugin and its cases in one working copy and runs the eval there. The copy's path
 * never changes, so Claude Code asks to trust it once, not on every run. Results are copied back
 * to evals/rulecast-plugin/results/, which is gitignored.
 */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
const plugin = path.join(repoRoot, "plugins/rulecast")
const cases = path.join(repoRoot, "evals/rulecast-plugin")
const work = path.join(repoRoot, "node_modules/.cache/rulecast-plugin-eval/rulecast")

rmSync(work, { recursive: true, force: true })
mkdirSync(path.dirname(work), { recursive: true })
cpSync(plugin, work, { recursive: true })
cpSync(cases, path.join(work, "evals"), {
  recursive: true,
  filter: (source) => path.basename(source) !== "results",
})

const run = spawnSync("claude", ["plugin", "eval", work, ...process.argv.slice(2)], { stdio: "inherit" })

const results = path.join(work, "evals/results")
if (existsSync(results)) {
  cpSync(results, path.join(cases, "results"), { recursive: true })
  process.stdout.write(`results: ${path.relative(process.cwd(), path.join(cases, "results"))}\n`)
}
if (run.error) {
  process.stderr.write(`rulecast: could not run claude: ${run.error.message}\n`)
  process.exit(2)
}
process.exit(run.status ?? 1)
