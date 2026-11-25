// Official BIP44/49/84/86 test vectors for "abandon x11 about".
import assert from 'node:assert/strict'
import { SCHEMES, normalizePhrase, checkPhrase, seedFromPhrase, accountFor, deriveAddress, findAddress } from './src/core.js'

const phrase = normalizePhrase('1. Abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ABOUT')
assert.ok(checkPhrase(phrase).ok)
assert.equal(checkPhrase(phrase.replace('about', 'abandon')).ok, false)
assert.equal(checkPhrase(phrase.replace('about', 'abuot')).unknownWords.length, 1)

const seed = seedFromPhrase(phrase)
const by = Object.fromEntries(SCHEMES.map((s) => [s.id, s]))
const vec = {
  legacy:  { first: '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA' },
  nested:  { first: '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf', xpub: 'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP' },
  segwit:  { first: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', change: 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el', xpub: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs' },
  taproot: { first: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr', change: 'bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7', xpub: 'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ' },
}
for (const [id, v] of Object.entries(vec)) {
  const s = by[id]; const { node, xpub } = accountFor(seed, s)
  assert.equal(deriveAddress(node, s, 0, 0), v.first, `${id} first`)
  if (v.change) assert.equal(deriveAddress(node, s, 1, 0), v.change, `${id} change`)
  if (v.xpub) assert.equal(xpub, v.xpub, `${id} xpub`)
  console.log(`ok ${id.padEnd(8)} ${v.first}`)
}
assert.equal(findAddress(seed, vec.segwit.change).path, "m/84'/0'/0'/1/0")
assert.equal(findAddress(seedFromPhrase(phrase, 'wrong'), vec.segwit.first, { limit: 50 }), null)
console.log('ok findAddress + passphrase changes wallet')
console.log('all test vectors pass')
