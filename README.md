# Fanout

**Crowdsourced AI API.** One OpenAI-shaped endpoint that routes to Anthropic, OpenAI, or Groq
using credentials the callers bring themselves — pooled across many keys, with automatic failover.

Runs entirely on Vercel's free tier. There is no database anywhere in the stack.

---

## How it works with no datastore

Two ideas do all the work.

**API keys are signatures, not rows.** A Fanout key is a payload plus an HMAC of that payload:

```
fo_live_<base64url({u,t,v,i,e})>.<base64url(hmac_sha256(payload))>
```

Verifying it is one HMAC recompute — no lookup, no latency, no table. The payload carries the
user id and tier, which is everything the proxy needs to route and meter.

**Connections are sealed blobs the client holds.** `POST /api/connect` takes a provider key,
encrypts it with AES-256-GCM under the server's master key, binds the ciphertext to the caller's
user id as additional authenticated data, and hands it back:

```
fc_<base64url(iv)>.<base64url(ciphertext||tag)>
```

Fanout keeps no copy. The AAD binding means a blob stolen from someone else fails to decrypt
rather than spending their credits.

**The fanout part.** Send several connection blobs in one header and the proxy treats them as a
pool: it picks one at random and retries the next on 401, 429, or 5xx. A group of donated keys
behaves like a single key with everyone's combined quota. Response headers report which
connection served the request.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/keys/issue` | Mint a Fanout key |
| `POST` | `/api/connect` | Seal a provider credential into a connection blob |
| `POST` | `/api/v1/chat/completions` | The proxy (OpenAI-compatible, streaming supported) |
| `GET` | `/api/v1/models` | List available providers |
| `GET` | `/api/health` | Liveness + config presence |

Models are provider-prefixed: `anthropic/claude-opus-5`, `openai/gpt-4o`, `groq/llama-3.3-70b-versatile`.

```bash
curl https://YOUR-APP.vercel.app/api/v1/chat/completions \
  -H "Authorization: Bearer $FANOUT_KEY" \
  -H "X-Fanout-Connection: $CONN_A,$CONN_B" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-opus-5","messages":[{"role":"user","content":"hi"}]}'
```

---

## Dropping it into an app

**There is no Fanout package to install.** The API is OpenAI-shaped on purpose, so every client
library that already speaks that format works unchanged. Integration is three lines of config:
point `baseURL` at Fanout, pass your `fo_live_` key as the API key, and send the connection blob
as a default header. After that, switching providers is editing one string.

**JavaScript / TypeScript** — the official `openai` package:

```js
import OpenAI from 'openai'

const fanout = new OpenAI({
  baseURL: 'https://YOUR-APP.vercel.app/api/v1',
  apiKey: process.env.FANOUT_KEY,
  defaultHeaders: { 'X-Fanout-Connection': process.env.FANOUT_CONNECTIONS },
})

const res = await fanout.chat.completions.create({
  model: 'anthropic/claude-opus-5',
  messages: [{ role: 'user', content: 'hi' }],
})
```

**Python** — same idea:

```python
from openai import OpenAI

fanout = OpenAI(
    base_url="https://YOUR-APP.vercel.app/api/v1",
    api_key=os.environ["FANOUT_KEY"],
    default_headers={"X-Fanout-Connection": os.environ["FANOUT_CONNECTIONS"]},
)

res = fanout.chat.completions.create(
    model="groq/llama-3.3-70b-versatile",
    messages=[{"role": "user", "content": "hi"}],
)
```

**Vercel AI SDK** — via `@ai-sdk/openai-compatible`:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

const fanout = createOpenAICompatible({
  name: 'fanout',
  baseURL: 'https://YOUR-APP.vercel.app/api/v1',
  apiKey: process.env.FANOUT_KEY,
  headers: { 'X-Fanout-Connection': process.env.FANOUT_CONNECTIONS },
})

const { text } = await generateText({ model: fanout('anthropic/claude-opus-5'), prompt: 'hi' })
```

**Anything else** — it's plain HTTP. Two headers and a JSON body, as in the curl above.

The model string is the only thing that changes when you switch destinations:
`anthropic/claude-opus-5` → `openai/gpt-4o` → `groq/llama-3.3-70b-versatile`. Same code, same
endpoint, different provider — that is the remote-control part. If a Fanout key is configured
server-side and the model string comes from a config value or a UI dropdown, users retarget the
model without touching code at all.

---

## Deploy

```bash
npm install
npm run secrets          # prints MASTER_SECRET and MASTER_ENCRYPTION_KEY
```

Import the repo at [vercel.com/new](https://vercel.com/new), add both secrets as environment
variables (mark them Sensitive), and deploy. Everything runs on the Edge runtime, so there are
no cold starts and streaming responses pipe straight through rather than buffering in a lambda.

For local work: put the same two variables in `.env.local` and run `vercel dev`.

---

## Design notes and limits

- **Edge runtime throughout.** Providers are called with plain `fetch`, not their SDKs — bundling
  three SDKs would blow the Edge size limit for no benefit.
- **Streaming is piped, not buffered.** Anthropic's SSE events are translated to OpenAI chunks
  frame by frame, which also sidesteps the function timeout since bytes keep flowing.
- **Rate limiting is per-instance.** The counter lives in module scope on a warm edge instance, so
  it is approximate by design. It protects Fanout's own invocation quota, not the caller's provider
  spend — they pay for that themselves. Swap in Upstash keyed on user id if you need it exact.
- **No revocation.** A signed key is valid until it expires (90 days). Adding revocation means
  adding state — Vercel Edge Config is the cheapest place to put a denylist.
- **The master key is the whole trust model.** `MASTER_ENCRYPTION_KEY` decrypts every outstanding
  connection blob. Keep the dependency tree minimal, never log request bodies or headers, and use
  distinct secrets per environment.
- **Rotating a secret invalidates everything signed or sealed under it.** Key rotation is a version
  bump in `lib/auth.ts`; connection rotation would need a `kid` prefix on the blob.

This is a demo built to show the architecture, not a service to trust with a valuable credential.
Vercel's Hobby plan also prohibits commercial use — a real deployment needs Pro or a different host.
