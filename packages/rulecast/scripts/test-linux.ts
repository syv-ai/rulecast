import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Runs the suite on Linux, in the container image CI uses, because the machine most of this is
 * written on is macOS and the two disagree about things a test can reach for.
 *
 * The case that paid for this script: a test named /proc as a directory it could not write to.
 * macOS has no /proc, so it failed instantly and the suite passed in 13 s. Linux has one, and
 * touching it left the vitest worker unable to exit — every CI run hung until the six-hour job
 * timeout, and took the release workflow with it, because lefthook's pre-push runs the suite
 * inside the changesets action. Nothing on macOS could have caught it.
 *
 * Hence the timeout below: a hang here must fail in minutes and say so, not reproduce the thing
 * it is meant to detect.
 */

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)))

const IMAGE = process.env.RULECAST_LINUX_IMAGE ?? "node:24-bookworm"
/** Generous next to the suite's ~6 s on Linux, short enough that a hang is a coffee, not a day. */
const TIMEOUT_S = Number(process.env.RULECAST_LINUX_TIMEOUT ?? 420)
/** Repeat runs reuse the store instead of downloading the dependency tree again. */
const STORE_VOLUME = "rulecast-linux-pnpm-store"

const dim = (s: string) => `\u001B[2m${s}\u001B[0m`
const green = (s: string) => `\u001B[32m${s}\u001B[0m`
const red = (s: string) => `\u001B[31m${s}\u001B[0m`

function has(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0
}

if (!has("docker", ["info"])) {
  process.stderr.write(
    `${red("✗")} docker is not available. Start Docker (or set RULECAST_LINUX_IMAGE for another runtime) and try again.\n`,
  )
  process.exit(2)
}

// The repository is mounted read-only and copied inside, so the run cannot touch the working tree
// and node_modules built for the host's platform never reach the container. `.git` goes too: it is
// a worktree pointer to a host path, and lefthook's `prepare` needs a repository it can install into.
const script = `
set -e
mkdir -p /work && cp -a /src/. /work/
cd /work
rm -rf node_modules packages/*/node_modules .git
git init -q . && git config user.email test@example.com && git config user.name test
corepack enable >/dev/null 2>&1
pnpm config set store-dir /pnpm-store --global >/dev/null 2>&1
echo "${dim("installing dependencies for linux…")}"
pnpm install --frozen-lockfile >/tmp/install.log 2>&1 || { tail -30 /tmp/install.log; exit 1; }
cd packages/rulecast
timeout -s KILL ${TIMEOUT_S} ./node_modules/.bin/vitest run ${process.argv.slice(2).join(" ")}
`

const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    `${root}:/src:ro`,
    "-v",
    `${STORE_VOLUME}:/pnpm-store`,
    ...(process.env.RULECAST_LINUX_PLATFORM ? ["--platform", process.env.RULECAST_LINUX_PLATFORM] : []),
    IMAGE,
    "sh",
    "-c",
    script,
  ],
  { stdio: "inherit" },
)

// 137 is the KILL from `timeout`: the suite did not finish, which is the failure this exists for.
if (result.status === 137) {
  process.stderr.write(
    `\n${red("✗")} the suite did not finish within ${TIMEOUT_S}s on Linux.\n` +
      `  It passes on macOS, so something in it depends on the platform — a path that exists only\n` +
      `  on Linux, or a child process that never exits. Re-run one directory at a time to find it:\n` +
      `    pnpm test:linux test/core/delivery\n`,
  )
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)
process.stdout.write(`\n${green("✓")} the suite passes on ${IMAGE}\n`)
