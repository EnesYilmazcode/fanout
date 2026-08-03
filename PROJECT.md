# Relaybee — project board

Living status doc. Updated in the same commit as the change it describes, so the board is never
stale relative to the code. Newest entries at the top of each log.

**Status:** deployed, and the relay is now verified end to end on production rather than only in
local tests. One open question needs a decision from the owner: see P0 in Next.
**Live URL:** https://relaybee.vercel.app
**Last updated:** 2026-08-02

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
| 16 | `X-Relaybee-Pool-Health` header — per-connection outcomes on every response | `feat(api)` |
| 17 | Static setup page — mint, seal, one copyable config block, strict CSP | `feat(web)` |
| 18 | Homepage redesign — light, minimal, key-first, auto-mint; demo moved to `/demo.html` | `feat(web)` |
| 19 | Supporter relay — `claude-code` model + work queue + worker brief, two-mode homepage | `feat(relay)` |
| 20 | Supporter presence — node heartbeat + `/api/work/status`, live "connected" light | `feat(relay)` |
| 21 | Live "N supporters online" count on both views (global presence) | `feat(relay)` |
| 22 | Relay hardening — 7 findings from adversarial review fixed | `fix(relay)` |
| 23 | CI (GitHub Actions runs `npm run check`) + `CLAUDE.md` working notes | `chore` |
| 24 | Human README with screenshot and diagram | `docs` (#8) |
| 25 | Demo page wording cleanup | `#9` |
| 26 | Homepage a11y + favicon + theme-color | `feat(web)` (#10) |
| 27 | Token usage in streaming responses | `feat(providers)` (#11) |
| 28 | `/api/health` reports queue backend + supporters online | `feat` (#12) |
| 29 | Rate-limit headers on `/api/work/*` | `feat(relay)` (#13) |
| 30 | End-to-end HTTP integration test — `npm run test:e2e` | `test` (#15) |
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
| 59 | A caller that gives up withdraws its job instead of leaving it queued | `fix(relay)` (#67) |
| 60 | Supporter worker loop handles error statuses, backs off, always answers | `fix(supporter)` (#70) |
| 61 | Supporter-side risks (untrusted prompts, plan terms) shown where supporters start | `docs` (#72) |
| 62 | Poll window aligned to the BRPOP cap, heartbeat throttled, cost model corrected | `perf(relay)` (#74) |
| 63 | Hosted API docs at `/docs.html` — every example filled with the reader's own key, plus a live relay test on the page | `docs(web)` |
| 64 | Renamed to Relaybee — bee mark, `relaybee.vercel.app`, `rb_live_` keys, old key and header still accepted | `refactor(brand)` |
| 65 | `/demo.html` removed; homepage trimmed to key, status, and two footer links | `refactor(web)` |

### Resolved: Relaybee is a personal capacity router

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
Relaybee — invite them into your Anthropic/OpenAI organization so they hold their own key and seal
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
| P0 | **Decide the relay's direction** ([#76](https://github.com/EnesYilmazcode/relaybee/issues/76)) | This board says the supporter relay is dead on terms grounds. The homepage leads with it. The measurements that were missing are now attached to the issue: the free tier fits about one supporter, and real answers ranged from 4s to 283s against a 110s ceiling |
| P1 | End-to-end test with a **real** provider key | The largest unverified claim in the repo. The live chain reaches Anthropic and returns a real `request_id`, but no successful completion has ever come back, and `test/e2e.mts` mocks the upstream, so the Anthropic response parsing is only ever checked against a fake written from the docs. One minute and about two cents: `node scripts/verify-provider.mjs` |
| P1 | npm client package | Mint/seal/compose-config from the terminal, mirroring the setup page. Design so a self-relay mode can be added later |
| P2 | Retry budget per request | One bad pool of 8 blobs currently costs 8 upstream calls |
| P2 | Record the demo clip for the post | Failover across your own providers — show two keys, kill one |
| P3 | GitHub OAuth key recovery | **Demoted 2026-08-01.** Its stated justification does not survive the code. The reason given was that a lost key orphans every AAD-bound blob, but user ids are generated randomly at mint time (`api/keys/issue.ts`, `${clean}_${randomUUID}`) and blobs are sealed to that id, so an OAuth-derived id is a different id and opens none of them. It could only help someone who arrived through OAuth on their first ever mint, and there are none. The mechanism stays pre-agreed if identity is ever forced |

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
  regions. It protects Relaybee's invocation quota, not anyone's provider spend.
- **A leaked key is valid until it expires** (90 days). See revocation in Icebox.
- **Rotating either secret invalidates everything** signed or sealed under it.
- **The relay fits about one continuous supporter on Upstash free.** An idle supporter node costs
  roughly 6 Redis commands a minute (one blocking poll plus a throttled heartbeat), about 259K a
  month against a 500K free tier. This is a real ceiling on the public relay, not a rounding error.
- **Bandwidth is paid twice per request** — in from the provider, out to the caller. On a proxy
  that caps throughput well before invocation count does.

---

## Changelog

### 2026-08-02 (the script for the oldest P1 could not run)

- **`scripts/verify-provider.mjs` has been broken since the rename, and it is the one command
  this board points at for its oldest P1.** Three defects, in the order you hit them. It
  defaulted `--base` to `https://relaybee-tawny.vercel.app`, a host that has never existed: the
  old one was `fanout-tawny` and the new one is `relaybee`, and the rename produced a name that
  is neither. The resulting Vercel 404 is plain text, and the health response was parsed
  unguarded, so the failure surfaced as an undici stack trace rather than an error. And it
  asserted the minted key starts with `fo_live_`, which stopped being minted on 2026-08-01, so
  even pointed at the right host it printed "1 check(s) FAILED" and exited 1 on a fully
  successful run.
- **The third one is the worst, because it fails in the direction that looks like a real
  finding.** The script's closing line tells the reader a failure means the provider contract
  does not match what `lib/providers.ts` assumes. That is exactly the wrong conclusion, and it
  is what this file has been handing anyone who ran it.
- Verified against production rather than locally: a wrong `--base` now exits 2 with a sentence
  instead of a trace, the default resolves and reports commit `4a88331`, the key assertion
  passes, and with a deliberately bogus provider key the chain reaches Anthropic and comes back
  with a real `request_id` and `invalid x-api-key`. So everything up to the funded-key step is
  now proven by running it. The prefix assertion is commented with where it mirrors
  (`lib/auth.ts`) since it is the thing that silently rotted, and only the prefix is echoed,
  never the key, which is a live bearer token for 90 days.
- Not fixed, and worth knowing: the P1 itself is still open. This makes the command runnable; it
  does not run it against a funded key.

### 2026-08-02 (supporter risk note comes off the homepage)

- The two paragraphs on the supporter view (your machine answers strangers' requests and they see
  your answers; the prompt reaches your agent as untrusted input; a consumer subscription is
  licensed to its holder) were **removed at the owner's request**. Recorded plainly because entry
  #61 added them on purpose and this reverses that.
- **The disclosure is not gone from the product.** It still lives in `public/llms.txt` in full,
  including the "if either of those gives you pause, do not run a supporter node" line, and that is
  the file the one-liner makes an agent fetch and follow before it runs anything, so it remains on
  the path a supporter actually takes. The smoke assertion moved rather than disappeared: it now
  pins that the connect line still sends the agent to `llms.txt`, because if that link ever goes,
  nothing discloses anything to anyone.

### 2026-08-02 (the site is two pages now)

- **`/demo.html` is gone**, along with `demo.css` and `demo.js`. It was the original dark landing
  page turned interactive walkthrough, and the homepage plus the docs page had both grown to cover
  what it did, so it was a third version of the same explanation with its own CSP, its own theme
  colour and its own a11y assertions to keep in step.
- **Bring-your-own-keys is not gone**, only its UI. It is still a real path through the API,
  `POST /api/connect` then the blob in a header, and section 4 of the docs page covers it with
  copyable commands. The page that took a live provider secret in a form field was also the one
  page that most deserved not to exist.
- Homepage trimmed: the "how to use this key" line went (the docs link in the footer already says
  it), the footer is now docs and source, and the mode toggle reads **Support** instead of
  "Become a supporter".
- Assertions replace the removed ones rather than just disappearing: the three files stay deleted,
  and no page links to `demo.html`, because a link to a page that no longer exists is worse than no
  link at all.

### 2026-08-01 (renamed to Relaybee)

- **The name changed and the address changed.** The old one was
  `fanout-tawny.vercel.app`, where "tawny" is a random word Vercel appends when it generates a
  subdomain. Worth recording how the replacement was picked, because the obvious method does not
  work: an unclaimed `*.vercel.app` subdomain and one assigned to a project with no live deployment
  return a **byte-identical** 404, same status, same headers, same body, so probing over HTTP tells
  you nothing. The only real test is the API refusing the add. Roughly 120 names were tested that
  way. Every clean single dictionary word was gone, across eight metaphor families (axon, synapse,
  plexus, semaphore, mycelium, apiary, loom, weave, spool, glean, windfall, patchwork, cairn,
  potlatch, thread, braid). Compounds are almost all free.
- **Three identifiers could not just be renamed**, because each one lives somewhere this repo does
  not control. Keys were `fo_live_`, are HMAC signatures with a 90 day life, and have no store to
  migrate, so `verifyKey` accepts both prefixes and new keys mint as `rb_live_`. The
  `X-Fanout-Connection` header sits in other people's env files, so it still routes and is still
  allowed through preflight. `localStorage` held `fanout_key` and `fanout_conns`, both read once
  under the old names, since a connection blob only decrypts under the key that sealed it and
  dropping the key would strand every blob with it. Each has an assertion, including a tampered
  legacy key still being rejected, so a later cleanup cannot remove the compatibility by accident.
- **The bee is drawn here, not imported.** No icon set has one: Lucide, Tabler and Phosphor all ship
  beef and beer and no bee, and the sets that do (game-icons, Twemoji) are CC-BY, which would put an
  attribution requirement and a foreign drawing style into a repo with neither. It is checked at
  128, 64, 32 and 16 pixels and inverted on dark. It also flies around the homepage, hidden outright
  under `prefers-reduced-motion`, and animated in CSS because the CSP forbids inline styles and the
  script that would otherwise drive it.
- Verified on production rather than locally: the deployed commit, a fresh `rb_live_` key
  authenticating against `/api/v1/models`, the docs page filling its examples with that key, the bee
  actually moving between two samples, and no CSP violations on either page.

### 2026-08-01 (a docs page that runs)

- **"docs" in the footer pointed at the GitHub README, and the README does not know your key.** The
  homepage hands you a key and a live count of supporters who could answer it, and then the next
  step was on a different site, written in placeholders. That is the gap that got reported: the page
  can tell you a supporter is online but not what to do with the key you are holding. `/docs.html`
  reads the key this browser already has and substitutes it into every example, so the first curl on
  the page is one you can paste and run.
- **It also makes the call itself.** A prompt box on the page sends the real streaming request with
  the real key, so "does my key work" is answered on the page instead of after a round trip through
  a terminal. It reports the same error envelope the API returns, verbatim.
- Covers both paths (`claude-code` relay and bring-your-own-keys), why `stream: true` is a
  requirement rather than a preference on the relay, model naming, and the failure statuses a caller
  actually hits with what to do about each. Also a PowerShell variant of the first curl, since the
  single-quoted JSON body in the standard one does not survive PowerShell.
- Verified in a real browser against the live handlers, not only asserted: mint from the page, key
  substituted into every snippet, presence count, a full streaming relay answer delivered by a
  supporter node, and zero CSP violations. 12 new smoke assertions pin the parts a reader copies.

### 2026-08-01 (board accuracy, and a repair)

- **The board was stale, which this document specifically promises not to be.** Its first paragraph
  says it is updated in the same commit as the change it describes. One of six open items,
  "Token usage in streaming responses", was already shipped as board item 27 and is asserted in the
  smoke suite. Removed. A checkable claim in the opening line that fails on inspection costs more
  than the row was worth.
- **GitHub OAuth key recovery demoted from P1 to P3.** Its justification does not survive the code.
  The reason given was that a lost key orphans every AAD-bound blob, but user ids are random per
  mint (`api/keys/issue.ts`) and blobs are sealed to that id, so an OAuth-derived id opens none of
  them. It could only ever help someone who arrived through OAuth on their first mint.
- **`scripts/verify-provider.mjs` added** so the oldest P1 is one command instead of a project.
  It mints, seals, and runs a real non-streaming and streaming completion against a live provider,
  checking the answer, the usage translation, the pool-health header, and the streamed reassembly.
  Run with a bogus key it already proves the chain reaches Anthropic and returns a real
  `request_id`; it needs a funded key to finish the job.
- **Encoding repaired.** Earlier edits in this session went through Windows PowerShell, which read
  this file as ANSI and wrote it back as UTF-8, turning every em dash into mojibake and adding a
  BOM. 76 characters across the file were mangled. Repaired and verified against the pre-session
  blob: 57 em dashes, 9 arrows, 7 middots and one each of the rest, exactly as before. Worth
  recording as a note to self: edit files here with a UTF-8 aware tool, not `Get-Content` piped
  into `Set-Content`.

### 2026-08-01 (relay cost and Upstash coverage)

- **The cost model was wrong by 3x, and is now right** (#74). The code comment and this board both
  claimed one Redis command per supporter poll window. `POLL_WINDOW_MS` was 20s while `waitPop`
  caps each blocking call at 15s, so every window issued two BRPOPs, plus a heartbeat ZADD on every
  poll that presence's 45s TTL never needed. Real cost was 3 commands per 20s, about 13k a day,
  roughly 78% of the whole 500K monthly free tier for a single idle supporter. The window now
  matches the blocking cap so a poll is one BRPOP, and the heartbeat fires at most every 30s.
  About 6 commands a minute now, 259K a month. Worth stating plainly rather than burying: even
  fixed, two continuously running supporters do not fit on the free tier.
- **Supporters can now see the risks this board already recorded** (#72). The Resolved section
  says subscription auth is licensed for the holder's own use and that every supporter node would
  risk a ban. That was written here and nowhere a supporter could read it, while the homepage asked
  strangers to point Claude Code at the site and start answering. A risk this project has reasoned
  about and then not passed on is worse than one nobody noticed. Prompt injection was the second
  gap: the design review covered a malicious supporter poisoning a caller and never the reverse,
  which is the direction that runs on someone else's machine. Both are now in `llms.txt` and on the
  supporter view, with the honest alternative, which is the bring-your-own-keys path rather than
  the self-relay line the design doc suggests, since the queue is global and no node can currently
  answer only its own requests.
- **The supporter worker loop stopped being dangerous on error paths** (#70). It decided "is there
  work" by testing whether the body was empty. A 204 is empty and was fine, but 401, 429 and 503
  all return non-empty JSON, so all three were treated as jobs, and none of them long-poll. With no
  sleep in the loop, one rate-limit trip turned a polite worker into a hot loop on a volunteer's
  machine, spawning `claude -p` each pass. It now branches on the status code, backs off,
  preflights jq, and always POSTs an answer even when the attempt failed, because taking a job
  removes it from the queue and silence leaves the caller with nothing.
- **A caller that gives up no longer leaves work behind** (#67). Found in production while
  verifying the change below. A request gave up after 15s with nobody online, its job stayed
  queued, and a supporter that connected moments later spent 16.1 seconds of real model time
  answering it. It was busy doing that instead of taking the live request behind it, so one
  abandoned job cost a volunteer's tokens and starved a real caller at once. The age trim from
  #55 cannot see this: a job abandoned at 15s still looks fresh for another 45. The caller now
  withdraws its own job, which is the only party that knows.
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
  (your app -> Relaybee -> your provider keys | supporters running Claude Code / Codex), both as
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
  work in production once `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set — Vercel's serverless
  instances do not share the in-memory fallback, so a supporter and the site land on different
  instances. This is the founder's next setup step (Upstash free tier), not a code change.

### 2026-07-30 (one-line supporter connect)

- **The intended supporter flow** (#52): a supporter tells Claude Code one line, "Connect to
  <site> and run as a Relaybee supporter," and Claude fetches `public/llms.txt` and runs the
  poll/answer/complete loop itself, minting its own key. Nothing to paste, no key to copy. The
  supporter view leads with the copyable one-liner; the full manual brief is a collapsible
  fallback. Homepage links agents at `/llms.txt`.

### 2026-07-30 (overnight — sixth fleet)

- **Sixth parallel fleet** (issues #48-#49, PRs #50-#51): the e2e test now also covers the
  hardened failure modes over real HTTP (no-supporter 504, oversized-body 400, cross-key blob
  403, missing-connection 400), and the repo gained a `CONTRIBUTING.md`, a PR template, and issue
  templates.
- **Overnight loop wound down here** after six fleets (26 PRs, issues #2-#49): the genuinely
  valuable, safe backlog is worked through. Remaining ideas are either product decisions for the
  founder (the two "future products") or need a real funded provider key (the last unverified
  link). The heartbeat stays armed for periodic checks rather than manufacturing busywork.

### 2026-07-30 (overnight — fifth fleet)

- **Fifth parallel fleet** (issues #42-#44, PRs #45-#47): the end-to-end test now runs in CI, a
  `SECURITY.md` states the reporting route (GitHub private advisory), scope, and honest limits,
  and the key/connect/proxy endpoints return a clean 503 "Relaybee is not configured" when a server
  secret is missing instead of a generic 500. The maintainer's personal email was kept out of the
  public SECURITY.md by choice.

### 2026-07-30 (overnight — fourth fleet)

- **Fourth parallel fleet** (issues #34-#37, PRs #38-#41): a branded 404 page, auth edge-case
  tests (expiry enforcement, payload-swap rejection, junk-bearer handling, tier preservation),
  a concise `docs/ARCHITECTURE.md`, and a `commit` field on `/api/health` from
  `VERCEL_GIT_COMMIT_SHA` so you can confirm which build is live.

### 2026-07-30 (overnight — third fleet)

- **Third parallel fleet** (issues #26-#29, PRs #30-#33): `vercel.json` with security headers
  (nosniff, no-referrer, DENY framing, locked-down Permissions-Policy) and immutable caching for
  static assets; an Open Graph / Twitter share preview with a served `/og.png`; real smoke
  coverage for the OpenAI and Groq adapters; and a request body size cap on the proxy path so an
  oversized payload is rejected with a clean 400 before any upstream call.

### 2026-07-30 (overnight — end-to-end test + second fleet)

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

### 2026-07-30 (parallel fleet — six PRs)

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
     → whole handler wrapped, queue errors become a clean 502, null/again message elements coerced.
  2. `flatten()` silently relayed an empty prompt for text-less content → rejected with 400.
  3–4. 25s relay wait raced Vercel Edge's ~25s deadline (platform 504 HTML) and 504'd healthy
     relays → `RELAY_WAIT_MS` cut to 20s, safely under the deadline, returns our own clean 504.
  5. In-memory job queue grew unbounded with no supporter polling → age-trim + `MAX_QUEUE` cap
     on push (both stores).
  6. Memory results map leaked → opportunistic sweep.
  7. Upstash busy-poll (~100k commands/day per idle supporter) → **BRPOP** blocking pop (one
     command per poll window) and one-command presence heartbeat. ~25× cheaper.
- **CI**: `.github/workflows/ci.yml` runs `npm run check` on every push to main and every PR —
  the gate for the overnight autonomous improvement loop. Added `CLAUDE.md` working notes.
- Smoke suite now 50 assertions (relay guards, presence, global count).

### 2026-07-30 (supporter presence)

- **Live connection detection.** Each `/api/work/next` poll now heartbeats the node (keyed by
  Relaybee user id, ~45s TTL); new `GET /api/work/status` reports whether the caller's own node is
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
  provider row (kept because a Relaybee key routes nothing without at least one sealed provider
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
- **`X-Relaybee-Pool-Health` response header** — every attempt's outcome in walk order
  (`work:429, personal:ok`) on success and failure paths. Relaybee's custom headers are now
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
- **Failover confirmed working live** — an 8-connection pool returns `X-Relaybee-Attempts: 8`,
  proving the proxy actually walks the pool rather than giving up on the first failure.
- **Deployed to production** at https://relaybee.vercel.app, with the GitHub repo connected
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
