# BTC Seed Checker

Local-first Bitcoin seed phrase checker. Give it a BIP39 phrase (12–24 words) and it:

- validates the phrase (word list + checksum), and tells you which word is wrong
- derives addresses for **all four** standard Bitcoin wallet types:

  | Type | Path | Addresses start with |
  |---|---|---|
  | Legacy (P2PKH) | `m/44'/0'/0'` | `1…` |
  | Nested SegWit (P2SH-P2WPKH) | `m/49'/0'/0'` | `3…` |
  | Native SegWit (P2WPKH) | `m/84'/0'/0'` | `bc1q…` |
  | Taproot (P2TR) | `m/86'/0'/0'` | `bc1p…` |

- checks offline whether the phrase **owns a given address**
- scans balances and history with a standard gap-limit scan (receive + change), via mempool.space or blockstream.info
- shows the account **xpub / ypub / zpub**, so you can import a watch-only wallet into Sparrow or BlueWallet without exposing the phrase again
- supports an optional BIP39 passphrase (the "25th word")

## Security model

- The phrase and passphrase are only used locally to derive keys. They are never saved and never sent anywhere.
- The balance scan sends only derived **public addresses** to the explorer.
- `index.html` has a Content-Security-Policy that only allows connections to `mempool.space` and `blockstream.info`, and it loads no external scripts. All crypto libraries are bundled inside the file.
- The offline buttons (and `--offline` in the terminal) make no network requests at all. For a wallet with real money, run those first with Wi-Fi off.
- If a phrase has been sitting in old notes, screenshots or cloud docs, treat it as exposed: move the funds to a fresh wallet.

Crypto comes from the audited [`@scure`](https://github.com/paulmillr/scure-btc-signer) libraries (`bip39`, `bip32`, `btc-signer`). Derivation is tested against the official BIP44/49/84/86 test vectors (`npm test`).

## Browser version (easiest)

Download the repo ZIP from GitHub, unzip it and double-click **`index.html`**. It works in Safari, Chrome or Firefox from your disk. No install needed.

- **Validate & show addresses (offline)**: checks the phrase and lists the first addresses + xpubs for each type
- **Find address (offline)**: "does this phrase own this address?" (4 types × 3 accounts × 1000 receive/change)
- **Scan balances & history**: looks up the derived public addresses

## Terminal version

```bash
git clone https://github.com/robmiller87/btc-seed-checker.git
cd btc-seed-checker
npm install
```

The phrase is read from stdin so it doesn't end up in shell history. Leading `printf` with a space also keeps it out of history in most shells.

```bash
# Offline: validate + show addresses and xpubs
printf '%s' 'word1 word2 … word12' | npm run check -- --phrase-stdin --offline

# Offline: does this phrase own this address?
printf '%s' 'word1 … word12' | npm run check -- --phrase-stdin --offline --address bc1q...

# Balance + history scan (public addresses only)
printf '%s' 'word1 … word12' | npm run check -- --phrase-stdin

# With a BIP39 passphrase on line 2
printf '%s\n%s' 'word1 … word12' 'my passphrase' | npm run check -- --phrase-stdin --passphrase-stdin-line2
```

Options: `--gap <n>` (default 20), `--accounts <n>` (default 1), `--types legacy,nested,segwit,taproot`, `--server https://blockstream.info/api`.

## If nothing shows up

- **Passphrase**: a BIP39 passphrase creates a completely different wallet. A missing or mistyped one is the most common reason for "empty".
- **Electrum seeds** are not BIP39. They will fail the checksum here. Restore those in Electrum itself.
- **More accounts / bigger gap**: some wallets use account 1, 2… or skip many addresses. Try `--accounts 3 --gap 50`.
- **Multisig** and non-standard paths aren't covered.

## Development

```bash
npm test         # BIP test vectors
npm run build    # rebuilds index.html from src/ (single self-contained file)
```

`src/core.js` is shared by the CLI and the browser page. `index.html` is a build output, committed so the ZIP download works with no install.
