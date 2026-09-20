import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const payloads = fileURLToPath(new URL("../payloads/linter/", import.meta.url))

/** Where the detector looks first (spec §6): <root>/node_modules/.bin. */
function binDir(root: string): string {
  return path.join(root, "node_modules", ".bin")
}

/** The workspace's own copy of a tool, so a fixture can run the real thing. */
export function realTool(tool: string): string | null {
  const binary = path.resolve("node_modules", ".bin", tool)
  return existsSync(binary) ? binary : null
}

/**
 * Puts a real tool in the fixture's node_modules/.bin. It forwards rather than symlinking: pnpm's
 * .bin entries are shell shims that locate the package from their own path, so a symlink to one
 * resolves against the fixture and fails with MODULE_NOT_FOUND. `exec` keeps $0 at the real shim.
 *
 * Throws when the tool is not installed: a fixture must not quietly test nothing.
 */
export async function linkTool(root: string, tool: string): Promise<void> {
  const binary = realTool(tool)
  if (binary === null) throw new Error(`${tool} is not installed in the workspace; run pnpm install`)
  await mkdir(binDir(root), { recursive: true })
  const forwarder = path.join(binDir(root), tool)
  await writeFile(forwarder, `#!/bin/sh\nexec ${JSON.stringify(binary)} "$@"\n`)
  await chmod(forwarder, 0o755)
}

/** A stub that replays a recording and writes the argv it was called with to <root>/<tool>.argv. */
export async function stubTool(root: string, tool: string, options: { exitCode?: number } = {}): Promise<void> {
  const recording = (await readFile(path.join(payloads, `${tool}.json`), "utf8")).replaceAll("__ROOT__", root)
  await mkdir(binDir(root), { recursive: true })
  const output = path.join(binDir(root), `${tool}.recording.json`)
  await writeFile(output, recording)
  const script = path.join(binDir(root), tool)
  await writeFile(
    script,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" > "${path.join(root, `${tool}.argv`)}"`,
      `cat "${output}"`,
      // A linter that found something exits non-zero; the detector must ignore that.
      `exit ${options.exitCode ?? 1}`,
      "",
    ].join("\n"),
  )
  await chmod(script, 0o755)
}

/** The argv a stub was called with, as one space-joined line. */
export async function stubArgv(root: string, tool: string): Promise<string> {
  return (await readFile(path.join(root, `${tool}.argv`), "utf8")).trim()
}
