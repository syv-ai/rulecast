<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Microkernel (plugin architecture)

`microkernel` · design patterns, architecture

Keep a small core that provides the minimal shared machinery, and put features in plugins that the core discovers and calls through a stable, versioned contract.

*Names:* Named as the Microkernel pattern in Buschmann et al., POSA vol. 1 (1996), borrowing the term from operating-system microkernels such as Mach. Richards and Ford (Fundamentals of Software Architecture, 2020) call it the microkernel or plugin architecture style. Eclipse, VS Code, browsers, webpack and pytest are well-known examples. Not the same as an OS microkernel, though the idea is shared.

*Matters most for:* plugin-host, plugins-extensions, desktop, cli-devtool, compilers-tooling

## But

A plugin contract is a public API: once others build on it, Hyrum's law applies and every observable behaviour becomes something you can't change cheaply, so publish the smallest contract that works and version it. When all extensions are in-house and ship together, a plain interface and a compile-time list are simpler and easier to follow than discovery and dynamic loading. Dynamic loading also brings security (running untrusted code), isolation and dependency conflicts between plugins. Plugins that need to talk to each other push the design toward a bus and away from a small core.

## Quality axes

- **change_cost** ⊕ (primary): Features ship as plugins through a stable contract, so the core stays unchanged as formats and providers are added.
- **security** −: Discovering and loading plugins means running code the core didn't write, possibly untrusted, inside the host.
- **delivery** −: A versioned plugin contract, discovery and lifecycle hooks must be designed before the first plugin.

**Flips:** With one in-house plugin released together with the core, a plain interface and a compile-time list are simpler; a broad contract falls to Hyrum's law and every core change breaks plugins, turning change_cost "-".

## Warranted when

- Third parties, or other teams, must add features without changing the core.
- The product has many optional features that customers mix differently.
- New formats, providers or languages keep being added to a switch statement in the core.
- The core must stay stable while features change at their own pace.

## How it shows

- A plugin interface or trait plus a registry, entry-point table or manifest format through which plugins are found.
- Features living in separate packages that the core never imports by name.
- A published plugin API module, separately versioned from the core, with compatibility notes.
- Lifecycle hooks (activate, deactivate, on_event) and a host that isolates plugin failures.

## Overdone when

- A plugin system with one plugin, written by the same team, in the same repo, released together.
- Making every internal module a plugin, so control flow is only visible at runtime.
- A contract so broad (plugins get the whole app object) that every core change breaks plugins.

## Example

Before:

```
fn import_file(path):
    if path.ends_with(".csv"): rows = parse_csv(read(path))
    elif path.ends_with(".xlsx"): rows = parse_xlsx(read(path))
    elif path.ends_with(".ofx"): rows = parse_ofx(read(path))
    else: raise Unsupported(path)
    ledger.add_all(rows)
# every new bank format is an edit to the core
```

After:

```
interface Importer:                 # the published contract
    api_version = 1
    fn handles(path) -> bool
    fn parse(data: Bytes) -> list[Transaction]

class Core:
    fn init(): self.importers = discover_plugins("ledger.importers")
    fn import_file(path):
        importer = first(i for i in self.importers if i.handles(path))
        if importer is None: raise Unsupported(path)
        ledger.add_all(importer.parse(read(path)))
```

Formats become plugins found at startup; the core only knows the contract, so new formats ship without touching it.

## By language

**python:** Discovery usually goes through packaging entry points (importlib.metadata.entry_points), as pytest and many CLIs do; pluggy is pytest's hook library. A plugin's dependencies share one environment with the host, so version conflicts are the main pain.

**typescript:** Usually plugins are npm packages loaded by name from config (ESLint, Vite, webpack); the contract is a published types package. VS Code adds process isolation via its extension host.

**java:** java.util.ServiceLoader with META-INF/services, or OSGi for full module lifecycles and isolation; class loader conflicts are the classic problem.

**csharp:** AssemblyLoadContext supports loading and unloading plugin assemblies; MEF (System.Composition) is an older discovery option. Share only a small contracts assembly between host and plugins.

**go:** The standard plugin package is fragile (same toolchain and dependency versions, limited platforms), so Go hosts usually compile plugins in via a registry populated from init functions, or run them as separate processes over RPC, as HashiCorp's go-plugin does.

**rust:** There is no stable Rust ABI, so dynamic plugins either go through a C ABI (abi_stable, libloading), WebAssembly (wasmtime, Extism) or a separate process. Compile-time plugins via traits and feature flags are far simpler when the set is known.

## Related

[Ports and Adapters](ports-and-adapters.md) · [Hyrum's Law](hyrums-law.md) · [Strategy](strategy.md) · [Switch Statements](switch-statements.md)

## Sources

- Buschmann et al., Pattern-Oriented Software Architecture vol. 1 (1996), Microkernel (recalled)
- Mark Richards and Neal Ford, Fundamentals of Software Architecture (2020), Microkernel Architecture Style (recalled)
