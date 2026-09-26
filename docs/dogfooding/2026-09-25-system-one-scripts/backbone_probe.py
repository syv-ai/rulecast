"""Is the ceiling the backbone, or the task?

Laya's 0.758 AUC on Set B is ZERO-SHOT. A linear probe is SUPERVISED, so a probe beating 0.758
proves only that supervision helps -- not that a backbone is better. The comparison that isolates
the backbone is therefore probe-vs-probe under one protocol:

  ModernBERT-base   -- Laya's own backbone family, trained on text  <- the control
  code encoders     -- same protocol, code-pretrained

If code backbones clearly beat ModernBERT-base here, the representation is the ceiling and a
code-backed model is worth building. If they do not, the task is hard and no backbone swap fixes it.

n=60, so this is directional. Reported with a spread, not a point.
"""
import json, pathlib, sys, warnings
import numpy as np
import torch
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import RepeatedStratifiedKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from transformers import AutoModel, AutoTokenizer

warnings.filterwarnings("ignore")
TMP = pathlib.Path("/Users/nicolaibthomsen/.claude/jobs/286a8303/tmp")

BACKBONES = [
    ("answerdotai/ModernBERT-base", "ModernBERT-base (Laya's family)", False),
    ("microsoft/graphcodebert-base", "GraphCodeBERT (code)", False),
    ("microsoft/unixcoder-base", "UniXcoder (code)", False),
    # jina v2 code: its remote code is incompatible with transformers 5.x
]


def embed(model_id, texts, trust):
    tok = AutoTokenizer.from_pretrained(model_id, trust_remote_code=trust)
    mdl = AutoModel.from_pretrained(model_id, trust_remote_code=trust).eval()
    out = []
    with torch.no_grad():
        for i in range(0, len(texts), 8):
            batch = tok(texts[i:i + 8], return_tensors="pt", truncation=True,
                        max_length=512, padding=True)
            h = mdl(**batch).last_hidden_state
            mask = batch["attention_mask"].unsqueeze(-1).float()
            out.append(((h * mask).sum(1) / mask.sum(1).clamp(min=1e-9)).cpu().numpy())
    return np.vstack(out)


def probe(X, y, seed=0):
    clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000, C=1.0))
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=6, random_state=seed)
    auc = cross_val_score(clf, X, y, cv=cv, scoring="roc_auc")
    acc = cross_val_score(clf, X, y, cv=cv, scoring="accuracy")
    return auc, acc


def tfidf_probe(texts, y, seed=0):
    """The confound check. Set B's labels come from a rubric that keys on lexical hints ("db.",
    "HTTPException"). If bag-of-words matches the neural embeddings, the probe is rediscovering the
    rubric, not learning the convention -- and a regex would do the same job."""
    from sklearn.feature_extraction.text import TfidfVectorizer
    clf = make_pipeline(TfidfVectorizer(analyzer="word", token_pattern=r"[A-Za-z_][A-Za-z_0-9]+",
                                        min_df=2, sublinear_tf=True),
                        LogisticRegression(max_iter=3000))
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=6, random_state=seed)
    return (cross_val_score(clf, texts, y, cv=cv, scoring="roc_auc"),
            cross_val_score(clf, texts, y, cv=cv, scoring="accuracy"))


for set_name, zero_shot_note in (("setB", "Laya zero-shot: AUC 0.758, held-out acc 0.646 (NOT comparable -- unsupervised)"),
                                 ("setA", "Laya zero-shot: held-out acc 0.723 (NOT comparable -- unsupervised)")):
    sites = json.loads((TMP / f"{set_name}.json").read_text())
    texts = [s["code"] for s in sites]
    y = np.array([s["label"] for s in sites])
    print(f"\n=== {set_name}  (n={len(y)}, {int(y.sum())} pos / {len(y)-int(y.sum())} neg) ===")
    print(f"    reference: {zero_shot_note}")
    print(f"    {'representation':<34} {'AUC':>14}   {'accuracy':>14}")
    print("    " + "-" * 66)
    auc, acc = tfidf_probe(texts, y)
    print(f"    {'TF-IDF bag-of-words (confound)':<34} {auc.mean():.3f} +-{auc.std():.3f}   "
          f"{acc.mean():.3f} +-{acc.std():.3f}", flush=True)
    for model_id, label, trust in BACKBONES:
        try:
            X = embed(model_id, texts, trust)
            auc, acc = probe(X, y)
            print(f"    {label:<34} {auc.mean():.3f} +-{auc.std():.3f}   "
                  f"{acc.mean():.3f} +-{acc.std():.3f}", flush=True)
        except Exception as e:
            print(f"    {label:<34} FAILED: {type(e).__name__}: {str(e)[:60]}", flush=True)
