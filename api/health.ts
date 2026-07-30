import { ADAPTERS } from '../lib/providers'
import { QUEUE_DISTRIBUTED, countLive } from '../lib/queue'

export const config = { runtime: 'edge' }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
}

export default async function handler(req?: Request): Promise<Response> {
  if (req?.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  return new Response(
    JSON.stringify({
      ok: true,
      providers: Object.keys(ADAPTERS),
      // Which relay backing store is live, and how many supporters are polling.
      queue: QUEUE_DISTRIBUTED ? 'upstash' : 'memory',
      supporters_online: await countLive(),
      // Presence check only — never echo the values.
      configured: {
        master_secret: Boolean(process.env.MASTER_SECRET),
        master_encryption_key: Boolean(process.env.MASTER_ENCRYPTION_KEY),
      },
    }),
    { headers: { 'content-type': 'application/json', ...CORS } },
  )
}
