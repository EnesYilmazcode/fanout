// Per-instance sliding-window limiter.
//
// This is deliberately not distributed. Fanout has no datastore, so the counter
// lives in module scope on whatever warm edge instance served the request — a
// user spread across regions gets roughly N-regions times the limit, and a cold
// start resets to zero. That is fine for what this protects: our own invocation
// and bandwidth quota, not the user's provider spend (they pay for that with
// their own key). Swap in Upstash keyed on userId if you ever need it exact.

type Window = { count: number; resetAt: number }

const buckets = new Map<string, Window>()
const WINDOW_MS = 60_000

export type Verdict = { ok: boolean; limit: number; remaining: number; resetAt: number }

export function check(userId: string, limit: number): Verdict {
  const now = Date.now()
  let w = buckets.get(userId)

  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + WINDOW_MS }
    buckets.set(userId, w)
  }

  // Opportunistic sweep so an instance that has seen many users doesn't grow
  // without bound. Cheap because it only runs on bucket creation.
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
  }

  w.count++
  const remaining = Math.max(0, limit - w.count)
  return { ok: w.count <= limit, limit, remaining, resetAt: w.resetAt }
}

export const LIMITS: Record<string, number> = { free: 20, pro: 120 }
