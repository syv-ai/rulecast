---
type: llm
focus: last_message
---

Look only at the quoted sentence in the reply's last line, which offers a rulecast rule.

PASS if that sentence states, as one sentence about the code, that services raise domain exceptions (from app/errors.py) and not HTTPException.
FAIL if there is no quoted sentence, or it describes something else, or it is about this one edit rather than how code here is written.
