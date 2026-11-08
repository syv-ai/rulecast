# Writing rules

The README's [A rule](../README.md#a-rule) shows the shape. This guide covers the rest; every key is in [`agents/reference/rule-format.md`](../agents/reference/rule-format.md).

## Guidance with nothing to catch

A rule with `context` and no `detect` delivers its doc section the first time an agent touches a matching file. Use it for a convention no pattern can express.

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

## Turning a rule off

- **A whole rule:** `enabled: false` on the rule. Under a rule repo's entry, `- id: <rule>` with `enabled: false` switches that rule off.
- **One finding:** a comment on the matched line or the line above it. The reason is required; an ignore without one suppresses nothing.

  ```python
  except Exception:
      # rulecast-ignore: python/no-silent-except best-effort cache cleanup
      pass
  ```

`rulecast run --all-files --summary` counts the ignores. An ignore or a config change made during an agent session is reported to you when the agent stops, so the agent can't quietly edit its way past a rule.
