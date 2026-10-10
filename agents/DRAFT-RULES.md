# Draft rulecast rules from a project's docs

Use this when asked to draft rulecast rules for a project from a document, usually `AGENTS.md` or `CLAUDE.md`. Every convention in the doc that code can visibly break becomes a rule that catches the break and points back at the doc. The developer decides which rules stay.

Load these when you need them. Relative links resolve against this file's own URL.

- [reference/rule-format.md](reference/rule-format.md): config and rule keys.
- [reference/detectors.md](reference/detectors.md): the detectors this rulecast version has, their config and template variables.

Commands below say `rulecast`. If it is not on the PATH, use `npx @syv-ai/rulecast`.

The steps ask the developer to decide several things. If no developer is there to answer (you were told to work unattended, or nobody replies), don't wait: take the default each step names, and list every choice you made that way in the summary (step 4).

## 1. Read

1. Read the doc you were pointed at in full.
2. Read `.rulecast-config.yaml`. If it is missing, stop and ask the developer to run `npx @syv-ai/rulecast init`. Then run `rulecast list`. It prints every configured rule, catalog rules included: its `files` and how many project files they match, what its detector looks for (`detects …`), and the doc sections it cites. `rulecast list <rule-id>` prints one rule with its message and the text of those sections. You need both for the catalog rules in step 2.
3. For each convention, read a few of the files it talks about, so your file and code patterns match the code as it is.

## 2. Sort the conventions

- **Checkable**: a break is visible in one file's path or text. "Never edit `src/client/`", "services never raise `HTTPException`", "no `print(` in the backend".
- **Guidance**: true and useful, but not visible as a pattern. "Keep services small", "test RBAC both ways".
- **Not about code**: commands, deployment, process. Skip these.

Two kinds need splitting:

- **Partly checkable**: one part is visible as a pattern and the rest is not. "Keep services small and free of framework types": a `fastapi` import in a service is visible, "small" is not. Draft a pattern rule for the visible part and a touch rule for the rest, both citing the same section.
- **Something must be present**: "every module gets its logger with `logging.getLogger(__name__)`". A detector reports what is in a file, so it cannot see a missing line without firing on every file that lacks it, `__init__.py` included. Check the wrong form instead, if there is one (a logger with another name), and let a touch rule deliver the rest.

**Catalog rules** (the rules `rulecast list` shows from a URL repo) were written for projects in general. For each one, answer two questions, separately. A rule can need a change for both.

1. **Which section should it cite?** If the project's doc has a section on the same subject, point the rule at it with a `context` override and change nothing else. The developer's own words beat the package's, even when they agree.

   ```yaml
   - repo: https://github.com/syv-ai/rulecast
     rev: v0.3.0   # unchanged: keep the entry as init wrote it
     rules:
       - id: python/no-httpexception-in-services
         context:
           - "@AGENTS.md#errors"
   ```

2. **Does what it checks fit this project?** Compare its `files` match count and its `detects` line with the doc, and read the section it cites with `rulecast list <rule-id>`. Judge what the rule does, not its name:
   - **It fits:** nothing more to do. A convention it already enforces needs no local rule.
   - **The doc covers files the rule misses**: the doc says "outside `app/api/`" and the rule's `files` is `services/`, or the doc's route module is `app/api/routes.py` and the rule's `files` is `routes/`. Draft a local rule of the same kind for the files it misses, with an `exclude` for the files it covers, so no site is reported twice. Say in its `description` which catalog rule it extends.
   - **It contradicts the doc, or matches no file at all**: it assumes a layer, a library or a layout the project doesn't have, or its cited section says the opposite of the doc. Leave it unchanged, tell the developer why, and propose `enabled: false` on its entry. Add it only if they agree. Unattended, propose it and leave the rule on.

For checkable conventions, prefer `path` (the file itself is the break), then `regex`, then `ast-grep`. Write the narrowest pattern that catches the break: a noisy rule gets ignored.

**Do not decide up front that a convention needs an `llm` rule.** Which tier a convention belongs in is a property of how it is *worded*, not of the convention: the same rule, written one way, scored P 0.99 / R 0.90 as a pattern, and written more strictly by the same project's owner, P 0.70. So the tier cannot be settled by reading the sentence. Attempt a pattern, measure it against examples, and fall back to `llm` only when the pattern fails — step 3 below is that loop.

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
3. Give it `examples`: two `good` and two `bad`, no two the same. Each is a `path` the rule matches and the `code` at it.
   - Quote real code where the repository has some: an actual violation for `bad`, compliant code for `good`.
   - Where it has none, which is usual in a small or clean repository, write your own: the smallest code that shows the break for `bad`, and for `good` a near miss, code that looks like the break and is not. Invented examples are fine. Say which ones are invented in the summary.
   - A `path` rule judges the file name, not its code: give it `bad` examples only, at paths the rule must refuse.

   ```yaml
   examples:
     good:
       - path: backend/app/services/users.py
         code: |
           log.info("created user %s", user.id)
     bad:
       - path: backend/app/services/users.py
         code: |
           print("created user", user.id)
   ```

4. Run `rulecast validate` and fix every diagnostic for your rule.
5. Run `rulecast test <id>`. Every example must pass.
   - A `bad` example with no finding means the pattern is too narrow. A `good` example that fires means it is too broad.
   - Revise the pattern **once**. If it still fails, move the rule to an `llm` detector and say in its `description` that a pattern was tried. Do not keep tightening a regex past one attempt: that is how a rule ends up fitting its examples and nothing else.
6. Run `rulecast test <id> --against .`. The rule's own `files` and `exclude` decide which files count, so `.` is right for every rule. Report both numbers to the developer — violations, and how many of the matching files they are in — and the note it prints, before asking them to keep it. Neither the numbers nor the note decide it. The developer does.
7. Ask the developer to keep, edit or drop the rule. After an edit, repeat steps 4 to 6. Remove dropped rules from the config. Unattended, keep every rule that passes step 5.

For each guidance convention, add a touch rule. It delivers the section the first time an agent reads or edits a matching file, and has no detector or message:

```yaml
- id: backend/services
  name: Service layer conventions
  files: ^backend/app/services/
  stages: [touch]
  context:
    - "@AGENTS.md#services"
```

Validate it the same way. A touch rule has no detector, so it takes no `examples` and `rulecast test` has nothing to run for it: skip steps 3, 5 and 6.

## 4. Finish

Run `rulecast validate` and `rulecast test` a last time; both must be clean. Then summarise:

- the rules kept: id, one line each, and the `--against` count (touch rules have no count);
- the rules dropped;
- the catalog rules you pointed at the project's doc, extended with a local rule, or propose to switch off, and why;
- the examples you invented;
- the conventions you skipped, with the reason;
- unattended, every choice you made without the developer.

## Never

- Never change rules or overrides under other `repos` entries, except to add a `context` override to a catalog rule, or `enabled: false` when the developer agrees (step 2). Everything else goes in the `repo: local` entry.
- Never add a `rulecast-ignore` comment or `enabled: false` unless the developer agrees the finding or the rule is wrong.
- Never change code to make a rule pass. Report findings; the developer decides.
- Never commit.
