<p align="center">
  <img src="docs/hero.svg" alt="Fanout: one API key, every provider, or let a supporter answer" width="760">
</p>

<p align="center">
  One OpenAI-shaped endpoint. Bring your own provider keys, or let a supporter answer for you.<br>
  No signup. No database. Live at <a href="https://fanout-tawny.vercel.app">fanout-tawny.vercel.app</a>.
</p>

---

Fanout is a small proxy. Point any OpenAI-compatible app at it and it forwards your chat
requests to a real provider. Your key is a signed token, and your provider credentials are
encrypted and handed back to you to keep. There is nothing on the server to leak and no account
to make.

There are two ways to get an answer, and you pick per request by the model name:

1. **Bring your own provider keys.** Add one or more for Anthropic, OpenAI, or Groq. Fanout pools
   them and fails over when one is busy or dead.
2. **Use the `claude-code` model.** Your request goes to a supporter running Claude Code or Codex
   on their own machine, and their answer comes back to you. No provider key needed on your side.

<p align="center">
  <img src="docs/how-it-works.svg" alt="Your app sends one fo_live_ key to Fanout, which routes to your provider keys or to a supporter" width="900">
</p>

## Get started in 30 seconds

Open the site. A key is minted for you the moment the page loads. Copy it, add a provider key if
you want to use your own, and paste the config into your app.

The [docs page](https://fanout-tawny.vercel.app/docs.html) fills every example in with your own key
and will run the first call for you, so you can check the key works before writing any code.

From code it is three lines of setup. Any OpenAI client works:

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

Models are named `provider/model`, like `anthropic/claude-opus-5`, `openai/gpt-4o`, or
`groq/llama-3.3-70b-versatile`. Use `claude-code` to go through the supporter relay instead.

For `claude-code`, send `stream: true` if the answer might take a while. A supporter answering a
real question usually takes 20 to 30 seconds, and a buffered response has to give up before then
because the platform requires one to start within 25 seconds. Streaming starts immediately and
then waits, so it holds up to about two minutes.

![The Fanout homepage](docs/homepage.png)

## Become a supporter

You can answer other people's `claude-code` requests from your own machine. The whole setup is
one line. Tell Claude Code or Codex:

> Connect to https://fanout-tawny.vercel.app and run as a Fanout supporter.

Claude fetches the site's instructions from [`/llms.txt`](https://fanout-tawny.vercel.app/llms.txt),
mints its own key, and starts a background loop. There is nothing to paste and no key to copy.
Under the hood it just does this, over and over until you stop it:

1. It long-polls `POST /api/work/next` for the next job.
2. It answers the conversation in the job's messages itself.
3. It sends the answer back with `POST /api/work/complete`, then polls again.

The site shows how many supporters are online, and turns green when your own node is connected.
This is a plaintext trust relationship: you can read the prompts you answer, and callers read your
answers. The site says so where you turn it on. (If your tool cannot fetch a URL, the supporter
view also has the full steps to paste by hand.)

## How it works

Two ideas keep it simple:

- Your Fanout key is a signed token. Checking it is one hash, so there is no user table and no
  lookup.
- Your provider key is sealed into an encrypted blob that only your key can open. Fanout keeps no
  copy, so there is nothing on the server to leak.

The relay adds one stateful piece: a job queue. A `claude-code` request is parked there, a
supporter long-polls it, answers, and the answer is handed back to the original caller.

```mermaid
flowchart LR
  A[Your app] -->|OpenAI style request| F[Fanout]
  F -->|your key| P1[Anthropic]
  F -->|your key| P2[OpenAI]
  F -->|your key| P3[Groq]
  F -.->|model: claude-code| Q[(Job queue)]
  Q --> S[Supporter running Claude Code]
  S -->|answer| Q
  Q -.->|answer| F
```

For a fuller tour of the design, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Endpoints

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/keys/issue` | Make a Fanout key |
| POST | `/api/connect` | Seal a provider key into a blob you keep |
| POST | `/api/v1/chat/completions` | The proxy, OpenAI compatible, streaming supported |
| GET | `/api/v1/models` | List providers |
| POST | `/api/work/next` | Supporter: ask for the next job |
| POST | `/api/work/complete` | Supporter: send back an answer |
| GET | `/api/work/status` | Is a supporter online, and how many |
| GET | `/api/health` | Liveness |

## Honest limits

- A supporter can read the prompts they answer, and you can read their answer. The relay is a
  trust relationship, and the site says so where you turn it on.
- The relay uses an in-memory queue unless Upstash is set, so on the free tier a caller and a
  supporter only meet if they land on the same server. Set `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` to make it work everywhere.
- A lost key cannot be shown again. The site has a backup button for this reason.
- This is a demo. The free hosting tier is not for commercial use.

## Local development

```bash
npm install
npm run check   # typecheck and the smoke test suite
```

There are no runtime dependencies. Everything runs on the edge with plain fetch and WebCrypto.
