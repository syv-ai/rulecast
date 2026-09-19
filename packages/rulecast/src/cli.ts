#!/usr/bin/env node
import { text as readAll } from "node:stream/consumers"

import { main } from "./commands/main"
import { spawnDetached } from "./commands/spawn"
import { clipboardCommand, copyWith } from "./init/clipboard"

const script = process.argv[1]!

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin: () => readAll(process.stdin),
  startWarm: (root, kinds) =>
    spawnDetached(process.execPath, [script, "warm", ...kinds.flatMap((kind) => ["--detector", kind])], root),
  // Only init prompts; a dynamic import keeps @clack/prompts out of every hook's startup.
  prompter: async () => (await import("./init/clack")).clackPrompter(),
  copyToClipboard: async (text) => {
    const clipboard = clipboardCommand(process.env)
    return clipboard !== null && (await copyWith(clipboard, text))
  },
})
