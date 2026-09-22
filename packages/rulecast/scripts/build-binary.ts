import { execFile } from "node:child_process"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const exec = promisify(execFile)
const packageDir = fileURLToPath(new URL("../", import.meta.url))

/**
 * The platforms 0.1 ships, as `<os>-<arch>`. Each is built on its own runner: `bun build --compile
 * --target=…` would embed whatever `@ast-grep/napi` resolved on the *building* machine, so a Linux
 * binary cross-compiled on macOS carries the darwin .node and dies at the first ast-grep rule —
 * in a way no test on the build machine can see. .github/workflows use these exact strings.
 *
 * No Windows: core/which.ts and detectors/linter/resolve.ts shell out to /bin/sh, commands/spawn.ts
 * assumes POSIX detached spawning, and nothing in the suite would catch a regression there.
 */
export const BINARY_RUNNERS = {
  "linux-x64": "ubuntu-latest",
  "linux-arm64": "ubuntu-24.04-arm",
  "darwin-arm64": "macos-latest",
  // macos-13 was retired on 2025-12-04; macos-15-intel is the Intel image.
  "darwin-x64": "macos-15-intel",
} as const

export const BINARY_TARGETS = Object.keys(BINARY_RUNNERS) as [BinaryTarget, ...BinaryTarget[]]
export type BinaryTarget = keyof typeof BINARY_RUNNERS

/** The target this machine builds for. Throws rather than guessing on a platform 0.1 does not ship. */
export function hostTarget(platform: string = process.platform, arch: string = process.arch): BinaryTarget {
  const target = `${platform}-${arch}`
  if (!(BINARY_TARGETS as readonly string[]).includes(target)) {
    throw new Error(`rulecast does not ship a binary for ${target} (targets: ${BINARY_TARGETS.join(", ")})`)
  }
  return target as BinaryTarget
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = hostTarget()
  // Not dist/: package.json's `files` is ["dist"], so a binary left there would be published to
  // npm as a 65 MB tarball the next time anyone ran `pnpm binary` before `pnpm publish`.
  const outfile = path.join(packageDir, "binaries", `rulecast-${target}`)
  await mkdir(path.dirname(outfile), { recursive: true })
  await exec("pnpm", ["build"], { cwd: packageDir })
  await exec("bun", ["build", path.join(packageDir, "dist/cli.js"), "--compile", "--outfile", outfile])
  const { size } = await stat(outfile)
  process.stdout.write(`${outfile}\n${(size / 1024 / 1024).toFixed(1)} MB\n`)
}
