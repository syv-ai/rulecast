# Generated code

Files produced by a generator (API clients, route trees, schema types, protobuf stubs) are outputs, not sources. A hand edit is lost the next time the generator runs, and until then the output disagrees with its source.

## Changing generated code

1. Find the source the file is generated from: the backend's OpenAPI schema, the route files, the schema definition. The file's header comment or the project's scripts usually name the generator.
2. Change the source.
3. Run the project's generate command (look in `package.json` scripts, a `Makefile`, or a `scripts/` directory).
4. Commit the source change and the regenerated files together.

If the generator itself produces wrong output, fix its configuration or report it; don't patch the output.

## Which files are generated

This rule matches `*.gen.ts`-style files and `__generated__/` directories by default. A project whose generator writes elsewhere overrides the rule's `files` in `.rulecast-config.yaml`:

```yaml
- id: generated-code
  files: ^frontend/src/client/
```
