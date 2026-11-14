---
"@syv-ai/rulecast": patch
---

A ruff linter rule's `rules` now take ruff selectors, as ruff's `select` does. `rules: [B]` takes every flake8-bugbear finding (B006, but not BLE001), `E5` takes E501, `PL` takes pylint's PLC, PLE, PLR and PLW codes, and `ALL` takes everything. A selector ruff has renamed (from ruff's own redirect table) takes what its new name does: `TCH` and `TCH001` take TC001, `U` takes UP006, `TRY200` takes B904. Before, rulecast turned the selector on but then kept only findings whose code was exactly `B`, so such a rule never fired.
