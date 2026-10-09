# rulecast

The unscoped name for [`@syv-ai/rulecast`](https://www.npmjs.com/package/@syv-ai/rulecast), so that `npx rulecast` runs it. It has no code of its own.

In a project, install the scoped package. The agent hooks and git hooks run the project's own copy:

```sh
npm i -D @syv-ai/rulecast
npx rulecast init
```

Documentation: https://github.com/syv-ai/rulecast

This directory sits outside the pnpm workspace on purpose. Inside `packages/*`, pnpm would try to resolve its `@syv-ai/rulecast` range against the workspace, and `changeset publish` would publish it with every release. It is published by hand: `npm publish --access public` from this directory.
