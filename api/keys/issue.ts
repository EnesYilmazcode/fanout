// Mint a Relaybee API key. This is a signature, not a database write — see lib/auth.ts.

import { issueKey } from '../../lib/auth'
import { check, clientIp, IP_ISSUE_LIMIT } from '../../lib/ratelimit'
import { hasSecrets, NOT_CONFIGURED } from '../../lib/config'

export const config = { runtime: 'edge' }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

export default async function handler(req: Request): Promise<Response> {
  try {
    return await handleIssue(req)
  } catch {
    // Last line of defence: anything unforeseen becomes a clean JSON envelope
    // with CORS, never a bare platform error page.
    return new Response(
      JSON.stringify({ error: { message: 'Internal error issuing a key.', type: 'api_error' } }),
      { status: 500, headers: { 'content-type': 'application/json', ...CORS } },
    )
  }
}

async function handleIssue(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: 'Use POST.' } }), {
      status: 405,
      headers: { 'content-type': 'application/json', ...CORS },
    })
  }

  // Minting an HMAC key needs MASTER_SECRET. Without it issueKey throws deep in
  // WebCrypto; return a clean 503 instead of a bare platform 500.
  if (!hasSecrets('MASTER_SECRET')) {
    return new Response(
      JSON.stringify({ error: { message: NOT_CONFIGURED, type: 'api_error' } }),
      { status: 503, headers: { 'content-type': 'application/json', ...CORS } },
    )
  }

  // Minting is unauthenticated by design, which makes it the softest spot in the
  // whole service: a fresh key is a fresh rate-limit bucket, so unlimited minting
  // would make every downstream limit decorative. Cap per source.
  if (!check(`issue:${clientIp(req)}`, IP_ISSUE_LIMIT).ok) {
    return new Response(
      JSON.stringify({ error: { message: 'Too many keys requested from this source. Try again shortly.', type: 'rate_limit_error' } }),
      { status: 429, headers: { 'content-type': 'application/json', ...CORS } },
    )
  }

  let handle = ''
  try {
    handle = ((await req.json()) as { handle?: string })?.handle ?? ''
  } catch {
    // No body is fine — we'll generate an anonymous id.
  }

  // The handle is a display convenience only. It is not an identity claim and
  // grants nothing: every key is scoped to its own randomly generated user id,
  // so two people picking the same handle never share connections or quota.
  const clean = handle.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'anon'
  const userId = `${clean}_${crypto.randomUUID().slice(0, 8)}`

  const key = await issueKey(userId)
  return new Response(
    JSON.stringify({
      key,
      user_id: userId,
      tier: 'free',
      expires_in_days: 90,
      note: 'Store this now. Relaybee keeps no record of it and cannot show it again.',
    }),
    { headers: { 'content-type': 'application/json', ...CORS } },
  )
}
