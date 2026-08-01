// Logic for the bring-your-own-keys demo. External rather than inline so the
// page can carry the same strict CSP as every other page. This page takes a raw
// provider secret, so it is the last one that should be exempt from it.

const $ = (id) => document.getElementById(id)
const show = (el, v) => { el.textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2) }
const origin = location.origin

let fanoutKey = localStorage.getItem('fanout_key') || ''
let connections = JSON.parse(localStorage.getItem('fanout_conns') || '[]')

if (fanoutKey) show($('out-key'), fanoutKey)
renderPool()

document.querySelectorAll('pre').forEach((p) => {
  if (p.textContent.includes('$ORIGIN')) p.textContent = p.textContent.replaceAll('$ORIGIN', origin)
})

function renderPool() {
  $('pool').textContent = connections.length
    ? `pool: ${connections.map((c) => `${c.provider}:${c.label || 'unnamed'}`).join('  ·  ')}`
    : ''
  localStorage.setItem('fanout_conns', JSON.stringify(connections))
}

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

$('btn-key').onclick = async () => {
  const btn = $('btn-key'); btn.disabled = true
  try {
    const { json } = await post('/api/keys/issue', { handle: $('handle').value })
    if (json.key) {
      fanoutKey = json.key
      localStorage.setItem('fanout_key', fanoutKey)
    }
    show($('out-key'), json)
  } catch (e) { show($('out-key'), String(e)) }
  btn.disabled = false
}

$('btn-connect').onclick = async () => {
  if (!fanoutKey) return show($('out-connect'), 'Issue a Fanout key first.')
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
      renderPool()
    }
    show($('out-connect'), json)
  } catch (e) { show($('out-connect'), String(e)) }
  btn.disabled = false
}

$('btn-run').onclick = async () => {
  if (!fanoutKey) return show($('out-run'), 'Issue a Fanout key first.')
  if (!connections.length) return show($('out-run'), 'Seal at least one connection first.')
  const btn = $('btn-run'); btn.disabled = true
  show($('out-run'), 'streaming…')
  try {
    const res = await fetch(origin + '/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fanoutKey}`,
        'x-fanout-connection': connections.map((c) => c.blob).join(','),
      },
      body: JSON.stringify({
        model: $('model').value,
        stream: true,
        messages: [{ role: 'user', content: $('prompt').value }],
      }),
    })

    if (!res.ok || !res.body) return show($('out-run'), await res.text())

    const served = res.headers.get('x-fanout-connection-label')
    let text = served ? `[served by ${res.headers.get('x-fanout-provider')} · ${served}]\n\n` : ''
    show($('out-run'), text)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta?.content
          if (delta) { text += delta; show($('out-run'), text) }
        } catch {}
      }
    }
  } catch (e) { show($('out-run'), String(e)) }
  btn.disabled = false
}
