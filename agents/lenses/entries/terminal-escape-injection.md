<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Terminal escape injection

`terminal-escape-injection` · anti-patterns, security

A program writes text it doesn't control (file names, remote data, commit messages, log lines) straight to a terminal, so escape and control sequences in that text are run by the terminal: they can hide or fake output, retitle the window, write the clipboard, or in older terminals make the terminal type commands back.

*Names:* MITRE's CWE-150, Improper Neutralization of Escape, Meta, or Control Sequences, is the established reference. The earliest write-up beyond denial of service is H D Moore's "Terminal Emulator Security Issues" (2003); David Leadbeater's "ANSI Terminal security in 2023 and finding 10 CVEs" (2023) is the modern survey. Also called ANSI escape injection. Log injection (CWE-117) is the same flaw in log files, and it becomes this one when the log is read with cat or tail.

*Matters most for:* cli-devtool, tui, compilers-tooling, plugin-host

## But

Tools whose job is to reproduce bytes exactly (cat, a hex dump's raw mode, a pager showing a file the user chose) may pass input through, and users of such tools expect it; many make escaping an option instead. Text the program generated itself needs no escaping. Most current terminals have closed the known echo-back holes (title reporting off, request sequences sanitised), but new ones were still being found in 2023 and some terminals remain exposed, so the risk is mostly deception (hidden or faked lines, misleading prompts) and clipboard writes, with echo-back as a tail risk. Deception is serious for tools that show content before a user approves an action.

## Quality axes

- **security** −: Untrusted text can hide or fake terminal output, retitle the window or write the clipboard, deceiving the user before they approve an action.

**Flips:** Tools whose job is reproducing bytes exactly (cat, raw modes) should pass input through.

## Why people fall into it

- Printing a string is the simplest thing, and test inputs never contain control characters.
- Colour output is wanted, so the program deliberately writes escape sequences and doesn't separate its own from the input's.
- Text "from the file system" or "from git" feels local and trusted, though it often came from a download or a clone.
- Escaping is easy to do at one call site and forget at the next.

## How it shows

- File names, archive entry names, branch names, HTTP headers or server responses printed with plain print, println or fmt.Println.
- Error messages that interpolate the user's or a remote system's input and go to stderr unescaped.
- Log lines with request fields written raw, later read in a terminal.
- A TUI or pager that renders remote content and passes ESC (0x1B), OSC or CSI sequences through.
- Escaping in some output paths and not others, with no single output helper.

## Overcorrecting looks like

- Stripping all non-ASCII, which mangles legitimate names in other scripts.
- Escaping text the program fully controls, or output going to a file or pipe that the user asked to be byte-exact (cat-like tools, --raw modes).
- Removing colour support altogether instead of separating the program's own sequences from input.

## What to do

Neutralise at the sink: route untrusted text through one output helper that replaces C0 and C1 control characters and DEL (except newline and tab where wanted) with visible escapes such as \x1b or caret notation, before adding the program's own styling. Offer a raw mode for users who want exact bytes, and keep escaping when output is a terminal. Terminals' own defaults (title reporting off, OSC 52 reads disabled) are a second layer, not the fix.

## Example

Before:

```
fn list_archive(path: str):
    for entry in open_archive(path).entries():
        print(entry.name + "  " + human_size(entry.size))

# an entry named "x\x1b[1A\x1b[2K" moves the cursor up and erases
# the line above, so a malicious file can wipe another entry from view
```

After:

```
fn printable(text: str) -> str:
    # C0 and C1 controls and DEL become visible escapes, e.g. "\x1b"
    return escape_controls(text)

fn list_archive(path: str):
    for entry in open_archive(path).entries():
        print(printable(entry.name) + "  " + human_size(entry.size))
```

Entry names now reach the terminal as visible text, so a crafted name can't move the cursor or erase lines.

## By language

**python:** print and logging pass control characters through; repr() or a str.translate table over the C0 and C1 ranges neutralises them. Rich has a separate markup-injection concern, handled with rich.markup.escape.

**typescript:** console.log writes strings as is; JSON.stringify escapes C0 controls, and strip-ansi removes CSI and OSC sequences when display rather than exactness is wanted.

**go:** fmt's %q and strconv.Quote escape control characters; Bubble Tea and Lip Gloss render strings as given, so the model must clean remote text before it reaches View.

**rust:** The Debug format ({:?}) and str::escape_debug escape control characters; Display ({}) writes them raw.

## Related

[Injection (SQL, command, template)](injection.md) · [Sensitive data in logs](sensitive-data-in-logs.md) · [Validate at the boundary](validate-at-the-boundary.md) · [Trusting client input](trusting-client-input.md) · [Defense in depth](defense-in-depth.md)

## Sources

- [MITRE CWE-150, Improper Neutralization of Escape, Meta, or Control Sequences](https://cwe.mitre.org/data/definitions/150.html) (read)
- [David Leadbeater, ANSI Terminal security in 2023 and finding 10 CVEs (2023)](https://dgl.cx/2023/09/ansi-terminal-security) (read)
- H D Moore, Terminal Emulator Security Issues (2003) (recalled)
- [MITRE CWE-117, Improper Output Neutralization for Logs](https://cwe.mitre.org/data/definitions/117.html) (recalled)
