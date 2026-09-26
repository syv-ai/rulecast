"""Set B: the semantic case. rulecast's `python/thin-routes` is an `llm` rule today; can a noul do it?

Question is taken verbatim from packages/rules-python/rules.yaml, minus "Report each offending
line" (a noul cannot localize -- the enumeration does that).

Also measures batched throughput, which is what decides whether N sites in one file fit the
350ms edit deadline.
"""
import json, pathlib, time
import laya
from laya import decide

TMP = pathlib.Path(__file__).parent
sites = json.loads((TMP / "setB.json").read_text())

QUESTION = ("Does this route handler do more than parse input, call a service and return the "
            "result - business logic, database access, or error translation written inline?")


def metrics(rows, tag):
    correct = sum(1 for r in rows if (r["p"] >= 0.5) == bool(r["label"]))
    acc = correct / len(rows)
    tp = sum(1 for r in rows if r["p"] >= 0.5 and r["label"] == 1)
    fp = sum(1 for r in rows if r["p"] >= 0.5 and r["label"] == 0)
    fn = sum(1 for r in rows if r["p"] < 0.5 and r["label"] == 1)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    ece = 0.0
    for b in range(10):
        lo, hi = b / 10, (b + 1) / 10
        br = [r for r in rows if (lo <= r["p"] < hi) or (b == 9 and r["p"] == 1.0)]
        if not br:
            continue
        ece += (len(br) / len(rows)) * abs(sum(r["p"] for r in br) / len(br)
                                           - sum(r["label"] for r in br) / len(br))
    # best achievable accuracy over all thresholds -- says whether the signal is there but
    # the 0.5 cut is simply in the wrong place (which min_confidence would fix)
    best_t, best_a = 0.5, acc
    for t in [i / 100 for i in range(1, 100)]:
        a = sum(1 for r in rows if (r["p"] >= t) == bool(r["label"])) / len(rows)
        if a > best_a:
            best_a, best_t = a, t
    print(f"{tag}: accuracy {acc:.3f} (baseline 0.500)  precision {prec:.3f}  recall {rec:.3f}  "
          f"ECE {ece:.3f}")
    print(f"{tag}: best threshold {best_t:.2f} -> accuracy {best_a:.3f}")
    ps = sorted(r["p"] for r in rows)
    print(f"{tag}: p range {ps[0]:.3f}..{ps[-1]:.3f}  median {ps[len(ps)//2]:.3f}")
    return {"tag": tag, "acc": acc, "prec": prec, "rec": rec, "ece": ece,
            "best_t": best_t, "best_acc": best_a, "rows": rows}


out = []
for sub, tag in [(None, "english-421M-base"), ("typed-decisions", "typed-decisions-finetune")]:
    t0 = time.time()
    ag = laya.load("convaiinnovations/laya", subfolder=sub)
    print(f"\n=== {tag} === load {time.time()-t0:.1f}s", flush=True)
    q = {"fat": {"type": "noul", "instructions": QUESTION}}
    decide(ag, sites[0]["code"], questions=q)  # warm

    rows, lat = [], []
    for s in sites:
        a = time.time()
        r = decide(ag, s["code"], questions=q)
        lat.append((time.time() - a) * 1000)
        rows.append({"label": s["label"], "p": float(r["fat"]["noul"]),
                     "file": s["file"], "line": s["line"], "name": s["name"]})
    lat.sort()
    print(f"{tag}: latency p50 {lat[len(lat)//2]:.1f}ms  p95 {lat[int(len(lat)*0.95)]:.1f}ms", flush=True)
    out.append(metrics(rows, tag))

    # ---- batching: many questions about ONE file in a single call ----
    if sub is None:
        print("\n--- batched: N questions in one call (one file's sites) ---", flush=True)
        for n in (1, 3, 5, 10, 20):
            qs = {f"q{i}": {"type": "noul", "instructions": QUESTION} for i in range(n)}
            state = sites[0]["code"]
            decide(ag, state, questions=qs)
            times = []
            for _ in range(5):
                a = time.time()
                decide(ag, state, questions=qs)
                times.append((time.time() - a) * 1000)
            times.sort()
            med = times[len(times) // 2]
            print(f"  {n:>2} questions: {med:7.1f}ms total   {med/n:6.1f}ms/question", flush=True)

(TMP / "setB-results.json").write_text(json.dumps(out, indent=1))
