# Publish Checklist

## Build

- Load unpacked from the final release folder only.
- Confirm the packaged zip matches the current source build.
- Confirm `manifest.json` version matches the release candidate being uploaded.

## Chrome Web Store assets

- Prepare extension icon assets and screenshots.
- Capture at least:
  - popup showing wrapped protection state
  - proxy address substitution on a real dapp
  - threat log / warning state
- Prepare a support email.
- Prepare a public privacy policy URL.

## Policy readiness

- Review permissions justification for:
  - `storage`
  - `activeTab`
  - `alarms`
  - `notifications`
  - `tabs`
  - `<all_urls>`
- Make sure store copy does not overclaim absolute safety.

## Functional launch checks

- EVM connect returns proxy address, not the real wallet.
- EVM risky signature flows log and notify correctly.
- Solana connect works on Jupiter.
- Aptos connect works on Liquidswap.
- Popup does not claim a site is connected on the wrong chain.

## Post-launch caution

- Treat Sui support as improving rather than fully universal until Cetus-class compatibility is tightened.
- Keep the adaptive interception refactor moving after launch.
