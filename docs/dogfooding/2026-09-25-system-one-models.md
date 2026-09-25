# Would a "System One" model (Jev, Laya) earn a place in rulecast?

**Date:** 2026-09-25 · **Verdict: no, on measurement** (revised same day: see "A follow-up that failed") · **Hardware:** Apple M3 Pro, 36 GB ·
**Versions:** `laya` 0.3.20, `torch` 2.14.0 (CPU), `transformers` 5.17.0, checkpoints
`convaiinnovations/laya` (421M English) and its `typed-decisions` fine-tune

The question was whether this model class changes **where a semantic rule can run** — specifically
whether it puts convention-compliance judgement on the `edit` path, which §6 reserves for
mechanical detectors because an `llm` call is seconds-slow.

It does not. Two independent measured reasons, below. The design idea is sound and the plumbing
works; the model is not good enough at the questions that would justify it, and the batching the
latency case depended on does not exist on CPU.

## What these models are

Non-autoregressive typed-decision models. A request is a block of state plus pre-declared typed
questions (`choice`, `score`, `noul`); every question is answered in one parallel forward pass as a
probability. **They emit no text** — so no line number and no `reason`.

| | Jev | Laya |
|---|---|---|
| Publisher | TypeSafe AI | Convai Innovations |
| Availability | hosted only | Apache 2.0, open weights |
| API | `POST /v1/systemone` | same, via `pip install laya[serve]` |

**Not reachable through Ollama, and not a packaging gap.** The registry has no `laya`, `jev` or
`modernbert`, and Ollama exposes `generate`/`chat`/`embed` over llama.cpp — there is no endpoint
shape for a typed question, and no text for a decoder to produce. The BYOM path is the model's own
`laya-serve`, which is Jev-compatible and therefore *not* OpenAI-compatible, so `openai-compatible`
+ `llm.base_url` does not reach it either.

## The design that would have worked

Worth recording, because it is not the obvious one and it survives every *architectural* objection.

A System One model cannot be a fifth `LlmProvider`: `ask()` returns `{rule, line, text?, reason}`
and the model can produce none of those. But it does not have to, if the jobs are split the way
`vulture` splits them — enumerate statically, then classify:

| Job | Who |
|---|---|
| Locate candidate sites | `ast-grep`, which already returns `Match { line, endLine, column, text, captures }` |
| Decide compliance | one `noul` per site → calibrated P(true) |
| Say why | the rule's own `message` template |

The model never localizes and never explains. `confidence` becomes a capture; a `min_confidence`
knob is `vulture --min-confidence`. **This part is fine.** What follows is why it still fails.

## Setup cost (BYOM, so the user pays it once, not rulecast)

| | |
|---|---|
| Checkpoints on disk | **1.6 GB** for both (English + `typed-decisions`) |
| First load | **110 s** (download + init) |
| Warm load from cache | **3.0–3.9 s** |

`laya.load()` prints a warning worth quoting, because it predicts the main result: *"this checkpoint
ships invalid temperatures or values outside [0.5, 5] … Treat confidence from the affected entries
as uncalibrated."*

## Reason 1: batching does not amortize on CPU

One file's sites, batched into a single call, English 421M, warm, median of 5:

| questions | total | per question |
|---|---|---|
| 1 | 75.9 ms | 75.9 ms |
| 3 | 194.9 ms | 65.0 ms |
| 5 | **322.0 ms** | 64.4 ms |
| 10 | 619.4 ms | 61.9 ms |
| 20 | 1282.5 ms | 64.1 ms |

Flat at ~62–76 ms per question — **linear, not amortized.** The published 7.2 ms/question is a
Tesla T4 result and does not transfer to CPU.

So five enumerated sites in one file cost 322 ms, against `edit_deadline_ms` of 350 ms and a whole
edit hook whose p95 is 220 ms (§13). The edit-path case rested entirely on batch amortization, and
it is not there. Single-question latency was fine (p50 43–70 ms, p95 81–111 ms) — it is the
per-file total that fails.

One genuine plus: the model is **deterministic**. Repeated calls returned byte-identical
probabilities. For a linter that is worth something.

## Reason 2: not accurate enough on the questions that would justify it

Two balanced sets from a real FastAPI + React codebase (781 `.py` files). Accuracy is against a
threshold **fitted on a held-out half** (400 random 50/50 splits) — the "best threshold" figures a
single pass reports are fitted on the test set and are not results.

| set | rule | labels | baseline | English 421M | `typed-decisions` |
|---|---|---|---|---|---|
| **A** | `python/no-silent-except` | machine (`ast`: is the handler body exactly `pass`) — 25/25 | 0.500 | **0.723** | 0.749 |
| **B** | `python/thin-routes` | rubric (inline DB / ≥2 `HTTPException` / >12 stmts) — 30/30 | 0.500 | **0.646** | 0.709 |

Set B is the one that matters: it is the shipped `llm` rule, the case `regex` and `ast-grep` cannot
decide. **0.646–0.709 held out is roughly one finding in three wrong**, and that is *after*
labelling project data to place the threshold. Set A is better — but `ast-grep` already decides Set
A exactly, for free, in-process.

**The model is better at the question rulecast already answers perfectly, and weakest at the one
only a model can answer.** That is backwards from what would make it worth building.

### The diagnosis: it ranks well, but its probabilities are not thresholds

A control question with a mechanically checkable answer, same 60 sites:

| question | AUC | accuracy at p≥0.5 |
|---|---|---|
| "Does this code contain the word 'async'?" | **0.978** | **0.550** |

Near-perfect *ranking*, coin-flip *decisions*. The probabilities carry the signal but are not
calibrated to any decision boundary — exactly what the load-time temperature warning said, and
consistent with ECE 0.139–0.393 across runs.

Wording moves the threshold a long way without fixing it (English 421M, Set B):

| wording | acc @0.5 | AUC | p-range |
|---|---|---|---|
| the rule's own words, verbatim | 0.500 | **0.758** | 0.646 … 0.966 |
| "database access or business logic inline?" | 0.633 | 0.728 | 0.093 … 1.000 |
| "execute a database query directly?" | 0.617 | 0.692 | 0.071 … 1.000 |
| "only validate input and delegate?" | 0.483 | 0.517 | 0.295 … 1.000 |
| "fat rather than thin?" | 0.483 | 0.524 | 0.369 … 0.963 |

The rule's own wording has the **best** ranking and the **worst** threshold placement — it never
returns below 0.646, so at 0.5 everything is a finding. A `choice` head on the same task scored
0.550.

So `min_confidence` would need per-rule, per-project temperature calibration against labelled
examples. That is the fine-tuning tax in miniature, and asking it of a lint rule is a worse deal
than deleting the rule.

## A follow-up that failed, and what it cost the argument

The obvious next question was whether the ceiling is the **backbone**: Laya's is ModernBERT-large,
pretrained on text, not code. If the model simply cannot represent code structure, the answer would
be to put a typed-decision head on a code-pretrained encoder rather than to fine-tune Laya.

So: mean-pooled embeddings from four encoders → logistic regression → repeated stratified 5-fold CV,
identical protocol on both sets. A probe is **supervised** and Laya's figures above are
**zero-shot**, so the only fair reading is probe against probe — the text backbone against the code
ones. A TF-IDF bag-of-words was added as a confound check, and it is the reason this section exists.

| representation | Set B AUC | Set B acc | Set A AUC | Set A acc |
|---|---|---|---|---|
| **TF-IDF bag-of-words** | **0.969** | **0.925** | **0.995** | **0.947** |
| ModernBERT-base (Laya's family, text) | 0.948 | 0.925 | 0.945 | 0.843 |
| GraphCodeBERT (code) | 0.960 | 0.908 | 0.961 | 0.850 |
| UniXcoder (code) | 0.924 | 0.869 | 0.963 | 0.857 |

**Bag-of-words wins or ties everywhere, so both label sets are lexically recoverable and neither is
a valid test of code understanding.** The backbone comparison measures nothing: code encoders,
a text encoder and a word-count model all land within noise of each other, which is what happens
when the task does not require the thing being compared. The hypothesis is **untested, not
disproved.** The weak link named at the bottom of this document turned out to be fatal for this
particular question.

Two things do survive it.

**A word-count model beats the 421M model by ~0.25, on identical labels.** TF-IDF plus logistic
regression: 0.925 (Set B) and 0.947 (Set A). Laya zero-shot: 0.646 and 0.723. That comparison *is*
fair — same sites, same labels — and it is a harder verdict on the zero-shot use than anything above.

**The space for a small supervised model is squeezed from both sides.** A convention that
bag-of-words can decide is a convention `regex` or `ast-grep` already decides — exactly, in process,
for free. So the only conventions worth a model are the ones whose labels a bag-of-words *cannot*
recover, and this exercise produced none of those.

**Consequence for the fine-tune question: it cannot be answered without a better benchmark, and
building one is the prerequisite, not the fine-tune.** The gate is cheap and mechanical — label a
set, then try to recover the labels with TF-IDF. If a word-count model gets them, the set is
measuring the wrong thing and `ast-grep` would have been the answer anyway. Only a set that defeats
that check can say whether this model class is worth training.

## What would change the answer

- **A GPU or MLX backend** fixes Reason 1 and does nothing for Reason 2, which is the blocker.
- **A code-domain fine-tune** is what Reason 2 needs. Convai's own `typed-decisions` fine-tune only
  moved Set B from 0.646 to 0.709.
- **A model that returns a span** would remove the need for `ast-grep` to enumerate — a smaller
  prize than it sounds, since enumeration was never the hard part.

## The one thing worth keeping

Set A ran at **recall 1.000 with precision 0.641** at the default threshold: it missed nothing and
over-flagged by about a third. That is not a detector, it is a **router** — "is this file worth a
`haiku` call?" — which is the use TypeSafe and LangChain both recommend. It would cut `llm` verify
cost and latency on a large verify without dropping a finding the `llm` would have made, *if* recall
holds on rules that matter.

That is a note against §6, not a sub-project, and it is untested: Set A recall is one rule on one
codebase.

## Reproducing

In `2026-09-25-system-one-scripts/`. Both extractors print their label counts and write the sampled
sets, so the labels can be audited independently of the model. The extractors take the target repo
from `TARGET_REPO` or `argv[1]`; the target here was a private codebase and is not named, as in the
2026-09-22 exercise.

```bash
uv venv laya-env --python 3.12
uv pip install --python ./laya-env/bin/python 'laya[serve]'
TARGET_REPO=/path/to/a/fastapi/project ./laya-env/bin/python extract_setA.py
./laya-env/bin/python run_setA.py          # downloads ~1.6 GB of checkpoints on first run
./laya-env/bin/python holdout.py           # re-derives the held-out numbers from the saved runs
```

`setA-results.json` and `setB-results.json` are the runs behind the tables, with per-site file paths
and symbol names stripped — `label` and `p` are all `holdout.py` reads.

## Limitations, and the one that matters

Set B's labels come from a rubric, not human review, and Set A's come from `ast`. Both are therefore
**lexically recoverable**, which the TF-IDF check above demonstrates rather than speculates: a
word-count model gets 0.925 and 0.947 on them.

That is fine for the verdict — a model that cannot beat `ast-grep` at an `ast-grep`-decidable
question, and cannot beat bag-of-words either, has not earned a detector — and it is **not fine for
any question about semantic capability.** These sets cannot distinguish a model that understands code
from one that counts tokens, so nothing here should be read as measuring the former.

What a set would need, to answer the question this one could not:

1. Labels from human review, or distilled from a frontier model whose judgement is the thing being
   replicated — not from a rubric, because a rubric is a regex and a regex is already a detector.
2. **The TF-IDF gate**: if a bag-of-words recovers the labels, the set is measuring the wrong thing
   and `regex` or `ast-grep` was the right answer all along. Only a set that defeats that check can
   say anything about semantic capability.
3. Sites from several codebases, not one, and held-out **rules** rather than held-out examples —
   per-rule accuracy is worthless for a lint tool, since every new rule is an unseen convention.

Also unmeasured: `laya-serve` over HTTP (the BYOM shape) — in-process numbers are its optimistic
bound, since HTTP only adds; the MLX and CoreML builds, which would change latency and not accuracy;
and anything at n larger than 60, where the ±0.07–0.12 fold spreads above would tighten.
