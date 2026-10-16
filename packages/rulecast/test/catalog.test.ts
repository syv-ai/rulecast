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
  "loop-safety/no-deleted-assertions-python",
  "loop-safety/no-deleted-assertions-ts",
  "loop-safety/no-deleted-assertions-js",
  "loop-safety/no-new-suppressions",
  "loop-safety/no-config-suppressions-python",
  "loop-safety/no-config-suppressions-js",
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
  /**
   * The file as committed before the change: the case is then a verify against that commit. A
   * `scope: removed` rule has nothing to count against without one.
   */
  before?: string
}

const PY_ASSERTS =
  "class Rates(TestCase):\n    def test_fresh(self):\n        self.assertTrue(rates.fresh())\n\n\ndef test_total():\n    assert total([1, 2]) == 3\n    with pytest.raises(ValueError):\n        total(None)\n"
const TS_EXPECTS = 'it("totals the lines", () => {\n  expect(total([1, 2])).toBe(3)\n  expect(total([])).toBe(0)\n})\n'
const TSX_EXPECTS =
  'test("shows the total", () => {\n  render(<Cart lines={[1, 2]} />)\n  expect(screen.getByText("3")).toBeTruthy()\n  assert.ok(screen)\n})\n'
const MYPY = '[project]\nname = "shop"\n\n[tool.mypy]\nstrict = true\n'
const RUFF = '[tool.ruff.lint]\nselect = ["E", "F"]\nignore = ["E501"]\n'
const TSCONFIG = '{\n  "compilerOptions": {\n    "strict": true,\n    "target": "es2022"\n  }\n}\n'

const SERVICE_OK = "def get_user(session, user_id):\n    return crud.get_user(session, user_id)\n"
const COMPONENT_OK = "export function UserList() {\n  const { data } = useUsers()\n  return <List items={data} />\n}\n"

const cases: Case[] = [
  {
    rule: "loop-safety/no-deleted-assertions-python",
    kind: "verify",
    file: "tests/test_rates.py",
    before: PY_ASSERTS,
    content: PY_ASSERTS.replace("    assert total([1, 2]) == 3\n", ""),
    fires: true,
  },
  {
    rule: "loop-safety/no-deleted-assertions-python",
    kind: "verify",
    file: "tests/test_rates.py",
    before: PY_ASSERTS,
    // Commented out is removed: the parser does not count a comment.
    content: PY_ASSERTS.replace("        self.assertTrue", "        # self.assertTrue"),
    fires: true,
  },
  {
    rule: "loop-safety/no-deleted-assertions-python",
    kind: "verify",
    file: "tests/test_rates.py",
    before: PY_ASSERTS,
    content: `${PY_ASSERTS}    assert total([]) == 0\n`,
    fires: false,
  },
  {
    rule: "loop-safety/no-deleted-assertions-ts",
    kind: "verify",
    file: "src/cart.test.ts",
    before: TS_EXPECTS,
    content: TS_EXPECTS.replace("  expect(total([])).toBe(0)\n", "  // expect(total([])).toBe(0)\n"),
    fires: true,
  },
  {
    rule: "loop-safety/no-deleted-assertions-ts",
    kind: "verify",
    file: "src/cart.test.ts",
    before: TS_EXPECTS,
    // Rewritten with a different expected value: not covered, and not this rule.
    content: TS_EXPECTS.replace("toBe(0)", "toBe(1)"),
    fires: false,
  },
  {
    rule: "loop-safety/no-deleted-assertions-js",
    kind: "verify",
    file: "src/Cart.test.tsx",
    before: TSX_EXPECTS,
    content: TSX_EXPECTS.replace("  assert.ok(screen)\n", ""),
    fires: true,
  },
  {
    rule: "loop-safety/no-deleted-assertions-js",
    kind: "verify",
    file: "src/Cart.test.tsx",
    before: TSX_EXPECTS,
    content: TSX_EXPECTS.replace("  render(", "  cleanup()\n  render("),
    fires: false,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "pyproject.toml",
    // What the agent wrote in the loop-safety pack's run 3 (docs/evidence/2026-10-16-loop-safety-pack.md).
    before: MYPY,
    content: `${MYPY}\n[[tool.mypy.overrides]]\nmodule = "legacyrates"\nignore_missing_imports = true\n`,
    fires: true,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "pyproject.toml",
    before: RUFF,
    content: RUFF.replace('["E501"]', '[\n    "E501",\n    "F401",\n]'),
    fires: true,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "pyproject.toml",
    // An existing ignore is not the change's: a line added next to it is no finding.
    before: RUFF,
    content: `${RUFF}line-length = 100\n`,
    fires: false,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "pyproject.toml",
    content: `${MYPY}disallow_untyped_defs = true\n`,
    fires: false,
  },
  {
    rule: "loop-safety/no-config-suppressions-js",
    kind: "verify",
    file: "tsconfig.json",
    before: TSCONFIG,
    content: TSCONFIG.replace('"strict": true', '"strict": false'),
    fires: true,
  },
  {
    rule: "loop-safety/no-config-suppressions-js",
    kind: "verify",
    file: "tsconfig.json",
    before: TSCONFIG,
    content: TSCONFIG.replace('"target": "es2022"', '"target": "es2023"'),
    fires: false,
  },
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
  // Review follow-ups on PR #39, second round: each case below failed before its fix.
  {
    rule: "loop-safety/no-deleted-assertions-python",
    kind: "verify",
    file: "tests/test_rates.py",
    before: PY_ASSERTS,
    // Only the pytest.raises block goes: `$OBJ.$ASSERT` used to bind it first and discard it.
    content: PY_ASSERTS.replace("    with pytest.raises(ValueError):\n        total(None)\n", "    total(None)\n"),
    fires: true,
  },
  {
    rule: "loop-safety/no-deleted-assertions-python",
    kind: "verify",
    file: "tests/test_rates.py",
    before: "def test_old():\n    with pytest.warns(DeprecationWarning):\n        old()\n",
    content: "def test_old():\n    old()\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-deleted-assertions-python",
    kind: "verify",
    file: "tests/test_rates.py",
    // `assertions()` is not an assert method.
    before: "def test_report():\n    report.assertions()\n    assert report.ok\n",
    content: "def test_report():\n    assert report.ok\n",
    fires: false,
  },
  {
    rule: "loop-safety/no-deleted-assertions-ts",
    kind: "verify",
    file: "src/cart.test.ts",
    before: TS_EXPECTS.replace("expect(total([1, 2]))", "expect<number>(total([1, 2]))"),
    content: TS_EXPECTS.replace("  expect(total([1, 2])).toBe(3)\n", ""),
    fires: true,
  },
  {
    rule: "loop-safety/no-deleted-assertions-ts",
    kind: "verify",
    file: "src/cart.test.ts",
    // A type argument added to an expect is not a removed expect.
    before: TS_EXPECTS,
    content: TS_EXPECTS.replace("expect(total([]))", "expect<number>(total([]))"),
    fires: false,
  },
  {
    rule: "loop-safety/no-deleted-assertions-js",
    kind: "verify",
    file: "src/Cart.test.tsx",
    before: TSX_EXPECTS,
    content: TSX_EXPECTS.replace("expect(screen", "expect<HTMLElement>(screen"),
    fires: false,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "pyproject.toml",
    content: "[tool.bumpversion]\nallow_dirty = true\n\n[tool.semantic_release]\nallow_zero_version = true\n",
    fires: false,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "pyproject.toml",
    content: "[tool.coverage.report]\nignore_errors = true\nshow_missing = true\n",
    fires: false,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "setup.cfg",
    content: "[mypy-legacy.*]\nfollow_imports = normal\nignore_errors = True\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "pyproject.toml",
    content: '[tool.mypy]\nstrict = true\n\n[[tool.mypy.overrides]]\nmodule = ["legacy.*"]\nignore_errors = true\n',
    fires: true,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "pytest.ini",
    content: "[pytest]\naddopts = -q -p no:cacheprovider\n",
    fires: false,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "pytest.ini",
    content: "[pytest]\naddopts = -q -p no:randomly\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "pytest.ini",
    content: "[pytest]\n# select with -k slow, or skip with --deselect\naddopts = -q  # never -k here\n",
    fires: false,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: "pyproject.toml",
    content: '[tool.pylint."messages control"]\ndisable = ["missing-docstring", "W0611"]\n',
    fires: true,
  },
  {
    rule: "loop-safety/no-config-suppressions-python",
    kind: "verify",
    file: ".pylintrc",
    content: "[MESSAGES CONTROL]\ndisable=missing-docstring\n",
    fires: true,
  },
  {
    rule: "loop-safety/no-config-suppressions-js",
    kind: "verify",
    file: "biome.json",
    content:
      '{\n  "vcs": { "enabled": false },\n  "formatter": { "enabled": false },\n  "organizeImports": { "enabled": false },\n  "assist": { "actions": { "source": { "organizeImports": "off" } } }\n}\n',
    fires: false,
  },
  {
    rule: "loop-safety/no-config-suppressions-js",
    kind: "verify",
    file: "biome.json",
    content: '{\n  "linter": {\n    "include": ["src"],\n    "enabled": false\n  }\n}\n',
    fires: true,
  },
  {
    rule: "loop-safety/no-config-suppressions-js",
    kind: "verify",
    file: "package.json",
    content: '{ "name": "shop", "renovate": { "enabled": false }, "c8": { "reporter": "off" } }\n',
    fires: false,
  },
  {
    rule: "loop-safety/no-config-suppressions-js",
    kind: "verify",
    file: "eslint.config.js",
    content: 'export default [{\n  rules: {\n    // "no-console": "off",\n    "no-console": "error",\n  },\n}]\n',
    fires: false,
  },
  {
    rule: "loop-safety/no-config-suppressions-js",
    kind: "verify",
    file: "eslint.config.js",
    content: 'export default [{ rules: { eqeqeq: "off" } }]\n',
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

  test.each(cases)("$rule on $file ($kind) fires: $fires", async ({ rule, kind, file, content, fires, before }) => {
    let root: string
    let baseCommit: string | undefined
    if (before === undefined) root = await createProject({ [file]: content })
    else {
      root = await createRepo({ [file]: before })
      baseCommit = await git(root, "rev-parse", "HEAD")
      await writeFile(path.join(root, file), content)
    }
    await stubAgentCli(root, "claude")
    const { delivery } = await runPipeline({
      project: { root, config: defaultConfig(), rules, diagnostics: [], mode: ATTENDED },
      stateDir: stateDirFor(root),
      event: { kind, files: [file], cwd: root, ...(baseCommit === undefined ? {} : { baseCommit }) },
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
