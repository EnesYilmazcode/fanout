// A tiny stand-in for the Upstash REST API: enough Redis to run the real
// Upstash code path in lib/queue.ts without a network or an account.
//
// The Upstash branch is the only part of the queue production actually uses,
// and until now it was the only part nothing exercised. It has already shipped
// one production-only bug (stale jobs never expiring, PR #55) that the memory
// store could not have caught. This closes that gap.
//
// It also counts commands, so tests can assert the cost of a code path rather
// than reasoning about it by eye.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type FakeUpstash = {
  url: string
  token: string
  /** Command name (upper case) to call count. */
  counts: Map<string, number>
  total(): number
  reset(): void
  /** Issue a command straight to the store, bypassing lib/queue. */
  raw(parts: Array<string | number>): Promise<unknown>
  /** Make the next n REST calls fail with a 500, to exercise the error guards. */
  failNext(n: number): void
  close(): Promise<void>
}

export async function startFakeUpstash(): Promise<FakeUpstash> {
  const lists = new Map<string, string[]>()
  const zsets = new Map<string, Map<string, number>>()
  const expiries = new Map<string, number>()
  const counts = new Map<string, number>()
  let failures = 0

  const expired = (key: string) => {
    const at = expiries.get(key)
    if (at !== undefined && Date.now() > at) {
      lists.delete(key)
      expiries.delete(key)
      return true
    }
    return false
  }
  const list = (key: string) => {
    expired(key)
    let l = lists.get(key)
    if (!l) { l = []; lists.set(key, l) }
    return l
  }
  const zset = (key: string) => {
    let z = zsets.get(key)
    if (!z) { z = new Map(); zsets.set(key, z) }
    return z
  }

  async function run(parts: Array<string | number>): Promise<unknown> {
    const name = String(parts[0]).toUpperCase()
    counts.set(name, (counts.get(name) ?? 0) + 1)
    const key = String(parts[1])
    switch (name) {
      case 'LPUSH': {
        const l = list(key)
        for (let i = 2; i < parts.length; i++) l.unshift(String(parts[i]))
        return l.length
      }
      case 'LTRIM': {
        const l = list(key)
        const start = Number(parts[2])
        const stop = Number(parts[3])
        lists.set(key, l.slice(start, stop < 0 ? undefined : stop + 1))
        return 'OK'
      }
      case 'BRPOP': {
        // Blocks server side until something lands or the timeout expires, then
        // returns [key, value] like the real thing.
        const deadline = Date.now() + Number(parts[2]) * 1000
        while (true) {
          const l = list(key)
          const v = l.pop()
          if (v !== undefined) return [key, v]
          if (Date.now() >= deadline) return null
          await sleep(10)
        }
      }
      case 'LREM': {
        // count > 0 removes from the head, count 0 removes every match.
        const l = list(key)
        const count = Number(parts[2])
        const value = String(parts[3])
        const limit = count === 0 ? Infinity : Math.abs(count)
        const order = count < 0 ? [...l.keys()].reverse() : [...l.keys()]
        const doomed = new Set<number>()
        for (const i of order) {
          if (doomed.size >= limit) break
          if (l[i] === value) doomed.add(i)
        }
        lists.set(key, l.filter((_, i) => !doomed.has(i)))
        return doomed.size
      }
      case 'LLEN': return list(key).length
      case 'EXPIRE': {
        expiries.set(key, Date.now() + Number(parts[2]) * 1000)
        return 1
      }
      case 'ZADD': {
        zset(key).set(String(parts[3]), Number(parts[2]))
        return 1
      }
      case 'ZSCORE': {
        const s = zset(key).get(String(parts[2]))
        return s === undefined ? null : String(s)
      }
      case 'ZCARD': return zset(key).size
      case 'ZREMRANGEBYSCORE': {
        const z = zset(key)
        const min = parts[2] === '-inf' ? -Infinity : Number(parts[2])
        const max = parts[3] === '+inf' ? Infinity : Number(parts[3])
        let removed = 0
        for (const [member, score] of [...z]) {
          if (score >= min && score <= max) { z.delete(member); removed++ }
        }
        return removed
      }
      default:
        throw new Error(`fake-upstash: unsupported command ${name}`)
    }
  }

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    if (failures > 0) {
      failures--
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'fake outage' }))
      return
    }
    try {
      const parts = JSON.parse(Buffer.concat(chunks).toString()) as Array<string | number>
      const result = await run(parts)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ result }))
    } catch (e) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: String(e) }))
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port

  return {
    url: `http://127.0.0.1:${port}`,
    token: 'fake-token',
    counts,
    total: () => [...counts.values()].reduce((a, b) => a + b, 0),
    reset: () => counts.clear(),
    raw: run,
    failNext: (n: number) => { failures = n },
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}
