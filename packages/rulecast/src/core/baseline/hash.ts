export interface Snapshot {
  fileHash: number
  lines: Uint32Array
}

const OFFSET_BASIS = 0x811c9dc5
const PRIME = 0x01000193

/** 32-bit FNV-1a over UTF-16 code units. Not cryptographic; only equality matters. */
export function fnv1a(text: string): number {
  let hash = OFFSET_BASIS
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, PRIME)
  }
  return hash >>> 0
}

export function hashLines(text: string): Uint32Array {
  const lines = text.split(/\r?\n/)
  const hashes = new Uint32Array(lines.length)
  lines.forEach((line, index) => {
    hashes[index] = fnv1a(line.trim())
  })
  return hashes
}

function hashOfHashes(lines: Uint32Array): number {
  let hash = OFFSET_BASIS
  for (const value of lines) {
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (value >>> shift) & 0xff
      hash = Math.imul(hash, PRIME)
    }
  }
  return hash >>> 0
}

export function snapshotOf(text: string): Snapshot {
  const lines = hashLines(text)
  return { fileHash: hashOfHashes(lines), lines }
}
