// The proxy. One catch-all route handles every /api/v1/* path, because Vercel's
// Hobby tier caps function count and each file is a separate bundle.

import { verifyKey, bearer } from '../../lib/auth'
import { open, type Connection } from '../../lib/seal'
import { route, ADAPTERS, type ChatRequest } from '../../lib/providers'
import { check, LIMITS } from '../../lib/ratelimit'

export const config = { runtime: 'edge' }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-fanout-connection',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

function err(status: number, message: string, type = 'invalid_request_error') {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

/** Provider statuses worth retrying on a different credential. */
function shouldFailover(status: number) {
  return status === 401 || status === 403 || status === 429 || status >= 500
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const path = new URL(req.url).pathname.replace(/^\/api\/v1/, '')

  // ---- who are you ---------------------------------------------------------
  const auth = await verifyKey(bearer(req))
  if (!auth) return err(401, 'Missing or invalid Fanout API key. Get one from /api/keys/issue.', 'authentication_error')

  const rl = check(auth.u, LIMITS[auth.t] ?? LIMITS.free)
  const rlHeaders = {
    'x-ratelimit-limit': String(rl.limit),
    'x-ratelimit-remaining': String(rl.remaining),
    'x-ratelimit-reset': String(Math.ceil(rl.resetAt / 1000)),
  }
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ error: { message: 'Rate limit exceeded.', type: 'rate_limit_error' } }),
      { status: 429, headers: { 'content-type': 'application/json', ...CORS, ...rlHeaders } },
    )
  }

  if (path === '/models') {
    return new Response(
      JSON.stringify({
        object: 'list',
        data: Object.keys(ADAPTERS).map((id) => ({ id, object: 'provider' })),
      }),
      { headers: { 'content-type': 'application/json', ...CORS, ...rlHeaders } },
    )
  }

  if (path !== '/chat/completions') return err(404, `No route for ${path}`)
  if (req.method !== 'POST') return err(405, 'Use POST for /v1/chat/completions')

  // ---- what are you asking for --------------------------------------------
  let body: ChatRequest
  try {
    body = (await req.json()) as ChatRequest
  } catch {
    return err(400, 'Request body must be valid JSON.')
  }
  if (!body?.model) return err(400, 'Field "model" is required, e.g. "anthropic/claude-opus-5".')
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return err(400, 'Field "messages" must be a non-empty array.')
  }

  const routed = route(body.model)
  if (!routed) {
    return err(400, `Unknown model "${body.model}". Use "<provider>/<model>", one of: ${Object.keys(ADAPTERS).join(', ')}.`)
  }
  const { adapter, model } = routed

  // ---- whose credentials are we spending ----------------------------------
  // Connections are client-held sealed blobs. Sending several is the point:
  // fanout rotates across them and fails over when one is rate-limited or dead.
  const raw = (req.headers.get('x-fanout-connection') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (raw.length === 0) {
    return err(400, 'Missing X-Fanout-Connection header. Create one at POST /api/connect.')
  }

  const conns: Connection[] = []
  for (const blob of raw) {
    const c = await open(blob, auth.u)
    if (c && c.provider === adapter.id) conns.push(c)
  }
  if (conns.length === 0) {
    return err(403, `No valid ${adapter.id} connection for this key. Blobs are bound to the user who created them.`, 'permission_error')
  }

  // Start at a random offset so load spreads across the pool instead of always
  // hammering whichever connection happens to be first in the header.
  const start = Math.floor(Math.random() * conns.length)
  const upstreamBody = JSON.stringify(adapter.translateRequest(body, model))

  let lastStatus = 502
  let lastText = 'All upstream connections failed.'

  for (let i = 0; i < conns.length; i++) {
    const conn = conns[(start + i) % conns.length]

    let upstream: Response
    try {
      upstream = await fetch(adapter.endpoint, {
        method: 'POST',
        headers: adapter.headers(conn.apiKey),
        body: upstreamBody,
      })
    } catch {
      lastStatus = 502
      lastText = `Could not reach ${adapter.id}.`
      continue
    }

    if (!upstream.ok) {
      lastStatus = upstream.status
      lastText = await upstream.text().catch(() => 'Upstream error.')
      if (shouldFailover(upstream.status) && i < conns.length - 1) continue
      // Non-retryable (a malformed request, say) — surface it verbatim so the
      // caller sees the provider's own explanation.
      return new Response(lastText, {
        status: upstream.status,
        headers: { 'content-type': 'application/json', ...CORS, ...rlHeaders },
      })
    }

    const served = {
      'x-fanout-provider': adapter.id,
      'x-fanout-connection-label': conn.label ?? 'unnamed',
      'x-fanout-attempt': String(i + 1),
      'x-fanout-pool-size': String(conns.length),
    }

    if (body.stream && upstream.body) {
      return new Response(adapter.translateStream(upstream.body, body.model), {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          ...CORS,
          ...rlHeaders,
          ...served,
        },
      })
    }

    const json = await upstream.json()
    return new Response(JSON.stringify(adapter.translateResponse(json, body.model)), {
      headers: { 'content-type': 'application/json', ...CORS, ...rlHeaders, ...served },
    })
  }

  return new Response(lastText, {
    status: lastStatus,
    headers: { 'content-type': 'application/json', ...CORS, ...rlHeaders },
  })
}
