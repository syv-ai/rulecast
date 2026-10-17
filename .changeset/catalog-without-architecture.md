---
"@syv-ai/rulecast": minor
---

The catalog no longer assumes anything about a project's architecture. Which layers a project has, where they live and what may call what are the developer's decisions, made in the conventions session, not catalog defaults.

- Removed `python/no-httpexception-in-services`, `python/no-queries-in-services`, `python/layering`, `python/thin-routes`, `react/no-fetch-in-components`, `react/data-fetching` and `react/no-inline-style`, with the docs they cite. A config that names one of them no longer compiles; remove the entry, or draft the convention as a local rule.
- `python/no-silent-except` now runs ruff's S110 and needs ruff installed. By default it flags a bare `except:`, `except Exception` and `except BaseException`; set `check-typed-exception` in the project's ruff config to flag typed ones too.
- `init` says a catalog rule "matches" the project's files, not that it "applies". The setup and drafting docs for agents say the same.
