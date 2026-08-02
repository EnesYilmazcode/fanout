# Relaybee Design Panel — Final Report

Moderator's synthesis of five panelists (Systems Architect, Security Engineer, ToS & Business Realist, Product & DX Lead, Claude Code Integration Specialist) across two rounds. Where the panel split, the split is shown and a moderator's ruling is given.

---

## 1. Verdicts

### One-key dashboard — WORKS WITH CHANGES

The founder's version — login screen, then your key — does not survive, but a smaller version is strictly better. The panel's decisive insight (Product & DX Lead, adopted by all five by round 2): the real first-run failure is not minting, it is that Relaybee is a **two-artifact system** (key + `X-Relaybee-Connection` blobs) sold with a one-artifact story, and that keys are unrecoverable. Since minting is already unauthenticated, a login gate manufactures an identity with no state to attach it to — pure friction. What ships instead is a **static, no-login setup page**: mint, seal providers, and emit one copyable config block (the "one key" moment delivered at the copy-paste layer), with localStorage as a convenience cache and zero backend. The one **remaining disagreement**: the Systems Architect and Product Lead want GitHub OAuth with deterministic re-mint (`HMAC(master_secret, github_id)`) as a near-term second PR, because an anonymously-minted key that is lost orphans every AAD-bound blob — a real data-loss failure, not friction. The Security Engineer, ToS Realist, and Integration Specialist would park OAuth until something forces identity. **Moderator's ruling:** the blob-continuity argument is a genuine failure mode the localStorage design cannot cover (lost laptop = total connection loss), and the mechanism is fully specified, stateless, and pre-agreed by four panelists as the identity layer whenever it arrives. It ships — but as an additive recovery path after the setup page and the P1 items, never as a gate on the page.

### Supporter mechanism (a), key deposit — DEAD

Unanimous, five to zero, on three **independent** fatal grounds, any one sufficient. **Premise:** Claude Max, Cursor, and Copilot issue no API keys — the person the pitch targets arrives at the deposit screen with nothing to deposit; the only depositable credential is a pay-per-token console key with no idle headroom, so "depositing" is donating money at cost. **Terms:** both OpenAI's and Anthropic's terms treat keys as confidential to the account and prohibit making credentials available to third parties; a pool where strangers spend a stranger's key is exactly the prohibited shape, payment or no payment. **Architecture:** serving a seller's key to a buyer requires deleting the AAD owner-binding — the single property the security review hardened — and converts `MASTER_ENCRYPTION_KEY` from "decrypts blobs clients hold" into "unlocks a vault of strangers' credentials," a categorical breach-profile downgrade on a hobby deployment. No panelist defended any version. The only residue — an explicit donation/credit pool where the operator holds one commercial account and supporters fund it — is recorded as a **separate future product**, not a rescue of (a). Recorded as *killed*, not deferred, per the ToS Realist's request.

### Supporter mechanism (b), Claude Code worker relay — DEAD as a marketplace; narrow salvage survives

The Integration Specialist verified the machinery is entirely real: headless `claude -p --output-format json`, `setup-token` OAuth for unattended auth, a ~15-line polling worker. It dies anyway, on four independent grounds. **Policy (the verdict):** subscription OAuth is licensed exclusively for the holder's own use; Anthropic moved to explicit enforcement against subscription-auth in third-party services in early 2026 — every supporter node would be a bannable ToS violation, and no architecture fixes a terms problem. **Infrastructure:** the Architect's arithmetic — a plain-polling idle worker alone blows Upstash's free-tier daily command budget; a streamed completion costs ~400 Redis commands (funding ~25 requests/day); multi-minute Claude Code jobs cannot fit inside Vercel Hobby's function lifetime at all. **Trust, bidirectionally and structurally (Security Engineer):** supporters read users' prompts in plaintext, and a malicious supporter's poisoned completion is a prompt-injection vector into the user's agentic toolchain; response integrity is cryptographically unverifiable. **Datastore:** the job queue puts user prompts at rest in Redis — a confidentiality obligation the project has never had. **Remaining disagreement on salvage:** the Security Engineer would permit a "trusted circle" (friends pooling one Max seat, exposure knowingly accepted); the ToS Realist and Integration Specialist reject it — consumer terms have no friendship exemption, and Relaybee documenting it makes the violation our published use case. **Moderator's ruling:** the Specialist verified the terms and is right — the salvage is **self-relay only**: your own idle machine serving your own jobs as one more connection in your own pool. The ToS Realist's open-model reframe (supporter-hosted Ollama/vLLM — the only *legal* volunteer network offered) survives as a parked, costed spike: it fixes licensing completely but inherits every infrastructure and trust wound, and its author downgraded it himself.

**The P0 answer, unanimous: Relaybee is a personal capacity router.** The marketplace lost independently on security, economics, terms, and infrastructure — any one would have sufficed.

---

## 2. The recommended design

**Identity model.** Anonymous mint remains the front door forever. GitHub OAuth is an optional, additive recovery layer: user id = `HMAC(master_secret, github_account_id)`, stable across logins; every dashboard visit re-mints a fresh key against that id. No key storage, no user table — "your key" is a function of who you are. Old keys stay valid to expiry (current model); sealed blobs remain AAD-valid across re-mints and across key loss, which is the entire point.

**Pages.**
- `public/setup.html` (rename the "dashboard" — it is a setup page):
  - **Step 1 — Get a key.** Button → existing `POST /api/keys/issue`. Key shown once, copy button, explicit "cannot be shown again" copy. Cached in localStorage as convenience only.
  - **Step 2 — Attach providers.** Provider dropdown + key + label → existing `POST /api/connect`. Sealed blobs collected in a labeled localStorage list; provider keys touch the page only in transit, exactly as curl does today.
  - **Step 3 — Your config.** Tabs: env block / curl / Python / JS / "tools that can't set custom headers." The env block bundles the Relaybee key plus comma-joined blobs, pre-assembled — the one-copyable-block moment.
  - Security conditions (Security Engineer, uncontested): strict CSP, zero third-party scripts, no analytics. A localStorage'd bearer key makes any XSS a key-theft primitive.
- Later, same page gains an optional "Recover access on another device" button → GitHub OAuth.

**New endpoints.** None for v1. For the recovery layer: one OAuth callback route (`api/auth/github.ts`) and a signed session cookie; the callback re-mints and redirects to the setup page. No other surface changes.

**Storage.** None. No Upstash, no Edge Config, nothing on the hot path. The parked bundle — hash-based revocation denylist, per-user accounting, any pooled-credit story — arrives together with a datastore if a future product ever activates it, and not before.

**Supporter architecture.** There is none, deliberately. Replacements: (1) a docs section, "using Relaybee with people you know" — invite them into your provider organization so they hold their own key and seal their own blob (the one sharing mechanism provider terms are built to permit); (2) self-relay as a future mode of the P1 npm package — point a worker on your own machine at your own pool. Donation credit pool and open-model volunteer network live in PROJECT.md as explicitly separate future products, each labeled with its real cost (commercial hosting, persistent broker, accounting, abuse pipeline).

---

## 3. PR plan

1. **PR 1 — `feat(web): static setup page`.** Add `public/setup.html`: mint + seal + tabbed one-copyable config block, localStorage-backed, strict CSP, no third-party scripts, no backend changes. Fixes the two-artifact onboarding failure and the lost-key footgun in an afternoon of static HTML. Link it from the landing page and README Quickstart.
2. **PR 2 — `docs: reposition as personal capacity router`.** Rewrite PROJECT.md's parked P0 section: record the panel verdicts — (a) killed, (b) killed as marketplace, with the ToS/enforcement citations attached — delete marketplace framing, add a "future products" section (donation pool, open-model network, each with its infrastructure preconditions) and move revocation + identity + accounting into one bundled icebox entry. Add the "using Relaybee with people you know = provider org invite" paragraph.
3. **PR 3 — `test: end-to-end completion with a real provider key`** *(pre-existing P1)*. The live chain reaches Anthropic and returns a `request_id`, but no successful completion has ever been produced. This must land before the setup page is promoted anywhere, since the page will drive real first runs.
4. **PR 4 — `feat(api): X-Relaybee-Pool-Health header`** *(pre-existing P1)*. Surface which connections failed, not just which won. Directly serves the setup-page audience debugging a multi-provider pool.
5. **PR 5 — `feat(auth): GitHub OAuth re-mint recovery`.** Deterministic user id via `HMAC(master_secret, github_id)`, one callback route, signed session cookie, "newest key" copy on the setup page. Additive, never a gate; zero storage. (Moderator's ruling over the park-it minority — see Verdict 1.)
6. **PR 6 — `feat(cli): npm client package`** *(pre-existing P1, reframed)*. Originally "seller side"; now a client helper: mint/seal/compose-config from the terminal, mirroring the setup page. Design the package so a **self-relay mode** (your own machine as one more connection in your own pool) can be added as mode two later — roadmap note only, not in scope.
7. **P2s unchanged**: retry budget per request, token usage in streaming responses, demo clip. The demo clip's story is now failover across your own providers, which is the honest pitch anyway.

---

## 4. Open questions for the founder

1. **Do you accept the identity verdict?** The panel unanimously answered your P0: this is a personal capacity router, and both supporter mechanisms are dead as proposed. If you still want a two-sided product, it is one of the two futures below — as a deliberate new commitment, not a feature of this codebase.
2. **Donation credit pool ("Patreon for inference")** — legally clean, but it is a commercial operation: Vercel Pro or another host, Upstash accounting, per-user caps, and an abuse/moderation pipeline that lands on you alone. Do you want to run an operations business? Yes/no gates everything about it.
3. **Open-model volunteer network ("BOINC for open weights")** — the only legal volunteer network offered, and the only proposal the panel split on with real energy. It requires a persistent broker, paid hosting, and a disclosed plaintext trust model — a re-platforming, arguably a new project that reuses Relaybee's adapter pattern. Is that spike worth costing? (Per the ToS Realist's own rule: budget the host before writing adapter code.)
4. **When does Relaybee stop being a demo?** Vercel Hobby prohibits commercial use; the moment any pooled-credit or donation story activates — or the setup page draws real users you feel responsible to — you need Pro and the revocation/identity/accounting bundle. Naming that threshold now prevents drifting past it.
5. **OAuth recovery timing.** The moderator ruled it in as PR 5 over a 3–2 park-it majority. If you disagree, the fallback the whole panel signed is: static page only, OAuth documented as the pre-agreed mechanism for whenever identity is forced.
6. **Everything ships straight to main today.** The panel produced an ordered PR plan; adopting it implies adopting PRs. Do you want review gates on this repo, or does the solo-dev commit-to-main workflow stand?