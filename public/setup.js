// Setup page logic. Same localStorage keys as the landing-page demo, so state
// made on either page shows up on both. Everything stays client-side: the only
// network calls are to this origin's /api/keys/issue and /api/connect.

const $ = (id) => document.getElementById(id)
const origin = location.origin

let fanoutKey = localStorage.getItem('fanout_key') || ''
let connections = JSON.parse(localStorage.getItem('fanout_conns') || '[]')
let activeTab = 'env'

// --- rendering ------------------------------------------------------------

const show = (el, v) => { el.textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2) }

function persist() {
  if (fanoutKey) localStorage.setItem('fanout_key', fanoutKey)
  localStorage.setItem('fanout_conns', JSON.stringify(connections))
}

function renderKey() {
  if (fanoutKey) {
    show($('out-key'), fanoutKey)
    $('btn-copy-key').hidden = false
    $('btn-key').textContent = 'Mint a new key'
  }
}

function renderPool() {
  const list = $('pool-list')
  list.textContent = ''
  connections.forEach((c, i) => {
    const li = document.createElement('li')
    const who = document.createElement('span')
    who.className = 'who'
    const b = document.createElement('b')
    b.textContent = c.provider
    who.append(b, ` · ${c.label || 'unnamed'}`)
    const rm = document.createElement('button')
    rm.textContent = 'remove'
    rm.addEventListener('click', () => {
      connections.splice(i, 1)
      persist(); renderPool(); renderConfig()
    })
    li.append(who, rm)
    list.append(li)
  })
}

// --- the config block -----------------------------------------------------

function configText() {
  const key = fanoutKey || '<mint a key in step 1>'
  const pool = connections.length
    ? connections.map((c) => c.blob).join(',')
    : '<seal a connection in step 2>'

  const templates = {
    env: `# Fanout — everything an OpenAI-compatible tool needs
FANOUT_BASE_URL=${origin}/api/v1
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
  show($('out-config'), configText())
}

// --- clipboard ------------------------------------------------------------

async function copy(btn, text) {
  try {
    await navigator.clipboard.writeText(text)
    const was = btn.textContent
    btn.textContent = 'Copied ✓'
    setTimeout(() => { btn.textContent = was }, 1400)
  } catch {
    btn.textContent = 'Copy failed — select the text manually'
  }
}

// --- wiring ---------------------------------------------------------------

async function post(path, body, key) {
  const res = await fetch(origin + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { res, json: await res.json().catch(() => ({})) }
}

$('btn-key').addEventListener('click', async () => {
  if (fanoutKey && !confirm('Mint a new key? Blobs sealed under the old key keep working with the old key only — the config block below always uses the newest one.')) return
  const btn = $('btn-key'); btn.disabled = true
  try {
    const { json } = await post('/api/keys/issue', { handle: $('handle').value })
    if (json.key) {
      fanoutKey = json.key
      persist(); renderKey(); renderConfig()
      show($('out-key'), fanoutKey)
    } else {
      show($('out-key'), json)
    }
  } catch (e) { show($('out-key'), String(e)) }
  btn.disabled = false
})

$('btn-copy-key').addEventListener('click', (e) => copy(e.target, fanoutKey))

$('btn-connect').addEventListener('click', async () => {
  if (!fanoutKey) return show($('out-connect'), 'Mint a Fanout key first (step 1).')
  const btn = $('btn-connect'); btn.disabled = true
  try {
    const { json } = await post('/api/connect', {
      provider: $('provider').value,
      apiKey: $('provider-key').value,
      label: $('label').value,
    }, fanoutKey)
    if (json.connection) {
      connections.push({ blob: json.connection, provider: json.provider, label: json.label })
      $('provider-key').value = ''
      $('label').value = ''
      $('out-connect').textContent = ''
      persist(); renderPool(); renderConfig()
    } else {
      show($('out-connect'), json)
    }
  } catch (e) { show($('out-connect'), String(e)) }
  btn.disabled = false
})

$('tabs').addEventListener('click', (e) => {
  const tab = e.target.dataset?.tab
  if (!tab) return
  activeTab = tab
  for (const b of $('tabs').querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === tab)
  renderConfig()
})

$('btn-copy-config').addEventListener('click', (e) => copy(e.target, configText()))

// --- backup ---------------------------------------------------------------

$('btn-backup').addEventListener('click', () => {
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

$('btn-restore').addEventListener('click', () => $('restore-file').click())

$('restore-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    if (typeof data.fanout_key !== 'string' || !Array.isArray(data.fanout_conns)) {
      throw new Error('Not a Fanout backup: expected {fanout_key, fanout_conns}.')
    }
    fanoutKey = data.fanout_key
    connections = data.fanout_conns.filter((c) => c && typeof c.blob === 'string')
    persist(); renderKey(); renderPool(); renderConfig()
    show($('out-backup'), `Restored: 1 key, ${connections.length} connection(s).`)
  } catch (err) { show($('out-backup'), String(err)) }
  e.target.value = ''
})

// --- init -----------------------------------------------------------------

renderKey()
renderPool()
renderConfig()
