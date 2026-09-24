/**
 * Scenarios that misbehave on purpose, so the harness's classification can be tested through the
 * real fork-and-watch path rather than against a mock of it.
 */
import type { Scenario } from "../../scripts/stress/types"

const passes: Scenario = {
  name: "fixture-passes",
  about: "Returns an observation whose checks all hold.",
  target: "scale",
  timeoutMs: 20_000,
  async run() {
    return { metrics: { answer: 42 }, checks: [{ name: "holds", ok: true, detail: "42" }], notes: ["a note"] }
  },
}

const violates: Scenario = {
  name: "fixture-violates",
  about: "Completes, but one of its checks fails.",
  target: "scale",
  timeoutMs: 20_000,
  async run() {
    return {
      metrics: { measured: 900 },
      checks: [
        { name: "holds", ok: true, detail: "fine" },
        { name: "does not hold", ok: false, detail: "900 ms (limit 100 ms)" },
      ],
      notes: [],
    }
  },
}

const crashes: Scenario = {
  name: "fixture-crashes",
  about: "Throws instead of returning an observation.",
  target: "adversarial",
  timeoutMs: 20_000,
  async run() {
    throw new Error("scenario blew up")
  },
}

/** Blocks the event loop, so nothing inside this process can interrupt it — including a timer. */
const hangs: Scenario = {
  name: "fixture-hangs",
  about: "Spins synchronously past its watchdog, the way a pathological regex does.",
  target: "adversarial",
  timeoutMs: 1_000,
  async run() {
    const until = Date.now() + 60_000
    while (Date.now() < until) {
      // Deliberately synchronous: a scenario that awaited here could be timed out from inside, and
      // would not exercise the reason the harness forks at all.
    }
    return { metrics: {}, checks: [], notes: [] }
  },
}

export const SCENARIOS: readonly Scenario[] = [passes, violates, crashes, hangs]
