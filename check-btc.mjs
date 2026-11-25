#!/usr/bin/env node
import process from 'node:process'
import { readFileSync } from 'node:fs'
import {
  SCHEMES, DEFAULT_API, normalizePhrase, checkPhrase, seedFromPhrase,
  accountFor, deriveAddress, findAddress, scan, satsToBtc,
} from './src/core.js'

function usage() {
  console.log(`BTC seed phrase checker (local-first)

Usage:
  printf '%s' 'word1 word2 ...' | npm run check -- --phrase-stdin [options]

Phrase sources (pick one):
  --phrase-stdin            read the phrase from stdin (recommended)
  --phrase-file <path>      read the phrase from a file
  --phrase-env              read from BTC_PHRASE env var

Options:
  --passphrase-stdin-line2  stdin line 2 is the BIP39 passphrase ("25th word")
  --passphrase-env          read BIP39 passphrase from BTC_PASSPHRASE
  --offline                 validate + derive only, no network at all
  --show <n>                offline: print first n receive addresses per type (default 3)
  --address <addr>          offline: check whether the phrase owns this address
  --gap <n>                 gap limit for the balance scan (default 20)
  --accounts <n>            scan accounts 0..n-1 per type (default 1)
  --server <url>            Esplora API base (default ${DEFAULT_API})
  --types <list>            comma list of legacy,nested,segwit,taproot (default all)

Safety:
  - The phrase and passphrase never leave this machine.
  - The balance scan sends only derived PUBLIC addresses to the server.
  - Avoid putting the phrase directly in a command line (shell history).
`)
}

function parseArgs(argv) {
  const a = { gap: 20, accounts: 1, show: 3, server: DEFAULT_API, offline: false }
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i]
    if (x === '-h' || x === '--help') a.help = true
    else if (x === '--phrase-stdin') a.phraseStdin = true
    else if (x === '--phrase-file') a.phraseFile = argv[++i]
    else if (x === '--phrase-env') a.phraseEnv = true
    else if (x === '--passphrase-stdin-line2') a.passStdin = true
    else if (x === '--passphrase-env') a.passEnv = true
    else if (x === '--offline') a.offline = true
    else if (x === '--show') a.show = parseInt(argv[++i], 10)
    else if (x === '--address') a.address = argv[++i]
    else if (x === '--gap') a.gap = parseInt(argv[++i], 10)
    else if (x === '--accounts') a.accounts = parseInt(argv[++i], 10)
    else if (x === '--server') a.server = argv[++i].replace(/\/+$/, '')
    else if (x === '--types') a.types = argv[++i].split(',').map((s) => s.trim())
    else if (x === '--phrase') throw new Error('--phrase on the command line is disabled (shell history). Use --phrase-stdin.')
    else throw new Error(`Unknown argument: ${x}`)
  }
  return a
}

async function readStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) return usage()

  let raw, passphrase = ''
  if (args.phraseStdin) {
    const lines = (await readStdin()).split(/\r?\n/)
    raw = lines[0]
    if (args.passStdin) passphrase = lines[1] ?? ''
  } else if (args.phraseFile) raw = readFileSync(args.phraseFile, 'utf8').split(/\r?\n/)[0]
  else if (args.phraseEnv) raw = process.env.BTC_PHRASE
  else { usage(); process.exit(1) }
  if (args.passEnv) passphrase = process.env.BTC_PASSPHRASE ?? ''

  const phrase = normalizePhrase(raw)
  const check = checkPhrase(phrase)
  console.log(`words: ${check.words}`)
  for (const u of check.unknownWords) console.log(`  word #${u.position} "${u.word}" is not in the BIP39 list`)
  if (!check.ok) { console.log(`phrase valid: NO — ${check.reason}`); process.exit(2) }
  console.log('phrase valid: YES (BIP39 checksum OK)')
  console.log(`BIP39 passphrase: ${passphrase ? 'used' : 'none'}`)

  const seed = seedFromPhrase(phrase, passphrase)
  const schemes = args.types ? SCHEMES.filter((s) => args.types.includes(s.id)) : SCHEMES

  if (args.address) {
    const hit = findAddress(seed, args.address, { accounts: Math.max(args.accounts, 3) })
    if (hit) console.log(`\nowns ${args.address}: YES — ${hit.scheme.label}, path ${hit.path}`)
    else console.log(`\nowns ${args.address}: NO (searched all 4 types, accounts 0-${Math.max(args.accounts, 3) - 1}, first 1000 indices). Wrong passphrase?`)
    if (args.offline) return
  }

  if (args.offline) {
    for (const s of schemes) {
      const { node, path, xpub } = accountFor(seed, s)
      console.log(`\n${s.label}  ${path}`)
      console.log(`  ${s.xpubName}: ${xpub}`)
      for (let i = 0; i < args.show; i++) console.log(`  ${path}/0/${i}  ${deriveAddress(node, s, 0, i)}`)
    }
    console.log('\n(offline: no network lookups were made)')
    return
  }

  console.log(`\nScanning via ${args.server} (public addresses only, gap limit ${args.gap})...`)
  const results = await scan(seed, {
    gap: args.gap, accounts: args.accounts, api: args.server, schemes,
    onProgress: (p) => process.stderr.write(`\r  ${p.path.padEnd(18)} checked ${String(p.checked).padStart(4)}  used ${p.found}   `),
  })
  process.stderr.write('\n')

  let total = 0, totalUnconf = 0, anyUsed = false
  for (const r of results) {
    total += r.confirmedSats; totalUnconf += r.unconfirmedSats
    console.log(`\n${r.label}  ${r.path}`)
    console.log(`  ${r.xpubName}: ${r.xpub}`)
    if (!r.used.length) { console.log('  no history'); continue }
    anyUsed = true
    console.log(`  balance: ${satsToBtc(r.confirmedSats)} BTC${r.unconfirmedSats ? ` (+${satsToBtc(r.unconfirmedSats)} unconfirmed)` : ''}`)
    for (const u of r.used) {
      console.log(`  ${u.path.padEnd(20)} ${u.address}  txs ${u.txCount}  bal ${satsToBtc(u.confirmedSats)}`)
    }
  }
  console.log(`\nTOTAL: ${satsToBtc(total)} BTC${totalUnconf ? ` (+${satsToBtc(totalUnconf)} unconfirmed)` : ''}`)
  if (!anyUsed) console.log('No history on any standard path. If you expected funds: check for a BIP39 passphrase, or the seed may be from Electrum (not BIP39).')
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1) })
