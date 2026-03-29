# condom@in 1.1.0 Release Candidate Report

## Build

- Version: `1.1.0`
- Folder: `C:\Users\gopin\Downloads\condom@in\_project\condom@in`

## Static regression

The following files passed `node --check`:

- `background.js`
- `content.js`
- `injected.js`
- `popup.js`
- `qa/server.js`

## Live behavior validated in this thread

### EVM

- Local simulator returned proxy addresses instead of the real EVM wallet.
- `eth_requestAccounts`, `eth_accounts`, `eth_coinbase`, and `wallet_requestPermissions` matched the proxy.
- Permit / Seaport / personal-sign flows were intercepted and surfaced in the threat log.
- Rotation changed the proxy and subsequent requests returned the new proxy.
- Uniswap-style EVM connect matched the proxy after rotation.

### Solana

- User confirmed Jupiter worked.

### Aptos

- Liquidswap flow was hardened and later confirmed working after a fresh-tab reload.

### Sui

- Aftermath discovery/connect improved enough for `condom@in` to appear and connect.
- Cetus remains inconsistent and should still be treated as unresolved for production confidence.

## Known production caution

This build is strong on the chains that matter most for phishing/drainer protection:

- EVM
- Solana
- Aptos

But it is **not honest** to call the extension fully battle-tested on every advertised chain yet.

Current caution items:

- `Sui` compatibility is still uneven across dapps, especially Cetus.
- The popup had to be corrected to avoid showing stale cross-chain activity as if the active site were connected.
- Any time `injected.js` changes, the extension must be reloaded and the target dapp must be opened in a fresh tab.

## Recommendation

This is a solid **release candidate** for continued live regression and packaging, with the clearest launch posture being:

- lead with EVM + Solana + Aptos protection
- keep Sui support described more cautiously until Cetus-class compatibility is tightened

## Suggested next packaging step

- Pack and archive this exact folder as the release candidate build.
