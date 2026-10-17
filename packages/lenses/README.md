# Lens catalog (work in progress)

Not released and not yet read by rulecast. The developer is still reviewing it, and its format may change.

The design knowledge a coding agent brings to working out a project's conventions with the developer:

- `principles.yaml`, `practices.yaml`, `laws.yaml`, `patterns.yaml`, `antipatterns.yaml`, `smells.yaml`: named lenses, each with a counter-view, examples, per-language notes and sources. A file holds one kind:
  - a **principle** says what to aim for and leaves the how open (single responsibility, YAGNI, least privilege);
  - a **practice** names what to do in code, or a policy a project decides (parse, don't validate; a deprecation policy);
  - a **law** is an observation about what tends to happen, which you can't follow, only plan for (Hyrum's law, Conway's law);
  - a **pattern** is a named, reusable design (repository, bounded context); an **anti-pattern** a recurring bad one; a **smell** a sign in code that one may be present.
- Every lens has an `axes:` field: its effect on six quality axes (`security`, `reliability`, `change_cost`, which includes testability, `delivery`, which is speed now, `runtime` and `operability`). Signs are `+` or `-`, each with a reason. `"++"` marks a lens's primary effect, the reason to reach for it: one or two on each principle, practice and pattern, none on anti-patterns and smells. `flips` says when a sign turns. Laws can't be followed, so they name the axes they bear on (`bears_on`) instead of signing them. The labels are under review with the rest of the catalog.
- `methodologies.yaml`: ways to frame a project's conventions.
- `starters.yaml`: per kind of project, the lenses to look at first and the probes for the interview (what to find in the repository first, and what to ask only if it can't tell).
- `thinking.yaml`: general stances for the interview. `grounds.yaml`: sources for laws that only ground probes.
- `overlaps.yaml`: overlapping lenses, and which to start from.
- `tell-rules/<lens-id>.yaml` and `tells-tested.yaml`: lens tells written as rulecast rules and measured on a 12-repository corpus (`docs/evidence/2026-10-13-tells-on-a-corpus.md`).
