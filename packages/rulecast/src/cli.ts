#!/usr/bin/env node
import module from "node:module"

// Every hook is a fresh process, so without this Node compiles all of rulecast and its dependencies
// again each time. It is here, ahead of a dynamic import, because a static import would load them
// first. Below Node 22.1 the function does not exist, and hooks only start slower.
// @types/node stays on the oldest Node rulecast supports, which has no such function.
;(module as typeof module & { enableCompileCache?: () => unknown }).enableCompileCache?.()

await import("./cli-main")
