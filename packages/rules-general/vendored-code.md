# Vendored code

Vendored code is someone else's code copied into the repository: Go modules under `vendor/`, C libraries under `third_party/`. It is a copy of a release, not a source. An edit in place is lost the next time the dependency is re-vendored, and until then the copy no longer matches any release of it.

## Changing vendored code

1. Change the dependency, not the copy: move to the release that has the fix, or get the fix into it upstream.
2. Re-vendor it with the package manager's own command, such as `go mod vendor`, or the script the project uses to copy it in.
3. Commit the version change and the re-vendored files together.

If the fix can't wait for upstream, keep it as a patch outside the vendored tree and apply it in the step that vendors the code, so re-vendoring keeps it.

## Which files are vendored

This rule matches `vendor/` and `third_party/` directories by default. Where a project keeps other vendored code is the project's to say: set `files` on the rule's entry in `.rulecast-config.yaml`.
