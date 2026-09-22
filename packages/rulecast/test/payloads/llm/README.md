# LLM provider output

Recorded output from the agent CLIs the `llm` detector shells out to, replayed by a stub in a
fixture's `node_modules/.bin` (`test/helpers/llm.ts`), which is where the providers look first.

## Files

| File | Tool | Command | Input |
|---|---|---|---|
| `claude-code.json` | Claude Code 2.1.278 | `claude -p --model haiku --output-format json --json-schema '<FINDINGS_SCHEMA>' --system-prompt '…' --tools "" --restricted --strict-mcp-config --no-session-persistence`, prompt on stdin | Rule `r1` ("report any line that uses `print()`") against a three-line Python file |

Recorded 2026-09-20. The envelope is trimmed to the fields the provider reads (`is_error`,
`structured_output`, `result`) plus enough context to recognise it.

## Why these are recordings

A live call costs money, needs credentials or a signed-in Claude Code, and gives a different
answer every time — none of which belongs in `pnpm test`. The stub makes the provider tests free,
offline and deterministic.

The two HTTP providers have no recording: `test/helpers/llm-server.ts` answers them from a local
`node:http` server, which also lets a test assert on the request that was sent.

`test/detectors/llm/live.test.ts` is where all four stand-ins get checked against reality: run it
with `RULECAST_LLM=1` and it makes one real call per provider the machine can reach, asserting the
shape of what comes back rather than the model's words. A provider it cannot reach — no binary on
`PATH`, no API key — is skipped by name with a printed reason, never silently passed.

## The stub is prompt-sensitive

The recording names rule `r1`, but each test uses whatever rule ids it needs — the detector
contract suite uses `a`, `b`, `good` and `bad`. Rather than a recording per test, the stub reads
the first `### <rule id>` heading out of the prompt it was given on stdin and substitutes it for
`r1` before printing. So the recording answers about whichever rule it was asked about.
