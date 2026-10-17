<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Injection (SQL, command, template)

`injection` · anti-patterns, security · **agents do this**

A query, shell command or template is built by pasting input into a string, so the interpreter can read part of the input as code instead of data.

*Names:* SQL injection was first described publicly by Jeff Forristal (as rain.forest.puppy) in Phrack issue 54, 1998. OWASP has ranked Injection in every Top 10 since 2003; it is A05:2025, which also covers OS command, NoSQL, ORM, LDAP and expression-language injection. MITRE's CWE-89 (SQL), CWE-78 (OS command) and CWE-1336 (server-side template injection). Cross-site scripting is the same flaw in an HTML context, and prompt injection is a cousin with no reliable fix of this kind.

*Matters most for:* web-api, fullstack-web, data-pipeline, cli-devtool, databases-storage

## But

Interpolating constants or values the code itself chose (a column picked from a fixed map, a table name from configuration) is safe, and many fine dynamic query builders do exactly that. Admin-only scripts and migrations that never see outside input can format SQL freely, though habits travel. Query builders and ORMs are not a guarantee either: OWASP notes ORM search parameters and parameterized stored procedures that build dynamic SQL inside are both injectable.

## Quality axes

- **delivery** +: Pasting values into a string is the most direct way to write a dynamic query, and it works on every test input.
- **security** −: Crafted input runs as SQL, shell or template code with the program's privileges.
- **reliability** −: Honest input with quotes or special characters, like the name O'Brien, breaks the query or command.

**Flips:** Admin-only scripts and migrations that never see outside input can format SQL safely, though the habit travels.

## Why people fall into it

- String building is the most direct way to write a dynamic query, and it works on every test input.
- Parts of a query can't be bound as parameters (identifiers, ORDER BY, IN lists of variable length), so people reach for formatting and then keep doing it for values too.
- A shell one-liner is shorter than finding the library call or splitting arguments.
- The input "comes from our own frontend", so it feels trusted.
- Logging or debugging code wants the final SQL as one string.

## How it shows

- SQL built with string concatenation, interpolation or format calls that include a variable, passed to execute, query or a raw-SQL method.
- An ORM's raw escape hatch fed an interpolated string (Django raw or extra, SQLAlchemy text, EF Core FromSqlRaw, Prisma $queryRawUnsafe, gorm Raw or Where with Sprintf).
- Sort columns, table names or filter operators taken from the request and put into SQL unchecked.
- Shell commands built as one string and run through a shell (shell=True, exec, system, sh -c).
- A template engine given a template string that contains user input, rather than the input as data.
- A hand-written escape function for quotes.

## Overcorrecting looks like

- Banning all raw SQL and forcing complex reports through an ORM that produces worse queries; raw SQL with bound parameters is safe.
- Blocking quote characters or keywords in input, which breaks names like O'Brien and doesn't make the query safe.
- Escaping values by hand on top of parameterized queries.

## What to do

Keep code and data apart. Use bound parameters for every value (placeholders, the ORM's query builder, a tagged template that parameterizes). For identifiers and sort orders, map the input onto a fixed allow-list in code. Call programs with an argument list and no shell, or use a library function instead of the program. Pass user content to templates as variables, never as the template. Run the database account with least privilege so a miss does less harm.

## Example

Before:

```
fn stock_report(warehouse: str, sort: str) -> list[Row]:
    sql = "SELECT sku, qty FROM stock WHERE warehouse = '" + warehouse + "'"
    sql = sql + " ORDER BY " + sort
    return db.query(sql)

fn archive_report(name: str):
    shell("tar czf /archive/" + name + ".tgz /reports/" + name)
```

After:

```
SORTABLE = {"sku": "sku", "quantity": "qty"}

fn stock_report(warehouse: str, sort: str) -> list[Row]:
    column = SORTABLE.get(sort) or raise BadRequest("unknown sort")
    sql = "SELECT sku, qty FROM stock WHERE warehouse = ? ORDER BY " + column
    return db.query(sql, [warehouse])

fn archive_report(name: str):
    run(["tar", "czf", "/archive/" + name + ".tgz", "/reports/" + name])
```

The value travels as a bound parameter, the column comes from a fixed map, and the command is an argument list with no shell, so no input can change what runs.

## By language

**python:** DB-API placeholders (%s or ? depending on driver) passed as the second argument to execute; an f-string or % formatting inside execute is the flaw. SQLAlchemy text() needs bindparams; Django's ORM filters are safe but raw(), extra() and RawSQL with formatting are not. subprocess with a list and no shell=True is safe. Jinja2's Template(user_string) or Flask's render_template_string with user content is template injection.

**typescript:** node-postgres and mysql2 take a values array; a template literal into query() is the flaw. Prisma's $queryRaw tagged template parameterizes, $queryRawUnsafe does not. Knex raw takes bindings. Use child_process.execFile or spawn with an argument array rather than exec with a built string.

**java:** PreparedStatement and JdbcTemplate with ? placeholders, JPA named parameters, and Spring Data derived queries are safe; Statement.execute or createQuery with + concatenation is JPQL or SQL injection. Use ProcessBuilder with separate arguments. Thymeleaf expression preprocessing (__${...}__) on user input is template injection.

**csharp:** SqlCommand with Parameters.Add, Dapper's anonymous parameter object, and EF Core's FromSql or FromSqlInterpolated (which turn an interpolated string into parameters) are safe. FromSqlRaw or ExecuteSqlRaw with an interpolated or concatenated string is the flaw. Use ProcessStartInfo.ArgumentList rather than one Arguments string.

**go:** database/sql placeholders (? or $1) with args to Query or Exec; fmt.Sprintf into the SQL is the flaw, and gorm's Where, Order and Raw are only safe with placeholders. exec.Command with separate args doesn't use a shell; exec.Command("sh", "-c", built) does. html/template escapes by context, text/template does not.

**rust:** sqlx's query with .bind() and its compile-checked query! macros, and diesel's query builder, are safe; sql_query or query with format! is the flaw. std::process::Command takes arguments separately and runs no shell unless you call one.

## Related

[Validate at the boundary](validate-at-the-boundary.md) · [Trusting client input](trusting-client-input.md) · [Least privilege](least-privilege.md) · [Defense in depth](defense-in-depth.md)

## Sources

- [OWASP Top 10 2025, A05:2025 Injection (CC BY 3.0)](https://top10.owasp.org/2025/A05_2025-Injection/) (read)
- [OWASP Cheat Sheet Series, SQL Injection Prevention (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html) (read)
- [OWASP Cheat Sheet Series, OS Command Injection Defense (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html) (read)
- [Jeff Forristal (rain.forest.puppy), NT Web Technology Vulnerabilities, Phrack 54 (1998)](http://phrack.org/issues/54/8.html) (recalled)
- [MITRE CWE-89, CWE-78 and CWE-1336](https://cwe.mitre.org/data/definitions/89.html) (recalled)
