---
"@syv-ai/rulecast": minor
---

`rulecast init` now flags hooks that can never fail, and says at which git stage each hook runs (#77, #78).

- **Hooks that can never fail.** An offered hook whose command exits 0 whatever it finds now has `neverFails` in the dry-run JSON. Its value is the part that causes it: `"|| true"`, `"|| :"`, `"; exit 0"` or `"set +e"`, found in the hook's entry or in the package script it runs. The text output says `(never fails: || true)`. A rule built on such a hook never fires, so `SETUP.md` now has the agent leave it off and tell the developer, who may believe it is a gate.
- **Stages.** An offered hook has `stages` when its config names them: the hook's own pre-commit `stages`, the config's `default_stages`, or for lefthook the hook it sits under. `commit-msg` hooks check the commit message, not the code, and `manual` hooks run only when asked for and may be slow. `SETUP.md` has the agent leave both off by default, and the text output says why.
