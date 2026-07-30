// Seal a provider credential into a client-held connection blob.
//
// The plaintext key exists only for the duration of this request. We encrypt it,
// return the blob, and forget it — there is nothing on our side to leak later.

import { verifyKey, bearer } from '../lib/auth'
import { seal } from '../lib/seal'
import { ADAPTERS } from '../lib/providers'
import { hasSecrets, NOT_CONFIGURED } from '../lib/config'

export const config = { runtime: 'edge' }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

export default async function handler(req: Request): Promise<Response> {
  try {
    return await handleConnect(req)
  } catch {
    // Last line of defence: anything unforeseen becomes a clean JSON envelope
    // with CORS, never a bare platform error page.
    return json(500, { error: { message: 'Internal error sealing the connection.', type: 'api_error' } })
  }
}

async function handleConnect(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: { message: 'Use POST.' } })

  // Verifying the key needs MASTER_SECRET; sealing the blob needs
  // MASTER_ENCRYPTION_KEY. Missing either would throw mid-operation — return a
  // clean 503 up front instead.
  if (!hasSecrets('MASTER_SECRET', 'MASTER_ENCRYPTION_KEY')) {
    return json(503, { error: { message: NOT_CONFIGURED, type: 'api_error' } })
  }

  const auth = await verifyKey(bearer(req))
  if (!auth) {
    return json(401, { error: { message: 'Missing or invalid Fanout API key.', type: 'authentication_error' } })
  }

  let payload: { provider?: string; apiKey?: string; api_key?: string; label?: string }
  try {
    payload = (await req.json()) as typeof payload
  } catch {
    return json(400, { error: { message: 'Request body must be valid JSON.' } })
  }

  const provider = (payload.provider ?? '').toLowerCase()
  const apiKey = payload.apiKey ?? payload.api_key ?? ''

  if (!ADAPTERS[provider]) {
    return json(400, {
      error: { message: `Unknown provider "${provider}". Supported: ${Object.keys(ADAPTERS).join(', ')}.` },
    })
  }
  if (!apiKey || apiKey.length < 8) {
    return json(400, { error: { message: 'Field "apiKey" is required.' } })
  }

  // The label is echoed back in the x-fanout-connection-label response header,
  // so control characters here would be a header-injection vector. Strip to
  // printable ASCII at the point of sealing rather than trusting the read path.
  const label = (payload.label ?? '').replace(/[^\x20-\x7E]/g, '').slice(0, 40)

  const blob = await seal({
    provider,
    apiKey,
    owner: auth.u,
    createdAt: Date.now(),
    label: label || undefined,
  })

  return json(200, {
    connection: blob,
    provider,
    label: label || null,
    usage: 'Send this in the X-Fanout-Connection header. Comma-separate several to pool them.',
    note: 'Bound to your key. Another user replaying this blob gets a decryption failure, not your credits.',
  })
}
