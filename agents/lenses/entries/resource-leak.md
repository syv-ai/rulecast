<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Resource Leak

`resource-leak` · anti-patterns, code

Something acquired, such as a file, socket, connection, response body, lock, goroutine or background task, is not released on every path, especially the error path, so the process slowly runs out of it.

*Names:* Also called Handle leak, Connection leak, Goroutine leak. A long-standing term with no single coiner. The structural fix has named originators: RAII from Bjarne Stroustrup in C++, Python's with statement (PEP 343, Guido van Rossum and Nick Coghlan), Java's try-with-resources (Java 7, Project Coin) and C#'s using statement.

*Matters most for:* web-api, distributed, databases-storage, tui, desktop, embedded

## But

A CLI that exits in milliseconds can let the OS reclaim handles, and that's fine. Some resources are meant to live as long as the process (a connection pool, a logger), and not closing them is the design. Finalizers and destructors are not a fix: they run late or never, and Java has deprecated finalize.

## Quality axes

- **delivery** +: Writing the happy path and starting a task in one line is faster than designing cleanup and lifetime.
- **reliability** −: The process slowly runs out of connections, handles or threads and then fails requests that did nothing wrong.
- **runtime** −: Leaked memory, goroutines and threads grow steadily and degrade the process over time.

**Flips:** A CLI that exits in milliseconds can leave cleanup to the OS, and process-lifetime resources like pools are meant never to close.

## Why people fall into it

- The happy path was written first and the error path added later without revisiting cleanup.
- Garbage collection makes memory feel automatic, and the same is assumed of handles, which it isn't (or not promptly).
- Starting a goroutine or task is one line; owning its lifetime is design work.
- Short-lived scripts and tests never show the leak, so it only surfaces under production load.

## How it shows

- Open, connect or acquire calls with the matching close on the happy path only, after code that can throw or return early.
- An HTTP response whose body is never closed or fully read.
- Goroutines or async tasks started with no cancellation, waiting forever on a channel or a future nobody completes.
- Connection pool exhaustion, "too many open files" or slowly climbing memory and thread counts in production.
- Tests that pass alone and fail when run together because ports or temp files are still held.

## Overcorrecting looks like

- Opening and closing a resource per operation when it is meant to be pooled or kept for the process's life (an HTTP client, a database pool).
- Wrapping cleanup so defensively that close errors on writable files are swallowed, losing data-loss signals.

## What to do

Tie release to scope with the language's construct (defer, using, try-with-resources, with, RAII) on the line after acquiring. Give every goroutine or task an owner and a way to stop it (a context, a cancellation token, a task group). Prefer long-lived pooled clients over per-call ones.

## Example

Before:

```
fn archive_invoices(month):
    conn = db.connect()
    out = open_file("invoices-" + month + ".csv", "w")
    for row in conn.query(INVOICES_FOR, month):
        out.write(format_row(row))     # a bad row throws here
    out.close()
    conn.close()                       # skipped on any error
```

After:

```
fn archive_invoices(month):
    with db.connect() as conn:
        with open_file("invoices-" + month + ".csv", "w") as out:
            for row in conn.query(INVOICES_FOR, month):
                out.write(format_row(row))
    # both are released on every path, in reverse order
```

Release is tied to scope, so an error halfway through no longer leaves a connection and a file handle open.

## One-file tell

Python: `= open(` outside a `with` statement. Java: `new FileInputStream(` or `getConnection(` not inside a try-with-resources header. Go: `http.Get(`, `http.Post(`, `.Do(req` or `os.Open(` with no `Close` in the following few lines.

## By language

**go:** defer x.Close() right after the error check. Always close http.Response.Body, even when you don't read it. Goroutine leaks are the big one: pass a context and select on ctx.Done(), and bound the lifetime with errgroup or a WaitGroup. goleak catches them in tests. Don't defer inside a long loop; the deferred calls pile up until the function returns.

**rust:** RAII through Drop makes most leaks hard, but mem::forget, Rc cycles and detached tokio tasks still leak. Keep JoinHandles or use a JoinSet. Drop cannot report errors, so call an explicit flush or close when the error matters.

**python:** Use with for files, locks and connections. CPython often closes files promptly through reference counting, which hides leaks that show under PyPy or in cycles; ResourceWarning flags them in tests. Keep a reference to tasks from asyncio.create_task or they can vanish; prefer TaskGroup.

**java:** try-with-resources on anything AutoCloseable. Streams from Files.lines must be closed too. Executors must be shut down, and thread-local values in pooled threads leak across requests.

**csharp:** using declarations for IDisposable, await using for IAsyncDisposable. Event handler subscriptions that are never removed are the common managed leak. Don't create an HttpClient per request; use IHttpClientFactory or one shared instance.

**typescript:** No deterministic cleanup until the using declaration (TC39 explicit resource management), so use try/finally. Event listeners, intervals and subscriptions not removed on teardown are the common leak in front-end and long-running Node code; AbortController cancels fetches and listeners.

## Related

[Swallowed Errors](swallowed-errors.md) · [Murphy's Law](murphys-law.md) · [Init-Time Side Effects](init-time-side-effects.md)

## Sources

- [Bjarne Stroustrup, The C++ Programming Language, resource acquisition is initialization](https://www.stroustrup.com/bs_faq2.html#finally) (recalled)
- [PEP 343, The "with" Statement](https://peps.python.org/pep-0343/) (recalled)
- [The Java Tutorials, The try-with-resources Statement](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html) (recalled)
- [uber-go/goleak](https://github.com/uber-go/goleak) (recalled)
