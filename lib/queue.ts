// Work relay queue: users' chat requests go in, supporters' answers come out.
//
// Storage is Upstash Redis (REST) when UPSTASH_REDIS_REST_URL/TOKEN are set,
// otherwise a per-instance in-memory fallback. The fallback lives on one warm
// edge instance, so a user and a supporter only meet if they land on the same
// instance. Good enough for a single-region demo and for tests; set Upstash to
// make it real.

export type Job = {
  id: string
  model: string
  messages: Array<{ role: string; content: string }>
  queuedAt: number
}

const RESULT_TTL_S = 120
const QUEUE_KEY = 'fanout:jobs'
const NODES_KEY = 'fanout:nodes'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A supporter node counts as "connected" for this long after its last poll.
// Comfortably longer than one poll window so a node between long-polls doesn't
// flicker offline.
const PRESENCE_TTL_S = 45

// Hard caps so an idle or attacked queue can't grow without bound. A job is
// ~32KB max; 200 is a generous ceiling for a demo and self-heals as work drains.
const MAX_QUEUE = 200
const JOB_MAX_AGE_MS = 60_000

interface Store {
  push(job: Job): Promise<void>
  /** Take a queued job back out. No-op if a supporter already popped it. */
  remove(job: Job): Promise<void>
  /** Block until a job is available or maxWaitMs elapses. */
  waitPop(maxWaitMs: number): Promise<Job | null>
  setResult(id: string, text: string): Promise<void>
  /** Block until this job's answer arrives or maxWaitMs elapses. */
  waitResult(id: string, maxWaitMs: number): Promise<string | null>
  markPresence(userId: string): Promise<void>
  isPresent(userId: string): Promise<boolean>
  countPresent(): Promise<number>
}

function upstashStore(url: string, token: string): Store {
  const cmd = async (parts: Array<string | number>) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(parts),
    })
    if (!res.ok) throw new Error(`queue backend error ${res.status}`)
    return ((await res.json()) as { result: unknown }).result
  }
  return {
    push: async (job) => {
      await cmd(['LPUSH', QUEUE_KEY, JSON.stringify(job)])
      // Keep only the newest MAX_QUEUE (LPUSH prepends, BRPOP drains the tail).
      await cmd(['LTRIM', QUEUE_KEY, 0, MAX_QUEUE - 1])
    },
    // The value is byte-identical to what push serialised, since it is the same
    // object. If a supporter popped it a moment ago this removes nothing, which
    // is the correct outcome.
    remove: async (job) => { await cmd(['LREM', QUEUE_KEY, 1, JSON.stringify(job)]) },
    // BRPOP blocks server-side for up to `timeout` seconds, so one idle poll is
    // ONE Redis command instead of ~20 RPOP+sleep round-trips. This is the
    // difference between a supporter costing ~4k and ~100k commands/day.
    waitPop: async (maxWaitMs) => {
      const deadline = Date.now() + maxWaitMs
      while (true) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) return null
        const timeoutS = Math.max(1, Math.min(15, Math.ceil(remaining / 1000)))
        const res = (await cmd(['BRPOP', QUEUE_KEY, timeoutS])) as [string, string] | null
        if (!res || !res[1]) continue
        const job = JSON.parse(res[1]) as Job
        // Drop jobs older than the memory store would have trimmed. Without this,
        // a queue that filled while no supporter was online feeds the first node
        // to connect a backlog of prompts whose callers already gave up — real
        // LLM quota spent answering dead requests. Keep looping within the poll
        // deadline until a live job or a timeout.
        if (Date.now() - job.queuedAt > JOB_MAX_AGE_MS) continue
        return job
      }
    },
    // The answer is a one-element list rather than a plain string so the waiting
    // caller can BRPOP it instead of polling GET twice a second.
    setResult: async (id, text) => {
      await cmd(['LPUSH', `fanout:result:${id}`, text])
      await cmd(['EXPIRE', `fanout:result:${id}`, RESULT_TTL_S])
    },
    // Same trick as waitPop, on the other side of the relay: one blocking command
    // per 15s of waiting instead of two GETs a second. That is what makes a long
    // wait affordable, and a long wait is what real answers need.
    waitResult: async (id, maxWaitMs) => {
      const key = `fanout:result:${id}`
      const deadline = Date.now() + maxWaitMs
      while (true) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) return null
        const timeoutS = Math.max(1, Math.min(15, Math.ceil(remaining / 1000)))
        const res = (await cmd(['BRPOP', key, timeoutS])) as [string, string] | null
        if (res && res[1]) return res[1]
      }
    },
    // One command per poll: bump this node's last-seen in a sorted set. Pruning
    // and counting happen lazily in countPresent, off the hot poll path.
    markPresence: async (userId) => { await cmd(['ZADD', NODES_KEY, Date.now(), userId]) },
    isPresent: async (userId) => {
      const score = (await cmd(['ZSCORE', NODES_KEY, userId])) as string | null
      return score !== null && Date.now() - Number(score) <= PRESENCE_TTL_S * 1000
    },
    countPresent: async () => {
      await cmd(['ZREMRANGEBYSCORE', NODES_KEY, 0, Date.now() - PRESENCE_TTL_S * 1000])
      return ((await cmd(['ZCARD', NODES_KEY])) as number) ?? 0
    },
  }
}

function memoryStore(): Store {
  const jobs: Job[] = []
  const results = new Map<string, { text: string; at: number }>()
  const presence = new Map<string, number>()

  const trimJobs = () => {
    const cutoff = Date.now() - JOB_MAX_AGE_MS
    while (jobs.length && jobs[0].queuedAt < cutoff) jobs.shift()
    if (jobs.length > MAX_QUEUE) jobs.splice(0, jobs.length - MAX_QUEUE)
  }

  return {
    push: async (job) => { trimJobs(); jobs.push(job) },
    remove: async (job) => {
      const i = jobs.findIndex((j) => j.id === job.id)
      if (i >= 0) jobs.splice(i, 1)
    },
    waitPop: async (maxWaitMs) => {
      const deadline = Date.now() + maxWaitMs
      while (true) {
        trimJobs()
        const job = jobs.shift()
        if (job) return job
        if (Date.now() >= deadline) return null
        await sleep(500)
      }
    },
    setResult: async (id, text) => {
      const now = Date.now()
      // Opportunistic sweep so read-once and orphaned answers don't accumulate.
      if (results.size > 500) {
        for (const [k, v] of results) if (now - v.at > RESULT_TTL_S * 1000) results.delete(k)
      }
      results.set(id, { text, at: now })
    },
    // In-process, so polling costs nothing. Reads once, matching BRPOP.
    waitResult: async (id, maxWaitMs) => {
      const deadline = Date.now() + maxWaitMs
      while (true) {
        const r = results.get(id)
        if (r) {
          results.delete(id)
          if (Date.now() - r.at <= RESULT_TTL_S * 1000) return r.text
        }
        if (Date.now() >= deadline) return null
        await sleep(100)
      }
    },
    markPresence: async (userId) => { presence.set(userId, Date.now()) },
    isPresent: async (userId) => {
      const at = presence.get(userId)
      if (at === undefined) return false
      if (Date.now() - at > PRESENCE_TTL_S * 1000) { presence.delete(userId); return false }
      return true
    },
    countPresent: async () => {
      const cutoff = Date.now() - PRESENCE_TTL_S * 1000
      let n = 0
      for (const [k, at] of presence) {
        if (at <= cutoff) presence.delete(k)
        else n++
      }
      return n
    },
  }
}

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN
export const QUEUE_DISTRIBUTED = Boolean(url && token)
const store: Store = QUEUE_DISTRIBUTED ? upstashStore(url!, token!) : memoryStore()

/** Jobs carry only model + flattened messages — no user id, no IP, nothing to correlate. */
export async function submitJob(model: string, messages: Job['messages']): Promise<Job> {
  const job: Job = { id: crypto.randomUUID(), model, messages, queuedAt: Date.now() }
  await store.push(job)
  return job
}

/**
 * Withdraw a job whose caller has stopped waiting.
 *
 * The age trim cannot cover this. A job abandoned after 15s still looks fresh
 * for another 45, so without this the next supporter to connect spends real
 * model time answering a prompt nobody will read, and is not available for the
 * request that does have someone waiting. Observed in production, not theorised.
 */
export async function cancelJob(job: Job): Promise<void> {
  await store.remove(job)
}

/** Long-poll for work on behalf of a supporter. Resolves null when nothing shows up. */
export async function nextJob(maxWaitMs: number): Promise<Job | null> {
  return store.waitPop(maxWaitMs)
}

/** Record that a supporter node is alive right now, keyed by its Fanout user id. */
export async function markLive(userId: string): Promise<void> {
  await store.markPresence(userId)
}

/** Is a supporter node currently polling under this user id? */
export async function isLive(userId: string): Promise<boolean> {
  return store.isPresent(userId)
}

/** How many supporter nodes are live right now, across everyone. */
export async function countLive(): Promise<number> {
  return store.countPresent()
}

/**
 * The job id is the capability: it is an unguessable UUID handed only to the
 * supporter who popped the job, so holding it is proof of assignment.
 */
export async function completeJob(id: string, text: string): Promise<void> {
  await store.setResult(id, text)
}

/** Wait for a supporter's answer on behalf of the requesting user. */
export async function awaitResult(id: string, maxWaitMs: number): Promise<string | null> {
  return store.waitResult(id, maxWaitMs)
}
