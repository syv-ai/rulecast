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
        raise NotFound(f"user {user_id} not found")
    return USERS[user_id]
PY

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
