// Shared gateway logic behind the /api/v1 routes.
//
// This lives in lib/ rather than in a catch-all route because Vercel's
// zero-config api/ directory only matches ONE path segment for [...param] —
// /api/v1/models resolved, /api/v1/chat/completions 404'd. Explicit route files
// import from here, so the logic stays in one place and the routing is boring.

import { verifyKey, bearer } from './auth'
import { open, type Connection } from './seal'
import { route, ADAPTERS, type ChatRequest } from './providers'
import { check, LIMITS, type Verdict } from './ratelimit'

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-fanout-connection',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

export const preflight = () => new Response(null, { status: 204, headers: CORS })

function err(status: number, message: string, type = 'invalid_request_error', extra: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...extra },
  })
}

function rlHeaders(rl: Verdict) {
  return {
    'x-ratelimit-limit': String(rl.limit),
    'x-ratelimit-remaining': String(rl.remaining),
    'x-ratelimit-reset': String(Math.ceil(rl.resetAt / 1000)),
  }
}

/** Verifies the key and meters the request. Returns a Response only on rejection. */
async function gate(req: Request) {
  const auth = await verifyKey(bearer(req))
  if (!auth) {
    return { fail: err(401, 'Missing or invalid Fanout API key. Get one from /api/keys/issue.', 'authentication_error') }
  }
  const rl = check(auth.u, LIMITS[auth.t] ?? LIMITS.free)
  const headers = rlHeaders(rl)
  if (!rl.ok) return { fail: err(429, 'Rate limit exceeded.', 'rate_limit_error', headers) }
  return { auth, headers }
}

/** Provider statuses worth retrying on a different credential. */
function shouldFailover(status: number) {
  return status === 401 || status === 403 || status === 429 || status >= 500
}

export async function listModels(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  const g = await gate(req)
  if (g.fail) return g.fail
  return new Response(
    JSON.stringify({ object: 'list', data: Object.keys(ADAPTERS).map((id) => ({ id, object: 'provider' })) }),
    { headers: { 'content-type': 'application/json', ...CORS, ...g.headers } },
  )
}

export async function chatCompletions(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return err(405, 'Use POST for /api/v1/chat/completions')

  const g = await gate(req)
  if (g.fail) return g.fail
  const { auth, headers } = g

  let body: ChatRequest
  try {
    body = (await req.json()) as ChatRequest
  } catch {
    return err(400, 'Request body must be valid JSON.', 'invalid_request_error', headers)
  }
  if (!body?.model) {
    return err(400, 'Field "model" is required, e.g. "anthropic/claude-opus-5".', 'invalid_request_error', headers)
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return err(400, 'Field "messages" must be a non-empty array.', 'invalid_request_error', headers)
  }

  const routed = route(body.model)
  if (!routed) {
    return err(400, `Unknown model "${body.model}". Use "<provider>/<model>", one of: ${Object.keys(ADAPTERS).join(', ')}.`, 'invalid_request_error', headers)
  }
  const { adapter, model } = routed

  // Connections are client-held sealed blobs. Sending several is the point:
  // fanout rotates across them and fails over when one is rate-limited or dead.
  const raw = (req.headers.get('x-fanout-connection') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (raw.length === 0) {
    return err(400, 'Missing X-Fanout-Connection header. Create one at POST /api/connect.', 'invalid_request_error', headers)
  }

  const conns: Connection[] = []
  for (const blob of raw) {
    const c = await open(blob, auth.u)
    if (c && c.provider === adapter.id) conns.push(c)
  }
  if (conns.length === 0) {
    return err(403, `No valid ${adapter.id} connection for this key. Blobs are bound to the user who created them.`, 'permission_error', headers)
  }

  // Start at a random offset so load spreads across the pool instead of always
  // hammering whichever connection happens to be first in the header.
  const start = Math.floor(Math.random() * conns.length)
  const upstreamBody = JSON.stringify(adapter.translateRequest(body, model))

  let lastStatus = 502
  let lastText = JSON.stringify({ error: { message: 'All upstream connections failed.', type: 'api_error' } })

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
      lastText = JSON.stringify({ error: { message: `Could not reach ${adapter.id}.`, type: 'api_error' } })
      continue
    }

    if (!upstream.ok) {
      lastStatus = upstream.status
      lastText = await upstream.text().catch(() => '{"error":{"message":"Upstream error."}}')
      if (shouldFailover(upstream.status) && i < conns.length - 1) continue
      // Non-retryable (a malformed request, say) — surface it verbatim so the
      // caller sees the provider's own explanation.
      return new Response(lastText, {
        status: upstream.status,
        headers: { 'content-type': 'application/json', ...CORS, ...headers, 'x-fanout-attempts': String(i + 1) },
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
          ...CORS,
          ...headers,
          ...served,
        },
      })
    }

    const json = await upstream.json()
    return new Response(JSON.stringify(adapter.translateResponse(json, body.model)), {
      headers: { 'content-type': 'application/json', ...CORS, ...headers, ...served },
    })
  }

  return new Response(lastText, {
    status: lastStatus,
    headers: { 'content-type': 'application/json', ...CORS, ...headers, 'x-fanout-attempts': String(conns.length) },
  })
}
