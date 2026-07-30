// Provider adapters.
//
// Fanout speaks OpenAI's wire format as its canonical API, because every client
// SDK already does. Each adapter translates that shape out to its provider and
// translates the answer (and the SSE stream) back.
//
// Model strings are prefixed: "anthropic/claude-opus-5", "openai/gpt-4o".

export type ChatRequest = {
  model: string
  messages: Array<{ role: string; content: unknown }>
  max_tokens?: number
  stream?: boolean
  [k: string]: unknown
}

export type Adapter = {
  id: string
  endpoint: string
  headers(apiKey: string): Record<string, string>
  translateRequest(body: ChatRequest, model: string): unknown
  translateResponse(json: any, model: string): unknown
  translateStream(
    upstream: ReadableStream<Uint8Array>,
    model: string,
    includeUsage?: boolean,
  ): ReadableStream<Uint8Array>
}

const encoder = new TextEncoder()

function sse(obj: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)
}

function chunk(model: string, id: string, delta: Record<string, unknown>, finish: string | null) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  }
}

/**
 * Reads an SSE body and yields parsed `{event, data}` frames. Handles chunk
 * boundaries splitting mid-frame, which is the usual source of dropped tokens.
 */
async function* frames(upstream: ReadableStream<Uint8Array>) {
  const reader = upstream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      let event = ''
      let data = ''
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (data) yield { event, data }
    }
  }
}

// ---------------------------------------------------------------- anthropic

const anthropic: Adapter = {
  id: 'anthropic',
  endpoint: 'https://api.anthropic.com/v1/messages',
  headers: (apiKey) => ({
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }),

  translateRequest(body, model) {
    const system: string[] = []
    const messages: Array<{ role: string; content: unknown }> = []
    for (const m of body.messages ?? []) {
      if (m.role === 'system') system.push(typeof m.content === 'string' ? m.content : '')
      else messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })
    }
    const out: Record<string, unknown> = {
      model,
      messages,
      // Anthropic requires max_tokens. 4096 is a safe default for a demo proxy.
      max_tokens: body.max_tokens ?? 4096,
    }
    if (system.length) out.system = system.join('\n\n')
    if (body.stream) out.stream = true
    return out
  },

  translateResponse(json, model) {
    const text = (json.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
    return {
      id: json.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: json.stop_reason === 'max_tokens' ? 'length' : 'stop',
        },
      ],
      usage: {
        prompt_tokens: json.usage?.input_tokens ?? 0,
        completion_tokens: json.usage?.output_tokens ?? 0,
        total_tokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
      },
    }
  },

  translateStream(upstream, model, includeUsage) {
    return new ReadableStream({
      async start(controller) {
        let id = 'chatcmpl-fanout'
        // Anthropic reports token counts across the stream: input_tokens arrives
        // in message_start, output_tokens accumulates in each message_delta.
        // We track them so a caller that opted in can get a final usage chunk.
        let promptTokens = 0
        let completionTokens = 0
        try {
          controller.enqueue(sse(chunk(model, id, { role: 'assistant', content: '' }, null)))
          for await (const f of frames(upstream)) {
            let ev: any
            try {
              ev = JSON.parse(f.data)
            } catch {
              continue
            }
            if (ev.type === 'message_start' && ev.message?.id) {
              id = ev.message.id
              if (typeof ev.message.usage?.input_tokens === 'number') promptTokens = ev.message.usage.input_tokens
            } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              controller.enqueue(sse(chunk(model, id, { content: ev.delta.text }, null)))
            } else if (ev.type === 'message_delta') {
              if (typeof ev.usage?.output_tokens === 'number') completionTokens = ev.usage.output_tokens
              if (ev.delta?.stop_reason) {
                const finish = ev.delta.stop_reason === 'max_tokens' ? 'length' : 'stop'
                controller.enqueue(sse(chunk(model, id, {}, finish)))
              }
            }
          }
        } catch {
          // Upstream cut out mid-stream. Close cleanly so the client sees a
          // truncated answer rather than a hung socket.
        }
        // OpenAI emits a final usage-only chunk (empty choices) when the caller
        // set stream_options.include_usage. Match that shape, and only when opted in.
        if (includeUsage) {
          controller.enqueue(
            sse({
              id,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [],
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens,
              },
            }),
          )
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
  },
}

// ------------------------------------------------------------------ openai

const openai: Adapter = {
  id: 'openai',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  headers: (apiKey) => ({
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  }),
  translateRequest: (body, model) => ({ ...body, model }),
  translateResponse: (json, model) => ({ ...json, model }),
  // Already OpenAI-shaped — hand the bytes straight through.
  translateStream: (upstream) => upstream,
}

// ------------------------------------------------------------------ groq
// Groq is OpenAI-compatible, so it reuses the passthrough translators.

const groq: Adapter = {
  ...openai,
  id: 'groq',
  endpoint: 'https://api.groq.com/openai/v1/chat/completions',
}

export const ADAPTERS: Record<string, Adapter> = { anthropic, openai, groq }

/** "anthropic/claude-opus-5" -> { adapter, model: "claude-opus-5" } */
export function route(modelString: string): { adapter: Adapter; model: string } | null {
  const i = modelString.indexOf('/')
  if (i === -1) return null
  const adapter = ADAPTERS[modelString.slice(0, i)]
  const model = modelString.slice(i + 1)
  if (!adapter || !model) return null
  return { adapter, model }
}
