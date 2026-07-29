# Fanout — project board

Living status doc. Updated in the same commit as the change it describes, so the board is never
stale relative to the code. Newest entries at the top of each log.

**Status:** deployed and verified live
**Live URL:** https://fanout-tawny.vercel.app
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
| 11 | Committed test suite — `npm test` | `test` |
| 12 | Deployed to production, GitHub auto-deploy connected | — |
| 13 | Fixed catch-all routing that 404'd the main endpoint | `fix(api)` |

### Next

| Priority | Item | Why |
|---|---|---|
| P0 | End-to-end test with a **real** provider key | The live chain reaches Anthropic and gets a genuine `request_id` back, but no successful completion has been produced yet |
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

**2026-07-28 · Explicit route files, not a catch-all. _(reversed an earlier decision)_**
The original design used one `api/v1/[...path].ts` to conserve function count. It 404'd in
production for any path deeper than one segment — `/api/v1/models` resolved, but
`/api/v1/chat/completions` did not, which is the entire product. Vercel's zero-config `api/`
directory matches a single segment for `[...param]`.

The build was green and the function was listed correctly in `vercel inspect`; only an actual
HTTP request against the deployment revealed it. Worth remembering: a successful build says
nothing about whether a route resolves. Shared logic now lives in `lib/gateway.ts` with thin
route files, at five functions total.

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

- **Deployed to production** at https://fanout-tawny.vercel.app, with the GitHub repo connected
  so pushes deploy themselves. Secrets are set for all three environments.
- **Fixed a production-only 404** on `/api/v1/chat/completions` caused by catch-all route depth.
  Found by smoke-testing the live deploy, not by the build.
- Verified live: key issuing, connection sealing, auth enforcement, rate-limit headers, model
  validation, and — the important one — a blob issued to one user is rejected (403) when a
  different user presents it. The full chain reaches Anthropic and returns a real `request_id`.
- Test suite committed to `test/smoke.mts`; `npm run check` runs typecheck plus 22 assertions.
  Previously these existed only as throwaway scratch, which meant no one could re-run them.
- Initial build: auth, sealing, three provider adapters, pooling proxy, landing page.
- Verified with 22 runtime checks — cross-user blob rejection, tamper rejection, and SSE
  reassembly across a split chunk boundary all pass. `tsc --noEmit` clean.
