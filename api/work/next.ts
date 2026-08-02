// Supporter side of the relay: long-poll for the next queued chat job.
//
// Auth is an ordinary Relaybee key — a supporter is just a user who polls. The
// response is the raw job (id, model, messages); 204 means nothing came in
// during the poll window, poll again. Supporters see prompts in plaintext:
// that is inherent to the relay and is disclosed where the worker is set up.

import { verifyKey, bearer } from '../../lib/auth'
import { nextJob, markLive } from '../../lib/queue'
import { check, clientIp, rlHeaders } from '../../lib/ratelimit'

export const config = { runtime: 'edge' }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-expose-headers': 'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset',
}

// Each poll holds the function open for up to POLL_WINDOW_MS, so the limit can
// be modest: 12/min per source is continuous coverage with headroom to spare.
//
// The window matches the queue's own blocking cap on purpose. At 20s it took two
// BRPOPs (15s then 5s) to cover one poll, which quietly doubled the cost of the
// only thing this project pays for continuously. 15s is one command per poll and
// still well under the Edge deadline.
const POLL_WINDOW_MS = 15_000
const IP_POLL_LIMIT = 12

// Presence has a 45s TTL, so heartbeating on every poll is mostly waste. Skip the
// write if this instance saw the same node recently. A cold instance always beats,
// so presence is never late, and the degenerate case (every poll landing on a
// different instance) is exactly what the code did before.
const HEARTBEAT_MS = 30_000
const lastBeat = new Map<string, number>()

function shouldBeat(userId: string): boolean {
  const now = Date.now()
  const prev = lastBeat.get(userId)
  if (prev !== undefined && now - prev < HEARTBEAT_MS) return false
  if (lastBeat.size > 1_000) {
    for (const [k, at] of lastBeat) if (now - at > HEARTBEAT_MS * 2) lastBeat.delete(k)
  }
  lastBeat.set(userId, now)
  return true
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: 'Use POST.' } }), {
      status: 405, headers: { 'content-type': 'application/json', ...CORS },
    })
  }

  const auth = await verifyKey(bearer(req))
  if (!auth) {
    return new Response(JSON.stringify({ error: { message: 'Missing or invalid Relaybee API key.', type: 'authentication_error' } }), {
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
    if (shouldBeat(auth.u)) await markLive(auth.u)

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
