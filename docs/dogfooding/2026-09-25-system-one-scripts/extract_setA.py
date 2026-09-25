"""Set A: except-clause sites with MACHINE-VERIFIABLE labels.

Ground truth is ast itself: an except handler whose body is exactly `pass` is a positive
(what rulecast's python/no-silent-except ast-grep rule matches); anything else is a negative.
No human judgment involved, so the labels cannot be biased toward the model.
"""
import ast, json, os, pathlib, random, sys

ROOT = pathlib.Path(os.environ.get("TARGET_REPO", sys.argv[1] if len(sys.argv) > 1 else "."))
random.seed(7)

sites = []
files = [p for p in ROOT.rglob("*.py")
         if ".venv" not in p.parts and "node_modules" not in p.parts and "site-packages" not in p.parts]

for path in files:
    try:
        src = path.read_text(encoding="utf-8")
        tree = ast.parse(src)
    except Exception:
        continue
    lines = src.splitlines()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        for h in node.handlers:
            body = [s for s in h.body if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant)
                                              and isinstance(s.value.value, str))]
            bare_pass = len(body) == 1 and isinstance(body[0], ast.Pass)
            # The snippet a `classify` detector would send: the whole try statement.
            seg = ast.get_source_segment(src, node)
            if seg is None:
                continue
            seg = seg.strip()
            if not (20 < len(seg) < 1400):
                continue
            sites.append({
                "file": str(path.relative_to(ROOT)),
                "line": h.lineno,
                "label": 1 if bare_pass else 0,
                "code": seg,
            })

pos = [s for s in sites if s["label"] == 1]
neg = [s for s in sites if s["label"] == 0]
random.shuffle(pos); random.shuffle(neg)
n = min(40, len(pos), len(neg))
sample = pos[:n] + neg[:n]
random.shuffle(sample)

print(f"total except sites: {len(sites)}  bare-pass: {len(pos)}  handled: {len(neg)}", file=sys.stderr)
print(f"balanced sample: {len(sample)} ({n} pos / {n} neg)", file=sys.stderr)
pathlib.Path(__file__).with_name("setA.json").write_text(json.dumps(sample, indent=1))
