---
"@syv-ai/rulecast": patch
---

The standalone binaries run ast-grep rules again. The released binaries (checked on 0.8.0) carried the build machine's path to the Python parser and did not include the parser itself, so on any other machine every ast-grep rule was disabled with "ast-grep is unavailable: No parser found", TypeScript rules included.

- The binary embeds each dynamic language's parser and writes it once to `<cache home>/native/<version>-<platform>-<arch>/` (the temp directory when the cache home can't be written), where ast-grep can load it.
- A dynamic language that cannot load disables only its own rules; the built-in languages keep working.
- The binary test checks that no path from the build machine is in the binary, and runs a TypeScript and a Python ast-grep rule.
