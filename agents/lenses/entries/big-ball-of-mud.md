<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Big Ball of Mud

`big-ball-of-mud` · anti-patterns, architecture · **contested**

A system with no recognisable structure, shaped by expedient fixes, where data and logic are shared freely and every part can reach every other. Malignant Growth is the process that usually produces it; this is the canonical name for the result.

*Names:* INNOQ calls the process that produces it Malignant Growth. Named by Foote and Yoder (1997).

*Matters most for:* fullstack-web, web-api, platforms

## But

Foote and Yoder, who named it, present it as a pattern rather than a pure anti-pattern: mud persists because it delivers, early on nobody understands the domain well enough to draw good boundaries, and markets reward shipping over structure. A messy first version of a poorly understood problem can be the best anyone could do at the time. A throwaway prototype, a spike or a short-lived script can be mud with no harm done. The trouble starts when the mess gets so opaque it can no longer adapt. Rewriting from scratch carries the second-system risk.

## Quality axes

- **delivery** +: Expedient fixes ship fastest, which is why mud persists.
- **change_cost** −: Anything reaches anything, so no change has a predictable scope and nobody can say where code belongs.
- **reliability** −: The same rule implemented slightly differently in several places, plus shared mutable data written from everywhere, gives inconsistent behaviour.

**Flips:** A spike, throwaway prototype or short-lived script can be mud with no harm, and an early version of a poorly understood problem may be the best possible.

## Why people fall into it

- deadlines push structure aside, and architecture's costs arrive before its benefits
- the right boundaries only become clear after the domain is understood, which is late
- turnover erodes the memory of why things are where they are
- architecture is invisible to users and managers, so nobody outside the team rewards it
- unexpected requirements force expedient changes the original design never anticipated
- a prototype that works gets shipped and grown instead of thrown away
- maintenance is handed to a separate or junior team without design authority

## How it shows

- no module boundaries that the import graph respects; anything imports anything
- global state and shared mutable data read and written from everywhere
- the same rule implemented in several places, slightly differently
- throwaway prototype code still in production years later
- nobody can draw the architecture, and the diagrams that exist are aspirational
- temporary workarounds and feature toggles that are years old and partly undocumented
- integrations added point to point as each new need came up

## Overcorrecting looks like

- imposing a rigid layered architecture on a young product before the domain is understood, which becomes a straitjacket
- declaring the system beyond repair and starting a rewrite when containment and refactoring would do

## What to do

Contain the worst parts behind a Facade (Sweeping It Under the Rug), alternate expansion with consolidation, refactor continuously under tests, separate what changes at different rates (Shearing Layers), and treat Reconstruction as a last resort.

## Example

None: It is a property of a whole codebase's structure; a snippet of mud just looks like a messy function.

## Related

[Under-Modularization](under-modularization.md) · [Technical Debt](technical-debt.md) · [Gall's Law](galls-law.md) · [Second-System Effect](second-system-effect.md) · [Lehman's Laws of Software Evolution](lehmans-laws.md) · [Broken Windows Theory](broken-windows-theory.md)

## Overlaps

big-ball-of-mud is the whole system; spaghetti-code is tangled control flow inside a module. A codebase can have either without the other.

## Sources

- [Foote and Yoder, Big Ball of Mud (1997)](http://www.laputan.org/mud/) (read)
- [INNOQ, Architecture Antipatterns, Malignant Growth](https://architecture-antipatterns.tech/patterns/malignant_growth.html) (read)
- [INNOQ, Architecture Antipatterns, Malignant Growth](https://architecture-antipatterns.tech/patterns/malignant_growth.html) (read)
- [INNOQ, Architecture Antipatterns, case study: Over-Configurability in a (huuuuge) eCommerce System](https://architecture-antipatterns.tech/case_studies/overconfigurability_in_a_huge_ecommerce_system.html) (read)
