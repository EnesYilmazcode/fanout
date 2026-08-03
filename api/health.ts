import { ADAPTERS } from '../lib/providers'
import { QUEUE_DISTRIBUTED, countLive } from '../lib/queue'
import { check, clientIp } from '../lib/ratelimit'

export const config = { runtime: 'edge' }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
}

// Health is public and unauthenticated, which is right for a health endpoint,
// but supporters_online is a metered Upstash read. Unguarded that made this the
// cheapest way to spend the project's entire queue budget: no key, no limit.
//
// Three guards. The CDN header below is the one that scales, because the
// in-process cache is per warm instance and multiplies across them while a
// shared cache does not. Behind it, a short cache collapses a burst into one
// read and a per-source ceiling on misses serves the last known number instead
// of paying for another. None of it costs accuracy that matters: presence has a
// 45s TTL.
const COUNT_CACHE_MS = 5_000
const IP_HEALTH_LIMIT = 30

// Nothing here is per-user, so a shared cache can serve it. The windows are
// sized to stay inside that TTL: a body can be COUNT_CACHE_MS old before it is
// stored, so 5 + 10 + 30 lands exactly on 45. A longer stale window would let
// this endpoint report a supporter the rest of the system already calls offline.
// max-age=0 is redundant on Vercel, which consumes s-maxage and rewrites this
// header before the client sees it, but it keeps the browser out of the cache
// if this ever sits behind anything else.
const CACHE_CONTROL = 'public, max-age=0, s-maxage=10, stale-while-revalidate=30'
let cached: { at: number; value: number | null } = { at: 0, value: null }

/** Null means the queue could not be read, which health reports rather than fails on. */
async function supportersOnline(req?: Request): Promise<number | null> {
  if (cached.at !== 0 && Date.now() - cached.at < COUNT_CACHE_MS) return cached.value
  if (req && !check(`health:${clientIp(req)}`, IP_HEALTH_LIMIT).ok) return cached.value
  try {
    cached = { at: Date.now(), value: await countLive() }
  } catch {
    // A queue outage is something health should report, not something health
    // should participate in by returning a bare platform 500.
    cached = { at: Date.now(), value: null }
  }
  return cached.value
}

export default async function handler(req?: Request): Promise<Response> {
  if (req?.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  return new Response(
    JSON.stringify({
      ok: true,
      // Which commit is deployed — short SHA from Vercel, or "dev" locally/under test.
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
      providers: Object.keys(ADAPTERS),
      // Which relay backing store is live, and how many supporters are polling.
      queue: QUEUE_DISTRIBUTED ? 'upstash' : 'memory',
      supporters_online: await supportersOnline(req),
      // Presence check only — never echo the values.
      configured: {
        master_secret: Boolean(process.env.MASTER_SECRET),
        master_encryption_key: Boolean(process.env.MASTER_ENCRYPTION_KEY),
      },
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': CACHE_CONTROL, ...CORS } },
  )
}
