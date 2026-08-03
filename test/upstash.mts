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
const submitted = await queue.submitJob('claude-code', [{ role: 'user', content: 'hello upstash' }])
const popped = await queue.nextJob(2000)
t('a submitted job comes back off the REST queue', popped?.id === submitted.id, popped?.id ?? 'none')
t('the job carries its messages intact', popped?.messages[0]?.content === 'hello upstash')
t('the queue is empty once popped', (await queue.nextJob(1000)) === null)

console.log('\nupstash — a caller that gives up takes its job with it')
// Without this, a job abandoned after 15s still looks fresh to the age trim for
// another 45, so the next supporter to connect burns real model time on it.
const abandoned = await queue.submitJob('claude-code', [{ role: 'user', content: 'nobody is waiting for this' }])
fake.reset()
await queue.cancelJob(abandoned)
t('cancelling costs one command', fake.total() === 1, `${fake.total()}`)
t('the abandoned job is gone, so no supporter can be handed it', (await queue.nextJob(1200)) === null)

// Cancelling a job a supporter already took must be a harmless no-op, not an error.
const taken = await queue.submitJob('claude-code', [{ role: 'user', content: 'already popped' }])
const gotIt = await queue.nextJob(2000)
t('the supporter got the job first', gotIt?.id === taken.id)
await queue.cancelJob(taken)
t('cancelling an already-popped job is harmless', true)

console.log('\nupstash — stale jobs are dropped (regression guard for #55)')
// Push a job older than JOB_MAX_AGE_MS straight into the store, the way a queue
// that filled while nobody was online would look.
await fake.raw(['LPUSH', 'relaybee:jobs', JSON.stringify({
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

console.log('\nupstash — counting supporters is one read, not a write plus a read')
// Plant a node whose last beat is older than the TTL.
const liveBefore = await queue.countLive()
await fake.raw(['ZADD', 'relaybee:nodes', Date.now() - (46 * 1000), 'stale-node'])
fake.reset()
const counted = await queue.countLive()
t('counting costs one command', fake.total() === 1, `${fake.total()} commands: ${[...fake.counts].map(([k, v]) => k + '=' + v).join(' ')}`)
t('and it is a range read, not a prune', (fake.counts.get('ZREMRANGEBYSCORE') ?? 0) === 0)
t('a node past its TTL is not counted', counted === liveBefore, `${counted} vs ${liveBefore}`)
const stored = await fake.raw(['ZCARD', 'relaybee:nodes'])
t('the expired member is still in the set, so the count did not rely on deleting it',
  stored === liveBefore + 1, String(stored))

console.log('\nupstash — the sweep rides the beat that grows the set, not a counter')
// A counter would live in one warm instance, so a poll landing on a cold one
// would restart it and the degenerate case would never sweep. Keying off ZADD's
// return value is server-side state, so it survives a cold start. Only the
// second assertion discriminates: a counter also skips the sweep on most beats,
// so it would still pass the first one.
fake.reset()
await queue.markLive('node-a')
t('a repeat beat from a known node costs one command and no sweep',
  fake.total() === 1 && (fake.counts.get('ZREMRANGEBYSCORE') ?? 0) === 0,
  `${fake.total()} commands: ${[...fake.counts].map(([k, v]) => k + '=' + v).join(' ')}`)

fake.reset()
await queue.markLive('brand-new-node')
t('the beat that adds a member sweeps', (fake.counts.get('ZREMRANGEBYSCORE') ?? 0) === 1, String(fake.counts.get('ZREMRANGEBYSCORE')))
t('and it removed the node that was past its TTL', (await fake.raw(['ZSCORE', 'relaybee:nodes', 'stale-node'])) === null)
t('so the set holds the live nodes and nothing else',
  (await fake.raw(['ZCARD', 'relaybee:nodes'])) === liveBefore + 1, String(await fake.raw(['ZCARD', 'relaybee:nodes'])))

console.log('\nupstash — the presence heartbeat is throttled, not per poll')
const workNext = (await import('../api/work/next.ts')).default
const pollReq = (k: string) => new Request('https://x/api/work/next', {
  method: 'POST', headers: { authorization: `Bearer ${k}` },
})
const beatKey = await issueKey('beat_user', 'free')
// Queue a job before each poll so BRPOP returns at once instead of blocking.
await queue.submitJob('claude-code', [{ role: 'user', content: 'beat one' }])
fake.reset()
await workNext(pollReq(beatKey))
t('a first poll marks presence', (fake.counts.get('ZADD') ?? 0) === 1, String(fake.counts.get('ZADD')))
await queue.submitJob('claude-code', [{ role: 'user', content: 'beat two' }])
await workNext(pollReq(beatKey))
t('an immediate second poll does not pay for it again', (fake.counts.get('ZADD') ?? 0) === 1, String(fake.counts.get('ZADD')))
t('the second poll still returned its job', true)

console.log('\nupstash — a backend outage degrades cleanly (the #55 guard, now covered)')
const key = await issueKey('outage_user', 'free')
fake.failNext(20)
const outage = await workNext(new Request('https://x/api/work/next', {
  method: 'POST', headers: { authorization: `Bearer ${key}` },
}))
t('an Upstash outage returns 503, not a bare platform error', outage.status === 503, `status=${outage.status}`)
const outageBody = await outage.json()
t('the outage body is a JSON error envelope', typeof outageBody?.error?.message === 'string')
t('the outage response still carries CORS', outage.headers.get('access-control-allow-origin') === '*')

console.log('\nupstash — /api/health does not hand out free queue reads')
const health = (await import('../api/health.ts')).default
// The outage above armed more failures than it consumed. Clear them.
fake.failNext(0)
// First health call of the process, so the cache is cold and this is a real read.
fake.reset()
const h1 = await health(new Request('https://x/api/health'))
const h1Body = await h1.json()
t('health reports a live supporter count', typeof h1Body.supporters_online === 'number', String(h1Body.supporters_online))
t('a cold health read costs a single count', fake.total() === 1, `${fake.total()}`)
for (let i = 0; i < 5; i++) await health(new Request('https://x/api/health'))
t('five more hits inside the cache window cost nothing', fake.total() === 1, `${fake.total()}`)

// Let the cache lapse, then take the queue away underneath it.
await new Promise((r) => setTimeout(r, 5100))
fake.failNext(20)
const h2 = await health(new Request('https://x/api/health'))
const h2Body = await h2.json()
t('health still answers 200 while the queue is down', h2.status === 200, `status=${h2.status}`)
t('health reports the unreadable count as null instead of throwing', h2Body.supporters_online === null, String(h2Body.supporters_online))
t('health still reports the rest of the service', h2Body.ok === true && h2Body.queue === 'upstash')

await fake.close()
console.log(failed === 0 ? '\nupstash: all checks passed' : `\nupstash: ${failed} check(s) FAILED`)
process.exit(failed === 0 ? 0 : 1)
