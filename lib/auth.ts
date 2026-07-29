// Self-verifying API keys. The key IS the record — there is no user table.
//
//   fo_live_<base64url(payload)>.<base64url(hmac_sha256(payload))>
//
// Verification is a single HMAC recompute: no database round trip, ~microseconds,
// and it works on the Edge runtime via WebCrypto.

import { bytesToB64u, b64uToBytes, b64uToJson, jsonToB64u, enc } from './b64'

export type KeyPayload = {
  u: string // user id
  t: 'free' | 'pro' // tier
  v: number // key version, for rotation
  i: number // issued at (unix seconds)
  e: number // expires at (unix seconds)
}

const PREFIX = 'fo_live_'
const KEY_VERSION = 1
const TTL_SECONDS = 90 * 24 * 60 * 60

let cachedKey: CryptoKey | null = null

async function hmacKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const secret = process.env.MASTER_SECRET
  if (!secret) throw new Error('MASTER_SECRET is not set')
  cachedKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  return cachedKey
}

export async function issueKey(userId: string, tier: KeyPayload['t'] = 'free'): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload: KeyPayload = { u: userId, t: tier, v: KEY_VERSION, i: now, e: now + TTL_SECONDS }
  const body = jsonToB64u(payload)
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body))
  return `${PREFIX}${body}.${bytesToB64u(new Uint8Array(sig))}`
}

export async function verifyKey(raw: string | null): Promise<KeyPayload | null> {
  if (!raw || !raw.startsWith(PREFIX)) return null
  const [body, sig] = raw.slice(PREFIX.length).split('.')
  if (!body || !sig) return null

  let ok: boolean
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(), b64uToBytes(sig), enc.encode(body))
  } catch {
    return null
  }
  if (!ok) return null

  let payload: KeyPayload
  try {
    payload = b64uToJson<KeyPayload>(body)
  } catch {
    return null
  }

  if (payload.v !== KEY_VERSION) return null
  if (payload.e < Math.floor(Date.now() / 1000)) return null
  return payload
}

/** Bearer token out of an Authorization header. */
export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization')
  if (!h) return null
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1] : null
}
