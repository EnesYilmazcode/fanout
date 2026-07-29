// Mint a Fanout API key. This is a signature, not a database write — see lib/auth.ts.

import { issueKey } from '../../lib/auth'

export const config = { runtime: 'edge' }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: 'Use POST.' } }), {
      status: 405,
      headers: { 'content-type': 'application/json', ...CORS },
    })
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
      note: 'Store this now. Fanout keeps no record of it and cannot show it again.',
    }),
    { headers: { 'content-type': 'application/json', ...CORS } },
  )
}
