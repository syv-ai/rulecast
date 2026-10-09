# Golden corpora

Two of rulecast's contracts, recorded as data rather than as TypeScript: what the agent-facing renderer prints for a delivery, and how §8 classifies a finding as new or pre-existing. `test/core/delivery/goldens.test.ts` walks both directories, so **adding a case is adding a file**.

They exist for two reasons. A change that is meant to preserve behaviour — moving the context budget into the renderer, splitting `decide` — can be shown to have done so: the goldens pass unchanged. And the spec (§17) says the recorded contracts, not the TypeScript, are the specification; before these, the renderer and classification had recorded inputs and no recorded expectations.

## Never generate an expectation from the implementation

Write each expected output by hand, or copy it from a run you have read line by line and agree with. An expectation recorded from the code pins whatever the code does today, which is stability, not correctness — `test/adapters/contract.test.ts:21` says the same about its own five self-recorded payloads, and names the hand-written test that is the authority over them.

If a case fails after a change, work out which side is wrong before touching the file. A golden that changes in a commit whose message says "behaviour-preserving" is a bug in one of the two.

## `delivery/`

A pair per case: `<name>.delivery.json` and `<name>.expected.txt`.

```json
{
  "about": "what this case pins, in one sentence",
  "options": { "maxMatchesPerRule": 10 },
  "delivery": { "findings": [], "preexistingSummary": [], "references": [], "touches": [], "stop": null,
                "warnings": [], "templates": {}, "omitted": { "findings": [], "rules": 0, "preexisting": 0 },
                "overflowPath": null }
}
```

`expected.txt` is `renderAgentText(delivery, options)` byte for byte, with no trailing newline (the renderer strips it). An empty file is a real expectation: a delivery with nothing in it prints nothing.

Two behaviours these pin that are easy to "fix" by accident: a grouped rule's skeleton prints `{{file}}` as `{file}`, and only a `full` reference is followed by a blank line, so the other states stack.

## `classification/`

One JSON per case.

```json
{
  "about": "what this case pins",
  "baseline": "file content at the baseline, or null for no baseline at all",
  "current": "file content now",
  "scope": "instance | container",
  "fingerprints": [[1, 5]],
  "match": [1, 6],
  "expected": "new | preexisting"
}
```

`fingerprints` is the container rule's recorded baseline ranges: `[]` means measured and clean, `null` means no record was ever written. `classify` cannot tell *why* a record is missing — no snapshot, past the deadline, over `max_file_bytes`, or a metered detector — so one `null` case stands for all four. The baseline is supplied as a snapshot, so nothing here needs git.

`container-boundary-first-line` and `container-boundary-last-line` were added after an off-by-one in `classify`'s overlap test (`<=` to `<` on either end) went uncaught by every other case — and by all 74 tests in `test/core/baseline`, `test/core/pipeline-container.test.ts` and `test/commands/run.test.ts`. Keep them.
