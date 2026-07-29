// base64url helpers that work on the Edge runtime (no Buffer).

export function bytesToB64u(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// The explicit `Uint8Array<ArrayBuffer>` matters: TypeScript 5.7 made the backing
// buffer generic, and WebCrypto's BufferSource rejects the SharedArrayBuffer case.
export function b64uToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const enc = new TextEncoder()
export const dec = new TextDecoder()

export function jsonToB64u(obj: unknown): string {
  return bytesToB64u(enc.encode(JSON.stringify(obj)))
}

export function b64uToJson<T>(s: string): T {
  return JSON.parse(dec.decode(b64uToBytes(s))) as T
}
