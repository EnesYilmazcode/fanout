// Work relay queue: users' chat requests go in, supporters' answers come out.
//
// Storage is Upstash Redis (REST) when UPSTASH_REDIS_REST_URL/TOKEN are set,
// otherwise a per-instance in-memory fallback. The fallback has the same limits
// as the rate limiter above it: it lives on one warm edge instance, so a user
// and a supporter only meet if they land on the same instance. Good enough for
// a single-region demo and for tests; set Upstash to make it real.

export type Job = {
  id: string
  model: string
  messages: Array<{ role: string; content: string }>
  queuedAt: number
}

const RESULT_TTL_S = 120
const QUEUE_KEY = 'fanout:jobs'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A supporter node counts as "connected" for this long after its last poll.
// Comfortably longer than one poll window so a node between long-polls doesn't
// flicker offline.
const PRESENCE_TTL_S = 45

interface Store {
  push(job: Job): Promise<void>
  pop(): Promise<Job | null>
  setResult(id: string, text: string): Promise<void>
  getResult(id: string): Promise<string | null>
  markPresence(userId: string): Promise<void>
  isPresent(userId: string): Promise<boolean>
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
    push: async (job) => { await cmd(['LPUSH', QUEUE_KEY, JSON.stringify(job)]) },
    pop: async () => {
      const raw = (await cmd(['RPOP', QUEUE_KEY])) as string | null
      return raw ? (JSON.parse(raw) as Job) : null
    },
    setResult: async (id, text) => { await cmd(['SET', `fanout:result:${id}`, text, 'EX', RESULT_TTL_S]) },
    getResult: async (id) => ((await cmd(['GET', `fanout:result:${id}`])) as string | null) ?? null,
    markPresence: async (userId) => { await cmd(['SET', `fanout:live:${userId}`, '1', 'EX', PRESENCE_TTL_S]) },
    isPresent: async (userId) => ((await cmd(['EXISTS', `fanout:live:${userId}`])) as number) === 1,
  }
}

function memoryStore(): Store {
  const jobs: Job[] = []
  const results = new Map<string, { text: string; at: number }>()
  const presence = new Map<string, number>()
  return {
    push: async (job) => { jobs.push(job) },
    pop: async () => {
      // Drop jobs nobody would still be waiting on, so an idle queue with no
      // supporters doesn't serve stale prompts minutes later.
      while (jobs.length && Date.now() - jobs[0].queuedAt > 60_000) jobs.shift()
      return jobs.shift() ?? null
    },
    setResult: async (id, text) => { results.set(id, { text, at: Date.now() }) },
    getResult: async (id) => {
      const r = results.get(id)
      if (!r) return null
      if (Date.now() - r.at > RESULT_TTL_S * 1000) { results.delete(id); return null }
      return r.text
    },
    markPresence: async (userId) => { presence.set(userId, Date.now()) },
    isPresent: async (userId) => {
      const at = presence.get(userId)
      if (at === undefined) return false
      if (Date.now() - at > PRESENCE_TTL_S * 1000) { presence.delete(userId); return false }
      return true
    },
  }
}

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN
export const QUEUE_DISTRIBUTED = Boolean(url && token)
const store: Store = QUEUE_DISTRIBUTED ? upstashStore(url!, token!) : memoryStore()

/** Jobs carry only model + flattened messages — no user id, no IP, nothing to correlate. */
export async function submitJob(model: string, messages: Job['messages']): Promise<string> {
  const id = crypto.randomUUID()
  await store.push({ id, model, messages, queuedAt: Date.now() })
  return id
}

/** Long-poll for work on behalf of a supporter. Resolves null when nothing shows up. */
export async function nextJob(maxWaitMs: number): Promise<Job | null> {
  const deadline = Date.now() + maxWaitMs
  while (true) {
    const job = await store.pop()
    if (job) return job
    if (Date.now() >= deadline) return null
    await sleep(1000)
  }
}

/** Record that a supporter node is alive right now, keyed by its Fanout user id. */
export async function markLive(userId: string): Promise<void> {
  await store.markPresence(userId)
}

/** Is a supporter node currently polling under this user id? */
export async function isLive(userId: string): Promise<boolean> {
  return store.isPresent(userId)
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
  const deadline = Date.now() + maxWaitMs
  while (true) {
    const text = await store.getResult(id)
    if (text !== null) return text
    if (Date.now() >= deadline) return null
    await sleep(500)
  }
}
