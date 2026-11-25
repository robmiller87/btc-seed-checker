// Shared core for the CLI and the browser page.
// Everything in this file runs locally. The only network call is
// fetchAddressStats(), which sends a single PUBLIC address.

import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from '@scure/bip32'
import { p2pkh, p2sh, p2wpkh, p2tr, NETWORK } from '@scure/btc-signer'

export const DEFAULT_API = 'https://mempool.space/api'
export const FALLBACK_API = 'https://blockstream.info/api'

// The four standard single-sig Bitcoin wallet types.
export const SCHEMES = [
  {
    id: 'legacy', purpose: 44, label: 'Legacy (P2PKH)', prefix: '1...',
    xpubName: 'xpub', versions: { private: 0x0488ade4, public: 0x0488b21e },
    address: (pub) => p2pkh(pub, NETWORK).address,
  },
  {
    id: 'nested', purpose: 49, label: 'Nested SegWit (P2SH-P2WPKH)', prefix: '3...',
    xpubName: 'ypub', versions: { private: 0x049d7878, public: 0x049d7cb2 },
    address: (pub) => p2sh(p2wpkh(pub, NETWORK), NETWORK).address,
  },
  {
    id: 'segwit', purpose: 84, label: 'Native SegWit (P2WPKH)', prefix: 'bc1q...',
    xpubName: 'zpub', versions: { private: 0x04b2430c, public: 0x04b24746 },
    address: (pub) => p2wpkh(pub, NETWORK).address,
  },
  {
    id: 'taproot', purpose: 86, label: 'Taproot (P2TR)', prefix: 'bc1p...',
    xpubName: 'xpub', versions: { private: 0x0488ade4, public: 0x0488b21e },
    address: (pub) => p2tr(pub.slice(1), undefined, NETWORK).address, // x-only key
  },
]

/** Normalise user input: lowercase, single spaces, strip numbering like "1. word". */
export function normalizePhrase(input) {
  return String(input || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\b\d+[.)]\s*/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/** Returns { ok, words, unknownWords, reason } without ever throwing on bad input. */
export function checkPhrase(phrase) {
  const words = phrase ? phrase.split(' ') : []
  const unknownWords = words
    .map((w, i) => ({ position: i + 1, word: w }))
    .filter(({ word }) => !wordlist.includes(word))
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    return { ok: false, words: words.length, unknownWords, reason: `Expected 12, 15, 18, 21 or 24 words, got ${words.length}.` }
  }
  if (unknownWords.length) {
    return { ok: false, words: words.length, unknownWords, reason: 'Some words are not in the BIP39 English word list (typo?).' }
  }
  if (!validateMnemonic(phrase, wordlist)) {
    return { ok: false, words: words.length, unknownWords, reason: 'All words are valid but the checksum fails: a word is wrong or the order is off.' }
  }
  return { ok: true, words: words.length, unknownWords, reason: null }
}

export function seedFromPhrase(phrase, passphrase = '') {
  return mnemonicToSeedSync(phrase, passphrase)
}

/** Account node + its extended public key for a scheme. */
export function accountFor(seed, scheme, account = 0) {
  const root = HDKey.fromMasterSeed(seed, scheme.versions)
  const path = `m/${scheme.purpose}'/0'/${account}'`
  const node = root.derive(path)
  return { path, node, xpub: node.publicExtendedKey }
}

export function deriveAddress(accountNode, scheme, chain, index) {
  const child = accountNode.deriveChild(chain).deriveChild(index)
  return scheme.address(child.publicKey)
}

/** Offline: does this phrase own `target` within the first `limit` indices? */
export function findAddress(seed, target, { accounts = 1, limit = 1000 } = {}) {
  const t = target.trim()
  const lower = t.toLowerCase()
  for (const scheme of SCHEMES) {
    for (let account = 0; account < accounts; account++) {
      const { node, path } = accountFor(seed, scheme, account)
      for (const chain of [0, 1]) {
        const branch = node.deriveChild(chain)
        for (let i = 0; i < limit; i++) {
          const addr = scheme.address(branch.deriveChild(i).publicKey)
          if (addr === t || addr === lower) return { scheme, path: `${path}/${chain}/${i}`, address: addr }
        }
      }
    }
  }
  return null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Network: sends ONE public address to an Esplora-compatible API. */
export async function fetchAddressStats(address, api = DEFAULT_API, fetchImpl = fetch) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetchImpl(`${api}/address/${address}`)
    if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue }
    if (!res.ok) throw new Error(`${api} returned HTTP ${res.status} for ${address}`)
    const j = await res.json()
    const c = j.chain_stats, m = j.mempool_stats
    return {
      txCount: c.tx_count + m.tx_count,
      confirmedSats: c.funded_txo_sum - c.spent_txo_sum,
      unconfirmedSats: m.funded_txo_sum - m.spent_txo_sum,
      totalReceivedSats: c.funded_txo_sum + m.funded_txo_sum,
    }
  }
  throw new Error(`${api} kept rate-limiting (HTTP 429). Wait a minute and retry, or use another server.`)
}

/**
 * Gap-limit scan of every scheme / account / chain.
 * Stops a branch after `gap` consecutive never-used addresses.
 * onProgress(event) is called for UI updates.
 */
export async function scan(seed, { gap = 20, accounts = 1, api = DEFAULT_API, batch = 4, delayMs = 250, onProgress = () => {}, fetchImpl = fetch, schemes = SCHEMES } = {}) {
  const results = []
  for (const scheme of schemes) {
    for (let account = 0; account < accounts; account++) {
      const { node, path, xpub } = accountFor(seed, scheme, account)
      const entry = { scheme: scheme.id, label: scheme.label, path, xpubName: scheme.xpubName, xpub, used: [], confirmedSats: 0, unconfirmedSats: 0, checked: 0 }
      for (const chain of [0, 1]) {
        const branch = node.deriveChild(chain)
        let index = 0, unusedRun = 0
        while (unusedRun < gap) {
          const idxs = Array.from({ length: batch }, (_, k) => index + k)
          const addrs = idxs.map((i) => scheme.address(branch.deriveChild(i).publicKey))
          const stats = await Promise.all(addrs.map((a) => fetchAddressStats(a, api, fetchImpl)))
          for (let k = 0; k < idxs.length; k++) {
            entry.checked++
            const s = stats[k]
            if (s.txCount > 0) {
              unusedRun = 0
              entry.used.push({ path: `${path}/${chain}/${idxs[k]}`, address: addrs[k], ...s })
              entry.confirmedSats += s.confirmedSats
              entry.unconfirmedSats += s.unconfirmedSats
            } else {
              unusedRun++
            }
          }
          index += batch
          onProgress({ scheme: scheme.label, path: `${path}/${chain}`, checked: entry.checked, found: entry.used.length })
          if (delayMs) await sleep(delayMs)
        }
      }
      results.push(entry)
    }
  }
  return results
}

export const satsToBtc = (s) => (s / 1e8).toFixed(8)
