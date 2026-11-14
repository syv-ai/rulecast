# @syv-ai/rulecast

## 0.15.0

### Minor Changes

- ed31926: rulecast now types files the way pre-commit does, so a hook rule on an `always_run` pre-commit hook can skip changes the hook doesn't care about. `rulecast init` and `rulecast doctor` say when it can't.
  
  pre-commit runs an `always_run` hook on every commit, whatever changed. `rulecast init` wrote such a rule with no `files`, so rulecast ran the hook, often a whole-project type check, on every commit and every agent stop, even when only Markdown changed.
  
  - **File types follow pre-commit's identify (2.6).** `types`, `types_or` and `exclude_types` now know identify's other extensions and file names for each tag: `python` takes `.wsgi`, `.pyt`, `.tac`, `.gyp` and `wscript`; `shell` takes `.bash`, `.zsh`, `.csh`, `.bats`, `.bashrc`, `.envrc` and `PKGBUILD`; `markdown` takes `.markdown`; `html` takes `.htm` and `.xhtml`; `json` takes `.ipynb`, `.geojson` and `Pipfile.lock`; `toml` takes `Cargo.toml`, `Pipfile` and `poetry.lock`; `yaml` and `plain-text` take their config and doc names (`README`, `LICENSE`, `README.md` too). An executable file whose name and extension identify doesn't know is typed by its shebang, read as identify reads it: `python`, `python3.12` or `pypy` gives `python`, a shell gives `shell`, `node` gives `javascript`, also through `#!/usr/bin/env [-S] …`, a quoted interpreter path, or nix-shell's `-i`. Only its first 256 bytes are read (4 KiB for nix-shell), once per file per run, and only for rules with type tags. A symlink has no type, as in identify. Breaking: an existing rule with type tags now also sees these files and no longer sees symlinks, and a rule with `exclude_types` now leaves these files out and no longer leaves out symlinks.
  - **init:** the rule now gets the hook's own `types`, `types_or`, `exclude_types` or `files`, from the config or the remote hook's `.pre-commit-hooks.yaml` in the clone pre-commit or prek already made, as far as the rule still takes in every file the hook checks. Every type but `text`, which pre-commit decides from a file's content, is carried over. An `exclude_types` is carried only for a type rulecast gives no more files than pre-commit (not `python`, `ts`, `shell`, `javascript` or `text`). A `files` regex is made relative to the project, unless JavaScript reads it differently (`\Z`, `{,n}`, `\w`) or, below the git top, it has a top-level `|` or a lookbehind. The rule's description says why it has a filter, and names any part of the hook's filter left out, for example "Runs only when a Python file changed: the hook is always_run, so pre-commit would run it on every commit. Changing only a config file it reads, such as pyproject.toml, doesn't run it." The config file it names follows the types (`tsconfig.json` for `ts`), and none is named when they don't say. When the rule would still run on every change, init's output says why, and `init --format json` gives it in `everyChange`: an `always_run` or `pass_filenames: false` hook with no files or types, a filter that can't be carried over, a remote hook whose manifest isn't on disk, or a lefthook job with no files template, glob or root.
  - **lefthook:** a job's `glob` list now uses every glob, `[…]` classes (`*.[jt]s`, `[!_]*`) are read as classes, and a `root` keeps the files under it while the glob is matched from the git top, as lefthook does. Before, `root: backend/` with `glob: "backend/src/*.py"` gave a rule that matched no file.
  - **doctor:** warns about an existing hook rule with no `files` or type tags whose hook is `always_run`, `pass_filenames: false` with no files or types, or a lefthook job with no files template. It names the filter to add, such as `types: [python]`, or why a rule can't match the hook's filter. It's a warning: doctor still exits 0.
  - A rule with such a filter no longer runs the hook when only a config file it reads changed, such as `pyproject.toml` or `mypy.ini`.
- 2d4352c: A Claude Code subagent now starts with the paths of the project's convention docs: the `conventions` file or folder and the files the project's rules cite, at most 8, never their content. It arrives through the SubagentStart hook, in the subagent's own context. The new config key `subagent_docs: false` turns it off for a project.

### Patch Changes

- 2d4352c: Claude Code hooks catch up with Claude Code 2.1.325. Re-run `rulecast install` where sessions start; `rulecast doctor` says the hooks are out of date until then.
  
  - **Hand-backs are not prompts.** In auto mode a subagent's report reaches the main agent as a prompt starting `<agent-message`, and each one reset the stop gate as if the user had written it. Those, and task notifications, no longer count. When Claude Code sends the prompt's `source`, only `user` and `sdk` prompts count.
  - **Internal agents under `claude --agent`.** `/compact`, `/btw` and prompt suggestions run as subagents of the session's own agent type, and their stops were checked like real subagents'. A subagent stop or start whose type is the session's own is now left alone.
  - **Work still running at a stop.** When the main agent stops while a background subagent it started is still running in the same checkout, that subagent's files are left to it, and checking files changed outside the agents' tool calls waits for a later stop; the stop says so in one line. A running background shell command (a dev server, a watcher) defers nothing. A subagent's own stop ignores the task list, which describes the parent session.
  - **Worktrees.** The configs of a worktree the agent enters with EnterWorktree, and of an isolated subagent's worktree, count as its projects from then on, not only once it edits there.
  - **More edit tools.** NotebookEdit and MultiEdit edits are checked. A Read that fails because the file is too large still delivers the file's conventions.
  - New hook groups: `PreToolUse (SubagentHandback)`, `PostToolUse (EnterWorktree|ExitWorktree)`, `PostToolUseFailure (Read)` and `SubagentStart`. The edit group's matcher becomes `Edit|Write|MultiEdit|NotebookEdit`, widened in place.
- 2d4352c: Sessions that start somewhere other than where the hooks were installed:
  
  - **Personal hooks name the script by its absolute path.** Claude Code reads `.claude/settings.local.json` at the top of the checkout even when a session starts in a subdirectory, but sets `$CLAUDE_PROJECT_DIR` to that subdirectory, so every personal hook failed with exit 127. `rulecast install --scope personal` and `rulecast init --scope personal` now write the script's absolute path; the file is not committed. An older personal install shows as out of date in `rulecast doctor`.
  - **The hook script finds the project from its own location**, not from `$CLAUDE_PROJECT_DIR`.
  - **`claude --worktree`.** A fresh worktree has no `node_modules`, so the hook script ran whatever rulecast was on the PATH. It now runs the main checkout's `node_modules/.bin/rulecast` first, found from the worktree's `.git` file without running git. `rulecast doctor` says which rulecast runs.
  - **`rulecast doctor` warns when sessions started in the current directory run no rulecast hooks** while configs exist above it in the same checkout, and says where the hooks are. A worktree with its own committed settings, such as one under `.claude/worktrees`, is judged by those.
  - **Personal and shared hooks never both run rulecast.** Claude Code merges only identical hook commands, so both ran it twice on every event. Personal hooks have one file, `.claude/settings.local.json` at the checkout's top (the main checkout's, from a worktree), read for every session in the checkout and its worktrees; a personal install, from any directory, writes or upgrades only that file, and never counts a `settings.json` as installed. A shared install writes `.claude/settings.json` in its own directory. `rulecast install` and `rulecast init` never remove hooks from a file nobody named: a personal install refuses (exit 2) while shared rulecast hooks exist where this checkout's sessions start (the run directory, the top, every config directory below it, every worktree's top), and a shared install refuses while the personal file has them. Each refusal names the files and the `rulecast uninstall --scope <x>` to run, and where. `rulecast uninstall` takes `--scope` and removes only the files in the directory it runs in, and says where to run it when the personal file is elsewhere. A `settings.local.json` below the top is a leftover Claude Code never reads: not installed, and `rulecast doctor` says how to remove it. doctor's remedies say where to run them, and it reports both scopes at once as an error, unless their commands are identical. Breaking: a project with rulecast hooks in both scopes is refused by `rulecast install` until one is uninstalled, and a plain `rulecast install` no longer upgrades personal hooks: use `--scope personal`.
  - **doctor** names the write guard's event when it is missing ("the write guard (PreToolUse Edit|Write)"), and says the guard can't be judged until a pinned rule repo is fetched, rather than calling the hooks out of date.
  - **Rule repos are fetched before the guard is judged** by `rulecast init` too. `rulecast add` says to run `rulecast install` when a rule it added refuses writes and the write guard isn't installed.
  - An older install's edit hook group that also holds a hook of the user's is left as it is; rulecast's hook moves to a group of its own.
- 2d4352c: Attended, a stop with findings now gives them to the agent as Stop context (`hookSpecificOutput.additionalContext`) instead of a block. The turn continues the same way, but Claude Code no longer frames the findings as a "blocking error", which agents had read as instruction injection. The unattended hold stays a block. Breaking: a tool that read `decision: "block"` from an attended stop's output now finds `hookSpecificOutput.additionalContext`.
- 2d4352c: In Claude Code's auto mode, a subagent's findings now reach it at its hand-back. Auto mode ends a subagent with the SubagentHandback tool, and a block at its SubagentStop came too late: Claude Code recorded it and the subagent never resumed. rulecast now checks the subagent when it hands back and refuses the hand-back with the findings, so it fixes them or puts them in its report. Claude Code retries a refused hand-back only a few times before the report is lost, so it is refused at most once (unattended, once more to report), whatever `max_blocks` says. The SubagentStop after a hand-back is no longer checked.
- 2d4352c: `rulecast install` and `rulecast init` now add the hook that runs before every Edit and Write only when a config a session there reaches has a `refuse_write` rule (`true` or `unattended`, catalog rules included). Without one, that hook cost every edit a process start and a config compile for nothing. Re-running either removes it from an older install that doesn't need it. `rulecast doctor` reports an error, and exits non-zero, when a config has a `refuse_write` rule but no such hook is installed, naming `rulecast install` as the fix. Install now fetches missing rule repos before it writes the hooks, so a catalog rule's `refuse_write` is known. `init` judges its own config as it is about to write it.

## 0.14.0

### Minor Changes

- 287ad5c: Biome is now a supported linter, and `rulecast init` reports the linters and CI systems it finds but can't use (#75, #76).
  
  - **Biome:** `detect: { linter: { tool: biome } }` delivers what the project's `biome.json` makes an error. `rules: [suspicious/noDebugger]` turns on named rules, with ids written as in `biome.json`; a bare name such as `noDebugger` is refused, since Biome reports `group/rule` and it would never match a finding (in `context_by_rule` too). rulecast runs `biome lint --reporter=rdjson` and links each finding to Biome's page for the rule. `init` offers it when `biome.json` or `biome.jsonc` is there and Biome is installed. It can't say which rules the config makes errors, so it shows no count. A pre-commit hook `biome-check`, `biome-lint` or `biome-ci` is marked as the same as the linter rule.
  - **Linters that are not offered:** `init --dry-run` lists them under `linters.unoffered`, and the text output names them. That covers a linter rulecast doesn't support (golangci-lint, RuboCop, stylelint, flake8, Pylint, Clippy, markdownlint, hadolint, ShellCheck), which a `command` rule can run, and a supported linter whose config is there but which isn't installed. Before, both were left out without a word.
  - **CI:** `detected.ci` now lists every CI config by system: `github-actions`, `azure-pipelines` (including templates in `.azure-pipelines/`), `gitlab-ci`, `circleci`, `bitbucket-pipelines` and `jenkins`. `agent` names the coding agent a config runs, or is `null`. Before, it listed only GitHub workflows that run an agent, so an Azure Pipelines repository read as having no CI. Breaking: `ci` entries now carry `system`, and `agent` may be `null`.
- c34e1c9: Rules can now judge commit messages (#79). A rule with `stages: [commit-msg]` checks the message, not files. `rulecast run --commit-msg FILE` runs these rules on the message in FILE, with the commit-msg rules of every config in the repository, at its top or in a package. Findings name the message `COMMIT_EDITMSG`. The commit-msg git hook runs it, so every committer is checked, person or agent. An agent sees its commit fail with the finding.
  
  - **Hook entries:** pre-commit gets a new `rulecast-commit-msg` hook id at the `commit-msg` stage. The lefthook and hk snippets in `guides/git-hooks-ci.md` have a `commit-msg` entry, and the message file is quoted in them: in a linked worktree git passes an absolute path, which can hold a space. The guide's pre-commit config installs the `commit-msg` hook too. All three are tested against the real tools.
  - **What is judged:** the message as git will record it. Everything from the scissors line down is left out (the diff `git commit -v` shows), whatever the comment character. Comment lines are blanked, so a finding's line is the line in the message file. The comment character comes from the scissors line, else `core.commentChar` or `core.commentString`. With `commit.cleanup` set to `whitespace`, `verbatim` or `scissors`, comment lines are kept, as git keeps them. The hook can't tell a `-m` or `-F` message, a `--cleanup` given on the command line, or which character `core.commentChar=auto` chose without a scissors line. In those cases, lines starting with the comment character (`#` for `auto`) are still dropped.
  - **Which detectors:** a commit-msg rule needs a detector that judges the text it is given, such as `regex` or `ast-grep`. It can't use `llm`: the hook runs on every commit, and a commit should not cost money. `commit-msg` must be the rule's only stage. The rule can't have `files`, `exclude`, `types`, `types_or`, `exclude_types`, `scope`, `refuse_write` or a `fix`, and `rulecast validate` says so when one is set. `rulecast doctor` doesn't try such a rule on project files.
  - **Flags:** `--commit-msg` takes no files, refs, rule id, `--summary`, `--llm`, `--no-llm` or `--session`. Each of them is a usage error (exit 2).
  - **A rule that doesn't compile:** a broken commit-msg rule makes `run --commit-msg` exit 3 instead of reporting "no findings". So does a broken rule whose stages are unknown, or a `repos` entry that can't be read, since either could hold commit-msg rules. A broken rule that judges files doesn't block commits, whatever config it is in. `run` and the pre-commit hook still report it.
  - **An example:** the guide has a "Commit messages" section with a rule that keeps AI co-sign trailers (`Co-Authored-By: Claude`, "Generated with Claude Code") out of commits. It is a recipe, not a catalog rule, since it's a project's policy rather than a language or tool standard.
- 5e1609c: Conventions review now scales past a few dozen candidates (#82). `CONVENTIONS.md` has a new step, "Many candidates", for when the developer asks for conventions from many sources and a one-question-at-a-time chat would take days.
  
  1. **Mine** each source into candidates of one shape: the text, every source with its exact words, what the code does today, what could check it, what should enforce it, and where it would be written.
  2. **Merge** them into one candidate per convention, keeping every quote. Where sources disagree, the disagreement becomes a conflict with options and a recommendation.
  3. **Group** them into topics in dependency order, and recommend keep, reword or decline for each.
  4. **Review** them on a new interactive page, `agents/conventions-review.html`. Conflicts come first, then one step per topic. Each candidate is a card the developer keeps, keeps in their own words, or declines with a reason. A decided card closes and the next one opens. There is a progress bar, a "show undecided only" switch, and a Finish step with the tally.
  5. **Read back** the decisions. Published as an artifact with the `db` capability, they are saved with the page and the agent reads them back. As a local file (`conventions-review.local.html`), they stay in the browser, and Finish copies them as JSON to paste into the chat.
  
  Declines carry their reason into `declined.md`. The page follows the viewer's light or dark theme.
- 0eb4aab: `rulecast doctor --time` reports whether tool-backed rules fit in the stop check's time budget (#83). It runs each rule whose detector runs a tool (a hook, a command, a linter) once, over every file the rule matches, which is the most an agent's stop can hand it. A new `timing` section reports its wall time against `timeouts.verify_ms`, for example `mypy-check — 41.2 s of 60.0 s on 928 files`. A stop runs all its rules in one budget, hooks one after another, so a last line runs them all together the way a stop does (`rulecast run --all-files`, llm rules left out): two rules that each fit can be cut off together. A rule or set of rules over the budget is a warning, which suggests raising `timeouts.verify_ms`, or switching the rule off and running the tool from a git hook or CI job of its own. A rule whose tool is missing, or whose dry run failed, is said once above and not timed. Before, a whole-project type checker or test suite had to be turned on before you found out it was too slow. In-process detectors (regex, ast-grep) take milliseconds and `llm` rules cost money per run, so neither is timed alone. `SETUP.md` has the agent run it after setup.
  
  A tool rulecast runs now gets a process group of its own, and a deadline ends the whole group. Before, only the tool itself was killed: a pre-commit hook's formatter kept running past the deadline and rewrote the files after rulecast had put them back. Ctrl-C, SIGTERM or SIGHUP to rulecast ends the tools it is running. A process that left the group but still holds the tool's output no longer keeps rulecast waiting past the deadline. Ctrl-C during `doctor` ends the running tools, puts back what a formatter hook changed, and exits 130.
  
  `doctor`'s touch-context section divides the message the way the hook does when other configs above a file also send touch context for it. Before, it measured each config against the whole message, said it fitted, and the hook then cut both.
- b1d45e0: The git hooks no longer block a commit or push when rulecast isn't installed (#84). A teammate who hasn't installed rulecast now sees this line, and the commit or push goes through:
  
  ```text
  rulecast is not installed, so this hook checked nothing. To install it, run curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh
  ```
  
  Before, the pre-commit and lefthook entries ended by running install.sh's rulecast, so with no rulecast anywhere they failed with "No such file or directory" and blocked every commit. The agent hooks already skipped in this case. A rulecast that can't start now counts as none too, including the project's own `node_modules/.bin/rulecast` when the `PATH` has no `node`, as in some GUI git clients. Before, that one blocked the commit with "node: not found".
  
  The pre-commit entries are now `verbose: true`. pre-commit hides a passing hook's output, so without it the warning was never shown. Every git-hook entry (pre-commit, lefthook, hk) now runs `rulecast run --quiet`, so a clean commit or push prints nothing. Findings, warning-severity ones included, and an incomplete run print as before. `--quiet` works with the terminal and agent formats only; json, sarif, `fix` and `try-repo` reject it. The new entries need this release's rulecast, since an older one rejects `--quiet`. `rulecast doctor --ci` still fails when rulecast is missing, so CI is where a missing install shows up. A rulecast that runs and reports findings still fails the hook as before.
  
  pre-commit picks up the new entry when you move `rev` to this release. The lefthook `run:` lines are copied into your `lefthook.yml`, so copy them again from `guides/git-hooks-ci.md`. The guide also has a new "A team" section on what happens for teammates without rulecast.
- 073cf5e: rulecast now supports [hk](https://hk.jdx.dev) as a git-hook manager, beside pre-commit and lefthook (#87).
  
  - **`hook` rules can run an hk step:** `detect: { hook: { hk: pre-commit/eslint } }` names a hook and a step in `hk.pkl` (or `.config/hk.pkl`, the config hk reads after `hk.pkl`). A `commit-msg` step is refused: it checks the commit message, and a hook rule runs on files. rulecast runs `hk run <hook> --check --step <step> --stash none --no-stage --format json` on the rule's files. Only the step's check command runs, never its fix, and the working tree is left as it is. A `pre-push` step is run with `--from-ref HEAD --to-ref HEAD` and stand-ins for the remote and its url, so hk checks exactly the rule's files and never contacts the git remote. A step is not run at all while hk's Pkl package is not in its cache: the rule's error names `hk validate`, which downloads it once, so a hook never fetches it behind the developer's back; every hk call also runs with `HK_PKL_OFFLINE=1`, so hk itself refuses to download. The step's output is read like any other hook's.
  - **`rulecast init` offers hk's steps when hk is installed.** `hk.pkl` is written in Pkl, which only hk can evaluate, so init asks hk for its plan (`hk run <hook> --plan --json --all --check`) of the `pre-commit` and `check` hooks, and offers each step once, with every hook it is in as its `stages`. Init uses no network for this: hk is asked only when every Pkl package its configs use is already in hk's cache (`$HK_PKL_CACHE_DIR` when set), and never for `pre-push`, whose plan asks the git remote. Otherwise `hooks.skipped` says so and names the hk command that lists the steps. It also lists a step hk never runs to check (only a fix command, or a profile that is not enabled), each `commit-msg` step, and hk's own error when it can't plan a hook. Without hk installed, the dry run says the steps couldn't be read. `detected.gitHooks` now lists hk.
  - **`rulecast doctor` checks hk:** whether hk is installed, and every hook or step a rule names that hk doesn't know or never runs to check. Under the same rule as init, it warns instead of asking hk when that would use the network.
  - **The git hooks guide has an hk section,** with the `rulecast` steps for `pre-commit` and `pre-push` in `hk.pkl`.
  
  Tested against hk 2.12.0.
- 7d552fc: `rulecast init` now flags hooks that can never fail, and says at which git stage each hook runs (#77, #78).
  
  - **Hooks that can never fail.** An offered hook whose command exits 0 whatever it finds now has `neverFails` in the dry-run JSON. Only how the command ends counts: it ends in `|| true`, `|| :`, `|| exit 0` or `|| echo …`, ends with `exit 0` or `true` on its own (after `;` or on its last line), or pipes into `tee` without `pipefail`. The value is that part, found in the hook's entry, or inside a `bash -c '…'` that is its last command (`sh -c 'mypy .' || true` is judged by the outer `|| true`) or in the package script its last command runs (in `npm run prep && npm run lint`, lint's). A bare `exit 0` or `true` at the end counts only when nothing could stop the script first: not under `set -e`, `set -o errexit` or `sh -ec`, and not after an `exit 1` or `exit $?`. A guarded setup line (`rm -f x || true; mypy .`), a `$(… || true)`, text in quotes, a comment, and `set +e … exit $status` are not flagged. The text output says `(never fails: || true)`. A rule built on such a hook never fires, so `SETUP.md` now has the agent leave it off and tell the developer, who may believe it is a gate.
  - **Stages.** An offered hook has `stages` when its config names them: the hook's own pre-commit `stages`, the config's `default_stages`, or for lefthook the hook it sits under. `commit-msg` hooks check the commit message, not the code, and `manual` hooks run only when asked for and may be slow. `SETUP.md` has the agent leave both off by default, and the text output says why.
- 043e88f: An `llm` rule can now see what the change removed from its other files, so a moved class no longer looks like a new one (#72). The model judges one file at a time. A rule that asks "is this a second model of an existing concept?" used to flag a class moved into a new file, because nothing in that file showed it had existed before. With `removed_definitions: true` under `detect.llm`, the prompt for each file also lists the definitions the change removed from its other files, deleted and moved files included: `class Order:`, `def total():`, `export interface Cart`, `public class Order {`, `data class Order(`, and the like. A moved definition then reads as moved.
  
  The old text comes from a commit: the session's start commit at an agent's stop, the merge base with `--from-ref`, or HEAD in a staged run. It is read only when such a rule runs, and at most 60 lines from other files are sent. A rule with this key gets its own model call per file, so the other rules' prompts and cached answers don't change.
- 1799616: rulecast now tells an agent when one of its shell commands works in another checkout of the repository (#71). A subagent that made its own worktree and ran `cd ../w1-m && sed …` from the lead's directory was invisible to rulecast. A shell call's hooks arrive with the session's working directory, so rulecast compared that tree and never saw what changed in the other checkout. Those edits were neither checked nor logged, which is why some worktrees had no `rulecast stats` data.
  
  The first time a command names another checkout that has a rulecast config above or below the place it names, and the call's checks didn't cover it, the agent is told once that edits there aren't checked. That holds even when the agent's own directory has no config. A checkout with a detached HEAD, such as a throwaway `git worktree add --detach` copy a gate runs tests in, is left out. The notice tells it to switch into that checkout first (in Claude Code, `EnterWorktree` with its path) or to use Edit and Write. Where a command works is read from `cd`, `pushd`, `git -C` and `make -C`, and from the paths in it: absolute, `~/`, and relative ones with a slash. Paths built from shell variables, paths inside quoted text with spaces such as a commit message, and here-document bodies aren't followed. Which checkout a path is in is read from its `.git`, without running git, so a command that names only places in the current checkout or outside every checkout costs no git call. `guides/advanced.md` describes the pattern.
  
  The Claude Code adapter now passes a Bash call's command text on in its shell events.
- 6c17270: `rulecast stats --worktrees GLOB` reads the project's log in every checkout of the repository whose directory name matches the glob (#71). `--worktrees '*'` reads them all and `--worktrees 'w2-*'` picks some. The flag is repeatable. Each worktree keeps its own log, so a setup with one worktree per agent used to mean running `stats` in each one and comparing by hand.
  
  Worktrees removed since are included while their logs are still in rulecast's cache, wherever they were: the cache now records which repository each project's checkout belongs to, and only this repository's are read. The output names each checkout read, and marks those removed and those with nothing logged. Findings in different checkouts are kept apart even within one session: a lead session that spans ten worktrees doesn't merge a finding fixed in one with the same finding left open in another. `sessions` still counts each session once, and so do the weekly session counts and the files a rule keeps firing on, over what the logs still hold. The weekly summary keeps counts rather than session ids, so for the weeks it covers, each checkout's count is added: a session that ran in two checkouts counts twice there. `--format json` lists the checkouts under `checkouts`.
- 427874c: Subagents that work in their own worktrees no longer end up in each other's checks, and a new `subagent_projects` setting decides whether the main agent checks their worktrees (#68, #73).
  
  rulecast remembers which projects a session worked in, so a stop or a shell call, which name no file, knows where to check. Until now that memory was shared by every agent in the session. Once a subagent edited a file in its own worktree, every other agent's shell calls and stops ran there too:
  
  - A subagent's shell call was compared against the lead's worktree and its siblings' worktrees, so their writes during the call were held to it.
  - The main agent's shell calls got the "another agent ran a shell command in this working tree" notice, which told it to give each agent its own worktree when it already had. The subagent's changed files were also treated as the main agent's edits, so it got their findings and touch context.
  - The main agent's stop sent every subagent's files to `llm` rules a second time, and could hit `llm.max_files_per_verify` on work it can't act on.
  
  Now each project is remembered for the agent that worked in it:
  
  - A subagent's shell calls and stop reach the projects above where it is, the ones the session start found below where it is, and the ones it worked in itself. Never another agent's, and never one in another checkout of the repository: a subagent in `<repo>/.claude/worktrees/x` no longer reaches the lead's config at `<repo>`.
  - A project counts as an agent's once it edits a file there, or a shell command of its changes one there. Reading a file no longer does, so the main agent reading a subagent's files doesn't pull that worktree into its own checks.
  - The main agent's shell calls and stop still reach the projects only its subagents worked in, as a backstop for a subagent that stopped with findings left. To leave a subagent's worktree to its own hooks, set this in that worktree's `.rulecast-config.yaml`:
  
    ```yaml
    subagent_projects: exclude
    ```
  
    With the default, `include`, the notice for a shared working tree now names this setting and no longer suggests separate worktrees.
  - A prompt still reaches every project the session worked in, since it only resets counters.
  
  A worktree inside its own repository is now a project boundary: a file in `<repo>/.claude/worktrees/x` is judged by the configs in that worktree and above the repository, not by the main checkout's config at `<repo>`. This holds for agent hooks and for `rulecast run`. A nested repository of its own, such as a submodule or a home directory kept in git, still gets the configs above it, and so do worktrees below a bare repository's directory (`proj/.git` naming `./.bare`).
  
  Breaking: the file that records a session's projects has a new format. A session that was already running when you upgrade forgets the projects it worked in outside the directories it started in and is in now. A new session is not affected.
- f37e1ca: `rulecast test <id> --runs N` runs a rule's examples N times and reports how many runs passed (#72). An `llm` rule can pass its examples once and fail them the next time, and a single run doesn't show that. The output says `passed in 3 of 5 runs` and lists each example that failed in some runs, such as `good[0] a.py — passed in 3 of 5 runs`. The rule fails if any run failed. `N` goes up to 20, since every run of an `llm` rule costs money. `--format json` has the counts under `rules[].runs`. `--runs` doesn't combine with `--against` or `--history`.
  
  The agent docs now leave the model for `llm` rules to the developer. They no longer suggest Haiku as the default. Instead they say what each model can do: Haiku is reliable only for simple, clear questions, and a rule that takes judgement needs Sonnet or stronger. On Haiku, one such rule failed its own examples every time, which looks the same as "no findings". `DRAFT-RULES.md` now has agents test a drafted `llm` rule with `--runs 5`.
- fd4b6d5: Touch context is smaller and more predictable when several touch rules match one file, and `rulecast doctor` says when a file's touch context is too long (#69).
  
  - **Each text is sent once.** When a touch rule cites a whole file and another cites a section of it, the agent used to get both, so the section arrived twice. Now the whole file is sent and the section isn't. If the whole file doesn't fit, the sections still go on their own.
  - **The most specific sections go first.** When a file's touch context is more than one message holds, the rules that cite the least text go first (on a tie, the fewest items, then config order), so a rule citing a whole file usually goes after one citing a few sections. What doesn't fit is named for the agent to read, as before. That is now usually a broad rule's whole file, the one the agent most likely read at the start, and not the narrow sections listed last.
  - **A section left out for room is sent once room frees up.** When a later part of the message turns out to cost less than planned, sections named earlier for lack of room are tried again. And when findings are shown, the budget no longer holds back room for the longer title that prints only when no finding fits, so a section or finding that fits is no longer cut by up to about 20 characters.
  - **`rulecast doctor` has a `touch context` section.** For each set of touch rules a file can match, it runs the same budget the hook uses and warns when something would be cut, naming the file, the rules and the sections:
  
    ```text
    touch context
      warning  src/run/x.ts — the first open sends the context of 2 touch rules, more than one message holds: docs/a.md#three would be named, not sent. Narrow these rules to the one or two sections that area gets wrong (broad, narrow)
    ```
  
  - `DRAFT-RULES.md` no longer tells agents to list every section that applies to an area in its touch rule. A touch rule now lists the one or two sections agents most often get wrong there, and principles that hold across the codebase stay in the agent doc. `guides/writing-rules.md` and the rule format reference say the same.

### Patch Changes

- 1e3df8f: The writing-rules guide has a new section, "Testing a rule on faults you already had" (#74). It describes how to test a rule against mistakes that really happened. Take a commit that introduced a fault and the commit that fixed it. The rule must fire on the first (`rulecast run <id> --from-ref F^ --to-ref F`), stay quiet on the fix, and fire on nothing else in `rulecast test <id> --history`. `DRAFT-RULES.md` has agents run the same three checks when the developer can name faults a rule should have caught.
- d55b028: A failed `hook` rule no longer reports its failure on a file the hook never named.
  
  - **The hook's own locations.** When a hook fails with output its `output` format does not read, rulecast now looks for a `path:line` in it, such as ty's ` --> app/user.py:93:5`, `./a.py:3` or `Dockerfile:12`. A line in one of the rule's files becomes the finding; a line in another rule's files from the same run leaves this rule with nothing. Before, the failure was always reported at line 1 of the rule's first file, so an `always_run` type check that failed over an unstaged file showed up on `.claude/hooks/rulecast.sh:1:1`.
  - **Failures about other files, or no file.** A hook given exactly one file that names no file still reports a finding on that file. Whether a pre-commit hook is given its files comes from the config and, for a remote hook, from the manifest in the clone pre-commit or prek already made; with no clone it counts as not given. When the output names only files the run did not give the hook, or no file while the hook got several files or none (`always_run`, `pass_filenames: false`, an hk step), the rule gets an error that says so and quotes the output. `rulecast run` exits 3, as for any rule that could not give an answer.
  - **A tool that could not start.** Exit 126 or 127, or output such as uv's "Failed to spawn", a shell's "command not found", pre-commit's "Executable `x` not found" or a stale shebang's "bad interpreter", is now a rule error saying the hook could not run, not a finding on the first file. The words count only when nothing else the hook printed is a finding or a place, so a finding that quotes them stays a finding.
- b275a0c: A `hook` rule whose hook manager isn't set up in the repository now says so (#87). This happens when a project moves from pre-commit to another hook manager and keeps its `hook/*` rules, or when a rule is copied from another repository. `rulecast validate` and `rulecast doctor` now say "no .pre-commit-config.yaml in the repository, so pre-commit is not set up here and this rule cannot run". Before, they said `no hook with id "mypy"`, as if only one hook were missing. `validate` now checks lefthook rules too: a lefthook rule with no lefthook config was caught only by `doctor`.
- 442e9ae: A ruff linter rule's `rules` now take ruff selectors, as ruff's `select` does. `rules: [B]` takes every flake8-bugbear finding (B006, but not BLE001), `E5` takes E501, `PL` takes pylint's PLC, PLE, PLR and PLW codes, and `ALL` takes everything. A selector ruff has renamed (from ruff's own redirect table) takes what its new name does: `TCH` and `TCH001` take TC001, `U` takes UP006, `TRY200` takes B904. Before, rulecast turned the selector on but then kept only findings whose code was exactly `B`, so such a rule never fired.
- 438e219: The setup page now publishes as an artifact without editing, and follows the viewer's light or dark theme (#81). `agents/setup-page.html` is now a fragment: its title, font links and style, then the page. That is what an artifact publisher wraps in its own document. Before, an agent had to cut the page's `<head>`, `<meta>` and `<body>` out by hand. For showing the page as a local file, `agents/setup-page.local.html` is the same page as a whole document. It is generated from the fragment, so the two can't drift apart. `SETUP.md` and `CONVENTIONS.md` say which file to fill for each. The page used to be dark only; it now has a light theme as well.
- 5c1de9a: `SETUP.md` no longer has the agent ask every setup question in one call (#80). Claude Code's question tool takes at most 4 questions per call, and the go-ahead question counts toward that. The agent now splits the questions over two calls in one turn, with the go-ahead last in the second, and asks any that still don't fit in the next turn.

## 0.13.0

### Minor Changes

- c08de32: A config can now record the conventions you decided not to check, and why, with a new `not_checked` key.
  
  Some conventions can't be checked by a rule: "every change gets a review" is about how people work, not about the code. When an agent drafts rules from your docs, it used to propose a line such as `Not checked by rulecast: about how to work` under each of these conventions in your own docs. That put rulecast's terms in your convention docs. Now the record goes in `.rulecast-config.yaml` instead, and your docs stay as you wrote them:
  
  ```yaml
  not_checked:
    - context: "@AGENTS.md#reviews"
      reason: about how to work, not about the code
  ```
  
  - `rulecast list` prints these entries after the rules. A later agent session sees that the convention was already considered, and why it has no rule, so it doesn't propose one again.
  - `rulecast validate` and `rulecast doctor` check each `context` the way they check a rule's: the file and the section must exist. A broken entry is a warning, not an error, because it keeps no rule from running. That includes a malformed one, such as `why:` written for `reason:` or a missing `reason`: `validate`, `doctor` and `list` name what is wrong with it, every other part of the config loads, and hooks and `rulecast run` ignore the entry. `validate` still exits 0, so a doc heading renamed under an entry never blocks a commit or a CI job; the entry is yours to fix when the warning says so.
  - The agent docs (`DRAFT-RULES.md`, `CONVENTIONS.md`) and the plugin's `add-rule` skill now propose `not_checked` entries and never write anything into your docs for this. If your docs already have `Not checked by rulecast:` lines, you can move each one into `not_checked` and delete the line.

### Patch Changes

- df841c1: `rulecast init` and the command help now say what is true.
  
  - `rulecast init --help` lists `--linters`. init already took it, to run your project's own linters (such as `linter/ruff`) as rules, and `init --dry-run` lists the ones it found, but the help left it out.
  - In a monorepo you might run `rulecast init --no-agents` in one package, because the agent hooks are installed higher up, where your sessions start. init used to say "No agent hooks: rulecast will not run in your agent until you run rulecast install", even though those hooks already run this package's rules. init now looks for agent hooks in the directories above, up to the top of the repository. When it finds them, it names them and says they reach this config for sessions started there. It still gives the old note when no hooks reach the config.
  - `rulecast warm` builds detector caches ahead of time. Its summary in the help now says that no built-in detector needs it yet. With only built-in detectors, it prints "nothing to warm".
  - `rulecast stats --help` and `rulecast replay --help` now point to `agents/reference/stats.md`, where their JSON is documented. They pointed to `output.md`, which no longer describes it.
  - The npm package description now reads "Your project's conventions, checked while your coding agent works."

## 0.12.0

### Minor Changes

- cdb6bd6: Updates the libraries rulecast runs on to their current major versions: `zod` 4, which checks config files, and `diff` 9, which compares files. Config error messages keep their wording, though a config with several errors may list them in a different order.
  
  Things you may notice:
  
  - `rulecast fix --dry-run` now puts a file name containing a tab, newline or carriage return in quotes, the way git writes it, so `git apply` can read the diff. Other names are not quoted, so `å.ts` still applies with macOS's `patch`, which reads no quoted names.
  - A whole number above 2^53 in a config, such as `max_file_bytes: 1e21`, is now refused instead of accepted.
  - Breaking, for anyone writing a custom detector: its `schema` must now be built with zod 4, because rulecast's types and validation use it.
  - Two exported types loosened from a non-empty tuple to an array: `RuleExamples`' `expect.lines` and `RuleEntry.stages` in `/internal`.
  
  The package's type declarations are now one file per module rather than a single bundle, because TypeScript 7 cannot bundle them. Importing from `@syv-ai/rulecast` works the same. zod 4 takes about 30 ms longer to load in each rulecast process. On Node 22.1 or newer rulecast now turns on Node's compile cache, kept in the system's temp directory, which wins back about half of that; on Node 20 hooks are the full 30 ms slower.

### Patch Changes

- f96be76: rulecast now uses ast-grep 0.51.1 (was 0.45.3) to run `ast-grep` rules. One change is visible in your rules, and only in Python ones.
  
  In an ast-grep pattern, `$NAME`, `$_NAME` and `$$$NAMES` are metavariables: they stand for whatever code is there. Python support comes from a separate parser, and until now ast-grep treated every `$` in a Python pattern as the start of a metavariable, even where you meant a real `$` character. So a pattern such as `Template("$name")` or `re.compile(r"^\d+$")` never matched anything. Now a `$` that does not start a metavariable is matched as you wrote it, as it already was for TypeScript, JavaScript, CSS and HTML. A Python rule with such a pattern may start reporting matches. Rules that use only metavariables match exactly what they did before.
  
  Nothing else changes for your rules: the parsers for the languages rulecast supports are the same versions, and so are the node kinds a rule can name.
- 5668744: Fixes to how rulecast's agent hooks are installed and checked, to the standalone installer, and to `rulecast fix --dry-run`.
  
  - `rulecast install` (and `rulecast init`) can put rulecast's Claude Code hooks in the shared `.claude/settings.json` or the personal `.claude/settings.local.json`. When both files held hooks from an older rulecast, only the shared one was updated, so the personal one kept the old commands and rulecast ran twice on every event. Install now updates rulecast's hooks in every settings file that has them, says which files it changed, and leaves everything else in those files alone. `rulecast doctor` reports a settings file left on an older command as out of date. Because install and init now read every settings file, one that is not valid JSON makes them stop and name it, where before they could skip it; doctor reports it on the hooks line and carries on.
  - When the hooks are installed but no rulecast can be found to run them, `rulecast doctor` now says so, with how to install rulecast, even when the hooks are also out of date. Before, it only said to run `rulecast install`, which does not fix it. Only a missing hook script is named before it, since the hooks that run the script fail without it.
  - `rulecast doctor`'s line about the agent hooks now lists every problem at once, where before it named one: hooks missing, hooks out of date in each settings file (named), a hook script that is missing or out of date, no rulecast to run, and a rulecast older than `minimum_rulecast_version`.
  - `rulecast doctor` names the rulecast the hooks run more accurately. The binary from install.sh is called that whether or not it was found through the PATH, and it is never offered a global npm update. When a global npm rulecast comes before install.sh's directory on the PATH, doctor now says to update the npm install, since a newer install.sh binary would never run.
  - install.sh prints the `fish_add_path` command with the directory in quotes, so a directory with a space in it stays one argument when you paste the command.
  - install.sh treats `/x/y`, `/x/y/` and `/x/y//` as the same install directory, and a PATH entry with a trailing slash as the same directory too. It no longer adds a second line to your shell's startup files, or the directory to your PATH twice, when the spelling differs.
  - `rulecast fix --dry-run` ends a file name that contains a space with a tab in the diff header, as git does. Without it, `patch` read `my file.ts` as `my` and could not apply the diff.
  - `rulecast init` now tells you to commit the hook script (`.claude/hooks/rulecast.sh`) whenever the shared `.claude/settings.json` runs it, including when the hooks were found in your personal settings, and when the script is on disk but was never committed. Without it in the repository, every teammate's hooks fail. In `rulecast init --format json`, a new `alsoCommit` list names such files: ones init leaves as they are that still need committing.
  - The git hook command (in `.pre-commit-hooks.yaml` and the lefthook example in the Git hooks guide) now skips a `rulecast` on the PATH that cannot run, such as a binary built for another machine, and goes on to the one install.sh installed, as the agent hooks already did. Before, the git hook failed. If you copied the lefthook example, copy it again.

## 0.11.0

### Minor Changes

- dc09425: The Claude Code hooks now run a script instead of a long inline command. `rulecast install` writes `.claude/hooks/rulecast.sh`, a short commented script that finds rulecast (the project's `node_modules/.bin`, then the PATH, then install.sh's directory) and hands it the hook's input. Every hook in `.claude/settings.json` is now `sh "$CLAUDE_PROJECT_DIR"/.claude/hooks/rulecast.sh`. What happens when rulecast is not installed is unchanged: no hook errors, a message when the session starts, and one at every stop in an unattended run.
  
  `rulecast doctor` reports a missing script as an error, because every hook would fail without it, and a script that differs from what install writes as out of date. `rulecast uninstall` removes the script.
  
  Breaking: run `rulecast install` again in each project. It replaces the old hook command and writes the script. Commit both `.claude/settings.json` and `.claude/hooks/rulecast.sh`.
  
  Breaking, for anyone writing their own adapter: `AdapterInstall.command` is now a string, not `command(local)`, and `AdapterInstall.files` is required: the files the hooks need next to the settings, which install writes and doctor checks.

### Patch Changes

- d8bba7f: The agent docs and the Writing rules guide now cover two more ways to place a convention.
  
  - **A migration's lock.** When something is being replaced, `DRAFT-RULES.md` drafts a rule that flags the old form, because agents copy whatever is still in the code. Its existing uses are backlog, so the `--against` rate gate does not count against it. A lock rule that never fires is working as intended, not a candidate for removal. `CONVENTIONS.md` asks for both the old form and the new one, and for a mistake someone has actually seen.
  - **One home for each convention.** Once a rule checks or delivers a section of `AGENTS.md` or `CLAUDE.md`, `DRAFT-RULES.md` proposes moving that section to the conventions docs, never copying it. The agent doc is read in every session; the rule delivers the section only when it is needed.

## 0.10.0

### Minor Changes

- 7223c45: The standalone binary installs with one command, the way uv's installer works:
  
  ```sh
  curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh
  ```
  
  - In a terminal, `install.sh` first shows what it will do and asks: proceed, customize (the directory, and whether to change startup files) or cancel. It reads the terminal, so it asks under `curl … | sh` too. With no terminal (CI, an agent, a container build) it uses the defaults and says so. Options go after `sh -s --`: `-y`/`--yes`, `--install-dir DIR`, `--no-modify-path`, `--help`; `RULECAST_YES=1`, `RULECAST_INSTALL_DIR` and `RULECAST_NO_MODIFY_PATH=1` do the same.
  - It downloads this machine's binary and its `.sha256` from the release, checks one against the other, and installs it as `~/.local/bin/rulecast`. `RULECAST_INSTALL_DIR` picks another directory, and so does `XDG_BIN_HOME` when `RULECAST_INSTALL_DIR` is unset.
  - It puts that directory on the PATH: it writes `<dir>/env` and sources it from `~/.profile`, from `~/.bashrc` and `~/.bash_profile` if they exist, and from `~/.zshrc` if it exists or zsh is your shell. It prints every file it changes. `RULECAST_NO_MODIFY_PATH=1` changes none. In GitHub Actions it also adds the directory to `$GITHUB_PATH`.
  - The docs site serves the latest release's script. Each release carries its own copy for a fixed version: `https://github.com/syv-ai/rulecast/releases/download/vX.Y.Z/install.sh`.
  - Git hooks and agent hooks run the project's `node_modules/.bin/rulecast`, else `rulecast` on the PATH, else install.sh's in its directory: an agent started from the Dock or an IDE may run its hooks with a PATH that lacks it.
  
  Breaking changes:
  
  - The binary no longer lives in the cache home. Run the install command again, then delete `~/.cache/rulecast/bin`.
  - `rulecast binary` (`install` and `path`) is removed.
  - The hooks no longer look in the cache home. Run `rulecast install` to rewrite the agent hooks, and replace the git hook commands with the ones in the Git hooks guide.
  - `rulecast clean` keeps only this version's native files. `doctor`'s install advice and the not-installed messages have changed.
  - Nothing warms the ast-grep parsers after installing: the first edit with a new version unpacks them.

## 0.9.0

### Minor Changes

- 571a7fd: The standalone binary is an install option for agent hooks. It needs no Node, no devDependency and no global npm install. You install it yourself; nothing downloads or installs it for you.
  
  - `rulecast binary install`, run by a downloaded binary, puts it at `<cache home>/bin/<version>-<platform>-<arch>/rulecast`, points `<cache home>/bin/rulecast-<platform>-<arch>` (this machine's current link) at it, and removes this machine's older versions. `rulecast binary path` names the current one. Under Node, `binary install` prints the command that installs the binary and installs nothing.
  - The README's Install section has a one-line install command. It downloads this version's binary and its `.sha256` from Releases over https only, checks them, and only then runs `binary install`.
  - The binary unpacks ast-grep's native module once, into `<cache home>/native/`, instead of to a new temp path on every run. On macOS that took a TypeScript ast-grep run from about 630 ms to about 105 ms. The variable that points ast-grep at it is never passed to the tools rulecast runs, so a project's own napi-rs tools (vite, vitest, knip, tailwind) are unaffected.
  - When the cache home's `native/` can't be written, the binary uses a temp directory only if this user owns it and nobody else can write it, and a fresh private one otherwise.
  - An installed binary that can't run on this machine (built for another one, or refused by the OS) counts as not installed: the hooks go on to the PATH, and `doctor` and `binary path` don't fail.
  - The binary can start `rulecast warm`. Before, the child it started failed with `unknown command "/$bunfs/root/rulecast"`.
  - `doctor` says which rulecast the hooks run and its version. When that version is older than `minimum_rulecast_version`, it warns and prints the update command. When the project's rulecast and an installed binary differ, it names both.
  - "requires rulecast X or newer" now names the rulecast that ran.
  - Setup asks how to install rulecast, recommends the binary (or the devDependency when the project pins its tools in `package.json`), shows the exact command, and runs it only after approval.
  
  Breaking changes:
  
  - The agent hook command looks in the project's `node_modules/.bin`, then the installed binary, then the PATH. Existing hooks read as out of date in `doctor`; run `rulecast install` to rewrite them.
  - The not-installed messages (`NOT_INSTALLED`, `NOT_INSTALLED_UNATTENDED`) have new text.
  - The `.pre-commit-hooks.yaml` entries no longer run `npx --no-install rulecast`. They use the same lookup as the agent hooks, so git hooks need no Node.
  - The README's Install section and lefthook snippet changed to match. The binary is no longer "for CI and one-off runs".
  - `cacheHome()` reads `HOME` from the environment it is given before falling back to the OS home directory. With `HOME`, `XDG_CACHE_HOME` and `RULECAST_HOME` all unset, the hooks don't look for an installed binary.
  - The installed binary's current link is `<cache home>/bin/rulecast-<platform>-<arch>`, one per machine, not `<cache home>/bin/rulecast`. The hooks only ever run this machine's link.
  - `rulecast clean` keeps `<cache home>/bin` (the installed binary) and this version's native files. To remove the binary, delete `<cache home>/bin`.
  - The docs site deploys after the release binaries are uploaded, so its install command never points at missing assets.
- 03f1a52: The linters a project already runs can be delivered with their docs. A `linter` rule without `rules` delivers what the project's own ESLint, Ruff, oxlint or gitleaks config makes an error, and each finding says where its lint rule is explained: the project's own section, or else the linter's page for it.
  
  - New rule key `context_by_rule`: maps a lint rule id, exactly as `{{ruleId}}` shows it, to project doc sections, on `linter`, `command` and `hook` rules. A section is delivered only with the findings of its lint rule, and the first such finding in a block says `see <ref>`. A lint rule with no mapping says `upstream docs: <url>` when the tool's output gives one. For Ruff the keys are codes (`B006`); a name is a validate error.
  - `rulecast init` detects the linters from their config files, lists how many rules each config makes errors and how many warnings will not be delivered, finds the doc sections that name those rules, and writes one rule per linter with `--linters linter/eslint,linter/ruff`. A pre-commit or lefthook hook that runs one of them says it is the same as the linter rule. init never writes `context_by_rule`: setup proposes each mapping and the developer agrees it.
  - `rulecast list` shows each mapping, and SARIF rule help includes the mapped sections.
  
  Breaking changes:
  
  - A `linter` rule without `rules` no longer delivers warnings: only what the project's config makes an error (ESLint level 2, oxlint `error`/`deny`, every rule Ruff selects, every gitleaks finding).
  - ESLint runs with `--format=json-with-metadata`.
  - Findings in JSON output carry `docs`: `{ "ref": … }` or `{ "url": … }`.
  - `context_by_rule` is a new rule key.
- 44ad109: Setup shows a page of defaults drawn from the repository, then asks only the open questions.
  
  - `init --dry-run --format json` reports what setup used to gather by hand: `detected.committers` (distinct authors in the last six months, bots left out; null when there are none or the clone is shallow), `detected.packages` (declared workspaces and top-level directories with a manifest, with their stack and whether they have an agent doc or config), `detected.sessions` (agent settings below the project), `detected.gitHooks` (pre-commit, lefthook, husky, and whether rulecast is in each) and `detected.ci` (workflows that run a coding agent).
  - It also reports `generated` and `vendored` paths (generator headers, `linguist-generated`, `linguist-vendored`, `vendor/` and `third_party/`) that the catalog rules' defaults don't already cover: a directory, a `.gitattributes` pattern as one path when it selects exactly the files git marks (git resolves the attributes, negation included), or files one by one (past 20, `notListed` counts the rest; Markdown is never header-scanned). They are offered only when the loaded catalog has `generated-code` or `vendored-code` to adopt them with. It also reports `catalog`: each catalog rule with how many of the project's files it matches, whether it is metered or in a pack, and whether it is configured.
  - The dry run fetches the catalog's rule data at its latest tag (or the config's pin), waiting at most 5 s for the tag list. Offline, it uses the newest catalog already cached and says so; otherwise it reports `catalog: { error }` and still exits 0.
  - New `init` flags: `--catalog id,id` adopts catalog rules, and `--generated path,path` and `--vendored path,path` add `generated-code` and `vendored-code` with `files` widened by those paths. Each takes only what the dry run offers, and `--catalog` refuses a pack and each rule in one. Catalog rules are now offered at setup; `rulecast add` and `list --catalog` stay for adopting them later.
  - New catalog rule `vendored-code`: edits under `vendor/` and `third_party/` are errors, with a message to update the dependency and re-vendor it.
  - SETUP.md's six-question interview is replaced: the agent fills the setup page with defaults from init's report and its own reading, asks the questions only the developer can answer (llm rules, agent loops with nobody watching) in the same turn, and writes after one approval. The setup page numbers every item, marks its state (default, said, off, struck) and has a "Needs your answer" section.
  - On the page, the install is a row like the rest: the devDependency, the standalone binary (its install command in the row's detail) or a global install, with the one already installed, else the devDependency where `package.json` pins the tools, else the binary, as its default. It is run only after approval, and only as shown. The weekly stats summary is an `off` row the developer can turn on, never a question, and init's report shows the config's setting as `config.stats.weeklySummary`.
  - All new work runs in `init`, which is not a hook: the edit-hook latency budget is unaffected.
  
  Breaking:
  
  - The setup page's `said` field is now `value`, and its items carry `n` and `state`. CONVENTIONS.md's review page uses `value` and `state: "said"`.
  - SETUP.md's interview is replaced by the page of defaults.
  - `init --format json` has new fields (`detected.committers`, `packages`, `sessions`, `gitHooks`, `ci`, and `generated`, `vendored`, `catalog`), and a dry run now loads the catalog.
  - `RuleSelection` (internal) gains `files`. `remoteTags` (internal) takes a timeout, and `loadCatalog` can fall back to the cache.
- a2538f1: `rulecast stats` shows a per-week trend for each rule: how often it fired per 100 checks that ran it, and the files it keeps firing on across sessions. The JSON gains a `weekly` key (`schemaVersion` stays 1), and the text output a weekly table once the trend spans two weeks.
  
  - The new config key `stats.weekly_summary` (off by default; `rulecast init --weekly-summary`) keeps 26 weeks of per-week counts in `findings-weekly.jsonl`, beside the config's findings log. A hook writes it when the log rotates and drops its oldest file. It holds rule ids, file paths, weeks and counts only. Without it, the trend covers what the log holds: about 8 MiB.
  - The key applies to its own config's log only, and is not inherited by configs below it.
  - The JSON is added to, so nothing breaks.

### Patch Changes

- d303d47: The plugin's add-rule skill now offers a rule instead of starting itself. When the developer corrects the agent in a way that says how code here should always or never be written, the agent finishes the fix and ends that reply with one line: `Want me to add a rulecast rule for this? "<the convention>"`. Nothing changes without a yes.
  
  - It offers once per convention per session, never again for that convention after a no, and at most once per reply. It does not offer for a change of mind about the task, a one-off bug, a mistake a rulecast finding already caught, or a run with nobody there to answer.
  - After a yes, the skill takes the convention as offered and does not ask again whether you want a rule. If the agent starts the skill without offering first, it still says why and asks before anything else.
  - The plugin has an eval suite in `plugins/rulecast/evals/`, run by hand with `claude plugin eval plugins/rulecast --scaffold --allow-tools Edit Write`. `yes-starts-skill` also needs Bash, and a grant applies to every case in a run, so run it on its own with `--case yes-starts-skill --allow-tools Bash Edit Write`.
  
  The plugin's version follows the CLI's, so this reaches you with the release.
- 2c53cd6: `rulecast help` lists the commands most projects use. `baseline`, `replay`, `autoupdate`, `try-repo`, `clean`, `warm` and `hook` are named on one line, and `rulecast help --all` lists them with what they do. Every command works as before, and `rulecast <command> --help` is unchanged.
  
  The README and the docs site have a new Advanced section and page. It holds several agents in one working tree, git operations during a turn, fresh environments, how staged and `--to-ref` runs hand files to tools, committed baselines, and the loop-safety pack. Links to `#fresh-environments` and `#a-committed-baseline` still work. Text about parallel agents that was under `#agents` is now under `#several-agents-at-once`.
  
  The README's command table is split into commands and advanced commands. "Turning a rule off" now sits next to the other rule sections.

## 0.8.2

### Patch Changes

- a88b5a5: The standalone binaries run ast-grep rules again. The released binaries (checked on 0.8.0) carried the build machine's path to the Python parser and did not include the parser itself, so on any other machine every ast-grep rule was disabled with "ast-grep is unavailable: No parser found", TypeScript rules included.
  
  - The binary embeds each dynamic language's parser and writes it once to `<cache home>/native/<version>-<platform>-<arch>/` (the temp directory when the cache home can't be written), where ast-grep can load it.
  - A dynamic language that cannot load disables only its own rules; the built-in languages keep working.
  - The binary test checks that no path from the build machine is in the binary, and runs a TypeScript and a Python ast-grep rule.

## 0.8.1

### Patch Changes

- 2abf5a3: Docs only, after an audit of every claim against the code.
  
  - The README's `refuse_write` example gains the `name` every local rule needs: before, it failed `rulecast validate`.
  - Getting started and the no-URL fallback say setup installs rulecast before `init`.
  - A protected file written through Bash holds the agent's stop up to the stop limit, not without end.
  - Exit codes: `test` exits 1 on a failed example, `baseline` 3 when a rule could not run.
  - `llm` rules can use the config's `llm.model`; the model aliases do not map for `openai-compatible`.
  - `gitleaks` reads staged content on stdin; `command` reads rdjson.
  - SETUP.md describes `modifies: null` and `runs` in init's JSON; output.md says init's JSON is not a contract.
  - `refuse_write` needs `edit` among the rule's stages; `rulecast install` after raising `verify_ms` goes where sessions start.
  - loops.md's stats recipe no longer fails when the config did not fully compile.
  - Performance and Install state the budgets `pnpm perf` checks instead of measured timings.

## 0.8.0

### Minor Changes

- 75fb916: Fixes from an end-to-end review of setup.
  
  - The Claude Code hooks are always the guarded command. It runs the project's `node_modules/.bin/rulecast`, else a `rulecast` on the PATH (one that cannot execute, such as a version-manager shim with nothing behind it, counts as none), and otherwise says once per session that rulecast is not installed. Before, `init` or `install` run without rulecast in `node_modules` (as the plugin's setup does through npx) wrote a bare `rulecast hook claude-code`, which failed on every tool call where rulecast was not on the PATH. `install` upgrades those hooks in place.
  - `doctor` no longer counts a rulecast that a package runner (`npx`, `pnpm dlx`, `yarn dlx`, `bunx`, `npm run`, `pnpm exec`) put on its PATH as one the hooks will find.
  - `init` offers hook ids that are valid rule ids: a lefthook job named `lint typescript` is `hook/pre-commit-lint-typescript`, and a local pre-commit hook `run_tests` is `hook/run-tests`. When validation fails, init no longer says to commit.
  - SETUP.md adds rulecast as a devDependency (or a global install, without a `package.json`) before `init`.
  - `install` raises the Stop and SubagentStop hooks' timeout when `timeouts.verify_ms` grows, or when it is missing, and `doctor` reports hooks with a timeout too short as out of date. Before, a raised `verify_ms` left Claude Code killing the stop check at 70 s.
  - SETUP.md no longer says hook rules run after every edit: they run when the agent stops.
  - `add` and `list --catalog` find the catalog however its GitHub URL is cased (`Syv-AI/rulecast`), rather than add a second entry that fails validation. `list --catalog` labels catalog rules with the catalog, not `local`.
  - The README's pre-commit `rev` and Status follow the version (`pnpm sync-version`). They said 0.4.
  - SETUP.md and CONVENTIONS.md publish the page as an artifact only where the agent has a tool for it.
  - A damaged line in a session store is skipped. Before, one such line dropped the session's memory, and with it the stop check, for every later hook of that session.
  - The session lock is kept fresh while its holder works and released only by its holder, so a holder slower than the 5 s stale limit no longer lets other hook processes in alongside it.
  - `init` judges a hook that runs a package script by that script (one level), and one that runs a script it cannot see into as "may change files", naming it (`modifies: null` and `runs` in JSON). It sees past package-manager flags and workspace selectors (`pnpm --filter web lint`, `yarn workspace web lint`), treats turbo, nx, lerna, npm-run-all and concurrently as unknown, and counts black, isort and `ruff format` as writers unless they `--check`. Before, `npm run lint` running `biome --write` was offered as read-only.
  - Session stores no longer grow by the whole dirty tree twice per shell call: a tree state is written as a reference to one the store already holds, or as its change from the agent's last one. With 2000 shell calls and 30 dirty files, a store went from 40 MB to 1 MB, and reading it from 375 ms to 27 ms on every hook.
  - `init`, `install` and `doctor` plan the agent hooks in one place. `init` now completes a partial install where it is, as `install` does, instead of writing a second set into the shared settings, and `doctor` judges the stop timeout by the largest `verify_ms` of every config the hooks serve.
  
  Breaking:
  
  - Session stores use a new tree record format. Stores from before this version are not supported.
  - `init --format json`: `hooks.offered[].modifies` can be `null` (rulecast cannot tell), with `runs` naming what the hook runs.
  - The Claude Code hook command changed. Run `rulecast install` to rewrite existing settings.
  - `Event` (exported types) is a discriminated union, one variant per `kind`.

## 0.7.0

### Minor Changes

- f19ceb5: The catalog no longer assumes anything about a project's architecture. Which layers a project has, where they live and what may call what are the developer's decisions, made in the conventions session, not catalog defaults.
  
  - Removed `python/no-httpexception-in-services`, `python/no-queries-in-services`, `python/layering`, `python/thin-routes`, `react/no-fetch-in-components`, `react/data-fetching` and `react/no-inline-style`, with the docs they cite. A config that names one of them no longer compiles; remove the entry, or draft the convention as a local rule.
  - `python/no-silent-except` now runs ruff's S110 and needs ruff installed. By default it flags a bare `except:`, `except Exception` and `except BaseException`; set `check-typed-exception` in the project's ruff config to flag typed ones too.
  - `init` says a catalog rule "matches" the project's files, not that it "applies". The setup and drafting docs for agents say the same.
- 0b81792: A repository can hold any number of `.rulecast-config.yaml` files: one at the top, one per package, or both. rulecast no longer assumes the config sits at the git top.
  
  - Every config above a file applies to it, each as its own project with its own rules, state and findings. Nothing is merged; `exclude` on a top rule keeps it out of a package.
  - Agent hooks route each file to those configs, wherever the session was started, and a stop checks every project the session touched. Paths the agent sees are relative to its working directory.
  - `rulecast run` and `fix` route the files under the current directory the same way. With several projects, JSON adds `baselines` and SARIF writes one run per project. Run from a subdirectory, they check that subtree.
  - `install` writes the hooks in the directory it runs in, where sessions start, and fetches the rule repos of every config at, above or below it. `init` sets up the project in the current directory, reads git hook configs at the git top and applies lefthook's `root:`.
  - Linters run from the nearest directory holding their own config, and find their binary in `node_modules/.bin`, then for ruff in `.venv/bin` or `venv/bin`, up to the git top. `uv run` is used only where a `uv.lock` already exists, so rulecast no longer creates one and a `.venv`. `doctor` checks each tool from every directory it would run in. `command` rules take a `cwd`.
  - `init` in a package lists the git hooks it does not offer, with the reason.
  - `protected-loop-config` also protects `.rulecast-config.yaml`, `.claude/settings` files and `.husky/` below the top. Replay reads transcripts of sessions started at or above the project.
  - The agent preamble says "rulecast rules (.rulecast-config.yaml)" rather than "This project's".
- 34a4a10: `agents/CONVENTIONS.md`: a new agent doc for working out a project's conventions with the developer before any rule is drafted. The agent reads the code with subagents that only observe, then interviews the developer one question at a time, recommending from rulecast's lens catalog (`agents/lenses/`, generated by `pnpm lenses`), and the developer reviews the result on one page. `init`'s drafting prompt and `SETUP.md` now start there; `DRAFT-RULES.md` stops when a doc states no conventions.
- 6ef2011: New ways to measure a rule before you switch it on, and fixes for agents that share a working tree.
  
  - `rulecast replay claude-code` judges your recent Claude Code sessions from their transcripts: what each rule would have told the agent at each edit and stop. llm rules run only with `--llm --yes`.
  - `rulecast test <id> --history [--commits N]` judges a rule on recent commits, on what each one added. `--label` writes the findings for you to mark real or false, which gives a precision. An llm rule prints its cost and runs only with `--yes`.
  - `rulecast stats` adds `runs`, `neverRan` and `stopBlocks`: a rule that never ran is told apart from one that ran and never fired, and each blocking rule's block rate is shown by the number of files at the stop.
  - A Bash command is no longer blamed for another agent's Edit or Write made while it ran, in the same session or another. A protected file changed during an overlap is answered with "undo only your change", never `git checkout`.
  - Lines a pull or merge brings into a file the agent edited are no longer counted as the agent's.
  - Every finding names its file and line, even when the rule's message leaves out `{{file}}`.
  - A `.rulecast-config.yaml` in your home directory no longer makes every repository below it one project, and `init` creates a repository's own config when the nearest one is above it.
  - Hooks: git never takes the index lock, tree snapshots give up after 3 s, a stop's work shares one `verify_ms`, session logs are written under a lock, and regex, ast-grep and llm rules skip binary files.
  - `agents/`: how to word an llm rule's question, llm rules measured with `--history` and started as warnings, and every convention's outcome accounted for when drafting rules.
- 2013931: A Claude Code plugin with one skill, `/rulecast:add-rule`. Install it with `/plugin install rulecast --marketplace syv-ai/rulecast`. With no argument it turns the mistake the session just showed into a rule; with one, the convention you name. The agent states the convention back, writes it into your docs if it isn't there, drafts and measures the rule as `agents/DRAFT-RULES.md` describes, and asks you before keeping anything. The plugin's version follows the CLI's.
- 099a062: Setup is now done by your coding agent, with you, and most rules come later through `/rulecast:add-rule`.
  
  - `/rulecast:setup` in the Claude Code plugin, or `agents/SETUP.md` for other agents: the agent reads the repository, asks what it can't tell (who it's for and where it runs, where configs go, where conventions live, whether llm rules are OK and with which model, which of your git hooks to run as rules, up front or as you go), shows the agreed setup on one page (`agents/setup-page.html`) and writes it only when you approve. Then it offers a few first rules.
  - `rulecast init` no longer prompts, selects catalog rules or prints a prompt. It takes the answers as flags: `--hooks`, `--llm-model`, `--llm-provider`, `--conventions`, plus `--agent` and `--scope`. `--dry-run --format json` reports what it found and every file it would write. `--rules`, `--no-rules`, `--no-hooks` and `--yes` are gone, and so is the `@clack/prompts` dependency.
  - `rulecast add <id|pack>...` adopts catalog rules or packs (`rulecast add loop-safety`). `rulecast list --catalog` lists the catalog's rules and marks those already configured; with a rule id it shows the rule's examples and the doc sections it cites.
  - `llm.model` in the config is the model for llm rules that name none, and says the developer agreed to llm rules. A rule's own `model` still wins. A rule with neither fails `rulecast validate`. `rulecast list` says whether llm rules are allowed.
  - `conventions` in the config names the file or folder where new conventions are written. A config without one uses the nearest config above that names one. `rulecast list` shows it on its first line.
  - `agents/CONVENTIONS.md`, the up-front path, is shorter: no lens catalog and no subagent pass, and its review uses the setup page. `agents/conventions-review.html` is gone. `agents/DRAFT-RULES.md` and add-rule check the catalog first and ask before drafting an llm rule.

## 0.6.0

### Minor Changes

- c19d72e: A `command` rule can run any tool that works as a pre-commit hook, with config only:
  
  - `output` reads `sarif`, `json`, `checkstyle`, `gitlab` (code-quality JSON, which ty prints), `rdjson`, or lines: `{ lines: gcc }`, `{ lines: gcc-nocol }`, `{ lines: msbuild }`, or `{ lines: { pattern: "<regex with named groups file, line, message…>" } }`.
  - `stream: stderr | both` reads a tool that reports on stderr.
  - `rules: [...]` keeps only findings with those rule ids.
  - `exit_codes: { error: [2, 101] }` names the exit codes that mean the tool failed; such a run is a rule error carrying the tool's stderr. Other exit codes are findings-or-clean, as before.
  - `scope: project` runs the tool on the whole project without files and keeps the findings in the rule's files: type checkers, dead-code and duplication tools. It runs at verify only unless `stages` says otherwise. In a staged `rulecast run` it runs on the working tree when the rule's files there match the index, and is skipped with a warning naming the files when they don't. rulecast never stashes.
  
  Rules that call the same command share one run, so three semgrep rules scan once.
- 37fe900: `command` rules carry `{{message}}`, `{{ruleId}}` and `{{severity}}` for every finding, from whatever the tool reported. A SARIF finding's `{{ruleId}}` is its `ruleId` and its end column is kept.
  
  **Changed:** a `command` finding's `{{text}}` is now the source at the finding's range, as for `linter` rules. Before, a SARIF finding's `{{text}}` was the tool's message; use `{{message}}` for that. A JSON result's own `text` field still wins.
  
  SARIF results that passed, did not apply or were suppressed are no longer findings, and a uri relative to a `uriBaseId` the run declares is resolved against it. Empty output is no findings in every format.
- 3333711: A committed baseline for full-repository runs. `rulecast baseline` runs every rule over every file and writes `.rulecast/baseline.json`, the ids of the findings there are today. Commit it, and `rulecast run --all-files` or `--files` treats those findings as pre-existing and exits 0 unless something new appears. That is the gate a nightly sweep or a scheduled agent loop needs when it has no ref to diff against.
  
  - `rulecast baseline --prune` drops the entries that are no longer found. It never adds one, keeps the entries of rules that did not run, and leaves the file untouched when nothing changed.
  - `rulecast baseline --force` rewrites the file. Without it, an existing baseline is not overwritten, so recording new findings is a visible step.
  - `rulecast baseline` gives metered (llm) rules every file, past `llm.max_files_per_verify`. With `--no-llm` it names the rules it left out, and `--force` keeps the old entries of every rule that did not run.
  - An entry whose rule no longer has the `verify` stage is stale, like one whose rule or file is gone.
  - `run` says when entries are no longer found (`baseline: 3 entries no longer found …`), and `--format json` has a new `baseline` key: `{ file, entries, matched, stale }`, or `null`.
  - A session, `--from-ref` and a staged commit's `HEAD` keep their own baseline. Agent hooks never read the file.
  - `rulecast doctor` reports the baseline's size, when it was added and when it last changed, taken from git.
  - `.rulecast/.gitignore` now lets `baseline.json` through. One written by an earlier rulecast is updated the next time it is used, unless it was edited. When another ignore file excludes `.rulecast/`, `rulecast baseline` names the pattern to narrow. And no rule ever checks files under `.rulecast/`.
  
  Where a ref exists, `--from-ref` is still the better baseline: it never needs maintaining.
- 8606098: Plugin detectors can declare three new optional things: `wholeProject(config)` (the tool needs the real project, so a staged run uses the working tree when the rule's files match it, and skips the rule otherwise), `changesFiles` (the tool may change files while it runs; it runs after every other kind, alone), and `validate({ rules, cwd })` (static checks against the project's files, reported by `rulecast validate`).
- e42fd8a: New command: `rulecast stats [--since 30d] [--format terminal|json]`. It shows, per rule, what became of the findings rulecast reported to agents: how many fired, were blocked at a stop, were fixed (and after how many turns), were left in place at a stop, were silenced with `rulecast-ignore`, or were prevented (a refused write the agent gave up on). It flags noisy rules, the ones the agent keeps hitting or silencing, and lists rules that never fired. In unattended mode, where an ignore silences nothing on code the agent changed, ignores the agent added or changed still count towards a rule being flagged as one the agent keeps silencing. `--format json` is a documented contract (`agents/reference/output.md`), for loops that improve rules.
  
  To get these numbers, agent hooks now append a small record per edit check, refused write and stop to `findings.jsonl` in the project's cache directory. A record holds finding ids, rule ids, file paths and line numbers only, never code or messages, and never leaves the machine. The file rotates at 4 MiB, a hook never fails because it could not be written, and `rulecast clean` removes it. `rulecast run`, git hooks and CI write nothing to it.
- f285003: New `rulecast fix` command: rules whose violations have a mechanical fix can now carry that fix, and rulecast applies it for you instead of an agent fixing each one by hand.
  
  - A `regex` rule takes `fix:` in the message's `{{name}}` syntax: `fix: "log.info({{args}})"`. An `ast-grep` rule takes ast-grep's own syntax: `fix: "logger.debug($$$ARGS)"`. No other detector accepts `fix`, and `rulecast validate` says so.
  - `rulecast fix [RULE_ID] (--files F... | --all-files | --from-ref A)` fixes every finding of those rules in the files, old ones too, then checks the files as `rulecast run` does and exits with `run`'s codes. `--dry-run` prints the diff and writes nothing. A fix that leaves its own finding in place is undone and reported as unresolved, so running the command twice changes nothing the second time (unless fixes were still pending after 10 passes: then it writes what it got and says to run it again). Findings with a `rulecast-ignore` comment are left alone, and a file where a fix would move that comment away from its finding is left unchanged. It never writes through a symlink (the file or a directory in its path), outside the project, to a file that is not UTF-8 or that changed while it was fixing, or to a file whose fixes keep undoing each other; it says which files it left and why, and a file it cannot write does not stop the others.
  - A fix has to be proven: a rule with `fix` needs at least one `bad` example, or its fix is dropped with a warning (the rule itself still runs). `rulecast test` applies the fix to every bad example and fails if the rule still fires on the result, or if the result differs from the example's optional `fixed:` text. `rulecast fix` runs the same check before it applies anything.
  - Agent hooks never apply a fix. rulecast still never rewrites an agent's file behind its back.
  - `--format json` marks a finding `"fixable": true` when `rulecast fix` can fix it, so a loop can send those to `rulecast fix` and the rest to an agent. The key is absent otherwise.
  - Plugin API: a detector can declare `fixable(config)` and attach a `fix` (a text edit) to its findings when `DetectorRun.fixes` is set. The detector contract suite has optional cases for it.
- 01ebbb4: rulecast no longer goes quiet in a fresh environment, such as a CI job, a cloud agent session or a new container, when it is configured but cannot run some of its rules. Common causes are a pinned rule repo that was never fetched (`rulecast install` was not run), a linter or script that is not installed, and a rule that fails to compile.
  
  - **Agent hooks, unattended mode:** every stop names the rules that did not run and why, for example "2 rules disabled: …@v1.0.0: not in the cache (run rulecast install)". When nothing else blocks, the main agent is held once per prompt and told to state in its final report that those checks did not run; a block for findings earlier in the prompt counts as that hold. It is told not to repair rulecast's setup itself. A block for findings lists the rules that were not checked. Attended sessions are unchanged: the problem is said once.
  - **`rulecast run`** says `incomplete: N rules did not run` instead of reading as clean, and `--format json` has a new `disabled` key: `[{ "reason", "rules" }]`. `run --session` also names rules the agent's session had disabled.
  - **`rulecast doctor --ci`** checks what a headless run needs: pinned repos as the hooks will find them (hooks never fetch, and `doctor --ci` does not either), detector dependencies, hooks that cannot run, the mode, and with `--from-ref REF` whether a merge base can be found. It exits 2 when rulecast would run degraded. It is on by itself when `CI` or `GITHUB_ACTIONS` is set.
  - **The hook command changed.** When rulecast is not installed (no `node_modules`) and the run is unattended by its environment (`RULECAST_MODE=unattended`, `CI` or `GITHUB_ACTIONS`), every stop now says so. To get it, run `rulecast install` again and commit `.claude/settings.json`. It upgrades the command from any earlier release, also in a clone that has not installed its dependencies yet.
  
  The README has a "Fresh environments" checklist under "Git hooks and CI".
- 05d0f70: The `linter` detector supports gitleaks, for hard-coded secrets: `linter: { tool: gitleaks }`, optionally narrowed with `rules: [aws-access-token, ...]`. It runs on edits as well as verify, reads staged content on stdin, and honours the project's `.gitleaks.toml`, `.gitleaksignore` and `gitleaks:allow` comments. A gitleaks finding's `{{text}}` is always `[redacted]`, so the secret is never repeated into an agent's context, a log or SARIF.
- f16e3bf: A new `hook` detector runs a hook the project already declares, so its findings reach the agent with the doc section the rule cites:
  
  - `hook: { pre-commit: mypy }` runs a hook from `.pre-commit-config.yaml` through prek when it is installed, else pre-commit, on the rule's files (`run <id> --files …`, which never stashes). A hook that only runs at another stage is run at that stage.
  - `hook: { lefthook: pre-commit/typecheck }` runs a lefthook job's own command with the rule's files in place of `{staged_files}`, `{files}`, `{all_files}` and `{push_files}`, without `lefthook run`, which can install git hooks.
  - `output` (default `{ lines: gcc }`), `rules` and `exit_codes` work as for `command`.
  - A hook that changes a file (a formatter) has the file put back, and each changed file is a finding: "<hook> would change this file". rulecast never rewrites an agent's file behind its back.
  - A hook that fails with output no format reads is one finding carrying its first lines.
  
  Hook rules run at verify unless `stages` says otherwise, and in a staged run they run on the working tree when the rule's files there match the index. husky hooks are shell scripts with nothing structured to read: use `command` with the script's command.
- 31d4ff2: `rulecast init` offers the project's own pre-commit and lefthook hooks as `hook` rules, shown in the review before anything is written. Hooks that look like formatters or fixers are offered but not ticked; hooks that run rulecast itself and pre-commit `meta` hooks are left out. Each rule cites the config that declares the hook until it is pointed at a convention. `--no-hooks` skips them.
- 05d0f70: A `linter` rule now turns on the rules it names instead of only reporting what the project's linter config already enables: ruff gets `--extend-select`, oxlint `-D` and eslint `--rule`. A rule asking for ruff `S110` used to find nothing in a project whose config didn't select it, which is most projects. Inline suppressions still hold, and so do ruff's `per-file-ignores` and oxlint's `overrides`. Rules without a `rules` list still see only what the project's config reports; they get a run of their own.
- f22e042: A new catalog pack, `loop-safety`, for agents that run with nobody watching, such as Claude Code's `/goal`, `claude -p`, scheduled tasks and CI. When an agent's goal is "the tests pass", the cheapest way there is often to make the tests or the checker say yes. The pack catches those shortcuts as they are written:
  
  - `loop-safety/no-skipped-tests-python`, `-ts` and `-js`: a new pytest skip or xfail, a unittest skip, or a `.skip`, `.only`, `.todo`, `.failing`, `xit`, `fit` or `this.skip()` in a test file.
  - `loop-safety/no-deleted-assertions-python`, `-ts` and `-js`: a test file with fewer assertions than before the change (`assert`, unittest and mock `assert*` calls, `pytest.raises`, `expect()`, `assert()`). A commented-out assertion counts as removed.
  - `loop-safety/no-new-suppressions`: a new `noqa`, `type: ignore`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `biome-ignore` or coverage pragma.
  - `loop-safety/no-config-suppressions-python` and `-js`: the same shortcut in a checker's config, such as a mypy `ignore_missing_imports` override, a ruff or flake8 `ignore` entry, pytest `--deselect` in `addopts`, an ESLint or Biome rule set to `"off"`, or `"strict": false` in `tsconfig.json`.
  - `loop-safety/no-lowered-thresholds`: an edit to a coverage threshold or to `--max-warnings`.
  - `loop-safety/protected-loop-config`: an edit to CI workflows, git hooks, `.rulecast-config.yaml` or `.claude/settings.json`.
  
  Only what the change adds is flagged, never what was already there; the deleted-assertion rules compare the file's assertion count with its baseline instead. Each finding tells the agent to fix the code, or to leave the test failing and report why it believes the test is wrong, and links the pack's doc, which explains how a developer makes such a change on purpose. The rules are warnings while someone is watching. In unattended mode (set `RULECAST_MODE=unattended` or `mode: unattended` for `/goal`, `claude -p` and scheduled runs; on by itself in CI) they are errors, and edits to the loop's configuration are refused before they are written. `rulecast init` offers the pack but never ticks it for you, unless the config already says `mode: unattended`. `rulecast init --rules loop-safety` installs all of it.
  
  Three rule-format changes come with it:
  
  - `scope: removed`: a match is something the code should keep, and the finding is a file with fewer matches than at its baseline: the session's, `run --from-ref`'s merge base, or `HEAD` in a staged run. It is judged when the agent stops, not after each edit, so an assertion moved over two edits is not reported. It needs a `regex` or `ast-grep` detector and reports nothing without a baseline (`run --all-files`). `rulecast test --against` does not count a removed rule, since its matches are not violations. Its message says how many went with `{{removed}}` and `{{baseline}}`; its `{{text}}` is always `removed`, so deleting one more is the same finding, and an unattended run is not blocked afresh for each one.
  - `escalate: true` on a rule makes it an error in unattended mode, the same as listing it in `unattended.escalate`. Set `escalate: false` on a catalog rule's entry to turn that off.
  - A rule's `minimum_rulecast_version` is now checked before the rest of the rule. A rule that uses a key added in a newer rulecast now says to upgrade, instead of failing on the key it does not know.
  
  Fixed: a file the agent changed with its shell and then read kept the read as its baseline, so the change was no longer new at the stop, and a deleted assertion was no longer counted. A read now never replaces the baseline of a file the session already changed.
- 89f366a: **Breaking for plugin detectors:** `runTool` now resolves to `{ stdout, stderr, exitCode }` instead of the stdout string, so a detector can tell a tool's "found something" exit code from its "I failed" one. Replace `await runTool(...)` with `(await runTool(...)).stdout` to keep the old behaviour. The `ToolResult` type is exported.
- be7a668: `rulecast run` has a stable output contract that scripts and agent loops can rely on. It is written down in `agents/reference/output.md`.
  
  - **Every finding has an `id`.** It is a hash of the rule, the file and the finding's source line, not its line number, so the same violation keeps its id when lines are added above it, and changes it when its line is edited. That lets a loop tell "the same finding as last run" from a new one. Findings also carry `endLine`. A detector can set `wholeFile: true` on a `Match` that is about the file as a whole, or `redacted: true` on one whose source is a secret; either id then hashes the match's text and captures instead of its line.
  - **The JSON has `schemaVersion: 1` and `complete`.** It also lists pre-existing findings in full under `preexisting`, and ignored findings carry their `id`. Adding a field leaves the version alone; removing, renaming or changing one bumps it.
  - **The SARIF is richer.** Each result has `partialFingerprints` (the id), `baselineState` (`new`, or `unchanged` for pre-existing findings, which are now included so code scanning does not read them as fixed) and `endLine`. Each rule in `tool.driver.rules` has its name, description, severity, and help text taken from the doc sections it cites. `invocations` says whether the run was complete.
  
  **Breaking:**
  
  - **Exit codes changed** for `run` and `try-repo`: `0` clean, `1` new error findings, `2` rulecast could not run, `3` incomplete. A rule that fails to compile, a rule repo that cannot be fetched, a detector that fails and a verify timeout used to exit 2 and hide the findings of the other rules. They now exit 3, with those findings still printed; so does `run --session` when the session had disabled a rule that would have run. `run RULE_ID` is incomplete only over that rule. `try-repo` still exits 2 when the repo it tries cannot be fetched. `3` wins over `1`. The table is in the README and in `rulecast run --help`.
  - **A config file that does not load** (bad YAML or schema, `minimum_rulecast_version` too new) is now an error on stderr with exit 2 and nothing on stdout, instead of a report that checked nothing. Agent hooks still warn, as before.
  - **`Finding` has two new required fields**, `id` and `endLine`. An adapter or tool that builds `Finding` values itself must set them.
  - The session store's `fingerprint` record is renamed `container`. A session that is running while rulecast is upgraded ignores its old records and classifies `scope: container` rules by line until it measures them again.
- 1fa1d80: `rulecast test` can gate a rule an agent drafted, so a loop can check one without reading terminal text:
  
  - **`--format json`** prints one document: per rule a `status`, and per example what it expected, what the rule found and, when it failed, why. It has its own `schemaVersion: 1`. The fields are in `agents/reference/output.md`.
  - **A `bad` example can pin what it finds** with `expect: { count: 2 }` or `expect: { lines: [3, 7] }`. `lines` is compared as a set. Without `expect`, a `bad` example still passes on at least one finding.
  - **A new `baseline` list** holds edits: `{ path, before, after, expect: { new: [...], preexisting: [...] } }`. `rulecast test` sorts the rule's findings in `after` into new and pre-existing by the rule's `scope`, the way an agent session would. This catches a rule that reports code an edit did not touch as new.
  - **`--against PATH --max-rate 0.5`** exits 1 when a rule flags more than that share of the files it matches. It is not applied under 25 matching files.
  
  `rulecast validate` rejects an `expect` on a `good` example, an empty `expect`, an expected line past the end of its example, and a `count` below the number of `lines` it pins. `agents/DRAFT-RULES.md` now asks for these expectations and gates on `--against . --max-rate 0.5`.
  
  `rulecast test` without a rule id now exits 1 when a rule failed to compile, with its diagnostic on stderr; it used to leave the rule out and pass. A config that does not load exits 2. Terminal output is otherwise unchanged without the new flags.
  
  **Breaking, for plugin code only:** the exported `RuleExamples` type has a required `baseline` list, and `bad` examples are `BadRuleExample` (exported, with the optional `expect`). Code that builds a `RuleExamples` value itself must add `baseline: []`.
- 9f07938: Unattended mode, for agent runs that nobody is watching, such as Claude Code's `/goal`, `claude -p`, scheduled tasks and CI. Until now the stop gate blocked a stop once per user prompt. A loop sends one prompt, so it got one block per run, and after that the findings went to a message that nobody read.
  
  Set `RULECAST_MODE=unattended`, or `mode: unattended` in `.rulecast-config.yaml`. The environment variable wins over the config. When neither is set, `CI` or `GITHUB_ACTIONS` turns the mode on. In unattended mode:
  
  - Every stop with new error findings is blocked, up to `unattended.max_blocks` (default 10) per prompt.
  - A finding that has blocked two stops is reported instead of blocked again, so a false positive cannot loop. A protected file changed with the shell keeps blocking until it is reverted.
  - When the budget is spent, or only repeated findings are left, the agent is held once more and told to record the findings as unresolved in its final report. Before, they went only to a message for the user.
  - The block message tells the agent that nobody is there to ask. If it disputes a finding, it records the finding in the run's decisions file or final report instead of asking the user.
  - In unattended mode a `rulecast-ignore` does not silence a finding on a line the agent changed during the run, whoever wrote the comment; ignores on code the run did not touch keep working. This holds in the stop gate and in `refuse_write`'s refusal.
  - `unattended.escalate: [rule-id, ...]` makes chosen warning rules errors, and `refuse_write: unattended` makes a rule refuse writes only in this mode.
  
  The mode applies to agent hooks only. `rulecast run`, in a git hook or a CI job, always runs the rules as written, so a CI job's exit code does not change. `rulecast run --session <id>` runs in the mode the session's hooks ran in, so it lists the same findings the stop blocks on. `rulecast doctor` shows the active mode and where it came from. Attended behaviour is unchanged.

### Patch Changes

- 53a4a3f: New docs page: rulecast in agent loops (`agents/reference/loops.md`, on the site under Guides as "Agent loops"). It has recipes for running rulecast inside agent loops that nobody watches:
  
  - a checklist before any loop: unattended mode, `rulecast doctor --ci`, and the `loop-safety` pack;
  - a Claude Code `/goal` whose condition is `rulecast run --from-ref main` exiting 0, worded so that exits 2 and 3 end the run with a report instead of looping;
  - a scheduled convention-drift sweep: one rule's new errors per run, `rulecast fix` for the ones it can fix, an agent for the rest, `rulecast baseline --prune`, and a draft pull request;
  - babysitting a pull request with `/loop` and `rulecast run --from-ref`;
  - reading `rulecast stats` to find noisy and dead rules, with the rules themselves revised together with the developer in a reviewed pull request.
  
  The output contract (`agents/reference/output.md`) now lists the `disabled` key of `rulecast run --format json`: the rules that did not run, and why.
- a325666: Hooks fail open when the cache home cannot be created: the hook exited 2 if `RULECAST_HOME` (or `~/.cache`) was unwritable, because it parsed the payload and created its state directory before its error handling. `rulecast run --from-ref` now checks files with non-ASCII names, which git listed quoted and no rule matched. `init` finds the git root through the same scrubbed environment as every other git call, so a `GIT_DIR` inherited from a git hook no longer names another repository.
  
  `rulecast test --against <paths>` without a rule id counts every rule, one line each. `uninstall` removes a settings file it leaves empty instead of writing `{}`. `init --yes` says when nothing in the catalog applies to the project's files. `validate` names the file once in a rule's diagnostic.
- 8d04795: A subagent's stop is now blocked only by findings in files that subagent edited. Before, it could be blocked by a file the main agent or another subagent changed, and was then asked to fix code it never touched. The main agent's stop still checks every file the session changed. A change no agent's tool call made is reported at the main agent's stop, and at a subagent's only when that subagent's own shell calls found it.
  
  Agents running in parallel in one working tree that change files with the shell can still be blamed for each other's writes: a shell command is held to every file that changed while it ran. Give parallel agents their own worktrees. An agent whose shell call overlaps another agent's, and that is held to files changed while it ran, is now told so, once per session, with the same advice.

## 0.5.0

### Minor Changes

- f440ea2: **Files the agent changes with Bash are now checked during the session.** Until now only `Edit` and `Write` were watched, so a rule broken with `sed -i`, a Python one-liner or a `>` redirect went unseen until a git hook or CI caught it. rulecast now records the working tree before and after each Bash call, and what changed during the call goes through the same check as an `Edit`: the finding arrives right after the call, titled "changed by your Bash command", and Stop is blocked until it is fixed. Run `rulecast install` again to add the Bash hooks to an existing install; `rulecast doctor` says when they are missing.
  
  **`refuse_write` catches shell writes.** A command cannot be refused before it runs, because nothing knows what it will write, so a protected file changed with Bash is caught right after: the agent is told the file is protected and how to revert it (`git checkout -- <file>`, or "undo only your change" when the file had your uncommitted work), Stop is blocked until it does, whatever the rule's severity, and you get a notice naming the file.
  
  **Changes nobody's tool call explains are reported, and never block.** Your own edits in another editor, a formatter, a job the agent left running: rulecast finds them by comparing the tree between calls and at Stop, reports them under "changed outside your tool calls", and never lets them stop the agent from finishing. On an allowed Stop they are shown to you.
  
  **Your uncommitted work stays yours.** At session start rulecast snapshots the files that are already dirty, so an agent that reads a file with `cat` and rewrites it with `sed` is judged only on the lines it added, not on yours. A `git stash && git stash pop`, a commit or a checkout during a call is not counted as an edit.
  
  The hook before each Bash call only records the tree. On a 20,000-file repository it adds 135–150 ms at p95; on an ordinary one, a few milliseconds. Outside a git repository rulecast says once that it cannot see the tree, and Bash edits are left to git hooks and CI as before.

## 0.4.0

### Minor Changes

- be50597: Two fixes found by measuring rather than reading, and a plugin API a third-party detector or adapter can use without reaching into `/internal`.
  
  **Fixed: a deadline that passed could switch a rule off for the whole session.** When an `ast-grep` rule failed after the edit deadline had passed but before the abort signal had fired — which is what happens when native parsing holds the event loop — it was recorded as a rule error, so the rule was disabled for the rest of the session and the run marked failed. It is now a timeout, logged and tried again at the next verify, as it always was for `regex` and `path`. `linter` and `llm` had the same shape and now share the same check.
  
  **Fixed: the context budget now spends exactly what the agent is sent.** The budget estimated a delivery's size with hand-tuned constants. Trimming seeded random deliveries across a sweep of limits, 5,708 of 24,000 rendered over their limit, by up to 500 characters; the adapter's slack absorbed it, so no agent saw a cut, but the budget was not keeping its own promise. The renderer now prices its own output and none overflow. Three causes: a block with findings cut was measured as if nothing were cut, every block was charged one character short, and a backlog with every summary cut still printed its heading and count. Exact prices also admit more — a doc section shorter than the "read this, too long" line that would replace it is no longer demoted to that line.
  
  **The plugin API is closed, and held closed.** `@syv-ai/rulecast` exported `CompiledRule` but not three types its own fields are declared with — `Stage`, `ReferenceSpec`, `RuleExamples` — so a third-party detector or adapter could not name them from either entry point. They are exported, with `RuleExample`, `renderAgentText` and `RenderOptions` (the budget is computed against this renderer, so an adapter should wrap it rather than replace it), and `lineStarts`, `positionAt` and `offsetAt`. A type-level check in the test suite fails if the public entry point names a type it does not export again.
  
  **A detector says what it is, instead of the core knowing its name.** `Detector` gains optional `metered`, `cost(config)`, `fileBudget(settings)`, `timeoutHint` and `wholeFile`. The `llm` detector declares the first four and `path` the last; everything the core used to do because a kind was called `"llm"` — never preselecting it in `init`, never fingerprinting it, budgeting its files, not dry-running it in `doctor` — it now does for any detector that declares `metered`. One wording changed as a result: `doctor` now says llm rules are not dry-run "(each run costs money)" rather than "(a model call costs money)".
  
  **Helpers for a detector that hands paths to another program**, on the plugin API: `repoRelative`/`repoRelativeTo` (handles a SARIF `file://` URI and a root reached through a symlink), `runTool` (a non-zero exit is an answer, a missing binary is an error), `sourceReader` and `pastDeadline`. `command` and `linter` each carried their own copies.
- 3d9b25a: rulecast reports the same line the same way in an agent hook, a git hook and CI. A team gets from `init` to a firing hook without a trap. The agent is told what to do with what it receives, and cannot quietly edit its way past the gate.
  
  **Changed: `rulecast run` with no file flags judges what is being committed.** It checks the staged files, reads their content from the index rather than the working tree, and classifies findings against `HEAD`. A line the commit did not change is backlog: shown, and never failing the commit. Before, a docstring added above an existing violation failed the commit, and a violation staged and then fixed only in the working tree passed. With nothing staged it says so and points at `--all-files`, and every run says how many files it checked. `llm` rules are skipped in this mode unless you pass `--llm`, and one line says so: a commit should not cost money.
  
  **`--to-ref B` reads content at `B`.** Pre-push and CI judge what is pushed, not whatever is uncommitted. `--from-ref` alone still reads the working tree. In a shallow clone, the error names `fetch-depth: 0`. `ruff` and `eslint` are handed the staged or committed content on stdin under the file's real path, so path-keyed configuration still applies; `command` scripts and `oxlint` get a scratch copy inside the project.
  
  **Git hooks and CI.** The repository ships a `.pre-commit-hooks.yaml` with `rulecast` (pre-commit) and `rulecast-push` (the pushed range), and the README has lefthook and GitHub Actions recipes, including SARIF upload. rulecast installs no git hooks itself.
  
  **Turning things off.** `enabled: false` switches a rule off, catalog rules included. `# rulecast-ignore: <rule-id> <reason>` on the matched line or the line above drops one finding; the reason is required. `run --all-files --summary` counts ignores.
  
  **The developer hears what the agent should not be the only one to see.** When an agent session changes `.rulecast-config.yaml` or adds an ignore, the developer is told at Stop through a `systemMessage`. Rule and detector warnings go there too, instead of into the model's context. The block reason tells the agent to say so when it thinks a finding is wrong rather than edit the config, and the backlog heading says to leave old violations alone unless asked. Overflow files and `read`-mode references now live in `<project>/.rulecast/`, which ignores itself: Claude Code blocks reads under `~/.cache` by default.
  
  **`init` installs hooks.** When no agent is detected, every supported adapter is preselected, interactively and under `--yes`; `--no-agents` installs none. The convention prompt defaults to the project's own doc heading when one matches the rule's doc.
  
  **A hook whose rulecast is not installed yet stays quiet.** The hook command exits 0 when `node_modules/.bin/rulecast` is missing (a fresh clone before `npm install`) and says so once, at session start. `rulecast install` upgrades rulecast's own stale hook entries, and `doctor` warns about them.
  
  **Commands that say what they did.** `rulecast list` shows every configured rule, catalog rules included: source, files and how many project files they match, what its detector looks for (a regex's pattern, an llm rule's question), the doc sections it cites; `rulecast list <rule-id>` adds the files it matches, the rule's message and the text of those sections; `--format json` too. `--version`, `help <command>` and `<command> --help` work. Validation errors say what to do (`unknown key "prompt" (did you mean "question"?)`). `test --against` prints one note chosen by the count, and says when there are too few matching files for the count to mean anything; `--against .` from the project root now means the whole project instead of being refused. A failing example shows what the detector matched, line breaks included, and bare `rulecast test` lists the `llm` rules it did not run. `doctor`'s dry run names the one file it tried out of how many. `validate` takes any file name and tells a config from a manifest by content.
  
  **The agent docs.** `DRAFT-RULES.md` starts from `rulecast list`. A convention a catalog rule already enforces gets a `context` override pointing at the project's doc. Examples with nothing real to quote are invented and labelled as invented. For each catalog rule it asks two questions separately, which section it should cite and whether what it checks fits the project, with a check for each. It covers conventions that are only partly checkable or require something to be present, and what to do when no developer is there to answer.
  
  **Catalog: `python/layering` reaches route modules.** It matched only `routes/`, `services/` and `crud/` directories, so a project with `app/api/routes.py` or `app/crud.py` never got the layering section. It now matches those layers as a directory or a single module, `api/` and `routers/` included, and leaves out tests.

## 0.3.0

### Minor Changes

- c83362b: Three changes drawn from measurements of where rulecast was weak, and a `doctor` fix.
  
  **`scope: instance | container` on a rule.** A rule can say whether its convention belongs to the token the detector matched or to the node around it. `instance` is the default and is what every rule did before. `container` classifies a finding as new only when the node it spans was not already violating the rule at the baseline, which is what a `slim-routes`-shaped rule needs: measured over 1,377 agent-written sites, line overlap scored precision 0.62 there and the container comparison 0.76. The baseline records what a container rule matched when it snapshots a file, so the edit path still runs each detector exactly once and no file content is stored.
  
  **`rulecast run --all-files` prints an adoption backlog**, and `--summary` prints it alone; `--format json` gains a `backlog` object. Counts, never a percentage: one codebase went from 61 violations in 80 files to 57 in 194 over eight months — the rate fell from 76% to 29% while the count stood still, because new code complied and the old violations were only diluted. Pre-existing findings in a hook delivery are now headed as a backlog and name the command that shows all of it, instead of reading as "not blocking, ignore this".
  
  **`rulecast test`**, with an `examples` rule key holding `good` and `bad` cases. It runs them and scores each rule; `rulecast test <id> --against <paths>` fires the rule over real files and reports how much it would flag, so a rule that nobody breaks or that everybody breaks is visible before adoption rather than after. Every catalog rule now ships examples. `agents/DRAFT-RULES.md` no longer asks an agent to pick a detector tier up front: the same convention scored P 0.99 as a pattern under one wording and P 0.70 under a stricter one, so the flow is now attempt a pattern, measure it, and fall back to `llm` only on failure.
  
  **Fixed:** `rulecast doctor` reported hooks as `ok` when the command they run is on neither the PATH nor `node_modules/.bin` — installed, and silently doing nothing on every event. It now warns and names the lever.

## 0.2.0

### Minor Changes

- 8578864: Warnings can no longer crowd findings out of a delivery, and a very large file can no longer hold
  up a write.
  
  Eighty rules that fail to compile used to produce eighty warnings — 13,500 characters against a
  9,000 character budget — and the one rule that still worked was dropped whole, so the agent was
  told eighty times that rulecast was broken and nothing about its own code. A rule repo pinned to a
  rev that has moved does exactly this, and that is the moment the working rules matter most.
  
  Two changes. Compile diagnostics and detector errors now collapse above three of a kind into one
  line with a count and an example — "80 rules failed to compile and were skipped — run rulecast
  validate" — keyed so that a rule breaking later in the session is still announced. And warnings are
  charged against the context budget *after* the findings rather than before them, capped at a share
  of it, so no number of warnings of any kind can cost the agent a finding it could act on. The other
  warnings are untouched: each already names a specific setting to change.
  
  New config key **`max_file_bytes`** (default 1 MiB). `ast-grep` parses in native code, which the
  timeout that bounds `regex` cannot interrupt, and the pre-write guard runs it before the agent's
  write is allowed: a 5 MB proposed write measured 942 ms of a blocked agent. Files over the ceiling
  are now skipped by the in-process detectors (`regex`, `path`, `ast-grep`) on edit and on guard, and
  the same write returns in 1 ms. `verify`, which has seconds to spend, always runs. A skipped file is
  written to the debug log, not delivered as a warning, and does not mark the run failed.
- 2533d3b: The stop gate reads what was found, not what fitted the context budget.
  
  A rule the budget dropped was filtered out of the delivery before the stop gate read it, so the agent could stop with an unresolved error and nothing reached it.
  
  Breaking: the package entry point is now the plugin API. `compile`, `runPipeline`, `cacheHome` and the rest of rulecast's own machinery moved to `@syv-ai/rulecast/internal`, and `rulecast run --format json` no longer carries `templates`, `omitted` or `overflowPath`.
- a55c674: Three ways rulecast could stop responding, found by stress testing and fixed.
  
  A rule that fired tens of thousands of times in one file — which an ordinary pattern does to a
  generated or minified file — made the delivery take time proportional to the square of its matches:
  62,000 matches took 5.9 seconds, and an 8 megabyte file never finished at all. Findings are now
  grouped in place, and that file completes in a second.
  
  A regex that backtracks exponentially could hold the edit hook, and the pre-write guard, open
  indefinitely. The deadline could not stop it — the matching is synchronous, so the timer that would
  fire the deadline never got to run — and the hook then reported the run as having finished on time.
  Matching is now bounded by a timeout V8 can actually enforce, and a missed deadline is recorded as
  one.
  
  A session store with a half-written record in the middle of it threw out of the hook. It now runs
  without session memory and says so, which is what the failure policy always specified.
  
  Detectors now receive `deadlineAt` on `DetectorRun`: the wall-clock time after which their results
  are discarded. A detector whose work is synchronous needs it, because `signal` cannot reach it.

## 0.1.1

### Patch Changes

- 193ec4a: Published through npm trusted publishing.
  
  Releases are now authorised by the release workflow's own OIDC identity rather than by a long-lived npm token, and every published tarball carries a provenance attestation tying it to the workflow run that built it. There is no npm publish token in the repository.

## 0.1.0

### Minor Changes

- cfee5bd: First release.
  
  rulecast delivers a project's conventions to a coding agent at the moment the agent is about to break one. A rule pairs a check with a message and a pointer to the doc section that explains it; rulecast runs as an agent hook, so the agent gets both in the same turn as the edit.
  
  - **Rules** in `.rulecast-config.yaml`, in pre-commit's style: local rules, or rules from a git rule repo pinned by tag. `rulecast autoupdate` moves the pins; `rulecast try-repo` runs a repo without configuring it.
  - **Six detectors**: `regex`, `path`, `ast-grep`, `command`, `linter` (ruff, oxlint, eslint) and `llm`. The first four run on every edit; `llm` runs only when the agent stops, names its own model, and speaks to Claude Code, OpenCode, the Anthropic API or any OpenAI-compatible endpoint.
  - **Claude Code adapter**, written against recorded hook payloads. The edit hook is budgeted under 500 ms at p95 and measured at p50 173 ms / p95 199 ms on an Apple M3 Pro with all six detectors configured. The pre-write hook adds about 80 ms per Edit or Write.
  - **Only what changed**: a per-session baseline separates findings the agent just introduced from what was already there, so an agent is told about its own work rather than the whole repository's.
  - **`refuse_write`** refuses the edit itself, before the file changes: the agent is shown the rule's message and the doc section it cites in place of the tool's result. It rests only on the text the agent is writing, gives up rather than guess when an edit cannot be reconstructed exactly, and refuses once per file per session, so a rule can stop a mistake without trapping the agent.
  - **A message is printed once**, not once per match: a rule that fired eleven times shows its message with `{name}` in place of its variables and one line per site under it. Under a hook's context budget, every rule that fired keeps a finding and the section it cites; repeats go first, then pre-existing summaries, then doc contents. A delivery too large even for that is written whole to the cache and the message ends with its path.
  - **`rulecast init`** detects the project, offers catalog rules that apply to its files, installs the hooks and prints a prompt for drafting rules from your own docs. **`rulecast doctor`** says why a rule is quiet: what compiled, which binaries, parsers and credentials are actually there, where the hooks and caches live, and what every rule matches today.
  - **Rule packages** for general, Python and React projects, and agent-facing docs under `agents/` so an agent can set rulecast up and draft rules itself.
  - Published to npm as `@syv-ai/rulecast`, with standalone Linux and macOS binaries on GitHub Releases.
