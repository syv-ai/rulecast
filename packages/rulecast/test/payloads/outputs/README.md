# Tool output, one file per format

Recorded 2026-10-14 by running each tool over a tiny fixture with a seeded problem and capturing
stdout. They pin the readers in `src/core/detection/outputs/`. `__ROOT__` stands in for the
fixture's absolute path where the tool printed one.

| File | Tool | Command | Format |
|---|---|---|---|
| `ty.gitlab.json` | ty 0.0.87 | `ty check --output-format gitlab a.py b.py` | `gitlab` |
| `ty.concise.txt` | ty 0.0.87 | `ty check --output-format concise a.py b.py` | `lines: gcc` |
| `mypy.txt` | mypy 2.4.0 | `mypy --show-column-numbers --no-error-summary a.py b.py` | `lines: gcc` |
| `pyright.txt` | pyright 1.1.414 | `pyright a.py b.py` | `lines: { pattern }` |
| `vulture.txt` | vulture 2.16 | `vulture a.py b.py` | `lines: gcc-nocol` |
| `tsc.txt` | typescript 7.0.2 | `tsc --noEmit --pretty false` | `lines: msbuild` |
| `shellcheck.checkstyle.xml` | shellcheck 0.11.0 | `shellcheck -f checkstyle s.sh` | `checkstyle` |
| `shellcheck.gcc.txt` | shellcheck 0.11.0 | `shellcheck -f gcc s.sh` | `lines: gcc` |
| `staticcheck.sarif.json` | staticcheck 2026.2.2 | `staticcheck -f sarif ./...` (the rules list trimmed to the rules that fired) | `sarif` |
| `staticcheck.txt` | staticcheck 2026.2.2 | `staticcheck ./...` | `lines: gcc` |
| `golangci-lint.txt` | golangci-lint 2.14.0 | `golangci-lint run --output.text.print-issued-lines=false --show-stats=false ./...` | `lines: gcc` |
| `deadcode.txt` | deadcode (x/tools, 2026-10) | `deadcode .` | `lines: gcc` |
| `tflint.compact.txt` | tflint 0.64.0 | `tflint -f compact` | `lines: gcc` |
| `rdjson.json` | none | written by hand from reviewdog's rdjson schema: no tool on this machine prints it | `rdjson` |

`test/detectors/command/live.test.ts`, with `RULECAST_TOOLS=1`, runs the real tools through
`command` rules. Re-record from there when a tool's output changes.
