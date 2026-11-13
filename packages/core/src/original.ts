import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Lê o original em partes, inclusive em contextos HTTP sem crypto.subtle. */
export async function hashOriginal(file: Blob): Promise<string> {
  const hash = sha256.create()
  const stream = file.stream().getReader()
  try {
    while (true) {
      const { done, value } = await stream.read()
      if (done) return bytesToHex(hash.digest())
      hash.update(value)
    }
  } finally {
    stream.releaseLock()
  }
}
