# Set up rulecast in a project

Use this when the developer asks you to set up rulecast. rulecast delivers a project's conventions to coding agents while they work: rules in `.rulecast-config.yaml` pair a check with a message and a pointer to the doc section it enforces.

Setup is short. You read what the repository can tell you, show the developer one page of defaults with the few questions only they can answer, and write it once they approve. More rules come later, one at a time: with `/rulecast:add-rule` from the rulecast plugin in Claude Code, or with [DRAFT-RULES.md](DRAFT-RULES.md) for one convention elsewhere.

Relative links in this file resolve against this file's own URL. Commands below say `rulecast`. If `rulecast` is not on the PATH, use `npx @syv-ai/rulecast`.

## 1. The developer is there

Every decision here is the developer's. Ask, and wait for the answer. If you were told to work without the developer, stop and say why: rulecast enforces conventions the developer chose, and nobody else can choose them.

## 2. Find first

Run init's dry run first, in each directory a config might go:

```sh
rulecast init --dry-run --format json
```

It writes nothing in the project. To show which catalog rules fit, it fetches the catalog's rule data at its latest tag (or the rev the config pins) into rulecast's cache; offline, it uses the newest one already cached, or reports the error. It reports:

- the stack, the docs and their headings, and the agents it detects;
- `committers`: how many people committed in the last six months, bots left out (null when there are none, or in a shallow clone);
- `packages`: declared workspaces and top-level directories with a manifest, each with its stack and whether it has its own agent doc or config;
- `sessions`: directories below this one where an agent's settings already sit (`.claude/`);
- `gitHooks`: pre-commit, lefthook or husky, and whether rulecast is already in each;
- `ci`: workflow files that run a coding agent;
- `linters`: the linters the project already runs (ESLint, Ruff, oxlint, gitleaks), each with the rules its own config makes errors (`errorRules`), how many warnings a rule would not deliver (`warningRules`), and `candidates`: doc sections that name one of those rules;
- the project's own hooks it can run as rules (and the ones it can't, with why). A hook that runs one of those linters has `sameAs: "linter/<tool>"`;
- `generated` and `vendored`: paths that are generated (by a header such as `@generated` or `.gitattributes`) or vendored, beyond what the catalog rules already cover, with the evidence: a directory, a `.gitattributes` pattern, or a file (past 20 files, `notListed` counts the rest). They are offered only when the catalog has the rule that covers them (`generated-code`, `vendored-code`);
- `catalog`: each catalog rule, how many of the project's files it matches, whether it is metered (asks a model) or in a pack, and whether it is configured;
- the config's current settings, and every file it would write.

Then read what needs judgement:

- The docs: `README`, `AGENTS.md` or `CLAUDE.md`, `CONTRIBUTING`, anything under `docs/`. Note the conventions they state that code could show, such as "never edit `src/client/` by hand".
- Your own memory of this project, if you keep one (in Claude Code, `~/.claude/projects/<project>/memory/`). Corrections the developer made before are the best candidates for rules.
- The script of any hook with `modifies: null`, named in `runs`, to see whether it changes files.
- Whether rulecast is installed: `node_modules/.bin/rulecast` is a devDependency, and `command -v rulecast` finds one on the PATH (the standalone binary, or a global install). Note whether there is a `package.json`, and whether the project pins its tools there.

## 3. Defaults and questions

Each item on the page gets a default from what you found. Only the items below marked **always** are questions; the rest are defaults the developer can strike or change. Put your recommendation first, except for llm rules.

| Item | Default from | Default | Becomes a question when |
|---|---|---|---|
| Who it's for | `committers.count` | 2 or more: a team. 1: solo. Hooks `--scope shared` either way: with one committer the shared file affects only them, and the next person to join gets the hooks. Say they can keep them personal with "*N*: personal" | `committers` is null |
| Install | `node_modules/.bin/rulecast`, `command -v rulecast`, and whether `package.json` pins the project's tools | the one already installed, if any; else the devDependency when `package.json` pins the tools, so everyone runs the same version; else the standalone binary, which needs no Node and no change to the project. The row lists the three options (devDependency, standalone binary, global `npm install -g`), and its `detail` is the exact command step 6 will run | never |
| Sessions start | where init runs, and `sessions` | here; each directory in `sessions` is listed as "sessions may also start in X", with `rulecast install --agent` there | never |
| Configs | `packages` and existing configs | one at the top, and one in each package that already has its own config, agent doc or `.claude/` | never |
| Pre-commit entry | `gitHooks` | on when pre-commit or lefthook is there without rulecast; `off` for husky, which init can't read; left out when rulecast is already in it | never |
| CI | `ci` | an aside in the footer: rulecast never edits CI | never |
| Conventions location | the config's `conventions`, else an existing folder such as `docs/conventions/`, else `primaryDoc` | that path | none of the three exists |
| Linter rules | `linters.offered` | each on, with `--linters`: the errors the linter's own config reports reach the agent after each edit (ESLint's when it stops), and only the ones its edit caused. The row says how many rules the config makes errors and how many warnings will not be delivered | never |
| Hook rules | `hooks.offered` | each checker on; `modifies: true` off (it changes files); `modifies: null` on or off once you have read its script; one with `sameAs` off, because the linter rule it names runs the same linter, after each edit | you cannot read the script |
| Generated paths | `generated` | each on, with `--generated` | never |
| Vendored paths | `vendored` | each on, with `--vendored` | never |
| Catalog rules | `catalog.rules` with `matching` above 0, not in a pack, not metered | each on, with `--catalog` | never. A metered one waits for the llm answer and is `off` until then |
| Stated conventions and memory corrections | your reading | each on: drafted after setup, one at a time | never |
| Up front or as you go | rulecast's default | as you go; struck, it takes the up-front path ([CONVENTIONS.md](CONVENTIONS.md)) | never |
| Weekly stats summary | the config's `stats.weeklySummary` | `off`, unless the config already has it on. Turned on, it is written with `--weekly-summary` | never: it is an item, and it never blocks approval |
| **llm rules** | | | **always**: they cost money per file, and the files leave the machine. Mark no option as recommended |
| **Agent loops with nobody watching** | `ci` is shown as found | | **always**: it makes rulecast stricter, and the repository can't show local `/goal` or `claude -p` runs |

The weekly stats summary row says what turning it on keeps: 26 weeks of per-week counts for `rulecast stats` (rule ids, file paths and counts, never code) on each machine, beside this config's findings log. The log alone holds about 8 MiB: weeks of work by hand, about a week for a loop that runs around the clock. It applies to this config only.

A linter rule delivers only errors: to have a warning delivered, the developer makes it an error in the linter's config. Each finding carries the linter's own page for its lint rule as a link, until a doc section is mapped to that rule after setup (step 7).

A hook rule runs when the agent stops, not after every edit, so a whole-project type checker is fine; only one slower than the stop check's timeout (`timeouts.verify_ms`, 60 s by default) is worth leaving off.

Stated conventions become candidates only when a pattern in the code can show them, at most five. One that names a generated path is not a candidate of its own: it joins that path's item, with a note that `AGENTS.md` says so too.

The loop answer decides the loop-safety pack (`rulecast add loop-safety`) and `RULECAST_MODE=unattended` for those runs. The llm answer decides `--llm-model` and `--llm-provider`; the provider is your own harness's (`claude-code` in Claude Code). Without a yes, no llm rule is ever proposed.

## 4. Show the page and ask

Fill [setup-page.html](setup-page.html). Copy the file and replace only the JSON in its `setup-data` block. Its head comment describes the fields, and how items are numbered (`n`) and marked (`state`). In that JSON, write every `<` inside a string as `\u003c`, as `init --format json` already does, so text such as a closing script tag cannot end the block early.

- `questions`: the open questions from step 3, with their options and why they are asked.
- `tree`: the repository as setup touches it. Configs, where sessions start, the conventions file or folder, generated and vendored paths, the files that change (`package.json` and its lockfile too, when rulecast is added as a devDependency), and what is not touched.
- `rules`: linter rules, hook rules, catalog rules, generated and vendored paths, each with its state. A linter rule's `text` gives its counts ("2 error rules, 1 warning not delivered"); a hook that is `off` for `sameAs` says which linter rule runs it instead.
- `decisions`: the setup rows from step 3. `found` is what step 2 showed, or null. `value` is the default. `why` says what it means here. `detail` shows exactly what changes: run the dry run again with the default flags and take the file contents from its `changes[].content`. For the install row, `detail` is the exact command step 6 will run (for the standalone binary, the whole command shown there).
- `candidates`: the stated conventions and memory corrections to draft as rules after setup.
- `footer`: what to say ("**go ahead**, or name numbers to strike or change"), which questions need an answer either way, and what the developer does themselves, such as CI.

If you have a tool that publishes private artifacts, publish the page there. Otherwise write it outside the repository, open it in the browser if you can, and tell the developer where it is.

In the same turn, ask every question on the page with your question tool, several in one call where the tool allows, and add one last question: "Everything else on the page: go ahead as shown / I'll name what to change". When the developer answers every question and picks go ahead, that is approval.

## 5. The reply

- Map what the developer says to numbers ("strike 4 and 7", "turn on 6", "2: also `backend/`", or free text) and repeat it back in one line.
- If the reply only strikes items, turns `off` items on, or answers the questions with options the page listed, that approves the page as amended. Say in one line what you will write ("Writing everything on the page except 5 and 8, llm rules with haiku"), and write it.
- If it changes a value or adds an item, show the page again with the change, keeping every number, and ask again.
- Ask again any question left unanswered. "Go ahead" never answers one.

## 6. Write

Only after the developer approves. First, install rulecast as approved, by running exactly the command the page showed. If the developer would rather run it themselves, give them the command and wait. Never install anything the page did not show.

- **The standalone binary:** this downloads the binary for this machine and its checksum from the latest release, checks them, installs it as `~/.local/bin/rulecast`, and puts that directory on the PATH. It prints every shell startup file it changed:

  ```sh
  curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh
  ```

  Everyone whose sessions run here installs it the same way. Tell the developer.
- **The devDependency:** add `@syv-ai/rulecast` with the project's package manager (`pnpm add -D`, `npm install -D`, `bun add -d`). The agent hooks and git hooks run that one first, so everyone gets the same version.
- **A global install:** `npm install -g @syv-ai/rulecast`. The hooks run it only when there is no devDependency. Everyone whose sessions run here installs it the same way.

These are the install row's three options. The hooks look for the project's `node_modules/.bin/rulecast` first, then for `rulecast` on the PATH, where the standalone binary and a global install both are. Then, in each config's directory:

```sh
rulecast init --agent <your adapter, e.g. claude-code> [--scope personal] [--linters linter/eslint,linter/ruff] [--hooks id,id] [--catalog id,id] [--generated path,path] [--vendored path,path] [--llm-model haiku --llm-provider <your harness, e.g. claude-code>] [--conventions docs/conventions/] [--weekly-summary]
```

Pass `--weekly-summary` where the developer turned on the weekly stats summary. Pass `--agent` only where sessions start. In a config's directory where they don't, pass `--no-agents` instead: hooks there would never run, and the install where sessions start already reaches that config.

`init` writes the config and the agent hooks, validates them, and says what to commit. `--generated` and `--vendored` add `generated-code` and `vendored-code` with `files` widened by those paths. If it fails with `unknown agent`, rulecast has no adapter for you yet: run it with `--no-agents`, and tell the developer rulecast cannot deliver rules to you yet. For any other failure, show the developer its output and stop.

Then, as the page says:

- **Sessions starting somewhere without a config:** run `rulecast install --agent <name>` there.
- **Pre-commit:** add rulecast's entry to `.pre-commit-config.yaml` or `lefthook.yml` as [Git hooks and CI](https://syv-ai.github.io/rulecast/guides/git-hooks-ci/) shows. Show the change first.
- **Conventions:** create the file or folder if it is new, with what the developer agreed should go in it. Show it first.
- **Agent loops with nobody watching:** `rulecast add loop-safety` adds the catalog pack that catches the shortcuts a loop takes to make tests pass. Tell the developer to set `RULECAST_MODE=unattended` for those runs. Set `mode: unattended` in a config only if nothing but those runs uses it: it makes every session there stricter.
- **CI:** tell the developer to add `npx rulecast install` and then `npx rulecast doctor --ci` before the agent step. In a project without Node, the step before them is the install command above (in GitHub Actions it adds its directory to `$GITHUB_PATH`), and they run `rulecast` in place of `npx rulecast`. Don't edit CI yourself.

## 7. Then

**Doc sections for the linter rules.** init writes each linter rule without any. For each `candidates` entry the dry run listed, and each error rule you find discussed in the docs by reading them, propose one mapping, one at a time, with the section quoted in a line. The developer agrees or rejects each one; a rule left unmapped keeps the linter's own link. Add the agreed ones under that rule's `context_by_rule` in the config, keyed by the lint rule's id as the dry run listed it (`eqeqeq: "@docs/conventions.md#comparisons"`), then run `rulecast validate`. The mappings go in the config only, never in the docs.

Draft each candidate the developer kept, one at a time: in Claude Code with `/rulecast:add-rule`, elsewhere with [DRAFT-RULES.md](DRAFT-RULES.md) for that one convention. Show each draft and get it approved on its own.

With none kept, tell the developer in two sentences how to add a rule later, and stop. Catalog rules can be adopted later too: `rulecast list --catalog` shows them, and `rulecast add <id>` adopts one.

**Up front** (the developer struck "as you go"): follow [CONVENTIONS.md](CONVENTIONS.md).

## Never

- Never write anything before the developer approves the page.
- Never write an item the developer has not seen on the page.
- Never take "go ahead" as an answer to a question on the page.
- Never add a `rulecast-ignore` comment or set `enabled: false` on a rule without the developer's agreement. Ignores added during a session are reported to the developer when you stop.
- Never edit agent hook settings (such as `.claude/settings.json`) by hand: `rulecast init`, `install` and `uninstall` manage them.
- Never set rulecast up without the developer.
- Never commit. The developer reviews and commits.
