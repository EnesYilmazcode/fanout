# Fanout — working notes for Claude

Fanout is one OpenAI-shaped endpoint with two ways to get an answer:
1. **Bring your own keys** — route to Anthropic / OpenAI / Groq with credentials the caller
   supplies, sealed into client-held blobs, pooled with failover.
2. **Supporter relay** — call the `claude-code` model and a supporter's machine (running a
   pasted worker loop) answers it. No provider key needed on the caller's side.

The homepage (`public/index.html` + `app.css` + `app.js`) auto-mints a key on load, offers a
copy/regenerate box, a supporter toggle with a live "N supporters online" count, and a worker
brief to paste into Claude Code / Codex. The bring-your-own-keys UI lives at `public/demo.html`,
and `public/docs.html` is the caller-facing API reference: it reads the key out of localStorage and
substitutes it into every example, and runs a live streaming relay call from the page.

## Architecture invariants — do not quietly break these

- **No database on the hot path.** Keys are HMAC signatures over their own payload (`lib/auth.ts`);
  connections are AES-256-GCM blobs the client holds (`lib/seal.ts`). Verification is a recompute,
  not a lookup. The relay queue (`lib/queue.ts`) uses Upstash Redis when `UPSTASH_REDIS_REST_*`
  are set and a per-instance in-memory fallback otherwise — that is the only stateful piece.
- **Connection blobs are bound to their owner** as AES-GCM additional data. A blob is unusable by
  anyone but the user who sealed it. This is deliberate and security-reviewed; never remove it.
- **Zero runtime dependencies, Edge runtime, WebCrypto only.** No npm packages in `lib/` or `api/`.
- **Strict CSP on every HTML page** (no inline script/style, same-origin only). A bearer key in
  localStorage means any XSS is key theft. Keep JS/CSS in external files.
- **The relay is a disclosed plaintext-trust relationship.** Supporters see prompts, users see
  answers. Say so where a supporter starts; do not pretend otherwise. The same applies to the two
  risks a supporter actually carries: the prompt is untrusted input reaching their agent, and a
  consumer subscription is licensed to its holder. Anything the board concludes about supporter
  risk belongs where a supporter will read it, not only in `PROJECT.md`.

## Testing & deploy

- `npm run check` = `tsc --noEmit` + `test/smoke.mts` (currently 42 assertions). It must pass
  before any commit. Add assertions when you add behavior.
- Deploy is automatic: Vercel builds every push. **`main` → production** (`fanout-tawny.vercel.app`);
  every PR gets a preview URL. So merging to `main` ships.
- GitHub Actions (`.github/workflows/ci.yml`) runs `npm run check` on pushes and PRs.

## Endpoints

`POST /api/keys/issue`, `POST /api/connect`, `POST /api/v1/chat/completions`, `GET /api/v1/models`,
`POST /api/work/next`, `POST /api/work/complete`, `GET /api/work/status`, `GET /api/health`.

## Status & roadmap

`PROJECT.md` is the living board — read it first, and update it in the same commit as any change.
The design review that set direction (personal capacity router, not a marketplace) is under
`docs/design/`.
