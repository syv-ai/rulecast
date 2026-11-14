import { readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { isDefinition, removedDefinitions } from "../../../src/core/baseline/removed-definitions"
import { createRepo, git } from "../../helpers/git"

describe("removedDefinitions (#72)", () => {
  test("definitions gone from changed and deleted files, not those kept or moved within a file", async () => {
    const root = await createRepo({
      "a.py": "class Order:\n    pass\n\ndef total():\n    return 1\n",
      "b.ts": "export interface Cart {}\nexport function price() {}\nconst x = 1\n",
      "c.go": "func Old() {}\n",
    })
    const head = (await git(root, "rev-parse", "HEAD")).trim()
    await writeFile(path.join(root, "a.py"), "def total():\n    return 1\n")
    await writeFile(path.join(root, "b.ts"), "export function price() {}\n")
    await rm(path.join(root, "c.go"))
    await writeFile(path.join(root, "new.py"), "class Order:\n    pass\n")
    const read = async (file: string) => readFile(path.join(root, file), "utf8").catch(() => null)
    expect(await removedDefinitions(root, ["new.py", "c.go", "b.ts", "a.py"], head, read)).toEqual([
      { file: "a.py", line: "class Order:" },
      { file: "b.ts", line: "export interface Cart {}" },
      { file: "b.ts", line: "const x = 1" },
      { file: "c.go", line: "func Old() {}" },
    ])
  })

  test.each([
    "public class Order {",
    "public final class Order {",
    "public interface Repo {",
    "public record Order(int id)",
    "public sealed partial class Order",
    "internal class Order",
    "sealed class Order",
    "data class Order(",
    "fun total(): Int",
    "override fun total(): Int",
    "func (o *Order) Total() int {",
    "func Total() int {",
    "export declare class Order",
    "export function* gen()",
    "export async function* gen()",
    "static async total() {",
    "private static void total() {",
    "public Map<String, Integer> totals(int days) {",
    "@Override public String toString() {",
    "@objc final class Order: NSObject {",
    "public struct Order {",
    "extension Order {",
    "protocol Repo {",
    "case class Order(id: Int)",
    "impl Order {",
    "pub(crate) fn total() -> u32 {",
    "class Order:",
    "async def total():",
  ])("a definition: %s", (line) => {
    expect(isDefinition(line)).toBe(true)
  })

  test.each([
    "return total()",
    "x = Order()",
    "if (ready) {",
    "print(1)",
    "classes = []",
    "constant = 1",
    "# class Order",
    "// public class Order",
    "public static final int LIMIT = max(1, 2);",
    "async (x) => x",
    "case Order(id) =>",
    "default: total()",
    "async with lock(x):",
    "async for x in aiter(y):",
    "static assert(x)",
  ])("not a definition: %s", (line) => {
    expect(isDefinition(line)).toBe(false)
  })

  test.each([
    ["one modifier and a long name", `public ${"x".repeat(20_000)}`],
    ["many modifiers", "public ".repeat(5_000)],
    ["modifiers then words", `${"public ".repeat(200)}${"x ".repeat(5_000)}`],
    // Under the line cap, so the pattern itself does the work.
    ["one modifier and a long name, under the cap", `public ${"x".repeat(490)}`],
    ["many modifiers, under the cap", "public ".repeat(70)],
  ])("a pathological line is judged quickly: %s", (_name, line) => {
    const started = performance.now()
    isDefinition(line)
    expect(performance.now() - started).toBeLessThan(20)
  })
})
