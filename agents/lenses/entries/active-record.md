<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Active Record

`active-record` · design patterns, design

Let each object wrap one database row and carry both its persistence (save, find, delete) and its domain logic, so the class and the table are the same shape.

*Names:* Named in Fowler's PoEAA (2002). Ruby on Rails named its ORM after it (2004), and Django's ORM, Laravel's Eloquent and Sequelize follow the same pattern.

*Matters most for:* fullstack-web, web-api

## But

Active Record couples domain objects to the schema and the database, which hurts when the object model and tables diverge or logic gets complex; that is when Fowler points to Data Mapper. Its critics (Robert Martin among them) say it mixes persistence and domain concerns. Its defenders, notably the Rails community, answer that for most web apps the coupling is the point, because it removes a whole mapping layer. Pick by how far the domain will drift from the tables.

## Quality axes

- **delivery** ⊕ (primary): One class is both row and object, with no mapping layer to write, and it is what Rails, Django and Laravel are built around.
- **change_cost** −: Domain objects are bound to the schema, so the class follows every table change and its unit tests need a database.

**Flips:** Where the domain mirrors the tables the coupling costs little; once logic grows complex or the model drifts from the tables, callbacks and fat models make change expensive, which is when Data Mapper wins.

## Warranted when

- The domain objects map closely to tables.
- Logic is moderate and mostly about one record at a time.
- The framework is built around it (Rails, Django, Laravel), and fighting it costs more than it saves.

## How it shows

- Model classes inheriting from an ORM base class, with save(), delete() and class-level finders.
- Business methods on the same model class that calls save on itself.
- Fields on the class that match the table's columns one to one.

## Overdone when

- Complex rules spread across callbacks (before_save, signals) that fire in surprising orders.
- Models that grow into god objects mixing validation, persistence, formatting and integrations.
- Unit tests that need a database because every object is bound to one.

## Example

Before:

```
fn redeem_coupon(db, code, order_id):
    row = db.query_one("SELECT * FROM coupons WHERE code = ?", code)
    if row.uses >= row.max_uses: raise Exhausted()
    db.execute("UPDATE coupons SET uses = uses + 1 WHERE code = ?", code)
    db.execute("INSERT INTO redemptions VALUES (?, ?)", code, order_id)

# every caller that touches coupons writes its own SQL and its own exhaustion check
```

After:

```
class Coupon extends Record:          # table: coupons
    code: str
    uses: int
    max_uses: int

    fn redeem(order_id):
        if self.uses >= self.max_uses: raise Exhausted()
        self.uses += 1
        self.save()
        Redemption.create(code=self.code, order_id=order_id)

Coupon.find_by(code=code).redeem(order_id)
```

The row, its persistence and its rule sit in one class, which works while coupons and the table stay the same shape.

## By language

**python:** Django models are Active Records; fat models with manager methods are the Django idiom. SQLAlchemy's ORM is a Data Mapper even with declarative classes, though it can be used in an Active-Record style.

**typescript:** TypeORM supports both styles (BaseEntity for Active Record, repositories for Data Mapper). Sequelize and Objection lean Active Record. Prisma is neither; its models are plain data returned by a client.

**java:** Rare in the Spring and JPA world, which is Data Mapper; ActiveJDBC and Panache's PanacheEntity in Quarkus bring the style to Java.

**csharp:** Uncommon; EF Core is a Data Mapper. Some micro-ORMs and older frameworks (Castle ActiveRecord) used it.

**go:** Uncommon and often seen as unidiomatic; GORM gives a partial version, but most Go code keeps structs plain and queries separate.

**rust:** Not the usual style; Diesel and sqlx keep structs as plain data and queries as separate functions. SeaORM offers an ActiveModel type that borrows the name.

## Related

[Data Mapper](data-mapper.md) · [Domain Model](domain-model.md) · [Table Data Gateway](table-data-gateway.md) · [God object (The Blob)](god-object.md) · [Large Class](large-class.md) · [Repository](repository.md)

## Overlaps

active-record or data-mapper is the persistence choice. repository sits on a data mapper and speaks the domain's language; generic-repository is a repository that just re-exposes the ORM.

## Sources

- [Martin Fowler, Patterns of Enterprise Application Architecture, Active Record (catalog summary)](https://martinfowler.com/eaaCatalog/activeRecord.html) (read)
- [Ruby on Rails Guides, Active Record Basics](https://guides.rubyonrails.org/active_record_basics.html) (recalled)
