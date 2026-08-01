// Shared gateway logic behind the /api/v1 routes.
//
// This lives in lib/ rather than in a catch-all route because Vercel's
// zero-config api/ directory only matches ONE path segment for [...param] —
// /api/v1/models resolved, /api/v1/chat/completions 404'd. Explicit route files
// import from here, so the logic stays in one place and the routing is boring.

import { verifyKey, bearer } from './auth'
import { open, type Connection } from './seal'
import { route, ADAPTERS, type ChatRequest } from './providers'
import { check, LIMITS, clientIp, IP_PROXY_LIMIT, rlHeaders } from './ratelimit'
import { submitJob, awaitResult, cancelJob, countLive, type Job } from './queue'
import { hasSecrets, NOT_CONFIGURED } from './config'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-fanout-connection',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers':
    'x-fanout-provider, x-fanout-connection-label, x-fanout-attempt, x-fanout-attempts, ' +
    'x-fanout-pool-size, x-fanout-pool-health, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset',
}

const preflight = () => new Response(null, { status: 204, headers: CORS })

function err(status: number, message: string, type = 'invalid_request_error', extra: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...extra },
  })
}

/** Verifies the key and meters the request. Returns a Response only on rejection. */
async function gate(req: Request) {
  // Verifying the key needs MASTER_SECRET. Without it verifyKey would treat every
  // key as invalid and return a misleading 401; a 503 tells the truth.
  if (!hasSecrets('MASTER_SECRET')) return { fail: err(503, NOT_CONFIGURED, 'api_error') }

  const auth = await verifyKey(bearer(req))
  if (!auth) {
    return { fail: err(401, 'Missing or invalid Fanout API key. Get one from /api/keys/issue.', 'authentication_error') }
  }
  const rl = check(auth.u, LIMITS[auth.t] ?? LIMITS.free)
  const headers = rlHeaders(rl)
  if (!rl.ok) return { fail: err(429, 'Rate limit exceeded.', 'rate_limit_error', headers) }

  // Second dimension, on the source IP. Without it the per-user limit above is
  // decorative: minting a new key is free and unauthenticated, so a caller can
  // rotate into a fresh bucket whenever they hit one.
  const ip = check(`ip:${clientIp(req)}`, IP_PROXY_LIMIT)
  if (!ip.ok) return { fail: err(429, 'Rate limit exceeded for this source.', 'rate_limit_error', headers) }

  return { auth, headers }
}

/** Provider statuses worth retrying on a different credential. */
function shouldFailover(status: number) {
  return status === 401 || status === 403 || status === 429 || status >= 500
}

// Failover walks the pool serially, so pool size is a direct multiplier on both
// outbound requests and function time. Uncapped, a caller could send ~140 blobs
// in one header (bounded only incidentally by Vercel's 32KB header limit) and
// turn a single request into 140 upstream calls and ~20s of execution.
// Eight is well past any legitimate pool and bounds the blast radius.
export const MAX_POOL = 8

export async function listModels(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  const g = await gate(req)
  if (g.fail) return g.fail
  return new Response(
    JSON.stringify({
      object: 'list',
      data: [...Object.keys(ADAPTERS), RELAY_PROVIDER].map((id) => ({ id, object: 'provider' })),
    }),
    { headers: { 'content-type': 'application/json', ...CORS, ...g.headers } },
  )
}

// --- the supporter relay --------------------------------------------------

// "claude-code/<anything>" routes to the supporter queue instead of a provider:
// the request needs no connection blobs, because supporters' machines are the
// capacity. Non-streaming in substance; stream:true gets the finished answer as
// a single SSE chunk so OpenAI clients that always stream still work.
const RELAY_PROVIDER = 'claude-code'
// The buffered path emits nothing until the answer is complete, so it is bounded
// by Vercel Edge's ~25s initial-response deadline. Exceed that and a timeout
// surfaces as platform 504 HTML instead of our clean JSON, so we give up first.
const RELAY_WAIT_MS = 20_000
// The streaming path is not bounded the same way. Edge requires a response to
// BEGIN within 25s but then allows streaming for minutes, so once the first
// chunk is out we can wait for an answer a supporter is actually still writing.
// Measured against production: a real headless `claude -p` on a real question
// takes 20 to 30 seconds, which the buffered window can never fit.
const RELAY_STREAM_WAIT_MS = 110_000
// One wait slice, and one keepalive comment per slice. Kept at the queue's own
// blocking cap so each slice is a single Redis command.
const RELAY_SLICE_MS = 15_000
const MAX_JOB_BYTES = 32 * 1024

// Upper bound on the raw request body, enforced before any parse or upstream
// fetch. The proxy re-serialises the body and ships it to a provider, so an
// oversized payload is both an amplification vector and a way to burn function
// time on JSON.parse. 256KB is far past any legitimate chat request (the relay
// caps its own message payload at 32KB) and rejects the rest cleanly.
export const MAX_BODY_BYTES = 256 * 1024

/** OpenAI content can be a string or an array of typed parts; jobs carry plain text. */
function flatten(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('')
  }
  return ''
}

async function relayCompletion(body: ChatRequest, headers: Record<string, string>): Promise<Response> {
  // Message elements are unknown-typed from the wire; a null or non-object entry
  // would throw on property access, so coerce defensively rather than trust them.
  const messages: Job['messages'] = body.messages.map((m) => ({
    role: String((m as { role?: unknown })?.role ?? 'user'),
    content: flatten((m as { content?: unknown })?.content),
  }))
  if (!messages.some((m) => m.content.trim() !== '')) {
    return err(400, 'No text content to relay. The claude-code model needs at least one message with text.', 'invalid_request_error', headers)
  }
  const payload = JSON.stringify(messages)
  if (payload.length > MAX_JOB_BYTES) {
    return err(400, `Request too large for the relay: cap is ${MAX_JOB_BYTES / 1024}KB of messages.`, 'invalid_request_error', headers)
  }

  let job: Job
  try {
    job = await submitJob(body.model, messages)
  } catch {
    // A queue-backend hiccup (e.g. transient Upstash 5xx) must not escape as a
    // bare platform 500 with no CORS or error envelope.
    return err(502, 'The relay queue is temporarily unavailable. Try again shortly.', 'api_error', headers)
  }

  const created = Math.floor(Date.now() / 1000)
  const relayHeaders = { ...headers, 'x-fanout-provider': RELAY_PROVIDER }

  if (body.stream) return relayStream(job, body, created, relayHeaders)

  let text: string | null
  try {
    text = await awaitResult(job.id, RELAY_WAIT_MS)
  } catch {
    return err(502, 'The relay queue is temporarily unavailable. Try again shortly.', 'api_error', headers)
  }
  if (text === null) {
    // Nobody is waiting for this any more. Leaving it queued means the next
    // supporter to connect spends real model time on an answer no one reads.
    await cancelJob(job).catch(() => {})
    return err(504, await timedOutMessage(), 'api_error', headers)
  }

  return new Response(
    JSON.stringify({
      id: `chatcmpl-${job.id}`, object: 'chat.completion', created, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
    { headers: { 'content-type': 'application/json', ...CORS, ...relayHeaders } },
  )
}

/**
 * Why the wait ended with nothing. "Nobody is here" and "someone is here and
 * still writing" are different problems with opposite advice, and telling a
 * caller to retry while a supporter is mid answer just queues the same prompt
 * twice and spends their tokens twice.
 */
async function timedOutMessage(known?: boolean): Promise<string> {
  let online = known
  if (online === undefined) {
    try { online = (await countLive()) > 0 } catch { online = false }
  }
  return online
    ? `A supporter took this and did not finish inside ${RELAY_WAIT_MS / 1000}s. Send "stream": true and Fanout holds the connection open while they work, which is what long answers need.`
    : 'No supporter is online right now. The relay only answers while someone is running a supporter node, so try again later, or run one yourself.'
}

/**
 * Streaming relay. The first chunk goes out immediately, which is what buys the
 * long wait: Edge only requires that a response START within 25s. After that we
 * wait in slices, sending an SSE comment between them so nothing along the path
 * decides the connection is idle.
 */
function relayStream(job: Job, body: ChatRequest, created: number, relayHeaders: Record<string, string>): Response {
  const encoder = new TextEncoder()
  const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`
  const chunk = (delta: unknown, finish: string | null) => ({
    id: `chatcmpl-${job.id}`, object: 'chat.completion.chunk', created, model: body.model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })

  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s))
      send(frame(chunk({ role: 'assistant' }, null)))

      const deadline = Date.now() + RELAY_STREAM_WAIT_MS
      let text: string | null = null
      let online: boolean | undefined
      let checked = false

      while (Date.now() < deadline) {
        const slice = Math.min(RELAY_SLICE_MS, deadline - Date.now())
        try {
          text = await awaitResult(job.id, slice)
        } catch {
          break
        }
        if (text !== null) break
        // One presence check, after the first empty slice. If nothing is polling
        // the queue then no answer is coming, and holding the caller for the
        // full window would be a worse experience than the old 20s cap.
        if (!checked) {
          checked = true
          try { online = (await countLive()) > 0 } catch { online = false }
          if (!online) break
        }
        send(': waiting for a supporter\n\n')
      }

      if (text === null) {
        await cancelJob(job).catch(() => {})
        send(frame({ error: { message: await timedOutMessage(online), type: 'api_error' } }))
      } else {
        send(frame(chunk({ content: text }, null)))
        send(frame(chunk({}, 'stop')))
      }
      send('data: [DONE]\n\n')
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', ...CORS, ...relayHeaders },
  })
}

export async function chatCompletions(req: Request): Promise<Response> {
  try {
    return await chatCompletionsInner(req)
  } catch {
    // Last line of defence: anything unforeseen becomes a clean OpenAI-shaped
    // 500 with CORS, never a bare platform error page.
    return err(500, 'Internal error handling the request.', 'api_error')
  }
}

async function chatCompletionsInner(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return err(405, 'Use POST for /api/v1/chat/completions')

  const g = await gate(req)
  if (g.fail) return g.fail
  const { auth, headers } = g

  // Read the body once as text so we can bound its size before parsing or
  // touching any upstream. An oversized payload is rejected here — before the
  // relay submit or any provider fetch — so it can never be amplified outward.
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return err(400, 'Could not read the request body.', 'invalid_request_error', headers)
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return err(400, `Request body too large: cap is ${MAX_BODY_BYTES / 1024}KB.`, 'invalid_request_error', headers)
  }

  let body: ChatRequest
  try {
    body = JSON.parse(rawBody) as ChatRequest
  } catch {
    return err(400, 'Request body must be valid JSON.', 'invalid_request_error', headers)
  }
  if (!body?.model) {
    return err(400, 'Field "model" is required, e.g. "anthropic/claude-opus-5".', 'invalid_request_error', headers)
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return err(400, 'Field "messages" must be a non-empty array.', 'invalid_request_error', headers)
  }

  if (body.model === RELAY_PROVIDER || body.model.startsWith(`${RELAY_PROVIDER}/`)) {
    return relayCompletion(body, headers)
  }

  const routed = route(body.model)
  if (!routed) {
    return err(400, `Unknown model "${body.model}". Use "<provider>/<model>", one of: ${Object.keys(ADAPTERS).join(', ')}, ${RELAY_PROVIDER}.`, 'invalid_request_error', headers)
  }
  const { adapter, model } = routed

  // Opening the sealed connection blobs needs MASTER_ENCRYPTION_KEY. The relay
  // path above needs no blobs, so this only guards the provider-routed path.
  if (!hasSecrets('MASTER_ENCRYPTION_KEY')) return err(503, NOT_CONFIGURED, 'api_error', headers)

  // Connections are client-held sealed blobs. Sending several is the point:
  // fanout rotates across them and fails over when one is rate-limited or dead.
  const raw = (req.headers.get('x-fanout-connection') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (raw.length === 0) {
    return err(400, 'Missing X-Fanout-Connection header. Create one at POST /api/connect.', 'invalid_request_error', headers)
  }
  if (raw.length > MAX_POOL) {
    return err(400, `Too many connections: ${raw.length}. At most ${MAX_POOL} may be pooled in one request.`, 'invalid_request_error', headers)
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

  // Per-attempt outcomes, in the order tried: "label:ok", "label:429",
  // "label:unreachable". Callers debugging a half-dead pool need to see which
  // connections failed, not just which one finally answered.
  const health: string[] = []
  const poolHealth = () => ({ 'x-fanout-pool-health': health.join(', ') })

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
      health.push(`${conn.label ?? 'unnamed'}:unreachable`)
      continue
    }

    if (!upstream.ok) {
      lastStatus = upstream.status
      lastText = await upstream.text().catch(() => '{"error":{"message":"Upstream error."}}')
      health.push(`${conn.label ?? 'unnamed'}:${upstream.status}`)
      if (shouldFailover(upstream.status) && i < conns.length - 1) continue
      // Non-retryable (a malformed request, say) — surface it verbatim so the
      // caller sees the provider's own explanation.
      return new Response(lastText, {
        status: upstream.status,
        headers: { 'content-type': 'application/json', ...CORS, ...headers, 'x-fanout-attempts': String(i + 1), ...poolHealth() },
      })
    }

    health.push(`${conn.label ?? 'unnamed'}:ok`)
    const served = {
      'x-fanout-provider': adapter.id,
      'x-fanout-connection-label': conn.label ?? 'unnamed',
      'x-fanout-attempt': String(i + 1),
      'x-fanout-pool-size': String(conns.length),
      ...poolHealth(),
    }

    if (body.stream && upstream.body) {
      // OpenAI convention: emit a trailing usage chunk only when the caller
      // opted in via stream_options.include_usage.
      const includeUsage = (body.stream_options as { include_usage?: unknown } | undefined)?.include_usage === true
      return new Response(adapter.translateStream(upstream.body, body.model, includeUsage), {
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
    headers: { 'content-type': 'application/json', ...CORS, ...headers, 'x-fanout-attempts': String(conns.length), ...poolHealth() },
  })
}
