import { expect, test } from "vitest"

import * as rulecast from "../src/index"

test("package entry loads", () => {
  expect(rulecast).toBeTypeOf("object")
})
