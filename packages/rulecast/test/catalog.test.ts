import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, test } from "vitest"

import { generateManifest } from "../scripts/manifest"
import { compileManifest } from "../src/core/compile/project"
import type { CompiledRule } from "../src/core/compile/rule"
import { defaultConfig } from "../src/core/config/schema"
import { runPipeline } from "../src/core/pipeline"
import { registry } from "./helpers/fixture"
import { stateDirFor } from "./helpers/home"
import { createProject } from "./helpers/project"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))

const CATALOG = [
  "generated-code",
  "python/no-httpexception-in-services",
  "python/no-queries-in-services",
  "python/layering",
  "python/no-silent-except",
  "react/no-fetch-in-components",
  "react/data-fetching",
  "react/no-inline-style",
]

interface Case {
  rule: string
  /** verify runs detectors; touch fires touch rules. */
  kind: "verify" | "touch"
  file: string
  content: string
  fires: boolean
}

const SERVICE_OK = "def get_user(session, user_id):\n    return crud.get_user(session, user_id)\n"
const COMPONENT_OK = "export function UserList() {\n  const { data } = useUsers()\n  return <List items={data} />\n}\n"

const cases: Case[] = [
  {
    rule: "generated-code",
    kind: "verify",
    file: "frontend/src/client/sdk.gen.ts",
    content: "export {}\n",
    fires: true,
  },
  { rule: "generated-code", kind: "verify", file: "src/__generated__/schema.ts", content: "export {}\n", fires: true },
  { rule: "generated-code", kind: "verify", file: "frontend/src/client.ts", content: "export {}\n", fires: false },
  {
    rule: "python/no-httpexception-in-services",
    kind: "verify",
    file: "app/services/users.py",
    content: "def get_user(session, user_id):\n    raise HTTPException(status_code=404)\n",
    fires: true,
  },
  {
    rule: "python/no-httpexception-in-services",
    kind: "verify",
    file: "app/services/users.py",
    content: "def get_user(session, user_id):\n    raise UserNotFound(user_id)\n",
    fires: false,
  },
  {
    rule: "python/no-httpexception-in-services",
    kind: "verify",
    file: "app/api/routes/users.py",
    content: "def read_user(user_id):\n    raise HTTPException(status_code=404)\n",
    fires: false,
  },
  {
    rule: "python/no-queries-in-services",
    kind: "verify",
    file: "app/services/users.py",
    content: "def list_users(session):\n    return session.exec(select(User)).all()\n",
    fires: true,
  },
  {
    rule: "python/no-queries-in-services",
    kind: "verify",
    file: "app/services/users.py",
    content: SERVICE_OK,
    fires: false,
  },
  { rule: "python/layering", kind: "touch", file: "app/services/users.py", content: SERVICE_OK, fires: true },
  { rule: "python/layering", kind: "touch", file: "app/models/user.py", content: "class User: ...\n", fires: false },
  {
    rule: "react/no-fetch-in-components",
    kind: "verify",
    file: "src/components/UserList.tsx",
    content: 'export async function load() {\n  return fetch("/api/users")\n}\n',
    fires: true,
  },
  {
    rule: "react/no-fetch-in-components",
    kind: "verify",
    file: "src/components/UserList.tsx",
    content: COMPONENT_OK,
    fires: false,
  },
  {
    rule: "react/no-fetch-in-components",
    kind: "verify",
    file: "src/hooks/useUsers.ts",
    content: 'export const listUsers = () => fetch("/api/users")\n',
    fires: false,
  },
  {
    rule: "react/data-fetching",
    kind: "touch",
    file: "src/components/UserList.tsx",
    content: COMPONENT_OK,
    fires: true,
  },
  { rule: "react/data-fetching", kind: "touch", file: "src/utils/format.ts", content: "export {}\n", fires: false },
  {
    rule: "python/no-silent-except",
    kind: "verify",
    file: "app/services/users.py",
    content: "def get():\n    try:\n        fetch()\n    except ValueError:\n        pass\n",
    fires: true,
  },
  {
    rule: "python/no-silent-except",
    kind: "verify",
    file: "app/services/users.py",
    content: "def get():\n    try:\n        fetch()\n    except ValueError:\n        log.warning('missing')\n",
    fires: false,
  },
  {
    rule: "react/no-inline-style",
    kind: "verify",
    file: "src/components/Card.tsx",
    content: "export const Card = () => <div style={{ padding: 8 }}>x</div>\n",
    fires: true,
  },
  {
    rule: "react/no-inline-style",
    kind: "verify",
    file: "src/components/Card.tsx",
    content: 'export const Card = () => <div className="p-2">x</div>\n',
    fires: false,
  },
]

describe("the rulecast repository's rule manifest", () => {
  test("is up to date with packages/rules-*", async () => {
    const committed = await readFile(path.join(repoRoot, ".rulecast-rules.yaml"), "utf8")
    expect(committed, "run pnpm manifest").toBe(await generateManifest(repoRoot))
  })

  test("compiles without diagnostics", async () => {
    const { rules, diagnostics } = await compileManifest(repoRoot, registry)
    expect(diagnostics).toEqual([])
    expect(rules.map((rule) => rule.id)).toEqual(CATALOG)
  })
})

describe("catalog rules", () => {
  let rules: CompiledRule[] = []
  beforeAll(async () => {
    rules = (await compileManifest(repoRoot, registry)).rules
  })

  test("every rule has a case where it fires and one where it does not", () => {
    for (const id of CATALOG) {
      expect(
        cases.some((c) => c.rule === id && c.fires),
        `${id} fires`,
      ).toBe(true)
      expect(
        cases.some((c) => c.rule === id && !c.fires),
        `${id} stays quiet`,
      ).toBe(true)
    }
  })

  test.each(cases)("$rule on $file ($kind) fires: $fires", async ({ rule, kind, file, content, fires }) => {
    const root = await createProject({ [file]: content })
    const { delivery } = await runPipeline({
      project: { root, config: defaultConfig(), rules, diagnostics: [] },
      stateDir: stateDirFor(root),
      event: { kind, files: [file], cwd: root },
      registry,
      maxContextChars: null,
    })
    const fired =
      kind === "touch" ? delivery.touches.includes(rule) : delivery.findings.some((finding) => finding.rule === rule)
    expect(fired).toBe(fires)
  })
})
