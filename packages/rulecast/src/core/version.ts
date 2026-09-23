/** The running rulecast version. test/core/version.test.ts keeps it equal to package.json. */
export const VERSION = "0.1.1"

export function parseVersion(text: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** Whether `running` is older than `minimum`. Both must be X.Y.Z (the schema checks `minimum`). */
export function isOlder(running: string, minimum: string): boolean {
  const a = parseVersion(running)
  const b = parseVersion(minimum)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!
  }
  return false
}
