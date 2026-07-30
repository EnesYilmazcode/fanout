# Fanout

One OpenAI-shaped endpoint that routes to Anthropic, OpenAI, or Groq using API keys the caller
brings. Hand it several keys at once and it treats them as a pool, picking one at random and
falling over to the next when one is rate limited or dead.

Runs on Vercel's free tier. No database, no runtime dependencies.

Live at https://fanout-tawny.vercel.app

## Quickstart

```bash
BASE=https://fanout-tawny.vercel.app

# 1. Mint a Fanout key. No signup, no account.
curl -sX POST $BASE/api/keys/issue -d '{"handle":"you"}'

# 2. Seal a provider key into a connection blob.
curl -sX POST $BASE/api/connect \
  -H "Authorization: Bearer $FANOUT_KEY" -H "Content-Type: application/json" \
  -d '{"provider":"anthropic","apiKey":"sk-ant-...","label":"personal"}'

# 3. Call it. Comma-separate blobs to pool them.
curl $BASE/api/v1/chat/completions \
  -H "Authorization: Bearer $FANOUT_KEY" \
  -H "X-Fanout-Connection: $CONN_A,$CONN_B" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-opus-5","messages":[{"role":"user","content":"hi"}]}'
```

Store the Fanout key when you get it. Nothing on the server remembers it, so it cannot be shown
again.

Prefer a browser? The [setup page](https://fanout-tawny.vercel.app/setup.html) does all three
steps and hands you one copyable config block (env vars, curl, Python, or JS), kept only in
your browser's localStorage — with a download-a-backup button, because that cache is the only
copy of your key anywhere.

## How it works with no database

Two ideas carry the whole thing.

**The key is the record.** A Fanout key is a payload plus an HMAC of that payload:

```
fo_live_<base64url({u,t,v,i,e})>.<base64url(hmac_sha256(payload))>
```

Checking one is a single HMAC recompute. No lookup, no table, no round trip. The payload carries
the user id and tier, which is everything the proxy needs to route and meter. Keys expire after
90 days.

**Connections are sealed blobs the caller holds.** `POST /api/connect` takes a provider key,
encrypts it with AES-256-GCM under the server's master key, mixes the caller's user id in as
additional authenticated data, and hands the result back:

```
fc_<base64url(iv)>.<base64url(ciphertext||tag)>
```

Fanout keeps no copy. The AAD binding means a blob lifted off someone else fails to decrypt
instead of spending their credits.

**The fanout part.** Several blobs in one header become a pool. The proxy starts at a random
offset so the first blob in the list doesn't absorb everything, then walks to the next one on a
401, 403, 429, or 5xx. Response headers report which connection served the request
(`X-Fanout-Connection-Label`), how many attempts it took (`X-Fanout-Attempt`), and every
attempt's outcome in walk order (`X-Fanout-Pool-Health: work:429, personal:ok`) — so a
half-dead pool is visible per request instead of silently degrading. Eight blobs per request is
the cap, because failover is serial and an uncapped pool turns one call into a hundred upstream
calls.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/keys/issue` | Mint a Fanout key |
| `POST` | `/api/connect` | Seal a provider credential into a connection blob |
| `POST` | `/api/v1/chat/completions` | The proxy, OpenAI-compatible, streaming supported |
| `GET` | `/api/v1/models` | List available providers |
| `GET` | `/api/health` | Liveness and whether the secrets are configured |

Models are provider-prefixed: `anthropic/claude-opus-5`, `openai/gpt-4o`,
`groq/llama-3.3-70b-versatile`.

## Using it from code

There is no Fanout package to install. The API is OpenAI-shaped on purpose, so every client
library that already speaks that format works unchanged. Point `baseURL` at Fanout, pass the
`fo_live_` key as the API key, send the connection blob as a default header.

**JavaScript and TypeScript**, with the official `openai` package:

```js
import OpenAI from 'openai'

const fanout = new OpenAI({
  baseURL: 'https://fanout-tawny.vercel.app/api/v1',
  apiKey: process.env.FANOUT_KEY,
  defaultHeaders: { 'X-Fanout-Connection': process.env.FANOUT_CONNECTIONS },
})

const res = await fanout.chat.completions.create({
  model: 'anthropic/claude-opus-5',
  messages: [{ role: 'user', content: 'hi' }],
})
```

**Python**, same idea:

```python
from openai import OpenAI

fanout = OpenAI(
    base_url="https://fanout-tawny.vercel.app/api/v1",
    api_key=os.environ["FANOUT_KEY"],
    default_headers={"X-Fanout-Connection": os.environ["FANOUT_CONNECTIONS"]},
)

res = fanout.chat.completions.create(
    model="groq/llama-3.3-70b-versatile",
    messages=[{"role": "user", "content": "hi"}],
)
```

**Vercel AI SDK**, through `@ai-sdk/openai-compatible`:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

const fanout = createOpenAICompatible({
  name: 'fanout',
  baseURL: 'https://fanout-tawny.vercel.app/api/v1',
  apiKey: process.env.FANOUT_KEY,
  headers: { 'X-Fanout-Connection': process.env.FANOUT_CONNECTIONS },
})

const { text } = await generateText({ model: fanout('anthropic/claude-opus-5'), prompt: 'hi' })
```

**Anything else** is plain HTTP. Two headers and a JSON body, like the curl above.

Switching destinations is one string. `anthropic/claude-opus-5` becomes `openai/gpt-4o` becomes
`groq/llama-3.3-70b-versatile`, with the same code against the same endpoint. If the Fanout key
lives server-side and the model string comes from a config value or a dropdown, users retarget
the model without touching code at all.

## Deploy

```bash
npm install
npm run secrets          # prints MASTER_SECRET and MASTER_ENCRYPTION_KEY
```

Import the repo at [vercel.com/new](https://vercel.com/new), add both secrets as environment
variables and mark them Sensitive, then deploy. Everything runs on the Edge runtime, so there are
no cold starts and streaming responses pipe straight through instead of buffering in a lambda.

For local work, put the same two variables in `.env.local` and run `vercel dev`. `npm run check`
runs the typecheck and the smoke tests.

## Notes and limits

- **Providers are called with plain `fetch`, not their SDKs.** Bundling three SDKs would blow the
  Edge size limit and buy nothing.
- **Streaming is translated frame by frame.** Anthropic's SSE events become OpenAI chunks as they
  arrive, so nothing buffers and the function timeout never comes into play.
- **Rate limiting is approximate.** The counter lives in module scope on a warm edge instance, so
  it resets on a cold start and multiplies across regions. Free keys get 20 requests a minute, pro
  gets 120, with a 60 per minute ceiling on the source IP over the top of that. It protects
  Fanout's own invocation quota, not the caller's provider spend, which they pay for themselves.
  Swap in Upstash keyed on user id if you need it exact.
- **No revocation.** A signed key works until it expires. Revoking means storing state, and Vercel
  Edge Config is the cheapest place to put a denylist.
- **The master key is the entire trust model.** `MASTER_ENCRYPTION_KEY` decrypts every outstanding
  connection blob. That is why the dependency tree is empty and why nothing logs request bodies or
  headers. Use different secrets per environment.
- **Rotating a secret invalidates everything signed or sealed under it.** Key rotation is a version
  bump in `lib/auth.ts`. Rotating connections would need a `kid` prefix on the blob.
- **Vercel's Hobby plan prohibits commercial use.** A real deployment needs Pro or a different host.

This is a demo of the architecture, not a service to trust with a valuable credential.

Design decisions, the security review, and what is still open live in [PROJECT.md](PROJECT.md).
