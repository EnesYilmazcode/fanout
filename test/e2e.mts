// End-to-end test over real HTTP.
//
// Boots the actual edge handlers on a local Node server, then drives them the
// way real clients do: mint a key, run a supporter worker loop that polls for
// jobs and answers them, and confirm a `claude-code` request comes back with
// that supporter's answer. Also exercises the bring-your-own-keys path against
// a fake provider so the proxy translation is covered over the wire too.
//
//   npx tsx test/e2e.mts
//
// Uses throwaway secrets and never touches a real provider.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'

process.env.MASTER_SECRET = 'e2e-secret-not-real'
process.env.MASTER_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64url')

const issue = (await import('../api/keys/issue.ts')).default
const connect = (await import('../api/connect.ts')).default
const chat = (await import('../api/v1/chat/completions.ts')).default
const workNext = (await import('../api/work/next.ts')).default
const workComplete = (await import('../api/work/complete.ts')).default
const workStatus = (await import('../api/work/status.ts')).default
const health = (await import('../api/health.ts')).default

type Handler = (req: Request) => Promise<Response> | Response
const routes: Record<string, Handler> = {
  'POST /api/keys/issue': issue,
  'POST /api/connect': connect,
  'POST /api/v1/chat/completions': chat,
  'POST /api/work/next': workNext,
  'POST /api/work/complete': workComplete,
  'GET /api/work/status': workStatus,
  'GET /api/health': health,
}

// Adapt Node's req/res to the Web Request/Response the handlers speak.
async function toRequest(req: IncomingMessage, base: string): Promise<Request> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = chunks.length ? Buffer.concat(chunks) : undefined
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  return new Request(base + req.url, { method: req.method, headers, body: body as any })
}

async function writeResponse(res: Response, out: ServerResponse) {
  out.statusCode = res.status
  res.headers.forEach((v, k) => out.setHeader(k, v))
  if (res.body) {
    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      out.write(Buffer.from(value))
    }
  }
  out.end()
}

const server = createServer(async (req, res) => {
  const base = `http://127.0.0.1:${port}`
  const url = new URL(base + req.url)
  const handler = routes[`${req.method} ${url.pathname}`]
  if (!handler) { res.statusCode = 404; res.end('no route'); return }
  try {
    const request = await toRequest(req, base)
    await writeResponse(await handler(request), res)
  } catch (e) {
    res.statusCode = 500
    res.end(String(e))
  }
})
await new Promise<void>((r) => server.listen(0, r))
const port = (server.address() as AddressInfo).port
const BASE = `http://127.0.0.1:${port}`

let failed = 0
const t = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

// --- a real supporter worker, exactly as the pasted brief describes ----------

let workerOn = true
// A real supporter runs `claude -p`, which takes tens of seconds on a real
// question. Tests set this to simulate one that outlasts the buffered window.
let answerDelayMs = 0
const served: string[] = []
async function supporter(key: string) {
  const auth = { authorization: `Bearer ${key}`, 'x-forwarded-for': '10.0.0.1' }
  while (workerOn) {
    let res: Response
    try {
      res = await fetch(BASE + '/api/work/next', { method: 'POST', headers: auth })
    } catch { break }
    if (res.status !== 200) continue // 204 (no work) or 429 (backoff) -> poll again
    const job = await res.json()
    const last = job.messages.at(-1)?.content ?? ''
    served.push(last)
    if (answerDelayMs) await new Promise((r) => setTimeout(r, answerDelayMs))
    await post('/api/work/complete', { id: job.id, text: `SUPPORTER_REPLY: ${last}` }, auth)
  }
}

// --- run it ------------------------------------------------------------------

console.log('\ne2e — mint a key over HTTP')
const mint = await (await post('/api/keys/issue', {}, { 'x-forwarded-for': '10.0.0.2' })).json()
t('minting returns a rb_live_ key', typeof mint.key === 'string' && mint.key.startsWith('rb_live_'))
const KEY = mint.key
const clientAuth = { authorization: `Bearer ${KEY}`, 'x-forwarded-for': '10.0.0.2' }

// A single supporter key drives the worker (it is just a user who polls). Mint
// it now, but start the worker AFTER the failure-mode block below — several of
// those cases (especially the 504) depend on there being no supporter online.
const supKey = (await (await post('/api/keys/issue', {}, { 'x-forwarded-for': '10.0.0.1' })).json()).key

// --- failure modes over real HTTP --------------------------------------------
// Run while nothing is polling the relay. (a) needs an empty relay so the wait
// window actually elapses; it is the one deliberately-slow case (~20s), kept
// single and up front so the whole file still finishes under the Edge budget.
// The others are immediate — they reject before any upstream fetch.

console.log('\ne2e — failure (a): claude-code with no supporter online -> clean 504')
{
  const r = await post('/api/v1/chat/completions', {
    model: 'claude-code', messages: [{ role: 'user', content: 'anyone-home' }],
  }, clientAuth)
  const j = await r.json()
  t('no-supporter relay returns 504', r.status === 504, `status=${r.status}`)
  t('504 carries an OpenAI-shaped error envelope', j.error?.type === 'api_error' && typeof j.error?.message === 'string')
  t('504 body is JSON, not a platform HTML page', (r.headers.get('content-type') ?? '').includes('application/json'))
  // With nothing polling, the message must say so. The other branch (a supporter
  // is here but slow) is asserted further down, and giving the wrong one is how
  // a caller gets told to retry into a supporter who is already answering.
  t('the 504 names the real reason: nobody is online', /no supporter is online/i.test(j.error?.message ?? ''), j.error?.message)
  // This caller has now given up. Its job must leave with it, or the supporter
  // started further down would spend real model time answering nobody. That is
  // asserted after the worker has been running: see "abandoned job" below.
}

console.log('\ne2e — failure (b): oversized proxy body -> 400')
{
  const pad = 'x'.repeat(300 * 1024) // past MAX_BODY_BYTES (256KB); caught before any parse
  const r = await post('/api/v1/chat/completions', {
    model: 'anthropic/claude-opus-5', messages: [{ role: 'user', content: 'hi' }], pad,
  }, clientAuth)
  const j = await r.json()
  t('oversized body is rejected with 400', r.status === 400, `status=${r.status}`)
  t('oversized rejection is a clean JSON envelope', j.error?.type === 'invalid_request_error' && /too large/i.test(j.error?.message ?? ''))
}

console.log('\ne2e — failure (c): a blob sealed under one key is rejected 403 for another')
{
  const sealed = await (await post('/api/connect', { provider: 'anthropic', apiKey: 'sk-ant-victim99', label: 'victim' }, clientAuth)).json()
  t('the victim blob seals for its owner', typeof sealed.connection === 'string' && sealed.connection.startsWith('fc_'))
  // A different Relaybee key presents the same blob. The AAD owner-binding makes it
  // undecryptable for anyone but the sealer, so the pool opens to nothing -> 403.
  const otherAuth = { authorization: `Bearer ${supKey}`, 'x-forwarded-for': '10.9.9.9' }
  const r = await post('/api/v1/chat/completions', {
    model: 'anthropic/claude-opus-5', messages: [{ role: 'user', content: 'not mine' }],
  }, { ...otherAuth, 'x-relaybee-connection': sealed.connection })
  const j = await r.json()
  t('cross-key blob use is rejected with 403', r.status === 403, `status=${r.status}`)
  t('403 is a permission_error envelope', j.error?.type === 'permission_error')
}

console.log('\ne2e — failure (d): provider model with no X-Relaybee-Connection -> clear 4xx')
{
  const r = await post('/api/v1/chat/completions', {
    model: 'anthropic/claude-opus-5', messages: [{ role: 'user', content: 'hi' }],
  }, clientAuth)
  const j = await r.json()
  t('missing connection is a clear 4xx', r.status === 400, `status=${r.status}`)
  t('the message tells the caller to send X-Relaybee-Connection', /x-relaybee-connection/i.test(j.error?.message ?? ''))
}

// --- now bring a supporter online and run the happy path ---------------------
const workerTask = supporter(supKey)
await new Promise((r) => setTimeout(r, 300)) // let the worker start polling

console.log('\ne2e — health sees the supporter online')
const h = await (await fetch(BASE + '/api/health')).json()
t('health reports memory queue', h.queue === 'memory', h.queue)
t('health counts the live supporter', h.supporters_online >= 1, `online=${h.supporters_online}`)

console.log('\ne2e — claude-code request is answered by the worker (non-streaming)')
const r1 = await post('/api/v1/chat/completions', {
  model: 'claude-code', messages: [{ role: 'user', content: 'relay-please' }],
}, clientAuth)
const j1 = await r1.json()
t('relay request succeeds', r1.status === 200, `status=${r1.status}`)
t('answer comes from the supporter', j1.choices?.[0]?.message?.content === 'SUPPORTER_REPLY: relay-please', JSON.stringify(j1.choices?.[0] ?? j1))
t('response is OpenAI-shaped', j1.object === 'chat.completion' && j1.choices[0].finish_reason === 'stop')
t('served-by header names the relay', r1.headers.get('x-relaybee-provider') === 'claude-code')

console.log('\ne2e — claude-code streaming')
const r2 = await post('/api/v1/chat/completions', {
  model: 'claude-code', stream: true, messages: [{ role: 'user', content: 'stream-please' }],
}, clientAuth)
const sse = await r2.text()
t('stream carries the supporter answer', sse.includes('SUPPORTER_REPLY: stream-please'))
t('stream ends with [DONE]', sse.trimEnd().endsWith('data: [DONE]'))

// The case that sent this whole change: against production, a real `claude -p`
// answering a real question took 23.3s and the caller was cut off at 20s, so the
// supporter spent the tokens and nobody got the answer. Streaming has to survive
// a supporter slower than the buffered window, or the relay only works for toys.
console.log('\ne2e — a supporter slower than the buffered window still lands (streaming)')
answerDelayMs = 22_000
const slowStart = Date.now()
const r4 = await post('/api/v1/chat/completions', {
  model: 'claude-code', stream: true, messages: [{ role: 'user', content: 'slow-please' }],
}, clientAuth)
const sse4 = await r4.text()
const slowTook = Date.now() - slowStart
answerDelayMs = 0
t('a 22s answer still reaches the caller', sse4.includes('SUPPORTER_REPLY: slow-please'), `${slowTook}ms`)
t('it outlasted the buffered window instead of 504ing', slowTook > 20_000, `${slowTook}ms`)
t('the stream opened immediately rather than buffering', sse4.startsWith('data: '))
t('keepalives held the connection while the supporter worked', sse4.includes(': waiting for a supporter'))
t('the slow stream still terminates with [DONE]', sse4.trimEnd().endsWith('data: [DONE]'))

console.log('\ne2e — the abandoned job from failure (a) was never handed to the supporter')
t('a caller that gave up did not leave work behind', !served.some((s) => s.includes('anyone-home')), JSON.stringify(served))

console.log('\ne2e — bring-your-own-keys path against a fake provider')
// Intercept only the provider endpoint; everything else uses real fetch.
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const u = typeof input === 'string' ? input : input.url
  if (u.includes('anthropic.com')) {
    return new Response(JSON.stringify({
      id: 'msg_fake', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'FAKE_ANTHROPIC_OK' }],
      stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 5 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}) as typeof fetch

const conn = await (await post('/api/connect', { provider: 'anthropic', apiKey: 'sk-ant-fake12345', label: 'byo' }, clientAuth)).json()
t('provider key seals into a blob', typeof conn.connection === 'string' && conn.connection.startsWith('fc_'))
const r3 = await post('/api/v1/chat/completions', {
  model: 'anthropic/claude-opus-5', messages: [{ role: 'user', content: 'hi' }],
}, { ...clientAuth, 'x-relaybee-connection': conn.connection })
const j3 = await r3.json()
globalThis.fetch = realFetch
t('byo request succeeds', r3.status === 200, `status=${r3.status}`)
t('provider answer is translated to OpenAI shape', j3.choices?.[0]?.message?.content === 'FAKE_ANTHROPIC_OK', JSON.stringify(j3.choices?.[0] ?? j3))
t('usage is mapped', j3.usage?.total_tokens === 8)

// --- teardown ----------------------------------------------------------------

workerOn = false
await Promise.race([workerTask, new Promise((r) => setTimeout(r, 100))])
server.close()

console.log(failed === 0 ? '\ne2e: all checks passed\n' : `\ne2e: ${failed} check(s) failed\n`)
process.exit(failed === 0 ? 0 : 1)
