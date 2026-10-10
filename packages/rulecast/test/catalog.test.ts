import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import { generateManifest } from "../scripts/manifest"
import { compileManifest } from "../src/core/compile/project"
import { type CompiledRule, isDetectorRule } from "../src/core/compile/rule"
import { defaultConfig } from "../src/core/config/schema"
import { memoryCache } from "../src/core/detection/cache"
import { runExamples } from "../src/core/examples"
import { runPipeline } from "../src/core/pipeline"
import { defaultDetectorSettings } from "../src/core/types"
import { registry } from "./helpers/fixture"
import { stateDirFor } from "./helpers/home"
import { stubAgentCli } from "./helpers/llm"
import { createProject } from "./helpers/project"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))

const CATALOG = [
  "generated-code",
  "python/no-httpexception-in-services",
  "python/no-queries-in-services",
  "python/layering",
  "python/no-silent-except",
  "python/thin-routes",
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
  // A route layer is not always a routes/ directory: the second drafting trial's app/api/routes.py
  // never got the layering section. thin-routes already names app/api and app/routers.
  { rule: "python/layering", kind: "touch", file: "app/api/routes.py", content: "x = 1\n", fires: true },
  { rule: "python/layering", kind: "touch", file: "app/routers/users.py", content: "x = 1\n", fires: true },
  { rule: "python/layering", kind: "touch", file: "app/crud.py", content: "x = 1\n", fires: true },
  { rule: "python/layering", kind: "touch", file: "tests/api/test_users.py", content: "x = 1\n", fires: false },
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
  // An llm rule's judgement belongs to the model, so what the catalog can check is that it is
  // wired up: the right files reach it, and a finding renders through {{reason}}. The stub answers
  // for whatever rule the prompt names, so the quiet case is a file the rule does not select.
  {
    rule: "python/thin-routes",
    kind: "verify",
    file: "app/api/users.py",
    content: "@router.get('/users')\ndef list_users(session):\n    return session.exec(select(User)).all()\n",
    fires: true,
  },
  {
    rule: "python/thin-routes",
    kind: "verify",
    file: "app/services/users.py",
    content: SERVICE_OK,
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

describe("catalog rule examples", () => {
  let rules: CompiledRule[] = []
  beforeAll(async () => {
    rules = (await compileManifest(repoRoot, registry)).rules
  })

  test("every rule with a detector carries examples, except the llm one", () => {
    for (const rule of rules.filter(isDetectorRule)) {
      const expected = rule.detector.kind !== "llm"
      expect(rule.examples !== null && rule.examples.bad.length > 0, `${rule.id} has bad examples`).toBe(expected)
    }
  })

  test.each(
    // A published rule's examples are the executable half of its documentation: a consumer who
    // overrides `files` or the pattern needs them to check the override, and this is what stops a
    // pattern tightened later from silently ceasing to match.
    CATALOG.filter((id) => id !== "python/thin-routes"),
  )("%s passes its own examples", async (id) => {
    const rule = rules.find((one) => one.id === id)
    expect(rule, id).toBeDefined()
    if (rule === undefined) return
    if (!isDetectorRule(rule)) {
      // A touch rule has nothing to run: `examples` on one is a compile diagnostic, so the check
      // here is that it does not have any rather than a silent skip.
      expect(rule.examples, `${id} is a touch rule`).toBeNull()
      return
    }
    const root = await createProject({})
    const result = await runExamples({
      detection: {
        root,
        registry,
        settings: defaultDetectorSettings(),
        cacheFor: () => memoryCache(),
        contextFor: async () => [],
      },
      rule,
      timeoutMs: 60_000,
    })
    const failures = result.outcomes
      .filter((outcome) => !outcome.passed)
      .map((outcome) => `${outcome.kind}[${outcome.index}] ${outcome.error ?? outcome.findings.length} findings`)
    expect(failures).toEqual([])
  })
})

describe("catalog rules", () => {
  let rules: CompiledRule[] = []
  beforeAll(async () => {
    rules = (await compileManifest(repoRoot, registry)).rules
  })
  // No case may reach a real model: the stub below is found by absolute path in each fixture's
  // node_modules/.bin, and a PATH without claude on it closes the fallback.
  beforeEach(() => vi.stubEnv("PATH", "/usr/bin:/bin"))
  afterEach(() => vi.unstubAllEnvs())

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
    await stubAgentCli(root, "claude")
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
