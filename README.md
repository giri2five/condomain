# condom@in

**your wallet's condom.**

A Chrome extension that protects you from wallet phishing, drainer attacks, and malicious dApps by giving every site its own disposable proxy wallet — your real wallet never connects to anything.

---

## How it works

Instead of exposing your real wallet to every dApp you visit, condom@in generates a fresh empty keypair for each site. When a dApp asks to connect, it gets the proxy. When it asks you to sign something, the proxy signs. Your real wallet address is never revealed, never signs anything, never at risk.

If a site tries to drain you with a Permit signature, a Seaport order, or a MetaTransaction — the signature is worthless. It came from an empty proxy wallet with nothing in it.

## What's protected

| Chain | Status |
|---|---|
| EVM (Ethereum, Base, Arbitrum, Optimism, Polygon, zkSync, and more) | ✅ Full protection |
| Solana | ✅ Full protection |
| Aptos | ✅ Full protection |
| Sui | ⚠️ Improving |
| TRON | ⚠️ Beta |

## Features

- Per-site proxy wallet — every dApp gets a different address
- Blocks Permit / Permit2 drain signatures
- Blocks Seaport NFT order drains
- Blocks MetaTransaction forwarding attacks
- Intercepts wallet_requestPermissions — no real MetaMask popup
- Threat detection with Chrome notifications and badge flash
- One-click proxy rotation per site
- Full activity log with threat classification
- AES-256-GCM encrypted key storage
- Works across all EVM chains simultaneously

## Install

Available on the Chrome Web Store.

Or load unpacked from this repo for development:
1. Clone this repo
2. Go to `chrome://extensions`
3. Enable Developer mode
4. Click Load unpacked → select this folder

## Privacy

All proxy keypairs are stored locally in your browser, encrypted with AES-256-GCM. No data is transmitted to any server. No account required.

[Privacy Policy](https://giri2five.github.io/condomain/PRIVACY_POLICY)

## License

MIT
