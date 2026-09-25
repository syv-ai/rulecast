"""Is Set B's null result the model, or my wording? Try several phrasings + a decomposition.

Also checks a `choice` question, since choice and noul have different heads, and a sanity control
(a question with an obvious mechanical answer) to prove the harness itself discriminates.
"""
import json, pathlib, time
import laya
from laya import decide

TMP = pathlib.Path(__file__).parent
sites = json.loads((TMP / "setB.json").read_text())

WORDINGS = {
    "rule-verbatim": ("Does this route handler do more than parse input, call a service and return "
                      "the result - business logic, database access, or error translation written inline?"),
    "short": "Does this route handler contain database access or business logic inline?",
    "db-only": "Does this code execute a database query directly?",
    "delegates": "Does this function only validate its input and delegate to another function?",
    "fat-thin": "Is this route handler fat (does real work itself) rather than thin (delegates)?",
}
CONTROL = "Does this code contain the word 'async'?"   # mechanically obvious; proves discrimination


def score(ag, question, key="q"):
    q = {key: {"type": "noul", "instructions": question}}
    rows = []
    for s in sites:
        r = decide(ag, s["code"], questions=q)
        rows.append((s["label"], float(r[key]["noul"])))
    acc = sum(1 for l, p in rows if (p >= 0.5) == bool(l)) / len(rows)
    ps = sorted(p for _, p in rows)
    # AUC: threshold-free, so it sees signal even when the 0.5 cut is wrong
    pos = [p for l, p in rows if l == 1]
    neg = [p for l, p in rows if l == 0]
    auc = sum((1.0 if a > b else 0.5 if a == b else 0.0) for a in pos for b in neg) / (len(pos) * len(neg))
    best = max(sum(1 for l, p in rows if (p >= t / 100) == bool(l)) / len(rows) for t in range(1, 100))
    return acc, auc, best, ps[0], ps[-1]


ag = laya.load("convaiinnovations/laya")
print(f"{'wording':<16} {'acc@0.5':>8} {'AUC':>6} {'best':>6}   p-range")
print("-" * 58)
for name, q in WORDINGS.items():
    acc, auc, best, lo, hi = score(ag, q)
    print(f"{name:<16} {acc:>8.3f} {auc:>6.3f} {best:>6.3f}   {lo:.3f}..{hi:.3f}", flush=True)

# control: label = does the source actually contain 'async'
ctrl_rows = []
q = {"c": {"type": "noul", "instructions": CONTROL}}
for s in sites:
    r = decide(ag, s["code"], questions=q)
    ctrl_rows.append((1 if "async" in s["code"] else 0, float(r["c"]["noul"])))
cacc = sum(1 for l, p in ctrl_rows if (p >= 0.5) == bool(l)) / len(ctrl_rows)
cpos = [p for l, p in ctrl_rows if l == 1]
cneg = [p for l, p in ctrl_rows if l == 0]
cauc = (sum((1.0 if a > b else 0.5 if a == b else 0.0) for a in cpos for b in cneg) / (len(cpos) * len(cneg))
        if cpos and cneg else float("nan"))
print(f"\nCONTROL ('contains async', {len(cpos)} pos / {len(cneg)} neg): acc {cacc:.3f}  AUC {cauc:.3f}")

# choice head, same task
ch = {"kind": {"type": "choice", "instructions": "Is this route handler thin or fat?",
               "criteria": {"thin": "only validates input and delegates to a service",
                            "fat": "contains inline database access or business logic"}}}
correct = 0
for s in sites:
    r = decide(ag, s["code"], questions=ch)
    top = r["kind"].get("choice") or r["kind"].get("answer") or r["kind"]
    pick = top if isinstance(top, str) else max(top, key=top.get) if isinstance(top, dict) else None
    correct += int((pick == "fat") == bool(s["label"]))
print(f"CHOICE head: accuracy {correct/len(sites):.3f}")
