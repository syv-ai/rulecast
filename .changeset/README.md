# Changesets

Every change that should appear in a release adds one: `pnpm changeset`, pick `@syv-ai/rulecast`,
pick patch / minor / major, and write what changed for someone who has never seen the project — it
becomes the `CHANGELOG.md` entry and the GitHub Release body.

`access: public` is not optional here. The `@syv-ai` scope is private by default on npm and a
scoped package will not publish without it.

`packages/rules-general`, `rules-python` and `rules-react` have no `package.json`: they are not npm
packages, they are consumed by git checkout at a tag. The tag changesets creates is what versions
them, which is what spec §16's "one tag versions the CLI and the rule packages" means in practice.
So `ignore` stays empty — changesets never sees them.

See [the changesets docs](https://github.com/changesets/changesets).
