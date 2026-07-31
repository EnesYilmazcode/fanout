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

/**
 * The rate-limit response headers for a Verdict. Every Fanout endpoint returns
 * the same envelope so a cross-origin worker sees identical fields everywhere;
 * keeping this in one place stops the four copies from drifting.
 */
export function rlHeaders(rl: Verdict): Record<string, string> {
  return {
    'x-ratelimit-limit': String(rl.limit),
    'x-ratelimit-remaining': String(rl.remaining),
    'x-ratelimit-reset': String(Math.ceil(rl.resetAt / 1000)),
  }
}

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

/**
 * Best-effort client IP, for limits that must survive key rotation.
 *
 * Metering on user id alone is bypassable here: /api/keys/issue is unauthenticated
 * and free, so anyone can mint a fresh key — and therefore a fresh bucket — as often
 * as they like. An IP dimension makes rotation pointless for a single source. It is
 * not a real defence against a distributed caller, and it is not meant to be; it
 * closes the trivial bypass, nothing more.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

/** Key minting is cheap for us but should not be free to automate. */
export const IP_ISSUE_LIMIT = 10
/** Ceiling per source IP across all keys it holds. */
export const IP_PROXY_LIMIT = 60
