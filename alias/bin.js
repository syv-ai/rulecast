#!/usr/bin/env node
// The CLI runs on import. No second process: hooks pay for every millisecond of startup.
await import("@syv-ai/rulecast/cli")
