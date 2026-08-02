// node scripts/gen-secrets.mjs
// Prints the two secrets Relaybee needs. Paste them into `vercel env add` (mark
// both Sensitive) or into .env.local for `vercel dev`.

import { randomBytes } from 'node:crypto'

const b64url = (n) => randomBytes(n).toString('base64url')

console.log(`MASTER_SECRET=${b64url(32)}`)
console.log(`MASTER_ENCRYPTION_KEY=${b64url(32)}`)
console.log()
console.log('MASTER_SECRET signs API keys. Rotating it invalidates every issued key.')
console.log('MASTER_ENCRYPTION_KEY seals connections. Rotating it invalidates every connection blob.')
console.log('Use different values per environment. Never commit either one.')
