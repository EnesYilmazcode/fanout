# Fanout — project board

Living status doc. Updated in the same commit as the change it describes, so the board is never
stale relative to the code. Newest entries at the top of each log.

**Status:** deployed and verified live — sharing-model question resolved, see Decision log
**Live URL:** https://fanout-tawny.vercel.app
**Last updated:** 2026-07-30

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
| 14 | Adversarial security review of the live deployment | — |
| 15 | Pool cap, per-IP metering, label sanitisation | `fix(security)` |
| 16 | `X-Fanout-Pool-Health` header — per-connection outcomes on every response | `feat(api)` |
| 17 | Static setup page — mint, seal, one copyable config block, strict CSP | `feat(web)` |
| 18 | Homepage redesign — light, minimal, key-first, auto-mint; demo moved to `/demo.html` | `feat(web)` |
| 19 | Supporter relay — `claude-code` model + work queue + worker brief, two-mode homepage | `feat(relay)` |
| 20 | Supporter presence — node heartbeat + `/api/work/status`, live "connected" light | `feat(relay)` |

### Resolved: Fanout is a personal capacity router

The parked P0 — personal router or marketplace — was put to a five-perspective design review
on 2026-07-30 (full report: `docs/design/2026-07-30-dashboard-panel.md`). The verdict was
unanimous: **personal capacity router.** Both supporter mechanisms are dead as proposed:

- **Key deposit (marketplace):** *killed*, not deferred. The target seller (Claude Max, Cursor,
  Copilot) has no API key to deposit — those products auth over OAuth and prohibit credential
  sharing; a console key is pay-per-token, so depositing one is donating money at cost; and
  serving a stranger's key requires deleting the AAD owner-binding, converting
  `MASTER_ENCRYPTION_KEY` into a vault of other people's credentials.
- **Claude Code worker relay:** the machinery is real (headless `claude -p`, long-lived OAuth
  tokens, a small polling loop) but subscription auth is licensed for the holder's own use and
  Anthropic explicitly enforces against it in third-party services — every supporter node would
  risk a ban. It also cannot fit Vercel Hobby function lifetimes or Upstash's free tier.
  Salvage: **self-relay** — your own idle machine serving your own pool — as a future mode of
  the npm package.

What replaces "supporters": sharing with people you know goes through the provider, not through
Fanout — invite them into your Anthropic/OpenAI organization so they hold their own key and seal
their own blob. That is the one sharing mechanism provider terms are built to permit.

### Future products (explicitly separate, each with its real cost)

Not features of this codebase. If either is ever pursued, it is a new commitment:

- **Donation credit pool** ("Patreon for inference") — legally clean; requires commercial
  hosting (Vercel Pro), a datastore for accounting, per-user caps, and an abuse pipeline.
- **Open-model volunteer network** ("BOINC for open weights") — supporters host Ollama/vLLM;
  fixes licensing entirely, but needs a persistent broker, paid hosting, and a disclosed
  plaintext trust model. Effectively a re-platforming that reuses the adapter pattern.

### Next

| Priority | Item | Why |
|---|---|---|
| P1 | End-to-end test with a **real** provider key | The live chain reaches Anthropic and gets a genuine `request_id` back, but no successful completion has been produced yet. Must land before promoting the setup page |
| P1 | GitHub OAuth key recovery | Deterministic re-mint from `HMAC(master_secret, github_id)` — additive, never a gate, zero storage. Covers the lost-key-orphans-blobs failure the setup page's backup button only mitigates |
| P1 | npm client package | Mint/seal/compose-config from the terminal, mirroring the setup page. Design so a self-relay mode can be added later |
| P2 | Retry budget per request | One bad pool of 8 blobs currently costs 8 upstream calls |
| P2 | Token usage in streaming responses | Anthropic sends `message_delta.usage`; currently dropped |
| P2 | Record the demo clip for the post | Failover across your own providers — show two keys, kill one |

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

**2026-07-30 · Personal capacity router, not a marketplace.**
Settled by a five-perspective design review (`docs/design/2026-07-30-dashboard-panel.md`).
The marketplace lost independently on four grounds — terms (credential sharing and subscription
relay are both prohibited by every relevant provider), economics (nothing depositable has idle
headroom), security (it requires deleting the AAD owner-binding), and infrastructure (relay
cannot fit Vercel Hobby or Upstash free tiers). Any one would have sufficed. The AAD
owner-binding stays. The "dashboard" shipped as a static no-login setup page for the same
reason: minting is unauthenticated, so a login would gate nothing; identity arrives later, if
ever, as optional OAuth key *recovery*, not as a gate.

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

## Security review — 2026-07-28

An adversarial pass was run against the live deployment: 14 key-forgery variants, 9 blob-isolation
attacks, secret-leakage scans with a planted sentinel key, SSRF probes, and amplification testing.

**The cryptographic model held.** Every forgery attempt was rejected — payload swapping with a kept
signature, tier escalation `free → pro`, key-version bumps, expiry tampering, single-byte flips in
payload and signature. Every blob-isolation attack was rejected — cross-user replay, byte flips in
the IV, ciphertext and GCM tag, truncation, IV swapping, cross-provider confusion. The planted
provider key never appeared in any response body or header, including on error paths. Endpoints are
hardcoded per adapter, so the model string offers no SSRF surface.

**Two real abuse paths were found, both fixed and re-verified live.**

| Severity | Issue | Fix |
|---|---|---|
| HIGH | Uncapped fan-out. Failover walks the pool serially and nothing bounded its length; ~140 blobs fit under Vercel's 32KB header limit, turning one request into ~140 upstream calls and ~20s of function time. | `MAX_POOL = 8`, rejected with 400 above it. Verified: 100 blobs now returns 400 in ~1s with zero upstream calls. |
| MEDIUM | Rate limits keyed only on user id, while minting a key is unauthenticated and free — so hitting a limit was answered by taking a fresh key and a fresh bucket. | Limits now also apply per source IP, on both minting and the proxy. Verified: minting cuts off after ~10 per source. |
| LOW | The connection label is echoed into a response header and accepted CRLF. Only reachable on the upstream-success path, so never confirmed live. | Stripped to printable ASCII at seal time. |

Worth stating plainly: the IP dimension does **not** stop a distributed caller, and is not meant to.
It closes the trivial single-source bypass. Real enforcement needs shared state — see Icebox.

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

### 2026-07-30 (supporter presence)

- **Live connection detection.** Each `/api/work/next` poll now heartbeats the node (keyed by
  Fanout user id, ~45s TTL); new `GET /api/work/status` reports whether the caller's own node is
  live. The supporter view polls it every 3s and flips from "Waiting for your node to connect…"
  to a green "Connected — your machine is answering requests" the moment the pasted worker loop
  starts. Polling stops when the view is left. Presence is per-key — no cross-user visibility.
  Four new smoke assertions (39 total) plus browser coverage of the offline→online transition.
- Supporter brief reworded to "Paste this into Claude Code or Codex."

### 2026-07-30 (relay + centered homepage)

- **Supporter relay built.** New `claude-code` model routes through a work queue instead of a
  provider: `lib/queue.ts` (Upstash REST when configured, per-instance memory otherwise) plus
  `POST /api/work/next` (supporter long-poll) and `POST /api/work/complete` (deliver). A user's
  `claude-code` request submits a job and waits up to 25s for a supporter's answer, returned
  OpenAI-shaped (streaming supported as a single chunk). Jobs carry only model + flattened
  messages — no requester id or IP; the job UUID is the completion capability. Eight new smoke
  assertions cover the full round-trip (35 total).
- **Homepage rebuilt to the centered two-mode spec**: title centered, a single key box with
  regenerate on the left and a copy icon on the right, and a top-right toggle to the supporter
  view, which shows a copy-paste worker brief for Claude Code embedding the user's key. The
  bring-your-own-keys UI stays at `/demo.html`. Verified in-browser under the CSP, 14 checks.

  Design-note carried forward for honesty: the relay is a plaintext trust relationship
  (supporters read prompts, users read answers), and running the worker on a Claude subscription
  is the supporter's own ToS risk, disclosed where the worker starts. The earlier review killed
  the relay *as an anonymous marketplace*; this is the founder's explicit direction to ship it
  as a free, opt-in supporter network. The AAD owner-binding on provider connections is
  untouched — the relay is a separate path that needs no blobs.

### 2026-07-30 (later)

- **Homepage redesigned to founder's spec**: light mode, minimal, key-first. The page now IS
  the product surface — a key auto-mints on first visit, with Copy and Regenerate, a compact
  provider row (kept because a Fanout key routes nothing without at least one sealed provider
  key), the copyable config block doubling as the API docs, and backup/restore as footer
  links. Regenerate warns and clears sealed providers, since blobs only decrypt under the key
  that made them. The old dark landing/demo moved to `/demo.html`. Same strict CSP; verified
  in-browser under it, 13 checks.

### 2026-07-30

- **Sharing-model P0 resolved: personal capacity router.** Five-perspective design review;
  full report committed to `docs/design/2026-07-30-dashboard-panel.md`. Marketplace framing
  removed from the board, the landing page, and the package description; future products
  (donation pool, open-model volunteer network) recorded separately with their real costs.
- **Setup page shipped** at `/setup.html` — mint, seal, and one copyable config block
  (env / curl / Python / JS), localStorage-backed with download/restore backup, strict CSP,
  no login and no backend changes. Verified in a real browser under the CSP: 12 checks.
- **`X-Fanout-Pool-Health` response header** — every attempt's outcome in walk order
  (`work:429, personal:ok`) on success and failure paths. Fanout's custom headers are now
  CORS-exposed so cross-origin callers can read them. Five new smoke assertions (27 total).

### 2026-07-29

- **README rewritten** in a plainer voice, with a Quickstart at the top so the first thing a
  reader sees is three curls that get them a working call. The old one explained the crypto
  before it explained how to get a key. Also documented things the README had never mentioned:
  the `MAX_POOL = 8` cap, the per-IP rate limits from the security review, the actual per-minute
  numbers, the random start offset, and 403 as a failover trigger (it listed only 401/429/5xx).

### 2026-07-28

- **Security review** of the live deployment. Crypto model survived every attack; two abuse paths
  found and fixed (pool cap, per-IP metering) plus one latent header-injection vector closed.
  Regression tests added for all three. Full detail in the Security review section above.
- **Failover confirmed working live** — an 8-connection pool returns `X-Fanout-Attempts: 8`,
  proving the proxy actually walks the pool rather than giving up on the first failure.
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
