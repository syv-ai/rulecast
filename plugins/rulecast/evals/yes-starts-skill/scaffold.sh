#!/usr/bin/env bash
# A tiny Python service repo set up for rulecast, with no rules yet.
set -euo pipefail
mkdir -p app/services

cat > .rulecast-config.yaml <<'YAML'
# rulecast config: https://github.com/syv-ai/rulecast
repos: []
YAML

cat > AGENTS.md <<'MD'
# AGENTS.md

A small user and order service. Code is in `app/`, services in `app/services/`.
rulecast checks this project's conventions; its config is `.rulecast-config.yaml`.
MD

: > app/__init__.py
: > app/services/__init__.py

cat > app/errors.py <<'PY'
class NotFound(Exception):
    """A requested record does not exist."""


class Conflict(Exception):
    """A write clashes with the current state."""
PY

cat > app/services/users.py <<'PY'
from fastapi import HTTPException

USERS = {1: "ada", 2: "grace"}


def get(user_id: int) -> str:
    if user_id not in USERS:
        raise HTTPException(404)
    return USERS[user_id]
PY

# The history's first exchange already changed users.py.
cat > app/services/users.py <<'PY'
from app.errors import NotFound

USERS = {1: "ada", 2: "grace"}


def get(user_id: int) -> str:
    if user_id not in USERS:
        raise NotFound(f"user {user_id}")
    return USERS[user_id]
PY

# rulecast is a devDependency here; the stub stands in for it (npx and node_modules/.bin both find it).
mkdir -p node_modules/@syv-ai/rulecast/bin node_modules/.bin
cat > package.json <<'JSON'
{"name": "svc", "private": true, "devDependencies": {"@syv-ai/rulecast": "0.8.2"}}
JSON
cat > node_modules/@syv-ai/rulecast/package.json <<'JSON'
{"name": "@syv-ai/rulecast", "version": "0.8.2", "bin": {"rulecast": "bin/rulecast.js"}}
JSON
cat > node_modules/@syv-ai/rulecast/bin/rulecast.js <<'JS'
#!/usr/bin/env node
// Eval stub for rulecast 0.8.2: answers `list` and `list --catalog` as the real CLI does for this project.
const args = process.argv.slice(2)
const out = (text) => process.stdout.write(`${text}\n`)
if (args[0] === "--version") {
  out("0.8.2")
} else if (args[0] === "list" && args.includes("--catalog")) {
  out(`Catalog: syv-ai/rulecast@v0.8.2

generated-code  path · edit, verify · error  [syv-ai/rulecast@v0.8.2]
  Generated code is never edited by hand
  Flags edits to generated files: *.gen.* files and __generated__/ directories.
  files \\.gen\\.[cm]?[jt]sx?$|(^|/)__generated__/ — matches no file in this project
  cites packages/rules-general/generated-code.md

loop-safety/no-skipped-tests-python  ast-grep · edit, verify · warning  [syv-ai/rulecast@v0.8.2]
  No new skipped or expected-to-fail Python tests
  files (^|/)(test[^/]*|[^/]*_test|conftest)\\.py$|(^|/)tests?/.*\\.py$ — matches no file in this project
  cites packages/rules-loop-safety/loop-safety.md#skipped-and-focused-tests

rulecast list --catalog <rule-id> shows one rule with the text of the sections it cites.`)
} else if (args[0] === "list") {
  out(`Conventions: not set
llm rules: not allowed (no llm.model)

0 rules

rulecast list <rule-id> shows one rule with the text of the sections it cites.`)
} else {
  process.stderr.write(`rulecast (eval stub): \`rulecast ${args.join(" ")}\` is not available in this eval\n`)
  process.exit(1)
}
JS
chmod +x node_modules/@syv-ai/rulecast/bin/rulecast.js
ln -s ../@syv-ai/rulecast/bin/rulecast.js node_modules/.bin/rulecast
printf 'node_modules/\n__pycache__/\n' > .gitignore

cat > app/services/orders.py <<'PY'
from fastapi import HTTPException

ORDERS = {10: "book", 11: "lamp"}


def get(order_id: int) -> str:
    if order_id not in ORDERS:
        raise HTTPException(404)
    return ORDERS[order_id]
PY

git init -q
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -qm "initial"
