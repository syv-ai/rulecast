#!/usr/bin/env node
import { text as readAll } from "node:stream/consumers"

import { main } from "./commands/main"
import { spawnDetached } from "./commands/spawn"

const script = process.argv[1]!

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin: () => readAll(process.stdin),
  startWarm: (root, kinds) =>
    spawnDetached(process.execPath, [script, "warm", ...kinds.flatMap((kind) => ["--detector", kind])], root),
})
