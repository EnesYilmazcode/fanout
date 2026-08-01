# Fanout â€” project board

Living status doc. Updated in the same commit as the change it describes, so the board is never
stale relative to the code. Newest entries at the top of each log.

**Status:** deployed and verified live â€” sharing-model question resolved, see Decision log
**Live URL:** https://fanout-tawny.vercel.app
**Last updated:** 2026-07-31

---

## Board

### Shipped

| # | Item | Commit |
|---|---|---|
| 1 | Repo scaffold â€” TypeScript, Edge config, secret generator | `chore: scaffold` |
| 2 | Self-verifying HMAC API keys, no user table | `feat(auth)` |
| 3 | AES-256-GCM sealed connections bound to owner id | `feat(seal)` |
| 4 | Provider adapters: Anthropic, OpenAI, Groq | `feat(providers)` |
| 5 | Anthropic SSE â†’ OpenAI chunk stream translation | `feat(providers)` |
| 6 | Per-instance sliding-window rate limiter | `feat(ratelimit)` |
| 7 | Key issue + connect endpoints | `feat(api)` |
| 8 | Proxy with connection pooling and failover | `feat(api)` |
| 9 | Landing page with live 3-step demo | `feat(web)` |
| 10 | README, integration snippets, this board | `docs` |
| 11 | Committed test suite â€” `npm test` | `test` |
| 12 | Deployed to production, GitHub auto-deploy connected | â€” |
| 13 | Fixed catch-all routing that 404'd the main endpoint | `fix(api)` |
| 14 | Adversarial security review of the live deployment | â€” |
| 15 | Pool cap, per-IP metering, label sanitisation | `fix(security)` |
| 16 | `X-Fanout-Pool-Health` header â€” per-connection outcomes on every response | `feat(api)` |
| 17 | Static setup page â€” mint, seal, one copyable config block, strict CSP | `feat(web)` |
| 18 | Homepage redesign â€” light, minimal, key-first, auto-mint; demo moved to `/demo.html` | `feat(web)` |
| 19 | Supporter relay â€” `claude-code` model + work queue + worker brief, two-mode homepage | `feat(relay)` |
| 20 | Supporter presence â€” node heartbeat + `/api/work/status`, live "connected" light | `feat(relay)` |
| 21 | Live "N supporters online" count on both views (global presence) | `feat(relay)` |
| 22 | Relay hardening â€” 7 findings from adversarial review fixed | `fix(relay)` |
| 23 | CI (GitHub Actions runs `npm run check`) + `CLAUDE.md` working notes | `chore` |
| 24 | Human README with screenshot and diagram | `docs` (#8) |
| 25 | Demo page wording cleanup | `#9` |
| 26 | Homepage a11y + favicon + theme-color | `feat(web)` (#10) |
| 27 | Token usage in streaming responses | `feat(providers)` (#11) |
| 28 | `/api/health` reports queue backend + supporters online | `feat` (#12) |
| 29 | Rate-limit headers on `/api/work/*` | `feat(relay)` (#13) |
| 30 | End-to-end HTTP integration test â€” `npm run test:e2e` | `test` (#15) |
| 31 | Dead-code sweep (unused exports demoted) | `refactor` (#21) |
| 32 | Defensive error wrappers on key + connect endpoints | `fix` (#22) |
| 33 | README polish + supporter walkthrough | `docs` (#23) |
| 34 | Demo page favicon + theme-color + a11y parity | `feat(web)` (#24) |
| 35 | OPTIONS/CORS preflight on `/api/health` | `feat` (#25) |
| 36 | Security + cache headers via `vercel.json` | `feat` (#30) |
| 37 | Social share preview (OG/Twitter) on the homepage | `feat(web)` (#31) |
| 38 | Smoke coverage for the OpenAI and Groq adapters | `test` (#32) |
| 39 | Request body size cap on the proxy path | `fix` (#33) |
| 40 | Branded 404 page | `feat(web)` (#38) |
| 41 | Auth edge-case tests (expiry, payload swap, junk bearer) | `test` (#39) |
| 42 | `docs/ARCHITECTURE.md` | `docs` (#40) |
| 43 | `/api/health` reports the deployed commit | `feat` (#41) |
| 44 | End-to-end test runs in CI | `ci` (#45) |
| 45 | `SECURITY.md` (reporting via GitHub private advisory) | `docs` (#46) |
| 46 | Clean 503 when server secrets are unconfigured | `fix` (#47) |
| 47 | e2e failure-mode coverage (504, 400, 403 over HTTP) | `test` (#50) |
| 48 | Contributor templates + `CONTRIBUTING.md` | `docs` (#51) |
| 49 | One-line supporter connect via hosted `/llms.txt` | `feat(web)` (#52) |
| 50 | Background supporter worker (`claude -p`) + count-based signal | `feat(web)` (#53) |
| 51 | README leads with human graphics (hero + two-sided how-it-works SVGs) | `docs` (#54) |
| 52 | Upstash queue drops stale jobs by age; work/* guard backend errors (503 envelope) | `fix(queue)` (#55) |
| 53 | Dead-code sweep + shared `rlHeaders` (deduped from 4 copies) | `refactor` (#56) |
| 54 | Four hollow tests rewired to real code paths (label sanitizer, IP limit, TTL, commit) | `test` (#57) |
| 55 | Answer delivery blocks on `BRPOP` instead of polling; Upstash path covered by tests | `perf(queue)` (#58) |
| 56 | `/api/health` caches, meters and guards its queue read | `fix(health)` (#62) |
| 57 | Status polling slowed to 10s and paused for hidden tabs | `fix(web)` (#61) |
| 58 | Streaming relay holds ~110s so real supporter answers arrive; honest 504 | `feat(relay)` (#59, #60) |

### Resolved: Fanout is a personal capacity router

The parked P0 â€” personal router or marketplace â€” was put to a five-perspective design review
on 2026-07-30 (full report: `docs/design/2026-07-30-dashboard-panel.md`). The verdict was
unanimous: **personal capacity router.** Both supporter mechanisms are dead as proposed:

- **Key deposit (marketplace):** *killed*, not deferred. The target seller (Claude Max, Cursor,
  Copilot) has no API key to deposit â€” those products auth over OAuth and prohibit credential
  sharing; a console key is pay-per-token, so depositing one is donating money at cost; and
  serving a stranger's key requires deleting the AAD owner-binding, converting
  `MASTER_ENCRYPTION_KEY` into a vault of other people's credentials.
- **Claude Code worker relay:** the machinery is real (headless `claude -p`, long-lived OAuth
  tokens, a small polling loop) but subscription auth is licensed for the holder's own use and
  Anthropic explicitly enforces against it in third-party services â€” every supporter node would
  risk a ban. It also cannot fit Vercel Hobby function lifetimes or Upstash's free tier.
  Salvage: **self-relay** â€” your own idle machine serving your own pool â€” as a future mode of
  the npm package.

What replaces "supporters": sharing with people you know goes through the provider, not through
Fanout â€” invite them into your Anthropic/OpenAI organization so they hold their own key and seal
their own blob. That is the one sharing mechanism provider terms are built to permit.

### Future products (explicitly separate, each with its real cost)

Not features of this codebase. If either is ever pursued, it is a new commitment:

- **Donation credit pool** ("Patreon for inference") â€” legally clean; requires commercial
  hosting (Vercel Pro), a datastore for accounting, per-user caps, and an abuse pipeline.
- **Open-model volunteer network** ("BOINC for open weights") â€” supporters host Ollama/vLLM;
  fixes licensing entirely, but needs a persistent broker, paid hosting, and a disclosed
  plaintext trust model. Effectively a re-platforming that reuses the adapter pattern.

### Next

| Priority | Item | Why |
|---|---|---|
| P1 | End-to-end test with a **real** provider key | The live chain reaches Anthropic and gets a genuine `request_id` back, but no successful completion has been produced yet. Must land before promoting the setup page |
| P1 | GitHub OAuth key recovery | Deterministic re-mint from `HMAC(master_secret, github_id)` â€” additive, never a gate, zero storage. Covers the lost-key-orphans-blobs failure the setup page's backup button only mitigates |
| P1 | npm client package | Mint/seal/compose-config from the terminal, mirroring the setup page. Design so a self-relay mode can be added later |
| P2 | Retry budget per request | One bad pool of 8 blobs currently costs 8 upstream calls |
| P2 | Token usage in streaming responses | Anthropic sends `message_delta.usage`; currently dropped |
| P2 | Record the demo clip for the post | Failover across your own providers â€” show two keys, kill one |

### Icebox

Deliberately not built. Each one trades away the no-database property, which is the point of the
project â€” revisit only if this stops being a demo.

- **Key revocation** â€” needs a denylist. Vercel Edge Config is the cheapest place if ever needed.
- **Distributed rate limiting** â€” needs Upstash. Current limiter is per-instance and approximate.
- **Listing your connections** â€” impossible by construction; the client holds the only copy.
- **Connection rotation** â€” would need a `kid` prefix on blobs to accept two key generations.
- **More providers** â€” trivial to add, but each is ongoing maintenance as its API drifts.

---

## Decision log

Why things are the way they are, so a future change doesn't quietly undo a deliberate choice.

**2026-07-30 Â· Personal capacity router, not a marketplace.**
Settled by a five-perspective design review (`docs/design/2026-07-30-dashboard-panel.md`).
The marketplace lost independently on four grounds â€” terms (credential sharing and subscription
relay are both prohibited by every relevant provider), economics (nothing depositable has idle
headroom), security (it requires deleting the AAD owner-binding), and infrastructure (relay
cannot fit Vercel Hobby or Upstash free tiers). Any one would have sufficed. The AAD
owner-binding stays. The "dashboard" shipped as a static no-login setup page for the same
reason: minting is unauthenticated, so a login would gate nothing; identity arrives later, if
ever, as optional OAuth key *recovery*, not as a gate.

**2026-07-28 Â· No database, by construction.**
Vercel's free tier has no first-party datastore, and the two things a datastore would buy
(revocation, exact quotas) are not needed for a demo. Keys became HMAC signatures over their own
payload; connections became AES-GCM blobs the client stores. The cost is listed in Icebox above,
and it is an accepted cost, not an oversight.

**2026-07-28 Â· OpenAI wire format as the canonical API.**
Every client SDK already speaks it, so integration is a `baseURL` change instead of a package
anyone has to install. Translation happens only on the outbound side, per adapter.

**2026-07-28 Â· Edge runtime, plain `fetch`, zero runtime dependencies.**
No cold starts, native streaming, and WebCrypto covers both HMAC and AES-GCM. Bundling three
provider SDKs would blow the Edge size limit and buy nothing over `fetch`. Zero dependencies also
shrinks the supply-chain surface, which matters because `MASTER_ENCRYPTION_KEY` decrypts every
outstanding connection.

**2026-07-28 Â· Explicit route files, not a catch-all. _(reversed an earlier decision)_**
The original design used one `api/v1/[...path].ts` to conserve function count. It 404'd in
production for any path deeper than one segment â€” `/api/v1/models` resolved, but
`/api/v1/chat/completions` did not, which is the entire product. Vercel's zero-config `api/`
directory matches a single segment for `[...param]`.

The build was green and the function was listed correctly in `vercel inspect`; only an actual
HTTP request against the deployment revealed it. Worth remembering: a successful build says
nothing about whether a route resolves. Shared logic now lives in `lib/gateway.ts` with thin
route files, at five functions total.

**2026-07-28 Â· Connection blobs are bound to the owner as AES-GCM additional data.**
Without this, a blob scraped from someone else's browser would spend their credits. With it,
decryption fails outright for anyone but the issuing user.

**2026-07-28 Â· Pool starts at a random offset, not index 0.**
Otherwise the first connection in the header absorbs all traffic and the rest are dead weight.

---

## Security review â€” 2026-07-28

An adversarial pass was run against the live deployment: 14 key-forgery variants, 9 blob-isolation
attacks, secret-leakage scans with a planted sentinel key, SSRF probes, and amplification testing.

**The cryptographic model held.** Every forgery attempt was rejected â€” payload swapping with a kept
signature, tier escalation `free â†’ pro`, key-version bumps, expiry tampering, single-byte flips in
payload and signature. Every blob-isolation attack was rejected â€” cross-user replay, byte flips in
the IV, ciphertext and GCM tag, truncation, IV swapping, cross-provider confusion. The planted
provider key never appeared in any response body or header, including on error paths. Endpoints are
hardcoded per adapter, so the model string offers no SSRF surface.

**Two real abuse paths were found, both fixed and re-verified live.**

| Severity | Issue | Fix |
|---|---|---|
| HIGH | Uncapped fan-out. Failover walks the pool serially and nothing bounded its length; ~140 blobs fit under Vercel's 32KB header limit, turning one request into ~140 upstream calls and ~20s of function time. | `MAX_POOL = 8`, rejected with 400 above it. Verified: 100 blobs now returns 400 in ~1s with zero upstream calls. |
| MEDIUM | Rate limits keyed only on user id, while minting a key is unauthenticated and free â€” so hitting a limit was answered by taking a fresh key and a fresh bucket. | Limits now also apply per source IP, on both minting and the proxy. Verified: minting cuts off after ~10 per source. |
| LOW | The connection label is echoed into a response header and accepted CRLF. Only reachable on the upstream-success path, so never confirmed live. | Stripped to printable ASCII at seal time. |

Worth stating plainly: the IP dimension does **not** stop a distributed caller, and is not meant to.
It closes the trivial single-source bypass. Real enforcement needs shared state â€” see Icebox.

---

## Known limits

Honest list. None of these are bugs; all are consequences of choices above.

- **Vercel Hobby prohibits commercial use.** Fine for a demo; a real service needs Pro.
- **Rate limiting is approximate.** Per warm instance, resets on cold start, multiplies across
  regions. It protects Fanout's invocation quota, not anyone's provider spend.
- **A leaked key is valid until it expires** (90 days). See revocation in Icebox.
- **Rotating either secret invalidates everything** signed or sealed under it.
- **Bandwidth is paid twice per request** â€” in from the provider, out to the caller. On a proxy
  that caps throughput well before invocation count does.

---

## Changelog

### 2026-08-01 (relay cost and Upstash coverage)

- **Real answers actually reach the caller now** (#59). Verified against production first: a real
  headless `claude -p` answering a real question took 23.3s, the caller was cut off at 20s, and the
  finished answer expired in Redis unread. The relay was demoing on toy prompts and failing at its
  advertised job. Edge only requires a response to BEGIN within 25s, so the streaming path now
  sends its first chunk immediately and then waits in 15s slices with SSE keepalives, up to about
  110s. The buffered path keeps the 20s cap, because there the deadline is real.
- **The 504 stopped blaming the wrong thing** (#60). `awaitResult` returning null was reported as
  "no supporter picked this up", including when one had and was still writing, which told the
  caller to retry and spend a supporter's tokens twice on the same prompt. It now checks presence
  and says which of the two happened, and points at `stream: true` when the answer was merely slow.
  The streaming path checks presence once after the first empty slice and gives up early when
  nothing is polling, so an empty relay still fails fast instead of holding the caller for 110s.
- **An open tab stopped costing 60 Upstash commands a minute** (#61). The homepage polled
  `/api/work/status` every 3 seconds, forever, including while the tab was in the background, and
  each poll is three commands (`ZSCORE`, prune, `ZCARD`). Presence has a 45s TTL, so 3s was never
  buying accuracy. Now 10s, and paused entirely while the tab is hidden, with an immediate poll on
  return so the number is current when it is actually being looked at.
- **`/api/health` stopped handing out free queue reads** (#62). `supporters_online` called
  `countLive()` on every hit, which is a prune plus a count, so two metered Upstash commands per
  anonymous request with no key and no limiter anywhere in the file. A curl loop was the cheapest
  way to spend the project's whole monthly queue budget. It now serves a 5s cache, meters cache
  misses per source, and catches a queue failure instead of returning a bare platform 500. That
  last part matters on its own: the endpoint you check to find out whether the service is broken
  was the one endpoint the #55 outage guard missed.

- **Answer delivery stopped polling** (#58). `awaitResult` ran a `GET` twice a second for the whole
  wait window, so every relayed request cost about 40 Upstash commands and a timeout cost the full
  40 for nothing. The job side already solved this with `BRPOP`; the answer side now does the same.
  A 20s wait is 2 commands instead of 40. That matters on its own (Upstash free is 500K commands a
  month) and it is what makes a longer wait window affordable, which is the fix for #59.
- **The Upstash path has tests for the first time** (#58). `test/fake-upstash.mts` is a small REST
  stand-in that speaks the handful of Redis commands the queue uses, so `npm run test:upstash`
  exercises the branch that actually serves production instead of the memory fallback. It covers
  the job round trip, the stale-job drop from #55 (previously untested, and the kind of bug only
  this path can have), answer delivery, presence, and the 503 outage guard. It also counts
  commands, so the cost claim above is asserted rather than argued.

### 2026-07-31 (README graphics + audit-driven fixes)

- **README made human and visual** (#54): a hero banner and a two-sided how-it-works diagram
  (your app -> Fanout -> your provider keys | supporters running Claude Code / Codex), both as
  self-contained SVGs that render inline on GitHub. Intro reworked so both paths land in the
  first screen; mermaid kept as a text fallback.
- **Deep audit** (20 verifier agents, 5 lenses: bugs / dead code / useless tests / simplification
  / config correctness). Every finding was adversarially verified against source before any fix.
  The confirmed set was triaged and the real, safe ones shipped:
  - **Real prod bug** (#55): the Upstash queue never expired jobs by age, while the memory store
    did. A queue that filled while no supporter was online would feed the first node to connect a
    backlog of already-abandoned prompts (real LLM quota spent on dead requests, live requests
    starved behind them). `upstashStore.waitPop` now skips jobs older than `JOB_MAX_AGE_MS`,
    matching the memory store. Also wrapped the `work/*` queue calls so an Upstash outage returns
    a 503 JSON/CORS envelope instead of a bare platform 500.
  - **Dead code + simplification** (#56): `rlHeaders()` was copy-pasted into four files, now
    hoisted to a single export in `lib/ratelimit.ts`. `frames()` parsed an SSE `event:` line no consumer
    read (dropped). Removed dead `id` attributes on the status dots, an unused catch binding, and
    a no-op base64<->base64url round trip in `seal.ts`.
  - **Tests that did not test** (#57): the label header-injection test asserted an inline copy of
    the regex instead of the real sanitizer, now drives the connect handler and decrypts the
    sealed blob. IP rate-limit enforcement was never exercised, so it now mints through the real
    handler until it 429s. The 90-day TTL is now asserted on the issued key. `health.commit` now
    asserts its specific "dev" fallback instead of `length > 0` (which could never fail).

### 2026-07-30 (background worker + Upstash reminder)

- **From live testing of the one-liner** (#53): `llms.txt` now tells the agent to run the worker
  as a background shell and answer each job with headless `claude -p`; the supporter view leads
  with the global "N supporters online" count (the one-liner mints its own key, so the browser's
  per-key connected light never fires). **Reminder made concrete:** the count and the relay only
  work in production once `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set â€” Vercel's serverless
  instances do not share the in-memory fallback, so a supporter and the site land on different
  instances. This is the founder's next setup step (Upstash free tier), not a code change.

### 2026-07-30 (one-line supporter connect)

- **The intended supporter flow** (#52): a supporter tells Claude Code one line, "Connect to
  <site> and run as a Fanout supporter," and Claude fetches `public/llms.txt` and runs the
  poll/answer/complete loop itself, minting its own key. Nothing to paste, no key to copy. The
  supporter view leads with the copyable one-liner; the full manual brief is a collapsible
  fallback. Homepage links agents at `/llms.txt`.

### 2026-07-30 (overnight â€” sixth fleet)

- **Sixth parallel fleet** (issues #48-#49, PRs #50-#51): the e2e test now also covers the
  hardened failure modes over real HTTP (no-supporter 504, oversized-body 400, cross-key blob
  403, missing-connection 400), and the repo gained a `CONTRIBUTING.md`, a PR template, and issue
  templates.
- **Overnight loop wound down here** after six fleets (26 PRs, issues #2-#49): the genuinely
  valuable, safe backlog is worked through. Remaining ideas are either product decisions for the
  founder (the two "future products") or need a real funded provider key (the last unverified
  link). The heartbeat stays armed for periodic checks rather than manufacturing busywork.

### 2026-07-30 (overnight â€” fifth fleet)

- **Fifth parallel fleet** (issues #42-#44, PRs #45-#47): the end-to-end test now runs in CI, a
  `SECURITY.md` states the reporting route (GitHub private advisory), scope, and honest limits,
  and the key/connect/proxy endpoints return a clean 503 "Fanout is not configured" when a server
  secret is missing instead of a generic 500. The maintainer's personal email was kept out of the
  public SECURITY.md by choice.

### 2026-07-30 (overnight â€” fourth fleet)

- **Fourth parallel fleet** (issues #34-#37, PRs #38-#41): a branded 404 page, auth edge-case
  tests (expiry enforcement, payload-swap rejection, junk-bearer handling, tier preservation),
  a concise `docs/ARCHITECTURE.md`, and a `commit` field on `/api/health` from
  `VERCEL_GIT_COMMIT_SHA` so you can confirm which build is live.

### 2026-07-30 (overnight â€” third fleet)

- **Third parallel fleet** (issues #26-#29, PRs #30-#33): `vercel.json` with security headers
  (nosniff, no-referrer, DENY framing, locked-down Permissions-Policy) and immutable caching for
  static assets; an Open Graph / Twitter share preview with a served `/og.png`; real smoke
  coverage for the OpenAI and Groq adapters; and a request body size cap on the proxy path so an
  oversized payload is rejected with a clean 400 before any upstream call.

### 2026-07-30 (overnight â€” end-to-end test + second fleet)

- **End-to-end HTTP test** (#15, `npm run test:e2e`): boots the real handlers on a local server
  and drives a full supporter round trip over HTTP (a real worker loop polls, answers, and the
  `claude-code` reply comes back, streaming and not), plus the bring-your-own-keys path against a
  fake provider. Proves the whole system works, not just units.
- **Second parallel fleet** (issues #16-#20, PRs #21-#25): dead-code sweep (three unused exports
  in `lib/gateway.ts` demoted to module-local), defensive error wrappers on the key and connect
  endpoints so nothing leaks a bare platform 500, a README polish pass, favicon/theme-color/a11y
  parity for the demo page, and an OPTIONS/CORS preflight on `/api/health`.
- Continuous overnight loop runs from the main session (GitHub tools + Workflow engine); the
  hourly cron is disabled while it runs to avoid two workers racing.

### 2026-07-30 (parallel fleet â€” six PRs)

Worked as parallel teams: six issues (#2-#7) opened at once, each implemented on its own
branch by an isolated agent, reviewed by a separate agent, and merged as PRs #8-#13.

- #8 README rewritten to be plain and human (no em dashes), with a homepage screenshot and a
  Mermaid flow diagram.
- #9 removed the stale "crowdsourced" example from the demo page.
- #10 homepage accessibility and mobile polish: theme-color, an SVG favicon that respects the
  strict CSP, focus-visible rings, aria labels, and aria-live on the copy feedback.
- #11 streaming responses can now emit a trailing OpenAI-shaped `usage` chunk, gated on
  `stream_options.include_usage`.
- #12 `/api/health` now reports the queue backend (`upstash` or `memory`) and `supporters_online`.
- #13 `/api/work/*` endpoints now carry `X-RateLimit-*` headers and expose them via CORS.

Also switched the autonomous improvement routine to a continuous internal loop (ships many small
tested changes per run, stops when it runs out of safe work) instead of one change per hour.

### 2026-07-30 (review hardening + online count)

- **Live "N supporters online" count** on both the use view (so a caller knows `claude-code` will
  be answered) and the supporter view, backed by a global presence count in the queue (Redis
  sorted set / in-memory map). Status endpoint now returns `{connected, online}`.
- **Adversarial review of the relay, 7 confirmed findings fixed** (full run archived under the
  session; verified against source before fixing):
  1. Uncaught exceptions in the relay path returned a bare Edge 500 with no CORS/OpenAI envelope
     â†’ whole handler wrapped, queue errors become a clean 502, null/again message elements coerced.
  2. `flatten()` silently relayed an empty prompt for text-less content â†’ rejected with 400.
  3â€“4. 25s relay wait raced Vercel Edge's ~25s deadline (platform 504 HTML) and 504'd healthy
     relays â†’ `RELAY_WAIT_MS` cut to 20s, safely under the deadline, returns our own clean 504.
  5. In-memory job queue grew unbounded with no supporter polling â†’ age-trim + `MAX_QUEUE` cap
     on push (both stores).
  6. Memory results map leaked â†’ opportunistic sweep.
  7. Upstash busy-poll (~100k commands/day per idle supporter) â†’ **BRPOP** blocking pop (one
     command per poll window) and one-command presence heartbeat. ~25Ã— cheaper.
- **CI**: `.github/workflows/ci.yml` runs `npm run check` on every push to main and every PR â€”
  the gate for the overnight autonomous improvement loop. Added `CLAUDE.md` working notes.
- Smoke suite now 50 assertions (relay guards, presence, global count).

### 2026-07-30 (supporter presence)

- **Live connection detection.** Each `/api/work/next` poll now heartbeats the node (keyed by
  Fanout user id, ~45s TTL); new `GET /api/work/status` reports whether the caller's own node is
  live. The supporter view polls it every 3s and flips from "Waiting for your node to connectâ€¦"
  to a green "Connected â€” your machine is answering requests" the moment the pasted worker loop
  starts. Polling stops when the view is left. Presence is per-key â€” no cross-user visibility.
  Four new smoke assertions (39 total) plus browser coverage of the offlineâ†’online transition.
- Supporter brief reworded to "Paste this into Claude Code or Codex."

### 2026-07-30 (relay + centered homepage)

- **Supporter relay built.** New `claude-code` model routes through a work queue instead of a
  provider: `lib/queue.ts` (Upstash REST when configured, per-instance memory otherwise) plus
  `POST /api/work/next` (supporter long-poll) and `POST /api/work/complete` (deliver). A user's
  `claude-code` request submits a job and waits up to 25s for a supporter's answer, returned
  OpenAI-shaped (streaming supported as a single chunk). Jobs carry only model + flattened
  messages â€” no requester id or IP; the job UUID is the completion capability. Eight new smoke
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
  untouched â€” the relay is a separate path that needs no blobs.

### 2026-07-30 (later)

- **Homepage redesigned to founder's spec**: light mode, minimal, key-first. The page now IS
  the product surface â€” a key auto-mints on first visit, with Copy and Regenerate, a compact
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
- **Setup page shipped** at `/setup.html` â€” mint, seal, and one copyable config block
  (env / curl / Python / JS), localStorage-backed with download/restore backup, strict CSP,
  no login and no backend changes. Verified in a real browser under the CSP: 12 checks.
- **`X-Fanout-Pool-Health` response header** â€” every attempt's outcome in walk order
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
- **Failover confirmed working live** â€” an 8-connection pool returns `X-Fanout-Attempts: 8`,
  proving the proxy actually walks the pool rather than giving up on the first failure.
- **Deployed to production** at https://fanout-tawny.vercel.app, with the GitHub repo connected
  so pushes deploy themselves. Secrets are set for all three environments.
- **Fixed a production-only 404** on `/api/v1/chat/completions` caused by catch-all route depth.
  Found by smoke-testing the live deploy, not by the build.
- Verified live: key issuing, connection sealing, auth enforcement, rate-limit headers, model
  validation, and â€” the important one â€” a blob issued to one user is rejected (403) when a
  different user presents it. The full chain reaches Anthropic and returns a real `request_id`.
- Test suite committed to `test/smoke.mts`; `npm run check` runs typecheck plus 22 assertions.
  Previously these existed only as throwaway scratch, which meant no one could re-run them.
- Initial build: auth, sealing, three provider adapters, pooling proxy, landing page.
- Verified with 22 runtime checks â€” cross-user blob rejection, tamper rejection, and SSE
  reassembly across a split chunk boundary all pass. `tsc --noEmit` clean.
