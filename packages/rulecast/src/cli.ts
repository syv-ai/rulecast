#!/usr/bin/env node
import { text as readAll } from "node:stream/consumers"

import { main } from "./commands/main"
import { spawnDetached } from "./commands/spawn"
import { selfCommand } from "./core/self"

const [command, ...self] = selfCommand()

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin: () => readAll(process.stdin),
  startWarm: (root, kinds) =>
    spawnDetached(command, [...self, "warm", ...kinds.flatMap((kind) => ["--detector", kind])], root),
})
