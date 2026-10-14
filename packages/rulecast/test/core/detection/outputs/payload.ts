import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const payloads = fileURLToPath(new URL("../../../payloads/outputs/", import.meta.url))

/** A recorded tool output, with `__ROOT__` replaced by `root`. */
export function payload(name: string, root = "/repo"): string {
  return readFileSync(payloads + name, "utf8").replaceAll("__ROOT__", root)
}
