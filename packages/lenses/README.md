# Lens catalog (work in progress)

Not released and not yet read by rulecast. The developer is still reviewing it, and its format may change.

The design knowledge a coding agent brings to working out a project's conventions with the developer:

- `principles.yaml`, `practices.yaml`, `laws.yaml`, `patterns.yaml`, `antipatterns.yaml`, `smells.yaml`: named lenses, each with a counter-view, examples, per-language notes and sources. A file holds one kind:
  - a **principle** says what to aim for and leaves the how open (single responsibility, YAGNI, least privilege);
  - a **practice** names what to do in code, or a policy a project decides (parse, don't validate; a deprecation policy);
  - a **law** is an observation about what tends to happen, which you can't follow, only plan for (Hyrum's law, Conway's law);
  - a **pattern** is a named, reusable design (repository, bounded context); an **anti-pattern** a recurring bad one; a **smell** a sign in code that one may be present.
- `methodologies.yaml`: ways to frame a project's conventions.
- `starters.yaml`: per kind of project, the lenses to look at first and the probes for the interview (what to find in the repository first, and what to ask only if it can't tell).
- `thinking.yaml`: general stances for the interview. `grounds.yaml`: sources for laws that only ground probes.
- `overlaps.yaml`: overlapping lenses, and which to start from.
- `tell-rules/<lens-id>.yaml` and `tells-tested.yaml`: lens tells written as rulecast rules and measured on a 12-repository corpus (`docs/evidence/2026-10-13-tells-on-a-corpus.md`).
