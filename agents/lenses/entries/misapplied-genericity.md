<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Misapplied Genericity

`misapplied-genericity` · anti-patterns, architecture · **agents do this**

Building a solution for a whole class of problems instead of the one in front of you, so it serves the current case badly and future ones no better. Speculative Generality is the code-scale smell; this is the system-scale version.

*Matters most for:* library-sdk, platforms, plugins-extensions

## But

Some domains really are generic: a rules engine for an insurer with hundreds of tariff versions, a CMS, a spreadsheet. There the configurability is the product. The test is whether the variation is real and already observed, and whether configuring a new case is genuinely cheaper than coding it. Generic designs often don't remove change but move it across boundaries, which can multiply the work.

## Quality axes

- **change_cost** −: Each new case still needs changes in every layer plus metadata, so change is moved across boundaries and multiplied instead of removed.
- **runtime** −: Behaviour interpreted from rule tables and configuration at runtime is slower than direct code.
- **operability** −: Hundreds of mostly undocumented options and toggles make it hard to know how a running system is configured or why it behaves as it does.
- **delivery** −: Building for a whole class of problems takes longer and serves the case in front of you badly.

**Flips:** Where the domain really is generic (a CMS, a tariff rules engine) and the variation is already observed, the configurability is the product.

## Why people fall into it

- stakeholders want to "solve it once and reuse it everywhere"
- project managers see future savings on paper
- developers enjoy the harder, more abstract problem
- one influential person asking for the generic version is enough to start it
- benefits of reuse are easy to overstate and the costs (testing, performance, onboarding) easy to understate

## How it shows

- one generic entity or request type (everything is an Order, a Thing, a Request) configured per use case by metadata or flags
- behaviour driven by rule tables, bit masks or configuration interpreted at runtime instead of by code
- a generic product or rules model that still needs code and schema changes in every layer for each new case
- hundreds of configuration options or toggles, many undocumented
- an in-house framework with one real consumer

## Overcorrecting looks like

- refusing to extract the shared part even after three near-identical concrete implementations exist
- copy-pasting whole subsystems per customer because "generic is bad"

## What to do

Solve the specific problem first and generalise only after several concrete cases show what actually varies ("use before reuse"); to recover, make the solution more specific step by step, biggest pain first, rather than through a big rewrite.

## Example

Before:

```
class Request:
    kind: string
    payload: map
    flags: int

fn handle(req: Request):
    rules = rule_table.load(req.kind)
    for step in rules.steps:
        if step.mask & req.flags:
            run_step(step.name, req.payload)

handle(Request("freeze_membership", {"member": 41, "weeks": 3}, 6))
```

After:

```
fn freeze_membership(member: Member, weeks: int):
    if weeks > MAX_FREEZE_WEEKS:
        raise FreezeTooLong(weeks)
    member.frozen_until = today() + weeks
    billing.pause(member, weeks)

freeze_membership(member, 3)
```

Each operation the gym actually needs is a plain function; a shared mechanism waits until several of them show the same shape.

## Related

[Over-Engineering](over-engineering.md) · [Speculative Generality](speculative-generality.md) · [YAGNI](yagni.md) · [Domain Allergy](domain-allergy.md) · [Gall's Law](galls-law.md)

## Sources

- [INNOQ, Architecture Antipatterns, Misapplied Genericity](https://architecture-antipatterns.tech/patterns/misapplied_genericity.html) (read)
- [INNOQ, Architecture Antipatterns, case study: Super-generic framework in logistics](https://architecture-antipatterns.tech/case_studies/super_generic_framework_in_logistics.html) (read)
- [INNOQ, Architecture Antipatterns, case study: Generic Product model for 12 insurance products](https://architecture-antipatterns.tech/case_studies/generic_product_model_for_12_insurance_products.html) (read)
- [INNOQ, Architecture Antipatterns, case study: The Financial Corp. App Productline for 100+ Countries](https://architecture-antipatterns.tech/case_studies/the_financial_company_app_productline_for_100+_countries.html) (read)
