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
    await post('/api/work/complete', { id: job.id, text: `SUPPORTER_REPLY: ${last}` }, auth)
  }
}

// --- run it ------------------------------------------------------------------

console.log('\ne2e — mint a key over HTTP')
const mint = await (await post('/api/keys/issue', {}, { 'x-forwarded-for': '10.0.0.2' })).json()
t('minting returns a fo_live_ key', typeof mint.key === 'string' && mint.key.startsWith('fo_live_'))
const KEY = mint.key
const clientAuth = { authorization: `Bearer ${KEY}`, 'x-forwarded-for': '10.0.0.2' }

// A single supporter key drives the worker (it is just a user who polls).
const supKey = (await (await post('/api/keys/issue', {}, { 'x-forwarded-for': '10.0.0.1' })).json()).key
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
t('served-by header names the relay', r1.headers.get('x-fanout-provider') === 'claude-code')

console.log('\ne2e — claude-code streaming')
const r2 = await post('/api/v1/chat/completions', {
  model: 'claude-code', stream: true, messages: [{ role: 'user', content: 'stream-please' }],
}, clientAuth)
const sse = await r2.text()
t('stream carries the supporter answer', sse.includes('SUPPORTER_REPLY: stream-please'))
t('stream ends with [DONE]', sse.trimEnd().endsWith('data: [DONE]'))

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
}, { ...clientAuth, 'x-fanout-connection': conn.connection })
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
