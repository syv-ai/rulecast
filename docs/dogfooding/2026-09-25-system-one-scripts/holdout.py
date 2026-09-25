"""The honest number: fit the threshold on half the data, score on the other half.

"best threshold -> accuracy" from the earlier runs is fitted on the test set itself, so it is an
optimistic bound, not a result. This does repeated random 50/50 splits instead.
"""
import json, pathlib, random, statistics

TMP = pathlib.Path(__file__).parent


def holdout(rows, trials=400, seed=3):
    rnd = random.Random(seed)
    accs = []
    for _ in range(trials):
        idx = list(range(len(rows)))
        rnd.shuffle(idx)
        half = len(idx) // 2
        fit = [rows[i] for i in idx[:half]]
        test = [rows[i] for i in idx[half:]]
        best_t, best_a = 0.5, -1.0
        for t in [i / 200 for i in range(1, 200)]:
            a = sum(1 for r in fit if (r["p"] >= t) == bool(r["label"])) / len(fit)
            if a > best_a:
                best_a, best_t = a, t
        accs.append(sum(1 for r in test if (r["p"] >= best_t) == bool(r["label"])) / len(test))
    accs.sort()
    return statistics.mean(accs), accs[int(len(accs) * 0.05)], accs[int(len(accs) * 0.95)]


for name in ("setA", "setB"):
    path = TMP / f"{name}-results.json"
    if not path.exists():
        continue
    print(f"\n=== {name} (threshold fitted on a held-out half, 400 random splits) ===")
    for entry in json.loads(path.read_text()):
        rows = entry["rows"]
        mean, lo, hi = holdout(rows)
        base = max(sum(r["label"] for r in rows), len(rows) - sum(r["label"] for r in rows)) / len(rows)
        print(f"  {entry['tag']:<26} held-out acc {mean:.3f}  [5-95%: {lo:.3f}-{hi:.3f}]   "
              f"baseline {base:.3f}")
