import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { clipboardCommand, copyWith, findOnPath } from "../../src/init/clipboard"
import { createProject } from "../helpers/project"

/** A directory of fake commands: each writes its stdin to <name>.out next to itself. */
async function fakeBin(names: string[]): Promise<string> {
  const bin = path.join(await createProject({}), "bin")
  await mkdir(bin)
  for (const name of names) {
    const file = path.join(bin, name)
    await writeFile(file, `#!/bin/sh\ncat > "${file}.out"\n`)
    await chmod(file, 0o755)
  }
  return bin
}

describe("clipboardCommand", () => {
  test("takes the first of pbcopy, wl-copy, xclip and clip.exe found on PATH", async () => {
    const bin = await fakeBin(["xclip", "clip.exe"])
    expect(clipboardCommand({ PATH: [path.join(bin, "missing"), bin].join(path.delimiter) })).toEqual({
      command: path.join(bin, "xclip"),
      args: ["-selection", "clipboard"],
    })
    const all = await fakeBin(["clip.exe", "wl-copy", "pbcopy"])
    expect(clipboardCommand({ PATH: all })?.command).toBe(path.join(all, "pbcopy"))
  })

  test("skips files that are not executable and gives null when nothing is found", async () => {
    const bin = await fakeBin([])
    await writeFile(path.join(bin, "pbcopy"), "not a program")
    expect(findOnPath("pbcopy", { PATH: bin })).toBeNull()
    expect(clipboardCommand({ PATH: bin })).toBeNull()
    expect(clipboardCommand({})).toBeNull()
  })
})

describe("copyWith", () => {
  test("pipes the text into the command", async () => {
    const bin = await fakeBin(["pbcopy"])
    expect(await copyWith({ command: path.join(bin, "pbcopy"), args: [] }, "Read this\n")).toBe(true)
    expect(await readFile(path.join(bin, "pbcopy.out"), "utf8")).toBe("Read this\n")
  })

  test("reports a command that cannot start", async () => {
    expect(await copyWith({ command: "/no/such/clipboard", args: [] }, "x")).toBe(false)
  })
})
