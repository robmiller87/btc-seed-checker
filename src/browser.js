import {
  SCHEMES, DEFAULT_API, FALLBACK_API, normalizePhrase, checkPhrase, seedFromPhrase,
  accountFor, deriveAddress, findAddress, scan, satsToBtc,
} from './core.js'

const $ = (id) => document.getElementById(id)
const out = $('out')

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text // never innerHTML: nothing user/network-supplied becomes markup
  return e
}
function clear() { out.replaceChildren() }
function line(text, cls) { out.appendChild(el('div', cls, text)); return out.lastChild }

function readInputs() {
  const phrase = normalizePhrase($('phrase').value)
  const passphrase = $('passphrase').value // passphrase is NOT normalised: it is case/space sensitive
  const check = checkPhrase(phrase)
  return { phrase, passphrase, check }
}

function showCheck(check, passphrase) {
  line(`${check.words} words`)
  for (const u of check.unknownWords) line(`Word #${u.position} "${u.word}" is not in the BIP39 word list`, 'bad')
  if (!check.ok) {
    line(`Phrase valid: NO — ${check.reason}`, 'bad big')
    line('Note: Electrum-generated seeds are not BIP39 and will always fail this check.', 'muted')
    return false
  }
  line('Phrase valid: YES (BIP39 checksum OK)', 'good big')
  line(passphrase ? 'BIP39 passphrase: used (a different passphrase = a different wallet)' : 'BIP39 passphrase: none', 'muted')
  return true
}

function typeCard(scheme, path, xpubName, xpub) {
  const card = el('section', 'card')
  card.appendChild(el('h3', null, `${scheme.label}  ·  ${scheme.prefix}`))
  card.appendChild(el('div', 'mono muted', path))
  const x = el('details')
  x.appendChild(el('summary', null, `${xpubName} (watch-only key, safe to import into Sparrow/BlueWallet)`))
  x.appendChild(el('div', 'mono wrap', xpub))
  card.appendChild(x)
  out.appendChild(card)
  return card
}

let busy = false
function setBusy(b) {
  busy = b
  for (const id of ['btnOffline', 'btnFind', 'btnScan']) $(id).disabled = b
  $('net').textContent = b ? 'Network: looking up public addresses…' : 'Network: idle'
}

$('btnOffline').onclick = () => {
  clear()
  const { phrase, passphrase, check } = readInputs()
  if (!showCheck(check, passphrase)) return
  const seed = seedFromPhrase(phrase, passphrase)
  for (const s of SCHEMES) {
    const { node, path, xpub } = accountFor(seed, s)
    const card = typeCard(s, path, s.xpubName, xpub)
    for (let i = 0; i < 5; i++) card.appendChild(el('div', 'mono', `${path}/0/${i}   ${deriveAddress(node, s, 0, i)}`))
  }
  line('Offline only — nothing was sent anywhere.', 'muted')
}

$('btnFind').onclick = () => {
  clear()
  const target = $('address').value.trim()
  if (!target) { line('Paste a Bitcoin address to look for.', 'bad'); return }
  const { phrase, passphrase, check } = readInputs()
  if (!showCheck(check, passphrase)) return
  line('Searching 4 types × 3 accounts × 1000 receive + change addresses (offline)…', 'muted')
  setTimeout(() => {
    const hit = findAddress(seedFromPhrase(phrase, passphrase), target, { accounts: 3 })
    if (hit) line(`Owns ${hit.address}: YES — ${hit.scheme.label}, path ${hit.path}`, 'good big')
    else line(`Owns ${target}: NO. Check the passphrase, or the address may be from another wallet.`, 'bad big')
  }, 20)
}

$('btnScan').onclick = async () => {
  if (busy) return
  clear()
  const { phrase, passphrase, check } = readInputs()
  if (!showCheck(check, passphrase)) return
  const api = $('server').value
  const gap = Math.max(1, parseInt($('gap').value, 10) || 20)
  const accounts = Math.max(1, parseInt($('accounts').value, 10) || 1)
  const seed = seedFromPhrase(phrase, passphrase)
  const progress = line('Starting…', 'muted')
  setBusy(true)
  try {
    const results = await scan(seed, {
      gap, accounts, api,
      onProgress: (p) => { progress.textContent = `Checking ${p.scheme} ${p.path} — ${p.checked} addresses, ${p.found} with history (via ${new URL(p.server).host})` },
      onRetry: (r) => { progress.textContent = `Connection hiccup, retrying… (${r.error})` },
    })
    progress.textContent = `Scan complete (gap limit ${gap}, via ${api}).`
    let total = 0, unconf = 0, any = false
    for (const r of results) {
      total += r.confirmedSats; unconf += r.unconfirmedSats
      const s = SCHEMES.find((x) => x.id === r.scheme)
      const card = typeCard(s, r.path, r.xpubName, r.xpub)
      if (!r.used.length) { card.appendChild(el('div', 'muted', `No history (${r.checked} addresses checked)`)); continue }
      any = true
      card.appendChild(el('div', 'big', `${satsToBtc(r.confirmedSats)} BTC${r.unconfirmedSats ? `  (+${satsToBtc(r.unconfirmedSats)} unconfirmed)` : ''}`))
      for (const u of r.used) {
        card.appendChild(el('div', 'mono', `${u.path}   ${u.address}   ${u.txCount} tx   ${satsToBtc(u.confirmedSats)} BTC`))
      }
    }
    const t = el('div', 'total', `Total: ${satsToBtc(total)} BTC${unconf ? `  (+${satsToBtc(unconf)} unconfirmed)` : ''}`)
    progress.after(t)
    if (!any) line('No history on any standard path. If you expected funds: was there a BIP39 passphrase? Or the seed may be Electrum-format.', 'muted')
  } catch (e) {
    line(`Lookup failed: ${e.message}.`, 'bad big')
    if (e.network) {
      line('Your browser blocked the request before it reached the explorer. Common causes:', 'muted')
      line('• The page is open inside a preview (e.g. the Claude app file card) that has no network access. Open the downloaded index.html directly in Safari, Chrome or Firefox instead.', 'muted')
      line('• A content blocker or privacy extension (Brave Shields, uBlock, Lockdown, etc.) is blocking mempool.space / blockstream.info.', 'muted')
      line('• Safari: if it still fails, check Develop → Developer Settings → "Disable local file restrictions", or use Chrome or Firefox.', 'muted')
      line('• Or use the terminal version, which never has this issue: npm run check -- --phrase-stdin', 'muted')
    }
  } finally {
    setBusy(false)
  }
}

$('toggle').onclick = () => {
  const p = $('phrase')
  p.classList.toggle('hidden-text')
  $('toggle').textContent = p.classList.contains('hidden-text') ? 'Show' : 'Hide'
}
$('clear').onclick = () => { $('phrase').value = ''; $('passphrase').value = ''; $('address').value = ''; clear() }

const srv = $('server')
for (const u of [DEFAULT_API, FALLBACK_API]) srv.appendChild(Object.assign(document.createElement('option'), { value: u, textContent: u }))
