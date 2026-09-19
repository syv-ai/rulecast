import { existsSync, statSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { compile } from "../core/compile/project"
import { readConfigData, readManifest } from "../core/config/load"
import type { DetectorRegistry } from "../core/detection/registry"
import { fetchCheckout } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import { fixedRepo } from "../core/repos/provider"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { executeRun, parseRunArgs } from "./run"
import { UsageError } from "./usage"

const isDirectory = (file: string) => existsSync(file) && statSync(file).isDirectory()

/** A working tree (".git") or a bare repository ("HEAD"): a local path git can fetch a rev from. */
const isGitRepo = (dir: string) => existsSync(path.join(dir, ".git")) || existsSync(path.join(dir, "HEAD"))

/** The project's config data with its settings kept, or {} outside a project. */
async function baseConfigData(root: string): Promise<Record<string, unknown>> {
  if (!hasProject(root)) return {}
  const data = await readConfigData(root)
  if (!data.ok) throw new Error(data.message)
  return typeof data.value === "object" && data.value !== null && !Array.isArray(data.value)
    ? (data.value as Record<string, unknown>)
    : {}
}

/** Runs a rule repo's rules (all, or one) against the project without editing its config. */
export async function tryRepoCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const run = parseRunArgs(args)
  const [repo, ruleId, ...extra] = run.leading
  if (repo === undefined) throw new UsageError("try-repo needs a repository path or URL")
  if (extra.length > 0) throw new UsageError(`unexpected arguments: ${extra.join(" ")}`)

  const local = path.resolve(io.cwd, repo)
  const directory = isDirectory(local)
  if (directory && run.ref !== null && !isGitRepo(local)) throw new UsageError("--ref only applies to URLs")
  // A directory is used as it is on disk, so rule authors see their uncommitted edits; --ref fetches instead.
  const fromDirectory = directory && run.ref === null
  const rev = fromDirectory ? "working-tree" : (run.ref ?? "HEAD")
  const temp = fromDirectory ? null : await mkdtemp(path.join(tmpdir(), "rulecast-try-repo-"))
  try {
    const dir = temp ?? local
    // git runs inside the temp checkout, so a local path must be the one resolved against the caller's cwd.
    if (temp !== null) await fetchCheckout(directory ? local : repo, rev, temp)
    const label = fromDirectory ? `${path.basename(local)}@${rev}` : repoLabel(repo, rev)

    const manifest = await readManifest(dir)
    if (!manifest.ok) throw new Error(`${label}: ${manifest.message}`)
    const ids = manifest.value.flatMap((rule) => {
      const id = (rule as { id?: unknown } | null)?.id
      return typeof id === "string" ? [id] : []
    })
    if (ruleId !== undefined && !ids.includes(ruleId)) throw new UsageError(`no rule "${ruleId}" in ${label}`)

    const configData = {
      ...(await baseConfigData(root)),
      repos: [{ repo, rev, rules: (ruleId === undefined ? ids : [ruleId]).map((id) => ({ id })) }],
    }
    const project = await compile({ root, registry, repos: fixedRepo(dir, label), configData })
    return await executeRun({ project, ruleId: null, run, registry, io })
  } finally {
    if (temp !== null) await rm(temp, { recursive: true, force: true })
  }
}
