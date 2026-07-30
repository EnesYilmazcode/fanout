// Supporter side of the relay: deliver an answer for a job taken from /api/work/next.
//
// The job id is the capability — an unguessable UUID that only the supporter
// who popped the job holds — so no further assignment bookkeeping is needed.

import { verifyKey, bearer } from '../../lib/auth'
import { completeJob } from '../../lib/queue'
import { check, clientIp } from '../../lib/ratelimit'

export const config = { runtime: 'edge' }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const MAX_ANSWER_BYTES = 64 * 1024
const IP_COMPLETE_LIMIT = 30

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', ...CORS },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: { message: 'Use POST.' } })

  const auth = await verifyKey(bearer(req))
  if (!auth) return json(401, { error: { message: 'Missing or invalid Fanout API key.', type: 'authentication_error' } })
  if (!check(`complete:${clientIp(req)}`, IP_COMPLETE_LIMIT).ok) {
    return json(429, { error: { message: 'Rate limit exceeded.', type: 'rate_limit_error' } })
  }

  let body: { id?: string; text?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json(400, { error: { message: 'Request body must be valid JSON.' } })
  }

  const id = body.id ?? ''
  const text = body.text ?? ''
  if (!/^[0-9a-f-]{36}$/.test(id)) return json(400, { error: { message: 'Field "id" must be the job id from /api/work/next.' } })
  if (!text) return json(400, { error: { message: 'Field "text" is required.' } })
  if (new TextEncoder().encode(text).length > MAX_ANSWER_BYTES) {
    return json(400, { error: { message: `Answer too large: cap is ${MAX_ANSWER_BYTES / 1024}KB.` } })
  }

  await completeJob(id, text)
  return json(200, { ok: true })
}
