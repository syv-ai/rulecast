<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Versioned Plugin Protocol

`versioned-plugin-protocol` · practices, api

Give a plugin or extension protocol its own version number, separate from the release of the host that speaks it, and have host and plugin state which protocol versions they speak, so the host can ship releases freely and an incompatible pair fails clearly at load time.

*Names:* Also called protocol versioning, a plugin handshake, or capability negotiation. No single coiner; it is established practice in HashiCorp's go-plugin (a handshake carrying a protocol version) and Terraform's plugin protocol (versions 5 and 6, each mapped to a range of CLI releases), and the Language Server Protocol negotiates capabilities in its initialize request instead of a number. POSA's Microkernel (1996) gives the architecture it belongs to.

*Matters most for:* plugin-host, plugins-extensions, cli-devtool, compilers-tooling, platforms

## But

When plugins are compiled against an SDK package that is already versioned apart from the host, that package's semver is the protocol version, and a second number adds nothing. VS Code ties its extension API to the editor's own version (engines.vscode) and makes it work by only ever adding to the API, so a host that never breaks its contract can get by with its release number. Version numbers are also coarse: capability negotiation, as in LSP, lets each side use what the other supports without a lockstep bump, at the cost of more branches. Every supported protocol version is code the host has to keep and test.

## Quality axes

- **change_cost** ⊕ (primary): The host ships releases freely, and plugin authors only see a break when the protocol version really changes.
- **operability** +: An incompatible host and plugin pair fails at load time with an error naming both versions.
- **reliability** +: Mismatched sides are refused up front instead of misbehaving mid-run on a message the other doesn't understand.
- **delivery** −: A handshake, version negotiation and adapters for older protocol versions have to be built and tested.

**Flips:** For plugins that ship with the host in one repository, it is overhead. Supporting every old version forever turns change_cost "-".

## Warranted when

- Third parties write plugins and install them separately from the host, on their own schedule.
- The host releases often for reasons that don't touch the plugin contract.
- Plugins run out of process (a subprocess speaking JSON, RPC, WebAssembly), so no compiler checks that the two sides agree.
- The protocol needs to change one day, and there is no way to tell an old plugin from a new one.

## How it shows

- A protocol or apiVersion field in the plugin manifest, handshake message or first request, checked by the host when it loads the plugin.
- A host that declares the range of protocol versions it supports, and an error naming both sides when they don't overlap.
- A plugin SDK package versioned on its own schedule, whose major version follows the protocol, not the host.
- Its absence, in a host that sends only its own release number and leaves each plugin to compare it with semver and guess.
- Its absence, in plugin SDK packages version-locked to the host, so every host release looks like a possible break to plugin authors.

## Overdone when

- A versioned protocol for plugins that live in the same repository and ship with the host.
- Bumping the protocol version for additive changes that old plugins can safely ignore.
- Negotiating dozens of fine-grained capabilities where one version number would do.
- Supporting every old protocol version forever, so the host carries adapters nobody uses.

## What to do

Put a protocol version in the first message or the manifest, and have the host pick the highest version both sides speak or refuse with a clear message. Make minor changes additive (new optional fields, new optional hooks) and read them tolerantly; reserve a new major protocol version for real breaks. Version the plugin SDK by the protocol, and publish which host releases speak which protocol versions.

## Example

Before:

```
# host -> plugin, first message
send(plugin, {"host_version": "0.9.3", "pages": pages})

# in the plugin
fn on_start(msg):
    if semver(msg["host_version"]) < semver("0.9.0"):
        log("warning: may not work with this host")
    ...   # no way to know whether the message shape changed
```

After:

```
# host -> plugin
send(plugin, {"protocol": [2, 3], "host_version": "0.9.3"})
reply = receive(plugin)                  # {"protocol": 2}
if reply["protocol"] not in [2, 3]:
    fail("plugin " + name + " speaks protocol " + str(reply["protocol"])
         + ", this host speaks 2 or 3")
send(plugin, encode_pages(pages, version = reply["protocol"]))
```

The protocol has its own number, the host says which versions it speaks, and a mismatch fails at load with both sides named, while host releases that don't touch the protocol no longer matter to plugins.

## By language

**rust:** Rust has no stable ABI, so in-process plugins as dynamic libraries need the same compiler and crate versions; most hosts use a subprocess with JSON or RPC, or WebAssembly, and version that protocol. A separately published plugin-API crate is the usual place for the protocol types.

**go:** The standard plugin package requires the same toolchain and dependency versions as the host, so most hosts run plugins out of process; HashiCorp's go-plugin carries a protocol version in its handshake and refuses a mismatch.

**python:** Plugins are usually found through entry points and called through hooks (pluggy). Adding a hook, or adding an argument to an existing hook, is additive, because implementations take only the arguments they name. Removing or renaming an argument, or changing what it means, is a protocol break that needs a version check.

**typescript:** VS Code extensions declare engines.vscode, the minimum host version, and type against @types/vscode; the host keeps the API additive instead of carrying a separate protocol number.

## Related

[Microkernel (plugin architecture)](microkernel.md) · [Semantic Versioning Discipline](semantic-versioning-discipline.md) · [Breaking-Change Surface](breaking-change-surface.md) · [Tolerant Reader](tolerant-reader.md) · [Deprecation Policy](deprecation-policy.md) · [Contract Test](contract-test.md)

## Sources

- [HashiCorp, Terraform Plugin Protocol](https://developer.hashicorp.com/terraform/plugin/terraform-plugin-protocol) (read)
- [HashiCorp, go-plugin (handshake and protocol version)](https://github.com/hashicorp/go-plugin) (recalled)
- [Microsoft, Language Server Protocol specification, capabilities and the initialize request](https://microsoft.github.io/language-server-protocol/) (recalled)
- Buschmann et al., Pattern-Oriented Software Architecture vol. 1 (1996), Microkernel (recalled)
