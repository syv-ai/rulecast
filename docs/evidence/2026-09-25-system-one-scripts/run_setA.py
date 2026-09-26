"""Run Set A through Laya: 50 except-sites, machine-labelled, 25/25 balanced.

Measures accuracy against the 0.50 majority-class baseline, calibration (ECE), and per-question
latency warm. Tests the base English checkpoint and the typed-decisions fine-tune.
"""
import json, pathlib, sys, time
import laya
from laya import decide

TMP = pathlib.Path(__file__).parent
sites = json.loads((TMP / "setA.json").read_text())

# Worded as rulecast's own rule describes itself (packages/rules-python/rules.yaml).
QUESTION = ("Does this Python code swallow an exception silently — an except clause whose only "
            "statement is pass, hiding the failure instead of handling, logging or re-raising it?")

def evaluate(subfolder, tag):
    t0 = time.time()
    ag = laya.load("convaiinnovations/laya", subfolder=subfolder)
    load_s = time.time() - t0
    print(f"\n=== {tag} === load {load_s:.1f}s", flush=True)

    q = {"swallow": {"type": "noul", "instructions": QUESTION}}
    # warm-up, excluded from timing
    decide(ag, sites[0]["code"], questions=q)

    rows, lat = [], []
    for s in sites:
        a = time.time()
        r = decide(ag, s["code"], questions=q)
        lat.append((time.time() - a) * 1000)
        ans = r["swallow"]
        rows.append({"label": s["label"], "p": float(ans["noul"]),
                     "conf": float(ans.get("confidence", ans["noul"])),
                     "file": s["file"], "line": s["line"]})

    correct = sum(1 for r in rows if (r["p"] >= 0.5) == bool(r["label"]))
    acc = correct / len(rows)
    tp = sum(1 for r in rows if r["p"] >= 0.5 and r["label"] == 1)
    fp = sum(1 for r in rows if r["p"] >= 0.5 and r["label"] == 0)
    fn = sum(1 for r in rows if r["p"] < 0.5 and r["label"] == 1)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    # 10-bin ECE
    ece = 0.0
    for b in range(10):
        lo, hi = b / 10, (b + 1) / 10
        bin_rows = [r for r in rows if (lo <= r["p"] < hi) or (b == 9 and r["p"] == 1.0)]
        if not bin_rows:
            continue
        conf = sum(r["p"] for r in bin_rows) / len(bin_rows)
        actual = sum(r["label"] for r in bin_rows) / len(bin_rows)
        ece += (len(bin_rows) / len(rows)) * abs(conf - actual)

    lat.sort()
    print(f"accuracy {acc:.3f}  (baseline 0.500)   precision {prec:.3f}  recall {rec:.3f}")
    print(f"ECE {ece:.3f}   latency p50 {lat[len(lat)//2]:.1f}ms  p95 {lat[int(len(lat)*0.95)]:.1f}ms  "
          f"min {lat[0]:.1f}ms  max {lat[-1]:.1f}ms")
    return {"tag": tag, "acc": acc, "prec": prec, "rec": rec, "ece": ece,
            "p50": lat[len(lat)//2], "p95": lat[int(len(lat)*0.95)], "load_s": load_s, "rows": rows}

out = []
for sub, tag in [(None, "english-421M-base"), ("typed-decisions", "typed-decisions-finetune")]:
    try:
        out.append(evaluate(sub, tag))
    except Exception as e:
        print(f"{tag} FAILED: {type(e).__name__}: {e}", flush=True)
(TMP / "setA-results.json").write_text(json.dumps(out, indent=1))
