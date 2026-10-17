<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Init-Time Side Effects

`init-time-side-effects` · anti-patterns, design · **agents do this**

Real work, such as reading config or env, opening connections, registering global state or making network calls, runs when a module is imported or a package initialised, before the program's entry point has had a say.

*Names:* Also called Import-time side effects, Work in static initializers, init() abuse. A descriptive name. Peter Bourgon's "A theory of modern Go" (2017) made the Go form widely known with its advice of no package-level variables and no func init. Miško Hevery's testability guide named the Java form as constructors and static blocks doing real work.

*Matters most for:* cli-devtool, library-sdk, serverless, plugin-host, plugins-extensions

## But

Pure, cheap initialization is fine: constants, lookup tables, compiled regexes. Registration by import (Go's database/sql drivers, image formats) is an accepted idiom when the init only registers and does no I/O. In a small script, a module-level client is honest and simple. Framework conventions (a module-level FastAPI or Flask app) are fine as long as configuration and connections happen at startup hooks rather than at import.

## Quality axes

- **delivery** +: One module-level client, ready wherever it is imported, is the shortest path.
- **reliability** −: An unrelated dependency being down breaks import, so even --help or an unrelated command fails.
- **change_cost** −: Tests need environment variables or network just to import a module, and import order starts to matter.
- **runtime** −: Work runs on every import whether used or not, slowing CLI startup and serverless cold starts.
- **operability** −: Configuration read before flags are parsed can't be overridden at launch.

**Flips:** In a small script a module-level client is honest and simple; pure initialisation and registration-only imports with no I/O are fine.

## Why people fall into it

- It is the shortest path: one global client, ready wherever you import it.
- Frameworks and examples show module-level app and client objects.
- Plugin and driver registration by import (database drivers, codecs) is a sanctioned pattern, and it spreads to things that aren't registration.
- Passing dependencies explicitly feels like ceremony in a small program.

## How it shows

- Module-level code that reads environment variables, opens database connections or creates clients with credentials.
- Go func init() that reads flags, env or files, or registers into a global registry.
- Configuration read before command-line flags are parsed, so flags can't override it.
- Tests that need environment variables set or network access just to import a module.
- Slow CLI startup, or --help that fails when a service is down.
- Import order that matters.

## Overcorrecting looks like

- Banning all module-level constants and precompiled patterns, which are pure and harmless.
- Threading every dependency through ten layers of parameters to avoid one lazily built singleton.

## What to do

Move the work into an explicit construction step called from main or the app factory, after flags and config are parsed, and pass the results in (dependency injection by hand is enough). Where something must be global, build it lazily on first use behind a function.

## Example

Before:

```
# thumbnails.py
STORAGE = BucketClient(env["BUCKET_URL"], env["BUCKET_KEY"])   # runs on import
SIZES = read_json("sizes.json")

fn make_thumbnails(image_id):
    image = STORAGE.get(image_id)
    for size in SIZES:
        STORAGE.put(thumb_key(image_id, size), resize(image, size))
```

After:

```
# thumbnails.py
class Thumbnailer:
    fn init(storage: BucketClient, sizes: list):
        self.storage = storage
        self.sizes = sizes

    fn make(image_id):
        image = self.storage.get(image_id)
        for size in self.sizes:
            self.storage.put(thumb_key(image_id, size), resize(image, size))

# main.py, after flags and config are parsed
thumbnailer = Thumbnailer(BucketClient(config.bucket_url, config.bucket_key), config.sizes)
```

Importing the module no longer needs credentials or files, and main decides where the configuration comes from.

## One-file tell

Go: func init() whose body calls os.Getenv, os.LookupEnv, os.Open, os.ReadFile, flag., sql.Open or http.. Python, outside test files and outside scripts (files with an `if __name__ == "__main__":` block): a top-level statement that calls os.environ[...], os.environ.get(, os.getenv(, open(, connect( or requests.<fn>(.

## By language

**go:** init functions run in dependency order before main and can't return errors, so they panic or log.Fatal instead. flag.Parse hasn't run yet, so flags read there are defaults. gochecknoinits and gochecknoglobals lint for these.

**python:** Everything at module top level runs on import, including on test collection. Use an app factory or a main function, and functools.cache for lazy globals. Import cost also hurts CLI startup; python -X importtime shows it.

**java:** Static initializer blocks and static fields with constructors run on class load; an exception there becomes ExceptionInInitializerError and the class is unusable thereafter (NoClassDefFoundError).

**csharp:** An explicit static constructor runs just before the type is first used; static field initializers in a type without one may run at any earlier time. An exception in either becomes TypeInitializationException, and the type is unusable for the rest of the app domain.

**typescript:** Top-level code in an ES module runs on first import, and top-level await can block every importer. Bundlers mark modules with side effects as not tree-shakable ("sideEffects" in package.json).

**rust:** Rust has no life-before-main by design; statics must be const-initialized. Lazy globals use std::sync::LazyLock or OnceLock, which run on first use, not at load.

## Related

[Global state](global-state.md) · [Singleton](singleton.md) · [Hard-to-Test Code](hard-to-test-code.md) · [Fail Fast](fail-fast.md)

## Sources

- [Peter Bourgon, A theory of modern Go (2017)](https://peter.bourgon.org/blog/2017/06/09/theory-of-modern-go.html) (recalled)
- [Miško Hevery, Guide to Writing Testable Code, Flaw - Constructor does real work](https://testing.googleblog.com/2008/11/guide-to-writing-testable-code.html) (recalled)
- [Effective Go, The init function](https://go.dev/doc/effective_go#init) (recalled)
