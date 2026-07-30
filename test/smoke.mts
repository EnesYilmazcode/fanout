// Runtime checks for the parts that would fail silently: credential isolation,
// tamper rejection, and SSE reassembly across chunk boundaries.
//
//   npm test
//
// Uses throwaway secrets. Nothing here touches a real provider — see PROJECT.md
// for the end-to-end test that still needs doing.

process.env.MASTER_SECRET = 'test-secret-not-used-anywhere-real'
process.env.MASTER_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64url')

const { issueKey, verifyKey } = await import('../lib/auth.ts')
const { seal, open } = await import('../lib/seal.ts')
const { route, ADAPTERS } = await import('../lib/providers.ts')
const { check } = await import('../lib/ratelimit.ts')

let failed = 0
const t = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

console.log('\nauth — keys verify without a datastore')
const key = await issueKey('enes_abc123', 'free')
t('issued key carries the fo_live_ prefix', key.startsWith('fo_live_'))
const payload = await verifyKey(key)
t('a valid key round-trips its payload', payload?.u === 'enes_abc123' && payload?.t === 'free')
t('a tampered signature is rejected', (await verifyKey(key.slice(0, -3) + 'xxx')) === null)
t('a forged key is rejected', (await verifyKey('fo_live_nope.nope')) === null)
t('a missing key is rejected', (await verifyKey(null)) === null)

console.log('\nseal — credentials are bound to their owner')
const conn = { provider: 'anthropic', apiKey: 'sk-ant-secret', owner: 'enes_abc123', createdAt: Date.now(), label: 'mine' }
const blob = await seal(conn)
t('sealed blob carries the fc_ prefix', blob.startsWith('fc_'))
t('the owner can open their own blob', (await open(blob, 'enes_abc123'))?.apiKey === 'sk-ant-secret')
t('another user CANNOT open the blob', (await open(blob, 'mallory_999')) === null)
t('a tampered blob is rejected', (await open(blob.slice(0, -4) + 'AAAA', 'enes_abc123')) === null)

console.log('\nrouting — provider prefixes')
t('routes anthropic/<model>', route('anthropic/claude-opus-5')?.model === 'claude-opus-5')
t('routes groq/<model>', route('groq/llama-3.3-70b-versatile')?.adapter.id === 'groq')
t('rejects an unprefixed model', route('claude-opus-5') === null)
t('rejects an unknown provider', route('cohere/command') === null)

console.log('\nanthropic adapter — request and response translation')
const areq = ADAPTERS.anthropic.translateRequest(
  { model: 'x', messages: [{ role: 'system', content: 'be terse' }, { role: 'user', content: 'hi' }] },
  'claude-opus-5',
) as any
t('system message hoists out of the array', areq.system === 'be terse' && areq.messages.length === 1)
t('max_tokens is defaulted (anthropic requires it)', areq.max_tokens === 4096)

const ares = ADAPTERS.anthropic.translateResponse(
  { id: 'msg_1', content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } },
  'anthropic/claude-opus-5',
) as any
t('response becomes an OpenAI completion', ares.choices[0].message.content === 'hello' && ares.object === 'chat.completion')
t('usage counts are mapped', ares.usage.total_tokens === 7)

console.log('\nanthropic adapter — streaming')
// The third frame is deliberately split mid-JSON: a parser that assumes one
// network chunk equals one SSE event drops tokens here.
const raw = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_9"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_bl',
  'ock_delta","delta":{"type":"text_delta","text":"lo!"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
]
const upstream = new ReadableStream<Uint8Array>({
  start(c) { for (const s of raw) c.enqueue(new TextEncoder().encode(s)); c.close() },
})
let out = ''
for await (const chunk of ADAPTERS.anthropic.translateStream(upstream, 'anthropic/claude-opus-5') as any) {
  out += new TextDecoder().decode(chunk)
}
const text = out.split('\n\n')
  .filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'))
  .map((l) => JSON.parse(l.slice(6)).choices[0].delta.content ?? '')
  .join('')
t('deltas reassemble across a split chunk', text === 'Hello!', JSON.stringify(text))
t('stream terminates with [DONE]', out.trimEnd().endsWith('data: [DONE]'))
t('stream reports a finish_reason', out.includes('"finish_reason":"stop"'))
t('default stream carries no usage chunk', !out.includes('"usage"'))

// stream_options.include_usage: capture message_delta.usage and emit a final
// OpenAI-shaped usage chunk (empty choices) right before [DONE].
const usageRaw = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_u","usage":{"input_tokens":11,"output_tokens":0}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
]
const usageUpstream = new ReadableStream<Uint8Array>({
  start(c) { for (const s of usageRaw) c.enqueue(new TextEncoder().encode(s)); c.close() },
})
let usageOut = ''
for await (const chunk of ADAPTERS.anthropic.translateStream(usageUpstream, 'anthropic/claude-opus-5', true) as any) {
  usageOut += new TextDecoder().decode(chunk)
}
const usageFrames = usageOut.split('\n\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]')).map((l) => JSON.parse(l.slice(6)))
const usageChunk = usageFrames.find((c) => c.usage)
t('opt-in stream emits a usage chunk before [DONE]', !!usageChunk && Array.isArray(usageChunk.choices) && usageChunk.choices.length === 0, JSON.stringify(usageChunk))
t('usage chunk maps anthropic token counts', usageChunk?.usage.prompt_tokens === 11 && usageChunk?.usage.completion_tokens === 4 && usageChunk?.usage.total_tokens === 15, JSON.stringify(usageChunk?.usage))
t('usage chunk is the last frame before [DONE]', usageOut.trimEnd().endsWith('data: [DONE]') && JSON.stringify(usageFrames.at(-1)) === JSON.stringify(usageChunk))

console.log('\nratelimit')
for (let i = 0; i < 20; i++) check('user_a', 20)
t('requests under the limit pass', check('user_b', 3).ok)
t('requests over the limit are blocked', !check('user_a', 20).ok)

console.log('\nabuse limits — regressions from the security review')
const { MAX_POOL } = await import('../lib/gateway.ts')
const { clientIp, IP_ISSUE_LIMIT, IP_PROXY_LIMIT } = await import('../lib/ratelimit.ts')

// Failover walks the pool serially, so pool size multiplies both upstream calls
// and function time. Uncapped this reached ~140 upstream requests per client call.
t('pool size is capped', typeof MAX_POOL === 'number' && MAX_POOL > 0 && MAX_POOL <= 16, `MAX_POOL=${MAX_POOL}`)
t('an IP ceiling exists for key minting', IP_ISSUE_LIMIT > 0 && IP_ISSUE_LIMIT <= 20)
t('an IP ceiling exists for the proxy', IP_PROXY_LIMIT > 0)

const ipReq = (h: Record<string, string>) => new Request('https://x/', { headers: h })
t('clientIp reads x-forwarded-for', clientIp(ipReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })) === '1.2.3.4')
t('clientIp falls back to x-real-ip', clientIp(ipReq({ 'x-real-ip': '9.9.9.9' })) === '9.9.9.9')
t('clientIp degrades safely', clientIp(ipReq({})) === 'unknown')

// The label is echoed into a response header, so control characters would be a
// header-injection vector.
const dirty = 'ok\r\nX-Injected: yes'
const cleaned = dirty.replace(/[^\x20-\x7E]/g, '').slice(0, 40)
t('control characters strip out of a label', !/[\r\n]/.test(cleaned), JSON.stringify(cleaned))

console.log('\npool health — failover surfaces per-connection outcomes')
const { chatCompletions } = await import('../lib/gateway.ts')
const healthKey = await issueKey('health_user', 'free')
const connA = await seal({ provider: 'anthropic', apiKey: 'sk-ant-aaaaaaaa', owner: 'health_user', createdAt: Date.now(), label: 'first' })
const connB = await seal({ provider: 'anthropic', apiKey: 'sk-ant-bbbbbbbb', owner: 'health_user', createdAt: Date.now(), label: 'second' })

// Whichever connection the random start offset picks first gets a 429; the
// retry succeeds. The health header must show both outcomes in walk order.
const realFetch = globalThis.fetch
let upstreamCalls = 0
globalThis.fetch = (async () => {
  upstreamCalls++
  if (upstreamCalls === 1) return new Response('{"error":{"message":"overloaded"}}', { status: 429 })
  return new Response(
    JSON.stringify({ id: 'msg_h', content: [{ type: 'text', text: 'pong' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}) as typeof fetch

const healthRes = await chatCompletions(new Request('https://x/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${healthKey}`,
    'x-fanout-connection': `${connA},${connB}`,
  },
  body: JSON.stringify({ model: 'anthropic/claude-opus-5', messages: [{ role: 'user', content: 'ping' }] }),
}))
globalThis.fetch = realFetch

const ph = healthRes.headers.get('x-fanout-pool-health') ?? ''
t('request succeeds after failover', healthRes.status === 200, `status=${healthRes.status}`)
t('pool health lists the failed connection', ph.includes(':429'), ph)
t('pool health lists the winner last', ph.endsWith(':ok'), ph)
t('attempt count matches the walk', healthRes.headers.get('x-fanout-attempt') === '2')
t('pool health is exposed to browsers', (healthRes.headers.get('access-control-expose-headers') ?? '').includes('x-fanout-pool-health'))

console.log('\nsupporter relay — claude-code jobs round-trip through the queue')
const workNext = (await import('../api/work/next.ts')).default
const workComplete = (await import('../api/work/complete.ts')).default
const userKey = await issueKey('relay_user', 'free')
const supporterKey = await issueKey('supporter_1', 'free')

const relayReq = (body: unknown) => new Request('https://x/api/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${userKey}` },
  body: JSON.stringify(body),
})

// A supporter cycle, exactly as the pasted worker brief describes it: poll,
// answer the last message, deliver. Runs concurrently with the user's request.
const supporterCycle = async () => {
  const polled = await workNext(new Request('https://x/api/work/next', {
    method: 'POST', headers: { authorization: `Bearer ${supporterKey}` },
  }))
  if (polled.status !== 200) return { polled: polled.status, job: null as any, delivered: 0 }
  const job = await polled.json()
  const delivered = await workComplete(new Request('https://x/api/work/complete', {
    method: 'POST',
    headers: { authorization: `Bearer ${supporterKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: job.id, text: `echo:${job.messages.at(-1).content}` }),
  }))
  return { polled: polled.status, job, delivered: delivered.status }
}

t('polling without a key is rejected', (await workNext(new Request('https://x/', { method: 'POST' }))).status === 401)

// Malformed relay inputs must fail cleanly (400), never throw a bare 500.
const nullMsg = await chatCompletions(relayReq({ model: 'claude-code', messages: [null] }))
t('a null message element is a clean 400', nullMsg.status === 400 && nullMsg.headers.get('access-control-allow-origin') === '*')
const imgOnly = await chatCompletions(relayReq({ model: 'claude-code', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:x' } }] }] }))
const imgJson = await imgOnly.json()
t('a text-less prompt is rejected, not blank-relayed', imgOnly.status === 400 && /no text content/i.test(imgJson.error.message))

const cycle = supporterCycle()
const relayRes = await chatCompletions(relayReq({ model: 'claude-code', messages: [{ role: 'user', content: 'ping-relay' }] }))
const side = await cycle
const relayJson = await relayRes.json()

t('supporter received a job', side.polled === 200 && side.job?.id?.length === 36)
t('job carries no requester identity', !JSON.stringify(side.job).includes('relay_user'))
t('delivery is accepted', side.delivered === 200)
t('user gets the supporter answer', relayRes.status === 200 && relayJson.choices?.[0]?.message?.content === 'echo:ping-relay', JSON.stringify(relayJson.choices?.[0] ?? relayJson))
t('relay response is OpenAI-shaped', relayJson.object === 'chat.completion' && relayJson.choices[0].finish_reason === 'stop')
t('provider header names the relay', relayRes.headers.get('x-fanout-provider') === 'claude-code')

const cycle2 = supporterCycle()
const streamRes = await chatCompletions(relayReq({ model: 'claude-code/default', stream: true, messages: [{ role: 'user', content: 'ping-sse' }] }))
await cycle2
const sseText = await streamRes.text()
t('stream:true yields SSE with the answer', sseText.includes('echo:ping-sse') && sseText.trimEnd().endsWith('data: [DONE]'))

console.log('\nsupporter presence — the site can tell when a node is live')
const workStatus = (await import('../api/work/status.ts')).default
const statusReq = (key: string) => new Request('https://x/api/work/status', { headers: { authorization: `Bearer ${key}` } })
const presenceUser = await issueKey('presence_user', 'free')

const before = await (await workStatus(statusReq(presenceUser))).json()
t('a node that never polled reads offline', before.connected === false)

// A poll marks the node live before it even returns work. Give it a job to pop
// so the long-poll returns immediately instead of holding the full window.
const { submitJob } = await import('../lib/queue.ts')
await submitJob('claude-code', [{ role: 'user', content: 'warm' }])
await workNext(new Request('https://x/api/work/next', { method: 'POST', headers: { authorization: `Bearer ${presenceUser}` } }))
const after = await (await workStatus(statusReq(presenceUser))).json()
t('polling marks the node connected', after.connected === true)

// Presence is scoped to the key — a different user never sees this node.
const otherKey = await issueKey('someone_else', 'free')
const other = await (await workStatus(statusReq(otherKey))).json()
t('presence does not leak across keys', other.connected === false)
t('status needs a key', (await workStatus(new Request('https://x/api/work/status'))).status === 401)

// Global count: presenceUser polled above, so at least one node is live and the
// count is visible to any key, including one whose own node is offline.
t('status reports a global online count', typeof other.online === 'number' && other.online >= 1)
const { countLive } = await import('../lib/queue.ts')
const baseline = await countLive()
await submitJob('claude-code', [{ role: 'user', content: 'warm2' }])
await workNext(new Request('https://x/api/work/next', { method: 'POST', headers: { authorization: `Bearer ${otherKey}` } }))
t('a second live node raises the count', (await countLive()) >= baseline + 1)

console.log('\nwork endpoints — consistent rate-limit headers and CORS exposure')
const rlKey = await issueKey('rl_headers_user', 'free')
const hasRl = (r: Response) =>
  r.headers.get('x-ratelimit-limit') !== null &&
  r.headers.get('x-ratelimit-remaining') !== null &&
  r.headers.get('x-ratelimit-reset') !== null
const exposesRl = (r: Response) => {
  const e = r.headers.get('access-control-expose-headers') ?? ''
  return e.includes('x-ratelimit-limit') && e.includes('x-ratelimit-remaining') && e.includes('x-ratelimit-reset')
}

// /api/work/status: a plain GET carries the limiter Verdict as headers, and the
// same headers are whitelisted for a cross-origin worker to read.
const statusHdrRes = await workStatus(statusReq(rlKey))
t('status returns rate-limit headers', hasRl(statusHdrRes))
t('status exposes rate-limit headers to browsers', exposesRl(statusHdrRes))
t('status rate-limit-reset is unix seconds', Number(statusHdrRes.headers.get('x-ratelimit-reset')) > 1_600_000_000)
t('status remaining decrements under limit', Number(statusHdrRes.headers.get('x-ratelimit-remaining')) < Number(statusHdrRes.headers.get('x-ratelimit-limit')))

// /api/work/complete: a 400 (bad job id) still carries the headers — the envelope
// is consistent across success and rejection, matching lib/gateway.ts.
const completeHdrRes = await workComplete(new Request('https://x/api/work/complete', {
  method: 'POST',
  headers: { authorization: `Bearer ${rlKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'not-a-uuid', text: 'x' }),
}))
t('complete rejection still carries rate-limit headers', completeHdrRes.status === 400 && hasRl(completeHdrRes))
t('complete exposes rate-limit headers to browsers', exposesRl(completeHdrRes))

// /api/work/next: queue a job first so the long-poll returns 200 immediately
// (an empty poll would hold the full window), then assert the headers ride along.
await submitJob('claude-code', [{ role: 'user', content: 'rl-header-warm' }])
const nextHdrRes = await workNext(new Request('https://x/api/work/next', {
  method: 'POST',
  headers: { authorization: `Bearer ${rlKey}`, 'x-forwarded-for': '203.0.113.7' },
}))
t('next poll returns rate-limit headers', nextHdrRes.status === 200 && hasRl(nextHdrRes))
t('next exposes rate-limit headers to browsers', exposesRl(nextHdrRes))

console.log('\nhealth — reports relay and queue state')
const health = (await import('../api/health.ts')).default
const healthBody = await (await health()).json()
t('health reports the queue backend', healthBody.queue === 'memory', healthBody.queue)
t('health reports supporters_online as a number', typeof healthBody.supporters_online === 'number')
t('health supporters_online matches countLive', healthBody.supporters_online === (await countLive()))
t('health reports the deployed commit', typeof healthBody.commit === 'string' && healthBody.commit.length > 0, healthBody.commit)
const healthPreflight = await health(new Request('https://x/api/health', { method: 'OPTIONS' }))
t('health OPTIONS preflight returns 204', healthPreflight.status === 204, `status=${healthPreflight.status}`)
t('health preflight sets CORS methods', (healthPreflight.headers.get('access-control-allow-methods') ?? '').includes('GET'))

console.log('\nerror handling — key and connect endpoints never leak a bare platform 500')
const issueHandler = (await import('../api/keys/issue.ts')).default
const connectHandler = (await import('../api/connect.ts')).default

// A request object that throws the moment the handler touches it forces the
// unforeseen-error path. The wrapper must still answer with a clean JSON
// envelope and the CORS headers, mirroring lib/gateway.ts chatCompletions.
const boom = () => new Proxy({}, { get() { throw new Error('forced') } }) as unknown as Request

const issueErr = await issueHandler(boom())
const issueErrJson = await issueErr.json()
t('issue: a forced error returns a clean 500', issueErr.status === 500)
t('issue: the error path keeps CORS', issueErr.headers.get('access-control-allow-origin') === '*')
t('issue: the error path carries a {message,type} envelope', typeof issueErrJson.error?.message === 'string' && typeof issueErrJson.error?.type === 'string')

const connectErr = await connectHandler(boom())
const connectErrJson = await connectErr.json()
t('connect: a forced error returns a clean 500', connectErr.status === 500)
t('connect: the error path keeps CORS', connectErr.headers.get('access-control-allow-origin') === '*')
t('connect: the error path carries a {message,type} envelope', typeof connectErrJson.error?.message === 'string' && typeof connectErrJson.error?.type === 'string')

console.log('\ndemo page — favicon, theme-color, and a11y polish')
const { readFileSync, existsSync } = await import('node:fs')
const demoHtml = readFileSync(new URL('../public/demo.html', import.meta.url), 'utf8')
t('demo references the shared /favicon.svg', demoHtml.includes('href="/favicon.svg"'))
t('demo theme-color matches the dark --bg', demoHtml.includes('name="theme-color" content="#0d0f12"'))
t('demo has a visible focus-visible ring', demoHtml.includes(':focus-visible'))
t('demo labels interactive controls for a11y', (demoHtml.match(/aria-label=/g) || []).length >= 5)

console.log('\nvercel.json — security and cache response headers')
const vercelCfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const allRoutes = (vercelCfg.headers ?? []).find((h: any) => h.source === '/(.*)')
const headerVal = (rule: any, key: string) =>
  (rule?.headers ?? []).find((x: any) => x.key.toLowerCase() === key.toLowerCase())?.value
t('vercel: all-routes rule exists', !!allRoutes)
t('vercel: X-Content-Type-Options nosniff', headerVal(allRoutes, 'X-Content-Type-Options') === 'nosniff')
t('vercel: Referrer-Policy no-referrer', headerVal(allRoutes, 'Referrer-Policy') === 'no-referrer')
t('vercel: X-Frame-Options DENY', headerVal(allRoutes, 'X-Frame-Options') === 'DENY')
t('vercel: Permissions-Policy disables camera/mic/geo',
  headerVal(allRoutes, 'Permissions-Policy') === 'camera=(), microphone=(), geolocation=()')
t('vercel: no CSP header (pages use per-page meta)',
  headerVal(allRoutes, 'Content-Security-Policy') === undefined)
const assetRule = (vercelCfg.headers ?? []).find((h: any) =>
  /app\.css/.test(h.source) && /app\.js/.test(h.source) && /favicon\.svg/.test(h.source))
t('vercel: static asset cache rule exists', !!assetRule)
t('vercel: static assets are immutable long-cache',
  /immutable/.test(headerVal(assetRule, 'Cache-Control') ?? '') &&
  /max-age=31536000/.test(headerVal(assetRule, 'Cache-Control') ?? ''))
console.log('\nopenai adapter — OpenAI-shaped passthrough with a re-stamped model')
// translateRequest spreads the caller's body and overwrites only the model
// (the prefix is stripped upstream), preserving every other field verbatim.
const oreq = ADAPTERS.openai.translateRequest(
  { model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'hi' }], temperature: 0.4, stream: true },
  'gpt-4o',
) as any
t('openai request re-stamps the model without the prefix', oreq.model === 'gpt-4o')
t('openai request preserves the caller body', oreq.temperature === 0.4 && oreq.stream === true && oreq.messages[0].content === 'hi')

// translateResponse likewise passes the provider JSON straight through, only
// overwriting model so the caller sees the prefixed name they asked for.
const ores = ADAPTERS.openai.translateResponse(
  { id: 'cmpl_1', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'yo' }, finish_reason: 'stop' }], usage: { total_tokens: 3 } },
  'openai/gpt-4o',
) as any
t('openai response is handed through unchanged but for the model', ores.model === 'openai/gpt-4o' && ores.id === 'cmpl_1' && ores.choices[0].message.content === 'yo' && ores.usage.total_tokens === 3)

// headers carry a Bearer token; endpoint is OpenAI's chat completions URL.
const ohdr = ADAPTERS.openai.headers('sk-openai-xyz')
t('openai headers use Bearer auth', ohdr.authorization === 'Bearer sk-openai-xyz' && ohdr['content-type'] === 'application/json')
t('openai endpoint is the chat completions URL', ADAPTERS.openai.endpoint === 'https://api.openai.com/v1/chat/completions')

// translateStream is a literal passthrough — already OpenAI-shaped, so the
// upstream ReadableStream is returned as-is (same reference, bytes untouched).
const oStreamRaw = 'data: {"choices":[{"delta":{"content":"passthrough"}}]}\n\ndata: [DONE]\n\n'
const oUpstream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(oStreamRaw)); c.close() } })
const oStreamOut = ADAPTERS.openai.translateStream(oUpstream, 'openai/gpt-4o')
t('openai stream is returned as the same object (no translation)', oStreamOut === oUpstream)
let oStreamText = ''
for await (const c of oStreamOut as any) oStreamText += new TextDecoder().decode(c)
t('openai stream bytes pass through untouched', oStreamText === oStreamRaw)

console.log('\ngroq adapter — reuses the OpenAI translators, only the endpoint differs')
t('groq is its own id but shares openai translators', ADAPTERS.groq.id === 'groq' && ADAPTERS.groq.translateRequest === ADAPTERS.openai.translateRequest && ADAPTERS.groq.translateResponse === ADAPTERS.openai.translateResponse)
t('groq endpoint points at Groq, not OpenAI', ADAPTERS.groq.endpoint === 'https://api.groq.com/openai/v1/chat/completions')
const greq = ADAPTERS.groq.translateRequest(
  { model: 'groq/llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'hey' }], top_p: 0.9 },
  'llama-3.3-70b-versatile',
) as any
t('groq request re-stamps the model and keeps the body', greq.model === 'llama-3.3-70b-versatile' && greq.top_p === 0.9)
const gres = ADAPTERS.groq.translateResponse({ id: 'gcmpl', object: 'chat.completion', choices: [] }, 'groq/llama-3.3-70b-versatile') as any
t('groq response re-stamps the model', gres.model === 'groq/llama-3.3-70b-versatile' && gres.id === 'gcmpl')
const gHdr = ADAPTERS.groq.headers('gsk-abc')
t('groq headers use Bearer auth', gHdr.authorization === 'Bearer gsk-abc')
const gUpstream = new ReadableStream<Uint8Array>({ start(c) { c.close() } })
t('groq stream is a passthrough too', ADAPTERS.groq.translateStream(gUpstream, 'groq/llama-3.3-70b-versatile') === gUpstream)
console.log('\nbody size cap — oversized proxy requests are rejected before any upstream call')
const { MAX_BODY_BYTES } = await import('../lib/gateway.ts')
const capKey = await issueKey('cap_user', 'free')
const capConn = await seal({ provider: 'anthropic', apiKey: 'sk-ant-cccccccc', owner: 'cap_user', createdAt: Date.now(), label: 'cap' })

// A body just over the cap must 400 before the pool is even opened. Guard the
// real fetch so a leak past the cap would be caught as an unexpected call.
const realFetchCap = globalThis.fetch
let capUpstreamCalls = 0
globalThis.fetch = (async () => { capUpstreamCalls++; return new Response('{}', { status: 200 }) }) as typeof fetch

const bigContent = 'x'.repeat(MAX_BODY_BYTES + 1024)
const oversizedRes = await chatCompletions(new Request('https://x/api/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${capKey}`, 'x-fanout-connection': capConn },
  body: JSON.stringify({ model: 'anthropic/claude-opus-5', messages: [{ role: 'user', content: bigContent }] }),
}))
const oversizedJson = await oversizedRes.json()
globalThis.fetch = realFetchCap

t('an oversized body returns 400', oversizedRes.status === 400, `status=${oversizedRes.status}`)
t('the oversized rejection made no upstream call', capUpstreamCalls === 0, `calls=${capUpstreamCalls}`)
t('the oversized rejection keeps CORS', oversizedRes.headers.get('access-control-allow-origin') === '*')
t('the oversized rejection carries a {message,type} envelope', typeof oversizedJson.error?.message === 'string' && /too large/i.test(oversizedJson.error.message))
t('the body cap is a sane 256KB', MAX_BODY_BYTES === 256 * 1024, `MAX_BODY_BYTES=${MAX_BODY_BYTES}`)
console.log('\nhomepage — social share preview (Open Graph + Twitter card)')
const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
t('index has og:title Fanout', indexHtml.includes('property="og:title" content="Fanout"'))
t('index has an og:description', /property="og:description" content="[^"]+"/.test(indexHtml))
t('index declares og:type website', indexHtml.includes('property="og:type" content="website"'))
t('index points og:image at /og.png', indexHtml.includes('property="og:image" content="/og.png"'))
t('index sets twitter:card summary_large_image', indexHtml.includes('name="twitter:card" content="summary_large_image"'))
t('index points twitter:image at /og.png', indexHtml.includes('name="twitter:image" content="/og.png"'))
t('the og.png share image exists', existsSync(new URL('../public/og.png', import.meta.url)))
t('share preview adds no inline script (CSP intact)', !/<script[^>]*>[^<]/.test(indexHtml))

console.log(failed === 0 ? '\nall checks passed\n' : `\n${failed} check(s) failed\n`)
process.exit(failed === 0 ? 0 : 1)
