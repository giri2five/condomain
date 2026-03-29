# Chrome Web Store Listing

## Name

condom@in

## Short description

Wallet phishing protection that routes dapps through per-site proxy wallets.

## Detailed description

`condom@in` is a protective wallet layer for web3 users.

Instead of exposing your main wallet directly to every dapp, `condom@in` gives each site its own disposable proxy wallet identity. That helps reduce phishing risk, wallet doxxing, malicious signature exposure, and cross-site wallet linkage.

### What it does

- wraps supported wallet connection flows with a per-site proxy address
- intercepts risky signature requests before they reach your real wallet identity
- flags common drainer patterns like Permit-style approvals, suspicious typed-data requests, and phishing-style signature prompts
- keeps threat history visible in the extension popup
- lets you rotate a site-specific proxy whenever a site feels sketchy

### Why use it

Most wallet users do not get drained by “hacks” in the dramatic sense. They get drained by connecting to the wrong site, signing the wrong payload, or unknowingly granting approvals that can be abused later.

`condom@in` is designed to reduce that exact risk.

### Current focus

The strongest protection coverage in this release is centered on:

- EVM
- Solana
- Aptos

Support for other chains and dapp environments continues to improve over time.

### Important note

`condom@in` is a protective layer, not a guarantee against every loss scenario. It does not protect against seed phrase theft, device malware, or scams that happen outside the wallet/browser flow.

## Category suggestion

Privacy and security

## Single-purpose statement

`condom@in` protects users from wallet phishing and drainer-style signature attacks by routing dapp connections through disposable per-site proxy wallets and surfacing risky signing behavior in the extension UI.
