import type { Event } from "../../src/core/types"
import { localConfig } from "../../test/helpers/config"

/**
 * A session as the agent actually drives it: the tool calls a coding agent makes, in order, with
 * the file contents it would have written at each step.
 *
 * `write` is applied before the event runs, so a scenario describes work being done rather than a
 * list of events over a static tree.
 */
export interface Step {
  event: Omit<Event, "cwd" | "session">
  /** Repo-relative file contents to put in place before this event. */
  write?: Record<string, string>
  /** What the agent was doing, for the report. */
  label: string
}

export interface Scenario {
  name: string
  /** One sentence: what this measures and why it is worth measuring. */
  about: string
  files: Record<string, string>
  steps: Step[]
}

const SERVICE = "app/services/orders.py"
const ROUTER = "app/api/routes.py"
const CLIENT = "src/client/api.ts"

/** Long enough that re-injecting it is worth measuring; short enough to read in the report. */
const conventions = [
  "# Backend conventions",
  "",
  "## Errors",
  "",
  "Services raise domain exceptions, never HTTP ones. An HTTPException in a service couples the",
  "business rule to the transport: the same rule then cannot be reused by a worker, a CLI command",
  "or a test that does not go through the router. Raise `NotFound`, `Conflict` or `Invalid` and let",
  "the router translate. The router is the only place that knows about status codes.",
  "",
  "## Services",
  "",
  "Business logic lives in `app/services`. A router function reads the request, calls one service",
  "function and renders the result; it holds no branching on domain state. If a router grows an",
  "`if` about what the data means rather than what the request asked for, that branch belongs in a",
  "service. Services do not import from `app/api`, which keeps the dependency pointing one way.",
  "",
  "## Sessions",
  "",
  "A service takes its database session as an argument and never opens one. The caller owns the",
  "transaction boundary, so one request is one transaction and a service can be composed into",
  "another without nesting commits.",
  "",
].join("\n")

const frontend = [
  "# Frontend conventions",
  "",
  "## Generated clients",
  "",
  "Everything under `src/client` is generated from the OpenAPI schema. Editing it works until the",
  "next generation run, which silently reverts the change. Change the schema and regenerate.",
  "",
].join("\n")

const rules: Record<string, unknown>[] = [
  {
    id: "backend/no-httpexception",
    name: "No HTTPException in services",
    files: "^app/services/.*\\.py$",
    detect: { regex: { pattern: "raise HTTPException\\((?<args>[^)]*)\\)" } },
    message: "{{file}}:{{line}} raises HTTPException({{args}}) in a service. Raise a domain exception instead.",
    context: ["@conventions/backend.md#errors"],
  },
  {
    id: "backend/no-session-open",
    name: "Services take a session",
    files: "^app/services/.*\\.py$",
    detect: { regex: { pattern: "Session\\(\\s*\\)" } },
    message: "{{file}}:{{line}} opens its own database session. Take one as an argument.",
    context: ["@conventions/backend.md#sessions"],
  },
  {
    id: "backend/services",
    name: "Service conventions",
    files: "^app/services/.*\\.py$",
    stages: ["touch"],
    context: ["@conventions/backend.md#services"],
  },
  {
    id: "api/no-domain-branching",
    name: "Routers do not branch on domain state",
    files: "^app/api/.*\\.py$",
    severity: "warning",
    detect: { regex: { pattern: "if\\s+order\\.(?<field>\\w+)" } },
    message: "{{file}}:{{line}} branches on order.{{field}} in a router. Move the decision into a service.",
    context: ["@conventions/backend.md#services"],
  },
  {
    id: "frontend/no-generated-edits",
    name: "Generated client is generated",
    files: "^src/client/",
    detect: { path: {} },
    message: "{{file}} is generated from the OpenAPI schema. Change the schema and regenerate.",
    context: ["@conventions/frontend.md#generated-clients"],
  },
]

const files: Record<string, string> = {
  ".rulecast-config.yaml": localConfig(rules),
  "conventions/backend.md": conventions,
  "conventions/frontend.md": frontend,
  [SERVICE]: "def get_order(id):\n    return None\n",
  [ROUTER]: "def read_order(id):\n    return get_order(id)\n",
  [CLIENT]: "export const api = 1\n",
}

const touch = (file: string): Step["event"] => ({ kind: "touch", files: [file], completeRead: true })
const edit = (file: string): Step["event"] => ({ kind: "edit", files: [file] })
const verify = (): Step["event"] => ({ kind: "verify", files: [] })

/**
 * The shape that motivates context memory: one file worked on across many turns. Without it every
 * edit re-sends the same convention section; with it the section is a pointer after the first.
 */
const sustained: Scenario = {
  name: "sustained-edit",
  about: "Twelve turns on one service file. The same convention section is relevant throughout.",
  files,
  steps: [
    { label: "read the service", event: touch(SERVICE) },
    ...Array.from({ length: 11 }, (_, i) => ({
      label: `edit ${i + 1}`,
      write: { [SERVICE]: `def get_order(id):\n    raise HTTPException(404)\n${"    pass\n".repeat(i + 1)}` },
      event: edit(SERVICE),
    })),
  ],
}

/** Several files, several rules: the references interleave, and coverage does most of the work. */
const spread: Scenario = {
  name: "multi-file-feature",
  about: "A feature touching a service, a router and the generated client, then a stop.",
  files,
  steps: [
    { label: "read the service", event: touch(SERVICE) },
    {
      label: "edit the service",
      write: { [SERVICE]: "def get_order(id):\n    raise HTTPException(404)\n" },
      event: edit(SERVICE),
    },
    { label: "read the router", event: touch(ROUTER) },
    {
      label: "edit the router",
      write: { [ROUTER]: "def read_order(id):\n    if order.paid:\n        return 1\n    return get_order(id)\n" },
      event: edit(ROUTER),
    },
    { label: "edit the generated client", write: { [CLIENT]: "export const api = 2\n" }, event: edit(CLIENT) },
    {
      label: "second edit to the service",
      write: { [SERVICE]: "def get_order(id):\n    raise HTTPException(404)\n    s = Session()\n" },
      event: edit(SERVICE),
    },
    { label: "stop", event: verify() },
  ],
}

/**
 * Compaction: the agent's context is cleared and its recent files re-attached, so rulecast re-sends
 * the touch context it had already delivered. What memory saves before a reset, a reset gives back.
 */
const compaction: Scenario = {
  name: "compaction",
  about: "Work, a compaction, then more work on the same file.",
  files,
  steps: [
    { label: "read the service", event: touch(SERVICE) },
    {
      label: "edit the service",
      write: { [SERVICE]: "def get_order(id):\n    raise HTTPException(404)\n" },
      event: edit(SERVICE),
    },
    {
      label: "edit again",
      write: { [SERVICE]: "def get_order(id):\n    raise HTTPException(409)\n" },
      event: edit(SERVICE),
    },
    { label: "compaction", event: { kind: "reset", files: [] } },
    {
      label: "edit after compaction",
      write: { [SERVICE]: "def get_order(id):\n    raise HTTPException(410)\n" },
      event: edit(SERVICE),
    },
    {
      label: "edit again",
      write: { [SERVICE]: "def get_order(id):\n    raise HTTPException(411)\n" },
      event: edit(SERVICE),
    },
  ],
}

/**
 * refuse_write: the violation is caught in the tool call, so it never reaches the file. The
 * comparison that matters is not tokens but operations — without the guard the agent writes, is
 * told, and edits again; with it the write is refused and the next one is right.
 */
const guarded: Scenario = {
  name: "refused-writes",
  about: "Three attempts to write a generated file, each judged before it lands.",
  files: {
    ...files,
    ".rulecast-config.yaml": localConfig(
      rules.map((rule) => (rule.id === "frontend/no-generated-edits" ? { ...rule, refuse_write: true } : rule)),
    ),
  },
  steps: [
    {
      label: "attempt to write the generated client",
      event: { kind: "guard", files: [CLIENT], intent: { content: "export const api = 2\n" } },
    },
    {
      label: "attempt again",
      event: { kind: "guard", files: [CLIENT], intent: { content: "export const api = 3\n" } },
    },
    { label: "read the service instead", event: touch(SERVICE) },
    {
      label: "edit the service",
      write: { [SERVICE]: "def get_order(id):\n    raise HTTPException(404)\n" },
      event: edit(SERVICE),
    },
  ],
}

export const SCENARIOS: Scenario[] = [sustained, spread, compaction, guarded]
