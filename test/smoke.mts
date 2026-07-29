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

console.log(failed === 0 ? '\nall checks passed\n' : `\n${failed} check(s) failed\n`)
process.exit(failed === 0 ? 0 : 1)
