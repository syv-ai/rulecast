import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import { generateManifest } from "../scripts/manifest"
import { compileManifest } from "../src/core/compile/project"
import { type CompiledRule, isDetectorRule } from "../src/core/compile/rule"
import { ATTENDED } from "../src/core/config/mode"
import { defaultConfig } from "../src/core/config/schema"
import { memoryCache } from "../src/core/detection/cache"
import { runExamples } from "../src/core/examples"
import { runPipeline } from "../src/core/pipeline"
import { defaultDetectorSettings } from "../src/core/types"
import { registry } from "./helpers/fixture"
import { createRepo, git } from "./helpers/git"
import { stateDirFor } from "./helpers/home"
import { stubAgentCli } from "./helpers/llm"
import { createProject } from "./helpers/project"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))

const CATALOG = [
  "generated-code",
  "loop-safety/no-skipped-tests-python",
  "loop-safety/no-skipped-tests-ts",
  "loop-safety/no-skipped-tests-js",
  "loop-safety/no-new-suppressions",
  "loop-safety/no-lowered-thresholds",
  "loop-safety/protected-loop-config",
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
  {
    rule: "loop-safety/no-skipped-tests-python",
    kind: "verify",
    file: "tests/test_rates.py",
    content:
      "import unittest\n\nclass Rates(unittest.TestCase):\n    def test_fresh(self):\n        self.skipTest('no service')\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-skipped-tests-python",
    kind: "verify",
    file: "tests/test_rates.py",
    content: "pytestmark = pytest.mark.slow\nyaml = pytest.importorskip('yaml')\n",
    fires: false,
  },
  // A skip outside a test file is not this rule's business: app code may have a `skip` of its own.
  {
    rule: "loop-safety/no-skipped-tests-python",
    kind: "verify",
    file: "app/pagination.py",
    content: "def page(items, mark):\n    return mark.skip(items)\n",
    fires: false,
  },
  {
    rule: "loop-safety/no-skipped-tests-ts",
    kind: "verify",
    file: "src/cart.spec.ts",
    content: "test.describe.skip('cart', () => {})\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-skipped-tests-ts",
    kind: "verify",
    file: "src/cart.ts",
    content: "export const page = (items: number[]) => items.slice(1)\nit.only = 1\n",
    fires: false,
  },
  {
    rule: "loop-safety/no-skipped-tests-js",
    kind: "verify",
    file: "src/Cart.test.tsx",
    content: "it.concurrent.only('totals', () => expect(<Cart />).toBeTruthy())\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-skipped-tests-js",
    kind: "verify",
    file: "src/Cart.test.tsx",
    content: "describe.each([1, 2])('cart %i', (n) => it('totals', () => expect(n).toBe(n)))\n",
    fires: false,
  },
  {
    rule: "loop-safety/no-new-suppressions",
    kind: "verify",
    file: "app/report.py",
    content: "def total(lines):  # pragma: no cover\n    return sum(lines)\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-new-suppressions",
    kind: "verify",
    file: "src/cart.ts",
    content: "// @ts-expect-error the old client has no types\nimport legacy from 'legacy'\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-new-suppressions",
    kind: "verify",
    file: "app/report.py",
    content: "# Coverage is checked in CI.\ndef total(lines):\n    return sum(lines)\n",
    fires: false,
  },
  {
    rule: "loop-safety/no-lowered-thresholds",
    kind: "verify",
    file: "tox.ini",
    content: "[testenv]\ncommands = pytest --cov=app --cov-fail-under=60\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-lowered-thresholds",
    kind: "verify",
    file: "package.json",
    content: '{ "scripts": { "lint": "eslint . --max-warnings 50" } }\n',
    fires: true,
  },
  {
    rule: "loop-safety/no-lowered-thresholds",
    kind: "verify",
    file: "package.json",
    content: '{ "scripts": { "test": "vitest run --coverage" } }\n',
    fires: false,
  },
  {
    rule: "loop-safety/protected-loop-config",
    kind: "verify",
    file: ".pre-commit-config.yaml",
    content: "repos: []\n",
    fires: true,
  },
  // Review follow-ups on PR #39: each case below failed before its fix.
  {
    rule: "loop-safety/no-lowered-thresholds",
    kind: "verify",
    file: "codecov.yml",
    content: "coverage:\n  status:\n    project:\n      default:\n        target: 80%\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-lowered-thresholds",
    kind: "verify",
    file: ".codecov.yml",
    content: "coverage:\n  status:\n    patch:\n      default:\n        threshold: 1%\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-lowered-thresholds",
    kind: "verify",
    file: "package.json",
    content: '{ "scripts": { "test": "c8 --check-coverage --lines 95 node --test" } }\n',
    fires: true,
  },
  {
    rule: "loop-safety/no-lowered-thresholds",
    kind: "verify",
    file: "Makefile",
    content: "cover:\n\tnyc --check-coverage --branches=80 mocha\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-new-suppressions",
    kind: "verify",
    file: "app/rates.py",
    content: "import os, sys  # NOQA: E401\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-skipped-tests-python",
    kind: "verify",
    file: "shop/tests.py",
    content: "class CartTests(TestCase):\n    @unittest.skip('flaky')\n    def test_total(self):\n        pass\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-skipped-tests-python",
    kind: "verify",
    file: "shop/testcart.py",
    content: "@unittest.expectedFailure\ndef test_total():\n    assert total() == 3\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-skipped-tests-ts",
    kind: "verify",
    file: "src/cart.test.ts",
    content: "test.failing('totals the lines', () => expect(total([1, 2])).toBe(3))\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-skipped-tests-ts",
    kind: "verify",
    file: "src/cart.test.ts",
    content: "test.fails('totals the lines', () => expect(total([1, 2])).toBe(3))\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-skipped-tests-ts",
    kind: "verify",
    file: "src/cart.test.ts",
    content: "it.runIf(process.env.RATES)('rates are fresh', () => expect(age()).toBeLessThan(3600))\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-skipped-tests-ts",
    kind: "verify",
    file: "e2e/checkout.spec.ts",
    content: "test('pays', async ({ page }) => {\n  test.fail()\n  await page.goto('/')\n})\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-skipped-tests-js",
    kind: "verify",
    file: "test/rates.js",
    content: "it('rates are fresh', function () {\n  if (!process.env.RATES) this.skip()\n})\n",
    fires: true,
  },
  // A helper named like a focus function is not a test: `fit` here fits a model.
  {
    rule: "loop-safety/no-skipped-tests-ts",
    kind: "verify",
    file: "src/model.test.ts",
    content: "const model = fit(points)\ntest('fits a line', () => expect(model.slope).toBe(2))\n",
    fires: false,
  },
  {
    rule: "loop-safety/no-skipped-tests-js",
    kind: "verify",
    file: "src/model.test.js",
    content: "const model = fit(points, { degree: 2 })\ntest('fits a curve', () => expect(model).toBeTruthy())\n",
    fires: false,
  },
  {
    rule: "loop-safety/no-skipped-tests-js",
    kind: "verify",
    file: "src/model.test.js",
    content: "fit(`fits a curve`, () => expect(model).toBeTruthy())\n",
    fires: true,
  },
  {
    rule: "loop-safety/protected-loop-config",
    kind: "verify",
    file: ".lefthook.yml",
    content: "pre-commit: {}\n",
    fires: true,
  },
  {
    rule: "loop-safety/protected-loop-config",
    kind: "verify",
    file: "lefthook.toml",
    content: "[pre-commit]\n",
    fires: true,
  },
  {
    rule: "loop-safety/protected-loop-config",
    kind: "verify",
    file: "lefthook.json",
    content: "{}\n",
    fires: true,
  },
  {
    rule: "loop-safety/protected-loop-config",
    kind: "verify",
    file: ".github/actions/setup/action.yml",
    content: "runs:\n  using: composite\n",
    fires: true,
  },
  {
    rule: "loop-safety/protected-loop-config",
    kind: "verify",
    file: "docs/ci.md",
    content: "# CI\n",
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
      project: { root, config: defaultConfig(), rules, diagnostics: [], mode: ATTENDED },
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

describe("loop-safety flags only what the change adds", () => {
  // Spec §8: an instance rule's finding is new when the change touched its line, and a path rule's
  // when the file changed. A loop that inherits a skip or a workflow is not blamed for it.
  const TEST = "tests/test_pricing.py"
  const WORKFLOW = ".github/workflows/test.yml"
  const SKIPPED = '@pytest.mark.skip(reason="needs the rates service")\ndef test_rates():\n    assert rates.fresh()\n'
  let rules: CompiledRule[] = []
  beforeAll(async () => {
    rules = (await compileManifest(repoRoot, registry)).rules.filter((rule) => rule.id.startsWith("loop-safety/"))
  })

  async function verifyAfter(edits: Record<string, string>) {
    const root = await createRepo({ [TEST]: SKIPPED, [WORKFLOW]: "jobs: {}\n" })
    const baseCommit = await git(root, "rev-parse", "HEAD")
    for (const [file, content] of Object.entries(edits)) await writeFile(path.join(root, file), content)
    const { delivery } = await runPipeline({
      project: { root, config: defaultConfig(), rules, diagnostics: [], mode: ATTENDED },
      stateDir: stateDirFor(root),
      event: { kind: "verify", files: [TEST, WORKFLOW], baseCommit, cwd: root },
      registry,
      maxContextChars: null,
    })
    return delivery
  }

  test("an unrelated test next to an existing skip is no finding; the skip and the workflow are pre-existing", async () => {
    const delivery = await verifyAfter({ [TEST]: `${SKIPPED}\ndef test_total():\n    assert total([1, 2]) == 3\n` })
    expect(delivery.findings).toEqual([])
    expect(delivery.preexistingSummary).toEqual([
      { rule: "loop-safety/no-skipped-tests-python", file: TEST, count: 1 },
      { rule: "loop-safety/protected-loop-config", file: WORKFLOW, count: 1 },
    ])
  })

  test("a second skip is one new finding, on the line the change added", async () => {
    const delivery = await verifyAfter({
      [TEST]: `${SKIPPED}\n@pytest.mark.xfail\ndef test_total():\n    assert total([1, 2]) == 3\n`,
    })
    expect(delivery.findings.map((finding) => [finding.rule, finding.line])).toEqual([
      ["loop-safety/no-skipped-tests-python", 5],
    ])
  })

  test("an unchanged workflow is nothing; an edited one is new", async () => {
    expect((await verifyAfter({})).findings).toEqual([])
    const edited = await verifyAfter({ [WORKFLOW]: "jobs: { test: {} }\n" })
    expect(edited.findings.map((finding) => finding.rule)).toEqual(["loop-safety/protected-loop-config"])
  })
})
