# condom@in Adaptive Interception Plan

## Goal

Move from chain-by-chain/manual wallet patches to a generic interception kernel that:

- captures wallet/provider discovery on any site as early as possible
- classifies what kind of provider pattern the site uses
- routes the site into the safest available proxy strategy
- degrades safely when the site uses an unknown pattern

This is not "self-fixing" in the magical sense. It is "self-adapting" within the browser/runtime patterns we can observe.

## What is realistically possible

We can make the extension adaptive across:

- provider globals assigned to `window`
- providers defined through `Object.defineProperty`
- wallet-standard event registration flows
- adapter-style provider discovery
- late-loaded providers
- provider aliases and renamed wallet globals
- per-site method usage profiling

We cannot automatically support a brand new chain or signing format with zero chain logic forever. At some point, a new chain still needs:

- address/account shape
- connect/getAccounts shape
- signing/result shape
- risk classification rules

So the right model is:

- generic discovery and capture
- generic capability profiling
- pluggable chain/runtime adapters

## Proposed kernel

### 1. Discovery Layer

Capture all common wallet entry points generically:

- `window.<provider>`
- nested globals such as `window.phantom.solana` or `window.phantom.sui`
- `Object.defineProperty(window, ...)`
- wallet-standard register/app-ready events
- chain-specific announce/request flows like EIP-6963

This layer should answer:

- what wallet-like objects appeared?
- where did they appear?
- when did they appear?
- what capabilities do they expose?

### 2. Capability Profiler

For every provider-like object, derive a runtime profile:

- connect methods: `connect`, `request`, `getAccounts`, `account`
- sign methods: `signMessage`, `signTransaction`, `signAndSubmitTransaction`
- identity flags: `isMetaMask`, `isPhantom`, `isPetra`, `isPontem`
- account storage shape: `publicKey`, `accounts`, `defaultAddress`
- event/listener model: `on`, `off`, `onAccountChange`, `onNetworkChange`

This creates a capability fingerprint instead of assuming chain from one hard-coded key.

### 3. Strategy Registry

Map the capability profile to a strategy:

- `evm_proxy`
- `solana_patch`
- `wallet_standard_sui`
- `aptos_adapter`
- `tron_proxy`
- `unknown_safe_mode`

The strategy registry should prefer:

1. full proxy path
2. first-class wallet registration path
3. direct method patch path
4. monitor-only / warn-only fallback

### 4. Safe Fallbacks

When a provider is unknown, do not silently fail.

Fallback options:

- mirror connect/account but block or warn on signing
- mark site as "partially wrapped"
- prompt for fresh tab when injected code changed
- log discovery metadata for future rule promotion

### 5. Site Learning

Persist per-origin runtime fingerprints:

- discovered provider keys
- discovery mechanism used by the dapp
- chain inferred
- methods actually called
- whether the proxy path succeeded
- whether a native wallet popup escaped

This lets `condom@in` "learn" which interception strategy is best for each origin without hand-fixing every time.

## Implementation milestones

### Phase 1: Core capture

- centralize generic `window` key traps
- centralize `Object.defineProperty` interception for wallet globals
- centralize wallet-standard registration helpers
- log provider discovery fingerprints

### Phase 2: Strategy routing

- add capability profiler
- add strategy selection
- route unknown providers into the best matching chain/runtime strategy

### Phase 3: Runtime resilience

- detect stale tabs after extension reload
- show "fresh tab required" UX for injected-code updates
- mark partial-protection states in popup

### Phase 4: Self-learning

- store per-origin/provider fingerprints
- auto-prefer the last successful strategy
- surface recurring unknown-provider fingerprints in QA logs

## Product rules

- Never pretend full protection when only partial interception is active.
- Always prefer a safe fallback over silent bypass.
- Unknown discovery patterns should become visible telemetry, not hidden bugs.
- New chains should plug into the strategy registry, not fork the whole injection model.

## Immediate next step

Refactor `injected.js` around a shared interception kernel:

- `captureWindowKey`
- `captureDefineProperty`
- `registerWalletStandardWallet`
- `profileProviderCapabilities`
- `pickStrategy`

That will reduce future fixes from "patch this dapp manually" to "teach the kernel one more capability pattern."
