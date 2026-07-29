# Fanout — project board

Living status doc. Updated in the same commit as the change it describes, so the board is never
stale relative to the code. Newest entries at the top of each log.

**Status:** built and unit-verified, not yet deployed
**Live URL:** _not deployed yet_
**Last updated:** 2026-07-28

---

## Board

### Shipped

| # | Item | Commit |
|---|---|---|
| 1 | Repo scaffold — TypeScript, Edge config, secret generator | `chore: scaffold` |
| 2 | Self-verifying HMAC API keys, no user table | `feat(auth)` |
| 3 | AES-256-GCM sealed connections bound to owner id | `feat(seal)` |
| 4 | Provider adapters: Anthropic, OpenAI, Groq | `feat(providers)` |
| 5 | Anthropic SSE → OpenAI chunk stream translation | `feat(providers)` |
| 6 | Per-instance sliding-window rate limiter | `feat(ratelimit)` |
| 7 | Key issue + connect endpoints | `feat(api)` |
| 8 | Proxy with connection pooling and failover | `feat(api)` |
| 9 | Landing page with live 3-step demo | `feat(web)` |
| 10 | README, integration snippets, this board | `docs` |

### Next

| Priority | Item | Why |
|---|---|---|
| P0 | Deploy to Vercel, fill in the live URL above | Nothing is real until it's reachable |
| P0 | End-to-end test against a real provider key | Unit tests cover translation; nothing has hit Anthropic yet |
| P1 | Record the demo clip for the post | The pooling failover is the visual — show two keys, kill one |
| P1 | `X-Fanout-Pool-Health` response header | Surface which connections failed, not just which one won |
| P2 | Retry budget per request | One bad pool of 20 blobs currently costs 20 upstream calls |
| P2 | Token usage in streaming responses | Anthropic sends `message_delta.usage`; currently dropped |

### Icebox

Deliberately not built. Each one trades away the no-database property, which is the point of the
project — revisit only if this stops being a demo.

- **Key revocation** — needs a denylist. Vercel Edge Config is the cheapest place if ever needed.
- **Distributed rate limiting** — needs Upstash. Current limiter is per-instance and approximate.
- **Listing your connections** — impossible by construction; the client holds the only copy.
- **Connection rotation** — would need a `kid` prefix on blobs to accept two key generations.
- **More providers** — trivial to add, but each is ongoing maintenance as its API drifts.

---

## Decision log

Why things are the way they are, so a future change doesn't quietly undo a deliberate choice.

**2026-07-28 · No database, by construction.**
Vercel's free tier has no first-party datastore, and the two things a datastore would buy
(revocation, exact quotas) are not needed for a demo. Keys became HMAC signatures over their own
payload; connections became AES-GCM blobs the client stores. The cost is listed in Icebox above,
and it is an accepted cost, not an oversight.

**2026-07-28 · OpenAI wire format as the canonical API.**
Every client SDK already speaks it, so integration is a `baseURL` change instead of a package
anyone has to install. Translation happens only on the outbound side, per adapter.

**2026-07-28 · Edge runtime, plain `fetch`, zero runtime dependencies.**
No cold starts, native streaming, and WebCrypto covers both HMAC and AES-GCM. Bundling three
provider SDKs would blow the Edge size limit and buy nothing over `fetch`. Zero dependencies also
shrinks the supply-chain surface, which matters because `MASTER_ENCRYPTION_KEY` decrypts every
outstanding connection.

**2026-07-28 · One catch-all route for `/api/v1/*`.**
Hobby caps function count and each file is its own bundle.

**2026-07-28 · Connection blobs are bound to the owner as AES-GCM additional data.**
Without this, a blob scraped from someone else's browser would spend their credits. With it,
decryption fails outright for anyone but the issuing user.

**2026-07-28 · Pool starts at a random offset, not index 0.**
Otherwise the first connection in the header absorbs all traffic and the rest are dead weight.

---

## Known limits

Honest list. None of these are bugs; all are consequences of choices above.

- **Vercel Hobby prohibits commercial use.** Fine for a demo; a real service needs Pro.
- **Rate limiting is approximate.** Per warm instance, resets on cold start, multiplies across
  regions. It protects Fanout's invocation quota, not anyone's provider spend.
- **A leaked key is valid until it expires** (90 days). See revocation in Icebox.
- **Rotating either secret invalidates everything** signed or sealed under it.
- **Bandwidth is paid twice per request** — in from the provider, out to the caller. On a proxy
  that caps throughput well before invocation count does.

---

## Changelog

### 2026-07-28

- Initial build: auth, sealing, three provider adapters, pooling proxy, landing page.
- Verified with 22 runtime checks — cross-user blob rejection, tamper rejection, and SSE
  reassembly across a split chunk boundary all pass. `tsc --noEmit` clean.
