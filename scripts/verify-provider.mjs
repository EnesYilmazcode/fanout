#!/usr/bin/env node
// Verify the bring-your-own-keys path against a REAL provider, end to end.
//
// This is the one claim in the repo nothing has ever proven. test/e2e.mts mocks
// the upstream, so the Anthropic response parsing in lib/providers.ts is only
// ever checked against a fake written from the docs. A wrong assumption about
// the provider's contract passes every assertion in the suite.
//
//   node scripts/verify-provider.mjs --key sk-ant-...
//   node scripts/verify-provider.mjs --provider groq --key gsk_...
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/verify-provider.mjs
//
// Options:
//   --provider  anthropic | openai | groq        (default: anthropic)
//   --model     provider-specific model id       (default: per provider below)
//   --base      the deployment to test           (default: production)
//
// Costs a few tokens, one non-streaming call and one streaming call. The key is
// sent to the Fanout deployment you name and to that provider, and nowhere else.
// It is never written to disk or printed.

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])

const PROVIDER = args.get('provider') ?? 'anthropic'
const BASE = (args.get('base') ?? 'https://fanout-tawny.vercel.app').replace(/\/$/, '')
const DEFAULT_MODEL = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
}
const MODEL = args.get('model') ?? DEFAULT_MODEL[PROVIDER]
const KEY =
  args.get('key') ??
  process.env[`${PROVIDER.toUpperCase()}_API_KEY`] ??
  process.env.PROVIDER_API_KEY

if (!DEFAULT_MODEL[PROVIDER]) {
  console.error(`Unknown provider "${PROVIDER}". Use anthropic, openai, or groq.`)
  process.exit(2)
}
if (!KEY) {
  console.error(`No provider key. Pass --key, or set ${PROVIDER.toUpperCase()}_API_KEY.`)
  process.exit(2)
}

let failed = 0
const t = (name, cond, extra = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
const post = (path, body, headers = {}) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

console.log(`\nverifying ${PROVIDER}/${MODEL} through ${BASE}`)

const health = await (await fetch(BASE + '/api/health')).json()
console.log(`   deployment commit ${health.commit}, queue ${health.queue}`)
t('the deployment is up', health.ok === true)
t('the provider is one it knows about', health.providers.includes(PROVIDER), health.providers.join(', '))

const mint = await (await post('/api/keys/issue', {})).json()
t('minted a Fanout key', typeof mint.key === 'string' && mint.key.startsWith('fo_live_'))
const auth = { authorization: `Bearer ${mint.key}` }

const sealed = await (await post('/api/connect', { provider: PROVIDER, apiKey: KEY, label: 'verify' }, auth)).json()
t('the provider key sealed into a connection blob', typeof sealed.connection === 'string' && sealed.connection.startsWith('fc_'), sealed.error?.message ?? '')
if (!sealed.connection) { console.log('\ncannot continue without a sealed connection'); process.exit(1) }
const withConn = { ...auth, 'x-fanout-connection': sealed.connection }

console.log('\nnon-streaming completion')
const t0 = Date.now()
const res = await post('/api/v1/chat/completions', {
  model: `${PROVIDER}/${MODEL}`,
  messages: [{ role: 'user', content: 'Reply with exactly the word: FANOUT_OK' }],
  max_tokens: 20,
}, withConn)
const body = await res.text()
let json = null
try { json = JSON.parse(body) } catch {}
console.log(`   ${res.status} in ${Date.now() - t0}ms, served by ${res.headers.get('x-fanout-provider')} / ${res.headers.get('x-fanout-connection-label')}`)
t('a real provider returned a real completion', res.status === 200, body.slice(0, 300))
t('the response is OpenAI-shaped', json?.object === 'chat.completion' && typeof json?.choices?.[0]?.message?.content === 'string')
t('the model actually answered', /FANOUT_OK/.test(json?.choices?.[0]?.message?.content ?? ''), JSON.stringify(json?.choices?.[0]?.message?.content))
t('usage was translated, not dropped', typeof json?.usage?.total_tokens === 'number' && json.usage.total_tokens > 0, JSON.stringify(json?.usage))
t('pool health reports the connection', (res.headers.get('x-fanout-pool-health') ?? '').includes('verify'), res.headers.get('x-fanout-pool-health') ?? 'none')

console.log('\nstreaming completion')
const sres = await post('/api/v1/chat/completions', {
  model: `${PROVIDER}/${MODEL}`,
  stream: true,
  stream_options: { include_usage: true },
  messages: [{ role: 'user', content: 'Count from 1 to 5, digits only, separated by spaces.' }],
  max_tokens: 40,
}, withConn)
const sse = await sres.text()
const deltas = [...sse.matchAll(/^data: (\{.*\})$/gm)]
  .map((m) => { try { return JSON.parse(m[1]) } catch { return null } })
  .filter(Boolean)
const streamed = deltas.map((d) => d?.choices?.[0]?.delta?.content ?? '').join('')
t('the stream returned 200', sres.status === 200, `status=${sres.status}`)
t('deltas reassembled into text', streamed.trim().length > 0, JSON.stringify(streamed.slice(0, 80)))
t('the streamed answer is the one asked for', /1\D+2\D+3\D+4\D+5/.test(streamed), JSON.stringify(streamed.slice(0, 80)))
t('the stream terminated with [DONE]', sse.trimEnd().endsWith('data: [DONE]'))
t('include_usage produced a usage chunk', deltas.some((d) => d?.usage?.total_tokens > 0))

console.log(
  failed === 0
    ? `\nVERIFIED: ${PROVIDER}/${MODEL} works end to end through ${BASE}.\nPaste this into PROJECT.md and strike the P1.`
    : `\n${failed} check(s) FAILED. This is the good outcome of running it: something in the provider contract does not match what lib/providers.ts assumes.`,
)
process.exit(failed === 0 ? 0 : 1)
