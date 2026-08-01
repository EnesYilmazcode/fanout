// Runs lib/queue.ts against a fake Upstash REST server, so the branch that
// actually serves production is exercised instead of only the memory fallback.
//
//   npm run test:upstash
//
// The store is chosen at module load from the environment, so the env has to be
// set before lib/queue is imported. That is why this is its own file.

import { startFakeUpstash } from './fake-upstash.mts'

const fake = await startFakeUpstash()
process.env.UPSTASH_REDIS_REST_URL = fake.url
process.env.UPSTASH_REDIS_REST_TOKEN = fake.token
process.env.MASTER_SECRET = 'upstash-test-secret'

const queue = await import('../lib/queue.ts')
const { issueKey } = await import('../lib/auth.ts')

let failed = 0
const t = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

console.log('\nupstash — the real REST path, not the memory fallback')
t('the queue selected the Upstash store', queue.QUEUE_DISTRIBUTED === true)

console.log('\nupstash — job round trip')
const jobId = await queue.submitJob('claude-code', [{ role: 'user', content: 'hello upstash' }])
const popped = await queue.nextJob(2000)
t('a submitted job comes back off the REST queue', popped?.id === jobId, popped?.id ?? 'none')
t('the job carries its messages intact', popped?.messages[0]?.content === 'hello upstash')
t('the queue is empty once popped', (await queue.nextJob(1000)) === null)

console.log('\nupstash — stale jobs are dropped (regression guard for #55)')
// Push a job older than JOB_MAX_AGE_MS straight into the store, the way a queue
// that filled while nobody was online would look.
await fake.raw(['LPUSH', 'fanout:jobs', JSON.stringify({
  id: 'stale-1', model: 'claude-code', messages: [{ role: 'user', content: 'old' }],
  queuedAt: Date.now() - 5 * 60_000,
})])
t('a job older than the max age is never handed to a supporter', (await queue.nextJob(1500)) === null)

console.log('\nupstash — answer delivery')
const answerId = 'result-round-trip'
await queue.completeJob(answerId, 'the answer')
t('an answer written by a supporter is read by the waiting caller', (await queue.awaitResult(answerId, 2000)) === 'the answer')
t('an answer is delivered once, then gone', (await queue.awaitResult(answerId, 300)) === null)

console.log('\nupstash — command cost, which is the whole point of the change')
fake.reset()
const t0 = Date.now()
const nothing = await queue.awaitResult('never-answered', 3000)
const waited = Date.now() - t0
t('an unanswered 3s wait resolves null', nothing === null)
t('it blocks server side rather than spinning', waited >= 2800, `${waited}ms`)
t('a 3s wait costs one command, not six', fake.total() === 1, `${fake.total()} commands: ${[...fake.counts].map(([k, v]) => k + '=' + v).join(' ')}`)

fake.reset()
await queue.completeJob('cost-check', 'x')
t('publishing an answer costs two commands', fake.total() === 2, `${fake.total()}`)

console.log('\nupstash — presence')
await queue.markLive('node-a')
t('a polling node reads back as live', (await queue.isLive('node-a')) === true)
t('an unknown node reads back as offline', (await queue.isLive('node-b')) === false)
t('the global count sees it', (await queue.countLive()) >= 1)

console.log('\nupstash — a backend outage degrades cleanly (the #55 guard, now covered)')
const workNext = (await import('../api/work/next.ts')).default
const key = await issueKey('outage_user', 'free')
fake.failNext(20)
const outage = await workNext(new Request('https://x/api/work/next', {
  method: 'POST', headers: { authorization: `Bearer ${key}` },
}))
t('an Upstash outage returns 503, not a bare platform error', outage.status === 503, `status=${outage.status}`)
const outageBody = await outage.json()
t('the outage body is a JSON error envelope', typeof outageBody?.error?.message === 'string')
t('the outage response still carries CORS', outage.headers.get('access-control-allow-origin') === '*')

await fake.close()
console.log(failed === 0 ? '\nupstash: all checks passed' : `\nupstash: ${failed} check(s) FAILED`)
process.exit(failed === 0 ? 0 : 1)
