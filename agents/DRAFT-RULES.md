# Draft rulecast rules from a project's docs

Use this when asked to draft rulecast rules for a project from a document, usually `AGENTS.md` or `CLAUDE.md`. Every convention in the doc that code can visibly break becomes a rule that catches the break and points back at the doc. The developer decides which rules stay.

Load these when you need them. Relative links resolve against this file's own URL.

- [reference/rule-format.md](reference/rule-format.md): config and rule keys.
- [reference/detectors.md](reference/detectors.md): the detectors this rulecast version has, their config and template variables.

Commands below say `rulecast`. If it is not on the PATH, use `npx @syv-ai/rulecast`.

## 1. Read

1. Read the doc you were pointed at in full.
2. Read `.rulecast-config.yaml`. If it is missing, stop and ask the developer to run `npx @syv-ai/rulecast init`. Note the rules already configured, so you don't draft duplicates.
3. For each convention, read a few of the files it talks about, so your file and code patterns match the code as it is.

## 2. Sort the conventions

- **Checkable**: a break is visible in one file's path or text. "Never edit `src/client/`", "services never raise `HTTPException`", "no `print(` in the backend".
- **Guidance**: true and useful, but not visible as a pattern. "Keep services small", "test RBAC both ways".
- **Not about code**: commands, deployment, process. Skip these.

For checkable conventions, prefer `path` (the file itself is the break), then `regex`. Write the narrowest pattern that catches the break: a noisy rule gets ignored.

## 3. Draft one rule at a time

For each checkable convention:

1. Show the developer the rule as YAML and the doc section it enforces.
2. Add it to the `rules` of the `repo: local` entry in `.rulecast-config.yaml`. Add that entry at the end of `repos` if there is none:

   ```yaml
   - repo: local
     rules:
       - id: backend/no-print
         name: Backend code logs instead of printing
         files: ^backend/.*\.py$
         exclude: ^backend/tests/
         detect:
           regex:
             pattern: '^\s*print\('
             flags: m
         message: "{{file}}:{{line}} prints. Use the logger instead."
         context:
           - "@AGENTS.md#logging"
   ```

   - `id`: lowercase `area/name`, unique in the config.
   - `files`: a regex searched in the repo-relative path. Anchor it with `^` so it matches the directory you mean.
   - `message`: what is wrong at `{{file}}:{{line}}` and what to do instead, in one or two sentences.
   - `context`: the doc section the rule enforces, as `@<file>#<heading-slug>`. The slug is the heading in lowercase, punctuation dropped, spaces turned into `-`.
3. Run `rulecast validate` and fix every diagnostic for your rule.
4. Run `rulecast run <id> --all-files --format json`. Tell the developer how many findings it reports and show up to three as `file:line` with the line's text. Many findings mean the code does not follow the convention today: say so. Existing violations never block an agent; only new ones do.
5. Ask the developer to keep, edit or drop the rule. After an edit, repeat steps 3 and 4. Remove dropped rules from the config.

For each guidance convention, add a touch rule. It delivers the section the first time an agent reads or edits a matching file, and has no detector or message:

```yaml
- id: backend/services
  name: Service layer conventions
  files: ^backend/app/services/
  stages: [touch]
  context:
    - "@AGENTS.md#services"
```

Validate it the same way. `rulecast run` reports no findings for touch rules, so skip step 4.

## 4. Finish

Run `rulecast validate` a last time. Then summarise: the rules kept (id and one line each), the rules dropped, and the conventions you skipped, with the reason.

## Never

- Never change rules or overrides under other `repos` entries; only the `repo: local` entry.
- Never change code to make a rule pass. Report findings; the developer decides.
- Never commit.
