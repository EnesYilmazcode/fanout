// Is a supporter node live for this key right now?
//
// The homepage polls this in supporter mode so it can light up "connected" the
// moment the pasted worker loop starts hitting /api/work/next. Presence is keyed
// by the Fanout user id in the bearer key, so a caller only ever sees the status
// of its own node — no cross-user visibility.

import { verifyKey, bearer } from '../../lib/auth'
import { isLive, countLive } from '../../lib/queue'
import { check, clientIp, type Verdict } from '../../lib/ratelimit'

export const config = { runtime: 'edge' }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-expose-headers': 'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset',
}

// The page polls every few seconds; keep a generous ceiling so a background tab
// that fell behind isn't locked out, but still bounded.
const IP_STATUS_LIMIT = 60

// Rate-limit headers from a limiter Verdict, matching how lib/gateway.ts builds
// them so a cross-origin worker sees the same envelope on every Fanout endpoint.
function rlHeaders(rl: Verdict) {
  return {
    'x-ratelimit-limit': String(rl.limit),
    'x-ratelimit-remaining': String(rl.remaining),
    'x-ratelimit-reset': String(Math.ceil(rl.resetAt / 1000)),
  }
}

function json(status: number, obj: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', ...CORS, ...extra },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'GET') return json(405, { error: { message: 'Use GET.' } })

  const auth = await verifyKey(bearer(req))
  if (!auth) return json(401, { error: { message: 'Missing or invalid Fanout API key.', type: 'authentication_error' } })
  const rl = check(`status:${clientIp(req)}`, IP_STATUS_LIMIT)
  const rlh = rlHeaders(rl)
  if (!rl.ok) {
    return json(429, { error: { message: 'Polling status too fast.', type: 'rate_limit_error' } }, rlh)
  }

  let connected: boolean, online: number
  try {
    [connected, online] = await Promise.all([isLive(auth.u), countLive()])
  } catch {
    return json(503, { error: { message: 'Relay queue is temporarily unavailable.', type: 'server_error' } }, rlh)
  }
  return json(200, { connected, online }, rlh)
}
