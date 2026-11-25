// Gap-limit scan + network resilience, against a mocked explorer (no real network).
import assert from 'node:assert/strict'
import { scan, seedFromPhrase, SCHEMES } from './src/core.js'
const seed = seedFromPhrase('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
const used = { 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu': 150000, 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el': 0 }
let calls = 0, n429 = 0
const fetchImpl = async (url) => {
  calls++
  if (calls === 3 && !n429++) return { status: 429, ok: false }
  const a = url.split('/').pop(); const bal = used[a]
  const st = (f, s, t) => ({ funded_txo_sum: f, spent_txo_sum: s, tx_count: t })
  return { status: 200, ok: true, json: async () => ({ chain_stats: a in used ? st(bal + 5000, 5000, 3) : st(0,0,0), mempool_stats: st(0,0,0) }) }
}
let r = await scan(seed, { gap: 20, delayMs: 0, retryBaseMs: 1, fetchImpl, schemes: SCHEMES.filter(s => s.id === 'segwit') })
assert.equal(r[0].used.length, 2); assert.equal(r[0].confirmedSats, 150000)
assert.equal(r[0].checked, 44) // batches of 2: 22 per chain
console.log('scan ok', r[0].used.map(u => u.path), 'checked', r[0].checked, '429 retried', n429)
// --- resilience ---
const seed2 = seedFromPhrase('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
const st2 = (f,t)=>({funded_txo_sum:f,spent_txo_sum:0,tx_count:t})
const ok = (a)=>({status:200,ok:true,json:async()=>({chain_stats: a==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'?st2(5000,1):st2(0,0), mempool_stats:st2(0,0)})})
const drop = ()=>{ throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }) }
const only = SCHEMES.filter(s=>s.id==='segwit')
// 1) mempool drops every 5th request -> retries, still completes
let n=0, retries=0
r = await scan(seed2,{delayMs:0,retryBaseMs:1,schemes:only,onRetry:()=>retries++,fetchImpl:async(u)=>{ if(++n%5===0) drop(); return ok(u.split('/').pop()) }})
assert.equal(r[0].used.length,1); console.log('intermittent drops: ok, retries', retries)
// 2) mempool dead entirely after 10 requests -> switches to blockstream
n=0; const hosts=new Set()
r = await scan(seed2,{delayMs:0,retryBaseMs:1,schemes:only,fetchImpl:async(u)=>{ if(u.includes('mempool') && ++n>10) drop(); hosts.add(new URL(u).host); return ok(u.split('/').pop()) }})
assert.equal(r[0].used.length,1); assert.ok(hosts.has('blockstream.info')); console.log('mempool dead: switched to', [...hosts])
// 3) both dead -> clear error
await assert.rejects(scan(seed2,{delayMs:0,retryBaseMs:1,schemes:only,fetchImpl:async()=>drop()}), (e)=>{ console.log('both dead:', e.message); return e.network })
console.log('all scan tests pass')
