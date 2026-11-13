# Writing rules

The README's [A rule](../README.md#a-rule) shows the shape. This guide covers the rest; every key is in [`agents/reference/rule-format.md`](../agents/reference/rule-format.md).

## Testing a rule

A rule's `examples` hold `bad` code it must flag and `good` code it must leave alone. `rulecast test` runs them. Two more checks say how the rule would behave on your code:

- `rulecast test <id> --against .` shows how many real files it would flag. The rule's own `files` picks which ones count.
- `rulecast test <id> --history` shows how often recent commits would have broken it.

```yaml
examples:
  bad:
    - path: app/services/users.py
      code: |
        raise HTTPException(404)
  good:
    - path: app/services/users.py
      code: |
        raise UserNotFound(user_id)
```

The rest, such as pinning the lines a `bad` example must flag, is in [Examples](../agents/reference/rule-format.md#examples).

## Testing a rule on faults you already had

The best evidence for a rule is a mistake that really happened. Take commits where a reviewer sent something back: each fault is a commit `F` that introduced it and a commit `X` that fixed it. Keep a candidate rule only if it passes all three:

```sh
rulecast run <id> --from-ref F^ --to-ref F   # it fires on the fault
rulecast run <id> --from-ref X^ --to-ref X   # it is quiet on the fix
rulecast test <id> --history --commits 80   # it is quiet on recent history, the faults aside
```

Each `run` judges only what that commit added, as a session judges an edit. The history check lists the commits it fired on, so the faults themselves show up there; anything else it lists is a false alarm or a fault nobody caught. A rule that fires on the fault but also across recent history describes the code rather than the mistake: narrow it, or drop it. One that misses the fault catches something else. With a few faults and a few candidates each, most candidates drop out, and the ones that stay have shown they catch what your reviewers catch.

## Guidance with nothing to catch

A rule with `context` and no `detect` is a touch rule: it delivers its doc section the first time an agent reads or edits a matching file. Use it for a convention no pattern can express. Keep each one to the one or two sections agents get wrong in that area: every touch rule matching a file arrives in the same message, and what does not fit is only named. `rulecast doctor` warns about files whose touch context is too long.

## Refusing a write

`refuse_write: true` refuses the edit before it happens. The agent gets your message and the doc section in place of the tool's result:

```yaml
- id: codegen/no-edit-client
  name: The generated client is not edited by hand
  files: '^src/client/'
  detect:
    path: {}
  refuse_write: true
  message: "{{file}} is generated from openapi.yaml. Edit the schema and run `pnpm codegen`."
```

Use it for generated code, vendored directories and files that must not change. Everything else is better reported after the write.

- A refusal only rests on the text the agent is writing, and happens once per file per session, so it never traps the agent.
- A write through Bash can't be refused before it runs. rulecast catches it right after: the agent is told how to revert it, its stop is held until it has (once per prompt by default), and you are told which file changed.

## The linters you already run

A `linter` rule without `rules` delivers what the project's own linter config makes an error, and only the errors the agent's edit caused. To have a warning delivered, make it an error in the linter's config.

Each finding says where its lint rule is explained: a doc section you map with `context_by_rule`, or else the linter's own page.

```yaml
- id: linter/eslint
  name: ESLint errors
  types_or: [javascript, jsx, ts, tsx]
  detect:
    linter: { tool: eslint }
  message: "{{message}} ({{ruleId}})"
  context_by_rule:
    eqeqeq: "@docs/conventions.md#comparisons"
```

Setup offers one rule per linter it finds, and proposes the mappings after setup, one at a time. The mapping lives in `.rulecast-config.yaml`, so your docs stay free of rulecast syntax. See [Per lint rule](../agents/reference/rule-format.md#per-lint-rule).

## Locking in a migration

Agents copy what they find. Halfway through moving off an API, the old form is still in the code, and an agent will add more of it. Give the move a rule that flags the old form and cites the doc or decision record that explains it:

```yaml
- id: frontend/no-raw-fetch
  name: API calls go through apiClient
  files: '^src/.*\.ts$'
  exclude: '^src/api/client\.ts$'
  detect:
    ast-grep:
      language: typescript
      rule: { pattern: "fetch($$$)" }
  message: "{{file}}:{{line}} calls fetch directly. Use apiClient from src/api/client.ts."
  context:
    - "@docs/decisions/0007-api-client.md"
```

The uses that are already there are [backlog](adopting-rules.md), so the rule can go in on day one. Once the migration is done, a rule that never fires is the lock working. Keep it.

## Turning a rule off

- **A whole rule:** `enabled: false` on the rule, or on its entry under a rule repo.
- **One finding:** a comment with a reason, on the matched line or the line above it:

  ```python
  except Exception:
      # rulecast-ignore: python/no-silent-except best-effort cache cleanup
      pass
  ```

The details, and what you are told when an agent adds an ignore, are in [Turning a rule or a finding off](../agents/reference/rule-format.md#turning-a-rule-or-a-finding-off).

## One home for each convention

`AGENTS.md` is read at the start of every session; a rule's doc section reaches the agent only when it is needed. Once a rule checks a convention, move its section out of `AGENTS.md` into your conventions docs and cite it from the rule. Move it rather than copy it, because copies drift. If some of your agents run without rulecast's hooks, leave it where it is.
