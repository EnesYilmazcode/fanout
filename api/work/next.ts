// Supporter side of the relay: long-poll for the next queued chat job.
//
// Auth is an ordinary Fanout key — a supporter is just a user who polls. The
// response is the raw job (id, model, messages); 204 means nothing came in
// during the poll window, poll again. Supporters see prompts in plaintext:
// that is inherent to the relay and is disclosed where the worker is set up.

import { verifyKey, bearer } from '../../lib/auth'
import { nextJob, markLive } from '../../lib/queue'
import { check, clientIp, type Verdict } from '../../lib/ratelimit'

export const config = { runtime: 'edge' }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-expose-headers': 'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset',
}

// Rate-limit headers from a limiter Verdict, matching how lib/gateway.ts builds
// them so a cross-origin worker sees the same envelope on every Fanout endpoint.
function rlHeaders(rl: Verdict) {
  return {
    'x-ratelimit-limit': String(rl.limit),
    'x-ratelimit-remaining': String(rl.remaining),
    'x-ratelimit-reset': String(Math.ceil(rl.resetAt / 1000)),
  }
}

// Each poll holds the function open for up to POLL_WINDOW_MS, so the limit can
// be modest: 12/min per source is continuous coverage with headroom to spare.
const POLL_WINDOW_MS = 20_000
const IP_POLL_LIMIT = 12

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: 'Use POST.' } }), {
      status: 405, headers: { 'content-type': 'application/json', ...CORS },
    })
  }

  const auth = await verifyKey(bearer(req))
  if (!auth) {
    return new Response(JSON.stringify({ error: { message: 'Missing or invalid Fanout API key.', type: 'authentication_error' } }), {
      status: 401, headers: { 'content-type': 'application/json', ...CORS },
    })
  }
  const rl = check(`poll:${clientIp(req)}`, IP_POLL_LIMIT)
  const rlh = rlHeaders(rl)
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: { message: 'Polling too fast. One request at a time is enough — each holds for 20s.', type: 'rate_limit_error' } }), {
      status: 429, headers: { 'content-type': 'application/json', ...CORS, ...rlh },
    })
  }

  // Mark presence up front — a node polling for work is a live node whether or
  // not this particular poll returns a job. This is what /api/work/status reads
  // so the site can light up "connected" the moment the worker loop starts.
  try {
    await markLive(auth.u)

    const job = await nextJob(POLL_WINDOW_MS)
    if (!job) return new Response(null, { status: 204, headers: { ...CORS, ...rlh } })

    return new Response(JSON.stringify(job), {
      headers: { 'content-type': 'application/json', ...CORS, ...rlh },
    })
  } catch {
    // The queue backend (Upstash) is unreachable. Return a JSON/CORS envelope
    // the worker loop can read instead of a bare 500 with no headers.
    return new Response(JSON.stringify({ error: { message: 'Relay queue is temporarily unavailable.', type: 'server_error' } }), {
      status: 503, headers: { 'content-type': 'application/json', ...CORS, ...rlh },
    })
  }
}
