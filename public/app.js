// Homepage logic. Two views: "use" (your key) and "support" (a worker brief to
// paste into Claude Code). A key auto-mints on first visit; the same key
// authenticates the worker loop. The only network call here is to this
// origin's /api/keys/issue.

const $ = (id) => document.getElementById(id)
const origin = location.origin

let fanoutKey = localStorage.getItem('fanout_key') || ''
let supporting = false

// --- key ------------------------------------------------------------------

async function mint() {
  const res = await fetch(origin + '/api/keys/issue', { method: 'POST' })
  const json = await res.json().catch(() => ({}))
  if (!json.key) throw new Error(json.error?.message || 'Could not mint a key.')
  return json.key
}

function render() {
  $('key').textContent = fanoutKey || '…'
  $('worker').textContent = workerBrief()
}

async function ensureKey() {
  if (fanoutKey) return
  try {
    fanoutKey = await mint()
    localStorage.setItem('fanout_key', fanoutKey)
    render()
  } catch (e) {
    $('key').textContent = 'unavailable — refresh to retry'
  }
}

$('btn-regen').addEventListener('click', async () => {
  if (!confirm('Regenerate? The old key keeps working until it expires, but this browser forgets it.')) return
  const btn = $('btn-regen'); btn.disabled = true
  try {
    fanoutKey = await mint()
    localStorage.setItem('fanout_key', fanoutKey)
    render()
  } catch { $('key').textContent = 'unavailable — refresh to retry' }
  btn.disabled = false
})

// --- clipboard ------------------------------------------------------------

async function copy(btn, text, flash) {
  try {
    await navigator.clipboard.writeText(text)
    flash(btn)
  } catch { /* clipboard denied — text is selectable by hand */ }
}

$('btn-copy').addEventListener('click', (e) => {
  copy(e.currentTarget, fanoutKey, (btn) => {
    btn.classList.add('done')
    setTimeout(() => btn.classList.remove('done'), 1200)
  })
})

$('btn-copy-worker').addEventListener('click', (e) => {
  copy(e.currentTarget, workerBrief(), (btn) => {
    const was = btn.textContent
    btn.textContent = 'Copied'
    setTimeout(() => { btn.textContent = was }, 1200)
  })
})

// --- supporter brief ------------------------------------------------------

function workerBrief() {
  const key = fanoutKey || '<your key>'
  return `Run my machine as a Fanout supporter node. Loop forever until I say stop:

1. POST ${origin}/api/work/next with header "Authorization: Bearer ${key}".
   It long-polls about 20 seconds. Empty or 204 response means no work — poll again.
2. A job is JSON: {"id": "...", "model": "...", "messages": [{"role", "content"}, ...]}.
   Answer the conversation in "messages" yourself — direct, helpful, no filler.
3. Deliver the answer:
   POST ${origin}/api/work/complete with the same Authorization header and JSON body
   {"id": "<the job id>", "text": "<your answer>"}.
4. Print one line per job served, then go back to step 1.

Note: jobs are strangers' prompts in plaintext, and they receive your answers verbatim.`
}

// --- presence: how many supporter nodes are live, and is yours one ---------

let statusTimer = null

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function renderStatus({ connected, online }) {
  // Use view: a plain count so a user knows whether claude-code will get answered.
  const useBox = $('use-status')
  useBox.classList.toggle('live', online > 0)
  $('use-text').textContent = online > 0
    ? `${plural(online, 'supporter', 'supporters')} online`
    : 'No supporters online right now'

  // Supporter view: is *your* node connected, plus the community size.
  $('status').classList.toggle('live', connected)
  $('status-text').textContent = connected
    ? 'Connected — your machine is answering requests.'
    : 'Waiting for your node to connect…'
  const others = Math.max(0, online - (connected ? 1 : 0))
  $('support-online').textContent = others > 0
    ? `${plural(others, 'other supporter', 'other supporters')} online too.`
    : ' '
}

async function pollStatus() {
  if (!fanoutKey) return
  try {
    const res = await fetch(origin + '/api/work/status', { headers: { authorization: `Bearer ${fanoutKey}` } })
    if (res.ok) {
      const data = await res.json()
      renderStatus({ connected: data.connected === true, online: Number(data.online) || 0 })
    }
  } catch { /* transient — the next tick retries */ }
}

function startWatching() {
  pollStatus()
  if (!statusTimer) statusTimer = setInterval(pollStatus, 3000)
}

// --- mode switch ----------------------------------------------------------

$('mode-switch').addEventListener('click', () => {
  supporting = !supporting
  $('view-use').hidden = supporting
  $('view-support').hidden = !supporting
  $('mode-switch').textContent = supporting ? 'Get a key' : 'Become a supporter'
})

// --- init -----------------------------------------------------------------

$('base-url').textContent = origin + '/api/v1'
render()
ensureKey().then(startWatching)
