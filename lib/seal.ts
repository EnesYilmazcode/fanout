// Sealed connection blobs.
//
// A user hands us a provider credential once. We encrypt it under the server's
// master key, bind the ciphertext to that user's id as AES-GCM additional data,
// and hand the blob back. The client stores it; we store nothing.
//
//   fc_<base64url(iv)>.<base64url(ciphertext||tag)>
//
// The AAD binding is what stops user A from replaying a blob they scraped from
// user B — decryption fails outright if the authenticated owner doesn't match.

import { bytesToB64u, b64uToBytes, enc, dec } from './b64'

export type Connection = {
  provider: string
  apiKey: string
  owner: string
  createdAt: number
  label?: string
}

const PREFIX = 'fc_'
let cachedKey: CryptoKey | null = null

async function aesKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const b64 = process.env.MASTER_ENCRYPTION_KEY
  if (!b64) throw new Error('MASTER_ENCRYPTION_KEY is not set')
  // b64uToBytes accepts standard base64 and base64url alike (it normalizes and
  // pads internally), so MASTER_ENCRYPTION_KEY can be in either form.
  const raw = b64uToBytes(b64)
  if (raw.length !== 32) throw new Error('MASTER_ENCRYPTION_KEY must decode to 32 bytes')
  cachedKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
  return cachedKey
}

export async function seal(conn: Connection): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(conn.owner) },
    await aesKey(),
    enc.encode(JSON.stringify(conn)),
  )
  return `${PREFIX}${bytesToB64u(iv)}.${bytesToB64u(new Uint8Array(ct))}`
}

/** Returns null if the blob is malformed, tampered with, or owned by someone else. */
export async function open(blob: string | null, owner: string): Promise<Connection | null> {
  if (!blob || !blob.startsWith(PREFIX)) return null
  const [ivPart, ctPart] = blob.slice(PREFIX.length).split('.')
  if (!ivPart || !ctPart) return null
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64uToBytes(ivPart), additionalData: enc.encode(owner) },
      await aesKey(),
      b64uToBytes(ctPart),
    )
    return JSON.parse(dec.decode(pt)) as Connection
  } catch {
    return null
  }
}
