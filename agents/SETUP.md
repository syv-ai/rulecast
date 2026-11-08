# Set up rulecast in a project

Use this when the developer asks you to set up rulecast. rulecast delivers a project's conventions to coding agents while they work: rules in `.rulecast-config.yaml` pair a check with a message and a pointer to the doc section it enforces.

Setup is short. You find out what the repository can tell you, ask the developer the rest, show them one page with everything you agreed, and write it once they approve. Most rules come later, one at a time: with `/rulecast:add-rule` from the rulecast plugin in Claude Code, or with [DRAFT-RULES.md](DRAFT-RULES.md) for one convention elsewhere.

Relative links in this file resolve against this file's own URL. Commands below say `rulecast`. If `rulecast` is not on the PATH, use `~/.cache/rulecast/bin/rulecast` if it exists, else `npx @syv-ai/rulecast`.

## 1. The developer is there

Every decision here is the developer's. Ask, and wait for the answer. If you were told to work without the developer, stop and say why: rulecast enforces conventions the developer chose, and nobody else can choose them.

## 2. Find first

Before asking anything, read what answers questions for you:

- The docs: `README`, `AGENTS.md` or `CLAUDE.md`, `CONTRIBUTING`, anything under `docs/`.
- The tree: packages, their languages and tools, where agent instructions sit (`.claude/`, `AGENTS.md` per package).
- Who works on it: `git log --since="6 months ago" --format='%an' | sort | uniq -c`.
- Git hooks and CI: `.pre-commit-config.yaml`, `lefthook.yml`, `.github/workflows/` and the like, and whether an agent runs in CI.
- Any `.rulecast-config.yaml` already there.
- Whether rulecast is installed: `rulecast binary path` names an installed standalone binary, and `node_modules/.bin/rulecast` is a devDependency. Note whether there is a `package.json`, and whether the project pins its tools there.
- Your own memory of this project, if you keep one (in Claude Code, `~/.claude/projects/<project>/memory/`). Corrections the developer made before are the best candidates for first rules.
- What init sees, in each directory a config might go:

  ```sh
  rulecast init --dry-run --format json
  ```

  It writes nothing. It reports the stack, the docs and their headings, the agents it detects, the project's pre-commit and lefthook hooks it can run as rules (and the ones it can't, with why), the config's current settings, and every file it would write.

Write down what this settles, so you don't ask it.

## 3. Interview

Ask in this order, one question at a time, with your question tool if you have one. Put your recommendation first. When step 2 already answered a question, say what you found in one line and ask only whether it holds.

1. **Who it's for and where it runs.** Solo or a team. Where rulecast should run: in agent sessions (always), on pre-commit, in CI, in agent loops that run with nobody watching (`/goal`, `claude -p`, scheduled runs). A team gets shared hook settings and a committed config; one person can keep them personal.
2. **Where configs go and where sessions start.** One `.rulecast-config.yaml` at the top, one per package, or both. Every config above a file applies to it, each on its own: its rules, its paths and its findings. Nothing is merged. Agents read hook settings only in the directory a session starts in, so hooks are installed there; one install reaches every config below it.
3. **Where conventions live, and how the developer thinks about them.** A file, or a folder with one file per area (`docs/conventions/errors.md`, `docs/conventions/testing.md`). New conventions are written there when a rule is added. Ask how many rules they want and how strict: a few that always hold, or broader coverage.
4. **llm rules.** Some conventions can't be shown with a pattern, and an llm rule asks a model about each changed file. It sends the file to the model's provider and costs money per file. Ask whether that is OK, and with which model. Recommend `haiku`, the cheapest. The provider is your own harness's (`claude-code` in Claude Code). Without a yes, no llm rule is ever proposed.
5. **The project's own hooks as rules.** For each hook the dry run offers, say what it would do as a rule: the agent sees its findings before it finishes, not first at commit. A hook rule runs when the agent stops, not after every edit, so a whole-project type checker is fine; only one slower than the stop check's timeout (`timeouts.verify_ms`, 60 s by default) is worth leaving out. Recommend leaving out formatters (`modifies: true` in the JSON: they change files). A hook with `modifies: null` ("may change files" in the text output) runs a script init cannot see into, named in `runs`: read that script before you recommend it.
6. **Review up front, or build as you go.** As you go is the default: rules are added when something goes wrong, with `/rulecast:add-rule`. Up front means working out the conventions now, through [CONVENTIONS.md](CONVENTIONS.md), which takes longer.
7. **How rulecast is installed.** The agent hooks and git hooks run the project's `node_modules/.bin/rulecast` first, then the standalone binary in `~/.cache/rulecast/bin/`, then one on the PATH. Recommend the standalone binary: it needs no Node and no change to the project. If the project already pins its tools in `package.json`, recommend the devDependency instead, so everyone runs the same version. If one is already installed, say which and ask whether it holds.

## 4. Show the page

Fill [setup-page.html](setup-page.html) with what you agreed. Copy the file and replace only the JSON in its `setup-data` block; its head comment describes the fields. In that JSON, write every `<` inside a string as `\u003c`, as `init --format json` already does, so text such as a closing script tag cannot end the block early.

- `tree`: the repository as setup touches it. Configs, where sessions start, the conventions file or folder, the files that change (`package.json` and its lockfile too, when rulecast is added as a devDependency), and what is not touched.
- `rules`: the hook rules chosen, and llm rules if allowed.
- `decisions`: one row per question in step 3. `found` is what step 2 showed, or null. `said` is the developer's answer, close to their words. `why` says what the choice means here. `detail` shows exactly what changes: take the file contents from the dry run's `changes[].content`, run again with the agreed flags, and for hook rules show the rules. For the install, `detail` is the exact command step 5 will run. Add one more row that is not a question: "Weekly stats summary", with `found: null` and `said: "off"` unless the developer turns it on. Its `why`: turned on, this config keeps 26 weeks of per-week counts for `rulecast stats` (rule ids, file paths and counts, never code) on each machine, beside its findings log. The log alone holds about 8 MiB: weeks of work by hand, about a week for a loop that runs around the clock. Applies to this config only.
- `candidates`: on the as-you-go path, the first-rule candidates from step 6, each with a rough `sketch` of its rule.

If you have a tool that publishes private artifacts, publish the page there. Otherwise write it outside the repository, open it in the browser if you can, and tell the developer where it is. Then ask in the chat whether to go ahead. If they change something, go back to that question, and show the page again.

## 5. Write

Only after the developer approves. First, install rulecast as approved, by running exactly the command the page showed. If the developer would rather run it themselves, give them the command and wait. Never install anything the page did not show.

- **The standalone binary:** this downloads the binary for this machine and its checksum from the release, checks them, and runs `rulecast binary install`, which puts it in `~/.cache/rulecast/bin/`:

  ```sh
  sh -c 'case "$(uname -s)-$(uname -m)" in Linux-x86_64) T=linux-x64;; Linux-aarch64|Linux-arm64) T=linux-arm64;; Darwin-arm64) T=darwin-arm64;; Darwin-x86_64) T=darwin-x64;; *) echo "rulecast: no standalone binary for $(uname -s) $(uname -m)" >&2; exit 1;; esac; D=$(mktemp -d) && cd "$D" && curl -fsSLO https://github.com/syv-ai/rulecast/releases/download/v0.8.2/rulecast-$T && curl -fsSLO https://github.com/syv-ai/rulecast/releases/download/v0.8.2/rulecast-$T.sha256 && if command -v shasum >/dev/null 2>&1; then shasum -a 256 -c rulecast-$T.sha256; else sha256sum -c rulecast-$T.sha256; fi && chmod +x rulecast-$T && ./rulecast-$T binary install; R=$?; cd / && rm -rf "$D"; exit $R'
  ```

  Everyone whose sessions run here installs it the same way. Tell the developer.
- **The devDependency:** add `@syv-ai/rulecast` with the project's package manager (`pnpm add -D`, `npm install -D`, `bun add -d`). The agent hooks and git hooks run that one first, so everyone gets the same version.

Then, in each config's directory:

```sh
rulecast init --agent <your adapter, e.g. claude-code> [--scope personal] [--hooks id,id] [--llm-model haiku --llm-provider <your harness, e.g. claude-code>] [--conventions docs/conventions/] [--weekly-summary]
```

Pass `--weekly-summary` where the developer turned on the weekly stats summary. Pass `--agent` only where sessions start. In a config's directory where they don't, pass `--no-agents` instead: hooks there would never run, and the install where sessions start already reaches that config.

`init` writes the config and the agent hooks, validates them, and says what to commit. If it fails with `unknown agent`, rulecast has no adapter for you yet: run it with `--no-agents`, and tell the developer rulecast cannot deliver rules to you yet. For any other failure, show the developer its output and stop.

Then, as agreed:

- **Sessions starting somewhere without a config:** run `rulecast install --agent <name>` there.
- **Pre-commit:** add rulecast's entry to `.pre-commit-config.yaml` or `lefthook.yml` as the README's [Git hooks and CI](https://github.com/syv-ai/rulecast#git-hooks-and-ci) shows. Show the change first.
- **Conventions:** create the file or folder if it is new, with what the developer agreed should go in it. Show it first.
- **Agent loops with nobody watching:** `rulecast add loop-safety` adds the catalog pack that catches the shortcuts a loop takes to make tests pass. Tell the developer to set `RULECAST_MODE=unattended` for those runs. Set `mode: unattended` in a config only if nothing but those runs uses it: it makes every session there stricter.
- **CI:** tell the developer to add `npx rulecast install` and then `npx rulecast doctor --ci` before the agent step. In a project without Node, the step before them is the install command above, and they run `~/.cache/rulecast/bin/rulecast` in place of `npx rulecast`. Don't edit CI yourself.

## 6. Then

**As you go:** offer a short list of first rules, and recommend one. Look for candidates in:

- conventions the docs state that nothing checks yet;
- corrections the developer made in this session;
- your memory of the project;
- the project's hooks that were not made rules;
- best practice for the project's languages and tools: `rulecast list --catalog` shows the catalog's rules, and `rulecast add <id>` adopts one. You may suggest design practices too; say they are suggestions;
- past agent sessions, only if the developer says you may read them (`rulecast replay` reads Claude Code's transcripts).

If the developer picks one, add it: in Claude Code with `/rulecast:add-rule`, elsewhere with [DRAFT-RULES.md](DRAFT-RULES.md) for that one convention. If not, tell them in two sentences how to add a rule later, and stop.

**Up front:** follow [CONVENTIONS.md](CONVENTIONS.md).

## Never

- Never write anything before the developer approves the page.
- Never add a `rulecast-ignore` comment or set `enabled: false` on a rule without the developer's agreement. Ignores added during a session are reported to the developer when you stop.
- Never edit agent hook settings (such as `.claude/settings.json`) by hand: `rulecast init`, `install` and `uninstall` manage them.
- Never set rulecast up without the developer.
- Never commit. The developer reviews and commits.
