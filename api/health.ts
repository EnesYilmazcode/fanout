import { ADAPTERS } from '../lib/providers'

export const config = { runtime: 'edge' }

export default function handler(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      providers: Object.keys(ADAPTERS),
      // Presence check only — never echo the values.
      configured: {
        master_secret: Boolean(process.env.MASTER_SECRET),
        master_encryption_key: Boolean(process.env.MASTER_ENCRYPTION_KEY),
      },
    }),
    { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } },
  )
}
