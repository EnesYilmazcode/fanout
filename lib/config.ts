// Server-secret presence check.
//
// Relaybee needs two secrets to do its work: MASTER_SECRET signs the HMAC API
// keys (lib/auth.ts) and MASTER_ENCRYPTION_KEY seals the connection blobs
// (lib/seal.ts). If one is missing, the operation that needs it throws deep in
// WebCrypto and surfaces as a generic platform 500 with no CORS or error
// envelope. This module lets each entry point check up front and return a clean
// 503 instead.
//
// It reports only PRESENCE, never the values — nothing here reads, returns, or
// logs a secret.

export type Secret = 'MASTER_SECRET' | 'MASTER_ENCRYPTION_KEY'

/** The user-facing message for a missing-secret 503. Says nothing about which. */
export const NOT_CONFIGURED = 'Relaybee is not configured.'

/** True only if every named env var is present and non-empty. */
export function hasSecrets(...names: Secret[]): boolean {
  return names.every((n) => {
    const v = process.env[n]
    return typeof v === 'string' && v.length > 0
  })
}
