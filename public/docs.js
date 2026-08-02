// Docs page. Three jobs: fill every example with the reader's own key, let them
// copy it, and let them run the relay call from the page so "does my key work"
// is answered on the spot rather than after a round trip through a terminal.
//
// The key comes from localStorage under the same name the home page uses, so a
// reader who has been to the home page arrives here already set up.

const $ = (id) => document.getElementById(id)
const origin = location.origin
const PLACEHOLDER = 'YOUR_FANOUT_KEY'

let fanoutKey = localStorage.getItem('fanout_key') || ''

// --- filling the examples --------------------------------------------------

// Snippets ship with __ORIGIN__/__KEY__ tokens in the markup. Keep the original
// text so a later mint can refill a block that has already been substituted.
const templates = new Map()
for (const pre of document.querySelectorAll('pre[data-fill]')) {
  templates.set(pre, pre.textContent)
}

function fill() {
  const key = fanoutKey || PLACEHOLDER
  for (const [pre, tpl] of templates) {
    pre.textContent = tpl.split('__ORIGIN__').join(origin).split('__KEY__').join(key)
  }
  $('key').textContent = fanoutKey || 'no key in this browser yet'
  $('btn-mint').hidden = Boolean(fanoutKey)
  $('btn-copy').disabled = !fanoutKey
  $('key-hint').textContent = fanoutKey
    ? 'Read from this browser. It is the same key the home page gave you, and it is filled into every example below.'
    : 'Mint one and every example below fills itself in. Keys are free, unauthenticated, and last 90 days.'
}

// --- clipboard -------------------------------------------------------------

async function copy(btn, text) {
  try {
    await navigator.clipboard.writeText(text)
    const was = btn.textContent
    btn.textContent = 'copied'
    btn.classList.add('done')
    setTimeout(() => { btn.textContent = was; btn.classList.remove('done') }, 1200)
  } catch { /* clipboard denied, the text is selectable by hand */ }
}

for (const btn of document.querySelectorAll('.snippet .copy')) {
  btn.addEventListener('click', () => copy(btn, btn.parentElement.querySelector('pre').textContent))
}
$('btn-copy').addEventListener('click', (e) => copy(e.currentTarget, fanoutKey))

// --- minting ---------------------------------------------------------------

$('btn-mint').addEventListener('click', async (e) => {
  const btn = e.currentTarget
  btn.disabled = true
  try {
    const res = await fetch(origin + '/api/keys/issue', { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!json.key) throw new Error(json.error?.message || 'Could not mint a key.')
    fanoutKey = json.key
    localStorage.setItem('fanout_key', fanoutKey)
    fill()
    startWatching()
  } catch (err) {
    $('key-hint').textContent = err.message
  }
  btn.disabled = false
})

// --- supporter presence ----------------------------------------------------

// Ten seconds, and stopped while the tab is hidden, for the same reason the home
// page does it: each poll is three Upstash commands against a 500K monthly budget
// and presence has a 45s server-side TTL, so faster buys no accuracy.
const STATUS_POLL_MS = 10_000
let statusTimer = null
let online = 0

function renderStatus(n) {
  online = n
  const box = $('status')
  box.classList.toggle('live', n > 0)
  $('status-text').textContent = n > 0
    ? `${n} supporter${n === 1 ? '' : 's'} online, so claude-code will be answered`
    : 'No supporters online, so claude-code has nobody to answer it right now'
}

async function pollStatus() {
  if (!fanoutKey) return
  try {
    const res = await fetch(origin + '/api/work/status', { headers: { authorization: `Bearer ${fanoutKey}` } })
    if (res.ok) renderStatus(Number((await res.json()).online) || 0)
  } catch { /* transient, the next tick retries */ }
}

function startWatching() {
  if (document.hidden || !fanoutKey) return
  pollStatus()
  if (!statusTimer) statusTimer = setInterval(pollStatus, STATUS_POLL_MS)
}

function stopWatching() {
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopWatching()
  else startWatching()
})

// --- run it here -----------------------------------------------------------

// Streaming, for the reason the page gives: a buffered relay request has to give
// up at 20s to stay inside the platform's initial-response deadline, and real
// supporter answers routinely take longer than that.
async function runTry() {
  const btn = $('btn-try')
  const out = $('try-out')
  const prompt = $('try-prompt').value.trim()

  if (!fanoutKey) { show(out, 'Mint a key first.', true); return }
  if (!prompt) { show(out, 'Type a prompt first.', true); return }

  btn.disabled = true
  show(out, online > 0 ? 'Waiting for a supporter to answer…' : 'Sending. No supporter is showing as online, so this may time out…', false)

  try {
    const res = await fetch(origin + '/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${fanoutKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-code',
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => ({}))
      show(out, `${res.status}: ${json.error?.message || 'Request failed.'}`, true)
      btn.disabled = false
      return
    }

    let answer = ''
    for await (const frame of sseFrames(res.body)) {
      if (frame === '[DONE]') break
      let ev
      try { ev = JSON.parse(frame) } catch { continue }
      // The relay reports a timeout as an error frame inside a 200 stream: the
      // headers were already sent by the time it knew nobody would answer.
      if (ev.error) { show(out, ev.error.message, true); btn.disabled = false; return }
      const delta = ev.choices?.[0]?.delta?.content
      if (delta) { answer += delta; show(out, answer, false) }
    }
    if (!answer) show(out, 'The stream ended without an answer. Try again in a moment.', true)
  } catch (err) {
    show(out, err.message || 'Request failed.', true)
  }
  btn.disabled = false
}

function show(out, text, bad) {
  out.hidden = false
  out.textContent = text
  out.classList.toggle('bad', Boolean(bad))
}

/** Yields each SSE frame's data payload, tolerating chunk boundaries mid-frame. */
async function* sseFrames(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, i)
      buf = buf.slice(i + 2)
      let data = ''
      for (const line of raw.split('\n')) {
        if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (data) yield data
    }
  }
}

$('btn-try').addEventListener('click', runTry)

// --- init ------------------------------------------------------------------

fill()
startWatching()
