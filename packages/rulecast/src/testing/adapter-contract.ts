import assert from "node:assert/strict"

import { type Adapter, type AdapterInput, type Delivery, type Event, emptyDelivery } from "../core/types"
import type { ContractCase } from "./contract"

export interface AdapterFixture {
  /** Recorded hook inputs and what the adapter must make of each. */
  payloads: { name: string; input: unknown; expected: AdapterInput | null }[]
  /** Deliveries the adapter must be able to format, with the event each belongs to. */
  deliveries: { name: string; delivery: Delivery; event: Event }[]
  /** Settings objects `install.merge` must round-trip. Ignored when the adapter has no install. */
  settings?: unknown[]
}

const FORMAT_OPTIONS = { maxMatchesPerRule: 3 }

/** Inputs no adapter handles. Parsing one must return null, not throw. */
const NONSENSE: unknown[] = [null, undefined, 0, "", "not json", [], {}, { hook_event_name: "NoSuchEvent" }]

/**
 * The adapter contract of spec §15, as cases any test runner can drive. Like the detector suite
 * it asserts with node:assert and imports no test framework.
 */
export function adapterContract(adapter: Adapter, fixture: AdapterFixture): ContractCase[] {
  const cases: ContractCase[] = [
    {
      name: "describes itself",
      async run() {
        assert.ok(adapter.name.length > 0, "name must not be empty")
        assert.ok(adapter.label.length > 0, "label must not be empty")
        assert.ok(
          adapter.maxContextChars === null || adapter.maxContextChars > 0,
          "maxContextChars must be null or positive",
        )
        assert.ok(Number.isInteger(adapter.restoredFiles) && adapter.restoredFiles >= 0, "restoredFiles must be >= 0")
      },
    },
    {
      name: "returns null for input it does not handle, and never throws",
      async run() {
        for (const input of NONSENSE) {
          const parsed = adapter.parse(input)
          assert.equal(parsed, null, `parse(${JSON.stringify(input)}) must be null`)
        }
      },
    },
    {
      name: "parses each recorded payload to its event",
      async run() {
        assert.ok(fixture.payloads.length > 0, "an adapter fixture needs at least one recorded payload")
        for (const { name, input, expected } of fixture.payloads) {
          assert.deepEqual(adapter.parse(input), expected, `payload ${name}`)
        }
      },
    },
    {
      name: "parsing is pure: the same payload parses the same twice",
      async run() {
        for (const { name, input } of fixture.payloads) {
          assert.deepEqual(adapter.parse(input), adapter.parse(input), `payload ${name}`)
        }
      },
    },
    {
      name: "every parsed event is well formed",
      async run() {
        for (const { name, input } of fixture.payloads) {
          const event = adapter.parse(input)?.event
          if (!event) continue
          assert.ok(event.cwd.length > 0, `${name}: event.cwd must not be empty`)
          for (const file of event.files) assert.equal(typeof file, "string", `${name}: files must be strings`)
          if (event.kind === "prompt" || event.kind === "reset") {
            assert.deepEqual(event.files, [], `${name}: ${event.kind} carries no files`)
          }
        }
      },
    },
    {
      name: "formats each delivery deterministically, with an exit code of 0 or 1",
      async run() {
        for (const { name, delivery, event } of fixture.deliveries) {
          const first = adapter.format(delivery, event, FORMAT_OPTIONS)
          const second = adapter.format(delivery, event, FORMAT_OPTIONS)
          assert.deepEqual(first, second, `${name}: formatting must be deterministic`)
          assert.equal(typeof first.stdout, "string", `${name}: stdout must be a string`)
          assert.ok([0, 1].includes(first.exitCode), `${name}: exit code must be 0 or 1, got ${first.exitCode}`)
        }
      },
    },
    {
      name: "an empty delivery exits 0",
      async run() {
        const event: Event = fixture.deliveries[0]?.event ?? { kind: "edit", files: [], cwd: "/project" }
        const result = adapter.format(emptyDelivery(), event, FORMAT_OPTIONS)
        assert.equal(result.exitCode, 0, "nothing to report must not be a failure")
      },
    },
  ]

  const install = adapter.install
  if (install) {
    cases.push(
      {
        name: "install declares markers, scopes and a command",
        async run() {
          assert.ok(install.markers.length > 0, "markers must not be empty")
          assert.ok(install.scopes.length > 0, "scopes must not be empty")
          for (const { file } of install.scopes) assert.ok(file.length > 0, "a scope needs a settings file")
          assert.notEqual(install.command(true), install.command(false), "a local install runs a different command")
        },
      },
      {
        name: "merge is idempotent and remove undoes it",
        async run() {
          const command = install.command(false)
          for (const settings of fixture.settings ?? [{}]) {
            const original = structuredClone(settings)
            const once = install.merge(structuredClone(original), command, 5_000)
            assert.ok(once.added.length > 0, "merging into fresh settings must add hooks")
            const twice = install.merge(structuredClone(once.settings), command, 5_000)
            assert.deepEqual(twice.settings, once.settings, "merging twice must change nothing")
            assert.deepEqual(twice.added, [], "merging twice must add nothing")
            const removed = install.remove(structuredClone(once.settings))
            assert.deepEqual(removed.settings, original, "remove must return the settings merge was given")
            assert.deepEqual([...removed.removed].sort(), [...once.added].sort(), "remove must name what merge added")
          }
        },
      },
    )
  }

  return cases
}
