// Homepage logic. A key is minted automatically on first visit; providers seal
// into client-held blobs; the config block assembles both. Same localStorage
// keys as the demo page, so state made on either shows up on both. The only
// network calls are to this origin's /api/keys/issue and /api/connect.

const $ = (id) => document.getElementById(id)
const origin = location.origin

let fanoutKey = localStorage.getItem('fanout_key') || ''
let connections = JSON.parse(localStorage.getItem('fanout_conns') || '[]')
let activeTab = 'env'

function persist() {
  if (fanoutKey) localStorage.setItem('fanout_key', fanoutKey)
  localStorage.setItem('fanout_conns', JSON.stringify(connections))
}

// --- key ------------------------------------------------------------------

async function mint() {
  const res = await fetch(origin + '/api/keys/issue', { method: 'POST' })
  const json = await res.json().catch(() => ({}))
  if (!json.key) throw new Error(json.error?.message || 'Could not mint a key.')
  return json.key
}

function renderKey() {
  $('key').textContent = fanoutKey || '…'
}

async function ensureKey() {
  if (fanoutKey) {
    $('key-hint').textContent = 'Yours alone. Fanout keeps no copy — it lives in this browser.'
    renderKey()
    return
  }
  try {
    fanoutKey = await mint()
    persist(); renderKey(); renderConfig()
  } catch (e) {
    $('key').textContent = 'unavailable'
    $('key-hint').textContent = String(e.message || e)
  }
}

$('btn-copy').addEventListener('click', (e) => copy(e.target, fanoutKey))

$('btn-regen').addEventListener('click', async () => {
  const warn = connections.length
    ? 'Regenerate? Your sealed providers only work with the current key, so they will be removed and must be added again.'
    : 'Regenerate? The current key keeps working until it expires, but this page will forget it.'
  if (!confirm(warn)) return
  const btn = $('btn-regen'); btn.disabled = true
  try {
    fanoutKey = await mint()
    connections = []
    persist(); renderKey(); renderChips(); renderConfig()
  } catch (e) { $('key-hint').textContent = String(e.message || e) }
  btn.disabled = false
})

// --- providers ------------------------------------------------------------

function renderChips() {
  const list = $('chips')
  list.textContent = ''
  connections.forEach((c, i) => {
    const li = document.createElement('li')
    li.append(`${c.provider}${c.label ? ' · ' + c.label : ''}`)
    const rm = document.createElement('button')
    rm.textContent = '×'
    rm.setAttribute('aria-label', `remove ${c.provider}`)
    rm.addEventListener('click', () => {
      connections.splice(i, 1)
      persist(); renderChips(); renderConfig()
    })
    li.append(rm)
    list.append(li)
  })
}

$('btn-add').addEventListener('click', async () => {
  $('add-err').textContent = ''
  if (!fanoutKey) return ($('add-err').textContent = 'No key yet — regenerate above first.')
  const btn = $('btn-add'); btn.disabled = true
  try {
    const res = await fetch(origin + '/api/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${fanoutKey}` },
      body: JSON.stringify({ provider: $('provider').value, apiKey: $('provider-key').value }),
    })
    const json = await res.json().catch(() => ({}))
    if (json.connection) {
      connections.push({ blob: json.connection, provider: json.provider, label: json.label })
      $('provider-key').value = ''
      persist(); renderChips(); renderConfig()
    } else {
      $('add-err').textContent = json.error?.message || 'Could not seal the key.'
    }
  } catch (e) { $('add-err').textContent = String(e.message || e) }
  btn.disabled = false
})

// --- config ---------------------------------------------------------------

function configText() {
  const key = fanoutKey || '<your key>'
  const pool = connections.length ? connections.map((c) => c.blob).join(',') : '<add a provider above>'

  const templates = {
    env: `FANOUT_BASE_URL=${origin}/api/v1
FANOUT_KEY=${key}
FANOUT_CONNECTIONS=${pool}`,

    curl: `curl ${origin}/api/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "X-Fanout-Connection: ${pool}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"anthropic/claude-opus-5",
       "messages":[{"role":"user","content":"hi"}]}'`,

    python: `from openai import OpenAI

client = OpenAI(
    base_url="${origin}/api/v1",
    api_key="${key}",
    default_headers={"X-Fanout-Connection": "${pool}"},
)

res = client.chat.completions.create(
    model="anthropic/claude-opus-5",
    messages=[{"role": "user", "content": "hi"}],
)`,

    js: `import OpenAI from 'openai'

const fanout = new OpenAI({
  baseURL: '${origin}/api/v1',
  apiKey: '${key}',
  defaultHeaders: { 'X-Fanout-Connection': '${pool}' },
})

const res = await fanout.chat.completions.create({
  model: 'anthropic/claude-opus-5',
  messages: [{ role: 'user', content: 'hi' }],
})`,
  }
  return templates[activeTab]
}

function renderConfig() {
  $('config').textContent = configText()
}

$('tabs').addEventListener('click', (e) => {
  const tab = e.target.dataset?.tab
  if (!tab) return
  activeTab = tab
  for (const b of $('tabs').querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === tab)
  renderConfig()
})

$('btn-copy-config').addEventListener('click', (e) => copy(e.target, configText()))

// --- clipboard ------------------------------------------------------------

async function copy(btn, text) {
  try {
    await navigator.clipboard.writeText(text)
    const was = btn.textContent
    btn.textContent = 'Copied'
    setTimeout(() => { btn.textContent = was }, 1200)
  } catch {
    btn.textContent = 'Copy failed'
  }
}

// --- backup ---------------------------------------------------------------

$('lnk-backup').addEventListener('click', (e) => {
  e.preventDefault()
  const blob = new Blob(
    [JSON.stringify({ fanout_key: fanoutKey, fanout_conns: connections }, null, 2)],
    { type: 'application/json' },
  )
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'fanout-backup.json'
  a.click()
  URL.revokeObjectURL(a.href)
})

$('lnk-restore').addEventListener('click', (e) => { e.preventDefault(); $('restore-file').click() })

$('restore-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    if (typeof data.fanout_key !== 'string' || !Array.isArray(data.fanout_conns)) {
      throw new Error('Not a Fanout backup.')
    }
    fanoutKey = data.fanout_key
    connections = data.fanout_conns.filter((c) => c && typeof c.blob === 'string')
    persist(); renderKey(); renderChips(); renderConfig()
  } catch (err) { alert(String(err.message || err)) }
  e.target.value = ''
})

// --- init -----------------------------------------------------------------

$('base-url').textContent = origin + '/api/v1'
renderKey()
renderChips()
renderConfig()
ensureKey()
