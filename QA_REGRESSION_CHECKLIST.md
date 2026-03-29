# condom@in Regression Checklist

## Release blockers

- `eth_requestAccounts` returns the proxy address, never the real wallet address.
- `eth_accounts` stays empty before connect and returns the proxy after connect.
- Dangerous EVM signature flows increment `threats blocked`.
- Dangerous EVM signature flows trigger a Chrome notification and a temporary red `!` badge.
- Popup shows the current site's active proxy for any connected chain, not only EVM.
- `swap condom` rotates the currently active chain for the current site.
- `rotate all proxies` rotates every stored chain type.
- No new errors appear in `chrome://extensions` for the extension while testing.

## Scam-site regression

### Fake airdrop / phishing connect

- Open a suspicious EVM dapp or a local test page that calls `eth_requestAccounts`.
- Confirm the returned address is not the user's real MetaMask address.
- Confirm the popup shows that same proxy address for the current site.

### Permit / typed-data drain

- Trigger `eth_signTypedData_v4` with a Permit or Permit2-shaped payload.
- Confirm the signature is returned from the proxy path.
- Confirm the popup threat counter increases.
- Confirm the user sees the danger notification and badge flash.

### Seaport / order-signing drain

- Trigger a Seaport-like typed-data request.
- Confirm the request is classified as a threat and visible in the threat log.

### Personal-sign phishing

- Trigger a suspicious `personal_sign` payload.
- Confirm it is logged as `warn` or `danger` depending on payload shape.

## Multi-chain regression

### Solana

- Test on a Solana wallet flow such as Jupiter.
- Confirm the proxy public key is returned instead of the user's real Phantom key.
- Confirm the popup can show the Solana proxy after connect.

### Sui

- Confirm `connect` or `getAccounts` marks the site as connected and the popup can surface the Sui proxy.

### Aptos

- Confirm `connect` or `account` marks the site as connected and the popup can surface the Aptos proxy.

### TRON

- Confirm sign flows keep the stored TRON proxy marked as connected once used.

## UX trust checks

- When protection is off, the popup language makes the exposed state obvious.
- Threat log entries are visually differentiated: `danger` red, `warn` amber, everything else neutral.
- The current-site proxy card never implies a site is protected when there is no connected or active proxy.

## Publish notes

- Re-run this checklist on the final packed build, not only unpacked mode.
- Keep screenshots of threat notification, popup threat log, and proxy-address substitution for store review materials.
