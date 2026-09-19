import { CANCEL_SYMBOL } from "@clack/prompts"
import { expect, test } from "vitest"

import { clackPrompter, unwrap } from "../../src/init/clack"
import { Cancelled } from "../../src/init/prompts"

test("unwrap passes answers through and turns a cancel into Cancelled", () => {
  expect(unwrap(["python/layering"])).toEqual(["python/layering"])
  expect(unwrap(false)).toBe(false)
  expect(() => unwrap(CANCEL_SYMBOL)).toThrow(Cancelled)
})

test("the clack prompter implements every prompt", () => {
  expect(Object.keys(clackPrompter()).sort()).toEqual([
    "confirm",
    "groupMultiselect",
    "intro",
    "multiselect",
    "note",
    "outro",
    "select",
  ])
})
