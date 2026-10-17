import { cp, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const FIXTURE = path.join(import.meta.dirname, "..", "payloads", "claude-code", "transcripts")

/**
 * A Claude Code config directory holding the recorded-shape transcripts for `root`, with their
 * `/project` paths pointed at it. Pass it as CLAUDE_CONFIG_DIR.
 */
export async function transcriptsFor(root: string): Promise<string> {
  const configDir = await mkdtemp(path.join(tmpdir(), "rulecast-claude-"))
  const real = await realpath(root)
  const dir = path.join(configDir, "projects", real.replace(/[^A-Za-z0-9]/g, "-"))
  await cp(FIXTURE, dir, { recursive: true, filter: (source) => !source.endsWith("README.md") })
  for (const file of ["session.jsonl", "session/subagents/agent-a1.jsonl"]) {
    const target = path.join(dir, file)
    await writeFile(target, (await readFile(target, "utf8")).replaceAll("/project/", `${real}/`))
  }
  return configDir
}
