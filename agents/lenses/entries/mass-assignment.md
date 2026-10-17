<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Mass assignment

`mass-assignment` · anti-patterns, security · **agents do this**

The request body is bound straight onto a domain or database model, so a client can set fields it was never meant to touch (role, owner, price, balance) just by adding them to the request.

*Names:* The Ruby on Rails name, made famous when Egor Homakov used it on GitHub in 2012. Called autobinding in Spring MVC and ASP.NET MVC, over-posting in Microsoft's docs, and object injection in PHP. MITRE's CWE-915. OWASP's API Security Top 10 2023 merges it with excessive data exposure as API3:2023 Broken Object Property Level Authorization.

*Matters most for:* web-api, fullstack-web, mobile

## But

For internal admin tools where every field is editable by the only role that can reach the endpoint, binding the model is fine and simpler. Pydantic or zod request schemas that already list only editable fields are the DTO, so spreading them into the model is safe; the flaw is binding to the type that also holds server-owned fields. Allow-lists still need maintaining; OWASP and CWE-915 both prefer them, but a stale allow-list fails the other way, silently dropping a new field.

## Quality axes

- **delivery** +: One class for request, row and response is less code, and the framework binds it for free.
- **security** −: A client sets server-owned fields such as role, owner or price by adding them to the request.

**Flips:** In an internal admin tool where the only role that reaches the endpoint may edit every field, binding the model is fine and simpler.

## Why people fall into it

- One class for request, row and response is less code, and frameworks bind to anything with matching field names.
- Generators and tutorials bind entities directly, because a demo has nothing to protect.
- Writing a DTO per endpoint feels like duplication (and DRY gets misread as "never repeat a field list").
- Sensitive fields are added to the model later, after the endpoint was written, and bind silently.

## How it shows

- An ORM entity used as the request type of a create or update endpoint.
- The whole body spread into a model constructor or an update call (Model(**body), new User(req.body), data req.body, Object.assign(entity, body)).
- A loop that copies every key of the body onto the record with setattr or by index.
- Serializers or forms that declare all fields (fields = "__all__") with no read-only list.
- A block-list of protected fields (setDisallowedFields, $guarded, json ignore on one field) instead of a list of allowed ones.
- The same model class used for the request, the database row and the response.

## Overcorrecting looks like

- A separate DTO and mapper per endpoint even where the input is genuinely all user-editable, which adds boilerplate without protecting anything.
- Mapping libraries configured to copy everything from the DTO to the entity, which reintroduces the problem one step later.
- Treating an allow-list as an authorization check; it limits which fields can be written, not who may write this record.

## What to do

Bind input to a request type that holds only the fields this caller may set, then copy them onto the entity explicitly. Where a separate type is too heavy, use the framework's allow-list (strong parameters, Bind with an include list, setAllowedFields, $fillable) rather than a block-list. Reject or ignore unknown fields on purpose, and set server-owned fields (owner, role, price) in code.

## Example

Before:

```
class Account:            # also the database row
    id: str
    display_name: str
    plan: str             # "free" | "pro"
    credit_balance: int

route PATCH "/account"
fn update_account(body: Account, user: User):
    account = accounts.get(user.account_id)
    copy_all_fields(from=body, to=account)
    accounts.save(account)
```

After:

```
class AccountUpdate:      # only what a customer may change
    display_name: str

route PATCH "/account"
fn update_account(body: AccountUpdate, user: User):
    account = accounts.get(user.account_id)
    account.display_name = body.display_name
    accounts.save(account)
```

The request type holds only the editable field, so sending plan or credit_balance has no effect.

## One-file tell

Python and TypeScript only. A model constructor, create or update call given the raw request body itself: Model(**request.json()), Model(**await request.json()), Model(**request.data / request.form / request.POST), setattr in a loop over request.<attr>.items(), new Model(req.body), Object.assign(x, req.body), data: req.body, ...req.body, data: await request.json(), and fields = "__all__" in a Django form or DRF serializer. Spreading a variable named data, payload or body doesn't count on the name alone.

## By language

**python:** FastAPI with separate Pydantic models for create, update and read (and model_config extra="forbid") avoids it; Model(**payload) where payload is a dict from request.json() does not. Django ModelForm and DRF ModelSerializer with fields = "__all__" bind everything; list fields and set read_only_fields.

**typescript:** Prisma create or update with data: req.body, Mongoose new Model(req.body), TypeORM merge or save with the body spread in, and Object.assign(entity, body) are the forms. Parse the body at the boundary with a runtime schema that lists only editable fields (a zod object strips unknown keys by default; .strict() rejects them), or copy named fields into data. A TypeScript type annotation on req.body checks nothing at runtime.

**java:** Spring MVC binds @ModelAttribute and @RequestBody onto JPA @Entity classes readily. @InitBinder with setDisallowedFields is a block-list, which Spring itself calls fragile, and it doesn't cover nested paths; setAllowedFields or a record DTO is the allow-list form.

**csharp:** ASP.NET Core model binding onto an EF Core entity is over-posting. Use input models or records, or in MVC [Bind("Name,Email")] and TryUpdateModelAsync with an include list. AutoMapper profiles that map every member back onto the entity reintroduce it.

**go:** json.Unmarshal into the stored struct sets any exported field present in the body; decode into a separate input struct, or tag server-owned fields json:"-", and consider Decoder.DisallowUnknownFields.

**rust:** serde Deserialize on the stored struct binds every field; use a separate input struct, with #[serde(deny_unknown_fields)] if unknown keys should be an error.

## Related

[Broken Object Level Authorization (IDOR)](broken-object-level-authorization.md) · [Trusting client input](trusting-client-input.md) · [Validate at the boundary](validate-at-the-boundary.md) · [Data Class](data-class.md)

## Sources

- [OWASP Cheat Sheet Series, Mass Assignment (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html) (read)
- [OWASP API Security Top 10 2023, API3:2023 Broken Object Property Level Authorization (CC BY-SA 4.0)](https://api-security.owasp.org/editions/2023/en/0xa3-broken-object-property-level-authorization/) (read)
- [MITRE CWE-915, Improperly Controlled Modification of Dynamically-Determined Object Attributes](https://cwe.mitre.org/data/definitions/915.html) (recalled)
- GitHub's 2012 public-key mass assignment incident (Egor Homakov) (recalled)
