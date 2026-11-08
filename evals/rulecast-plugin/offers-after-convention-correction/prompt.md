---
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill]
runs: 5
---
No, services here never raise HTTPException, they raise domain exceptions from app/errors.py. Fix users.py.
