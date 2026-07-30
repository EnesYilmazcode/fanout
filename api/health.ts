import { ADAPTERS } from '../lib/providers'
import { QUEUE_DISTRIBUTED, countLive } from '../lib/queue'

export const config = { runtime: 'edge' }

export default async function handler(): Promise<Response> {
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
    { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } },
  )
}
