"""Set B: FastAPI route handlers, for rulecast's `python/thin-routes` rule (today an `llm` rule).

Labels come from an explicit, reproducible rubric rather than the model or my reading, so they can
be audited. The rubric encodes the rule's own words: "more than parse input, call a service and
return -- business logic, database access, or error translation written inline".

  FAT (1): inline DB/ORM access, or >=2 inline HTTPException raises, or a big body (>12 stmts)
  THIN (0): no DB access, no HTTPException, <=4 statements -- i.e. delegates and returns
  dropped:  everything in between (deliberately ambiguous, excluded rather than guessed)
"""
import ast, json, os, pathlib, random, sys

ROOT = pathlib.Path(os.environ.get("TARGET_REPO", sys.argv[1] if len(sys.argv) > 1 else "."))
random.seed(11)

DB_HINTS = ("db.", "session.", "supabase", ".execute(", ".query(", "select(", "insert(",
            "update(", "delete(", ".commit(", ".scalars(", ".fetchall(", ".fetchone(")
ROUTE_DECOS = ("get", "post", "put", "patch", "delete")


def is_route(fn):
    for d in fn.decorator_list:
        node = d.func if isinstance(d, ast.Call) else d
        if isinstance(node, ast.Attribute) and node.attr in ROUTE_DECOS:
            return True
    return False


sites = []
files = [p for p in ROOT.rglob("*.py")
         if ".venv" not in p.parts and "node_modules" not in p.parts and "site-packages" not in p.parts]

for path in files:
    try:
        src = path.read_text(encoding="utf-8")
        tree = ast.parse(src)
    except Exception:
        continue
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) or not is_route(fn):
            continue
        seg = ast.get_source_segment(src, fn)
        if seg is None or not (60 < len(seg) < 1500):
            continue
        body = [s for s in fn.body if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant)
                                           and isinstance(s.value.value, str))]
        n_stmt = sum(1 for _ in ast.walk(fn) if isinstance(_, ast.stmt))
        text = seg
        has_db = any(h in text for h in DB_HINTS)
        n_http = text.count("HTTPException")

        if has_db or n_http >= 2 or n_stmt > 12:
            label = 1
        elif not has_db and n_http == 0 and len(body) <= 4:
            label = 0
        else:
            continue
        sites.append({"file": str(path.relative_to(ROOT)), "line": fn.lineno, "name": fn.name,
                      "label": label, "has_db": has_db, "n_http": n_http, "n_stmt": n_stmt,
                      "code": seg})

pos = [s for s in sites if s["label"] == 1]
neg = [s for s in sites if s["label"] == 0]
random.shuffle(pos); random.shuffle(neg)
n = min(30, len(pos), len(neg))
sample = pos[:n] + neg[:n]
random.shuffle(sample)
print(f"route handlers labelled: {len(sites)}  fat: {len(pos)}  thin: {len(neg)}", file=sys.stderr)
print(f"balanced sample: {len(sample)} ({n}/{n})", file=sys.stderr)
pathlib.Path(__file__).with_name("setB.json").write_text(json.dumps(sample, indent=1))
