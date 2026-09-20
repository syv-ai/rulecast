import { describe, expect, test } from "vitest"

import { builtinDetectors } from "../../src/detectors"
import { detectorContract } from "../../src/testing/detector-contract"
import { DETECTOR_FIXTURES } from "./fixtures"

test("every built-in detector has a contract fixture", () => {
  expect(builtinDetectors.map((detector) => detector.kind).sort()).toEqual(Object.keys(DETECTOR_FIXTURES).sort())
})

for (const detector of builtinDetectors) {
  describe(`${detector.kind} detector contract`, () => {
    for (const contractCase of detectorContract(detector, DETECTOR_FIXTURES[detector.kind]!)) {
      test(contractCase.name, () => contractCase.run(), 30_000)
    }
  })
}
