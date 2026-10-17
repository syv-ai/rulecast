<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Transaction Script

`transaction-script` · design patterns, design

Organise business logic as one procedure per request or use case, which reads its data, applies the rules and writes the result, top to bottom.

*Names:* Named in Fowler's PoEAA (2002) as the simplest of his three domain logic patterns (with Table Module and Domain Model). It is the shape most handler-plus-SQL code already has.

*Matters most for:* web-api, cli-devtool, data-pipeline, serverless

## But

Fowler's own point is that transaction scripts degrade as logic grows: duplication between scripts increases and rules that belong to one concept scatter, at which point a domain model is cheaper. The switch point is when the same invariants show up in several scripts. Until then, this is the right default, and it is not an anti-pattern.

## Quality axes

- **delivery** ⊕ (primary): One procedure per operation, read, check, write, with no object model or mapping layer to design first.
- **change_cost** +: While rules are short and independent, a newcomer can follow each operation in one read.

**Flips:** As rules grow and interact, the same checks are copied into many scripts that drift apart, turning change_cost "-" and making a domain model cheaper.

## Warranted when

- The rules per operation are short and don't interact much.
- The domain is CRUD or a generic subdomain (settings, audit logs, imports).
- The team wants code a newcomer can follow in one read.

## How it shows

- One function per operation (approve_expense, close_month) that queries, checks and updates in sequence.
- Data passed around as rows, dicts or plain records with no behaviour.
- Shared helper functions extracted once two scripts repeat a step.

## Overdone when

- Keeping it after the rules grow, so the same checks are copied into many scripts that drift apart.
- Scripts that call each other in long chains, recreating a domain model badly.

## Example

Before:

```
class ExpenseApproval:
    fn init(policy_engine, rule_registry, approval_chain_factory): ...
    fn approve(expense_id, approver):
        chain = self.approval_chain_factory.for_expense(expense_id)
        chain.handle(ApprovalRequest(expense_id, approver))
# three rules in total, spread over seven classes
```

After:

```
fn approve_expense(db, expense_id, approver):
    e = db.get_expense(expense_id)
    if e.status != "submitted": raise Invalid("not submitted")
    if e.amount > approver.limit: raise Forbidden("over approval limit")
    if e.submitter == approver.id: raise Forbidden("cannot approve own expense")
    db.update_expense(expense_id, status="approved", approved_by=approver.id)
```

For a few independent rules, one readable procedure per operation beats an object structure with nothing to coordinate.

## By language

**python:** The default shape in FastAPI and Flask apps: a route or crud function doing the whole operation over SQLAlchemy or Pydantic models.

**go:** Idiomatic Go services often look like this, with handlers or service methods over structs and database/sql or sqlc queries, and that is usually fine.

## Related

[Domain Model](domain-model.md) · [Service Layer](service-layer.md) · [Anemic Domain Model](anemic-domain-model.md) · [Table Data Gateway](table-data-gateway.md) · [Duplicate Code](duplicate-code.md) · [Shotgun Surgery](shotgun-surgery.md) · [KISS (Keep It Simple, Stupid)](kiss.md)

## Overlaps

Decide domain-model or transaction-script first: it is a choice per subdomain, not a ranking. Only then is anemic-domain-model a fault, when rich rules were wanted and ended up in services. data-class is the smell on one class, and is fine on boundary types.

## Sources

- [Martin Fowler, Patterns of Enterprise Application Architecture, Transaction Script (catalog summary)](https://martinfowler.com/eaaCatalog/transactionScript.html) (read)
- [Martin Fowler, PoEAA ch. 2, Organizing Domain Logic](https://martinfowler.com/books/eaa.html) (recalled)
