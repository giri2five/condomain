/**
 * condom@in v1.0 — injected.js
 * world: "MAIN" — document_start
 *
 * Per-chain strategy chosen for reliability:
 *  EVM     → Proxy on window.ethereum + EIP-6963 (Proxy wins because MetaMask
 *             uses simple assignment so our getter/setter always fires first)
 *  Solana  → Direct method patching on the provider object itself + Proxy fallback
 *             (Phantom locks window.phantom but methods on the object are writable)
 *  Sui     → Own wallet registered in @mysten/wallet-standard + method patching
 *  Aptos   → Direct method patching (same logic as Solana)
 *  TRON    → Direct method patching
 *
 * EIP-6963: async re-announce breaks the synchronous loop that caused stack overflow
 * wallet_requestPermissions: intercepted in background — prevents real MetaMask popup
 */
(function () {
  'use strict';

  const ORIGIN = location.hostname;
  let _enabled = true;
  let _reqId   = 0;
  const _pending = new Map();
  const _wrapped = new WeakMap(); // provider → proxy

  const _defProp = Object.defineProperty.bind(Object); // native ref before any wallet loads

  // ── Bridge ──────────────────────────────────────────────────────────────

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data?.__cdm_res) return;
    const cb = _pending.get(e.data.id);
    if (!cb) return;
    _pending.delete(e.data.id);
    e.data.error
      ? cb.reject(Object.assign(new Error(e.data.error), { code: 4001 }))
      : cb.resolve(e.data.result);
  });

  function bridge(chain, method, params) {
    return new Promise((resolve, reject) => {
      const id = ++_reqId;
      _pending.set(id, { resolve, reject });
      window.postMessage({ __cdm_req: true, id, chain, method, params, origin: ORIGIN }, '*');
    });
  }

  window.addEventListener('message', (e) => {
    if (e.data?.__cdm_enabled !== undefined) _enabled = e.data.__cdm_enabled;
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  function b58decode(s) {
    const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n = 0n;
    for (const c of s) { const i = A.indexOf(c); if (i < 0) return new Uint8Array(32); n = n * 58n + BigInt(i); }
    const bytes = []; while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
    const out = new Uint8Array(32); const off = 32 - bytes.length;
    bytes.forEach((b, i) => { if (off + i < 32) out[off + i] = b; });
    return out;
  }

  function makePubkey(b58) {
    const bytes = b58decode(b58);
    return {
      _b58: b58, _bytes: bytes,
      toString()  { return this._b58; },
      toBase58()  { return this._b58; },
      toJSON()    { return this._b58; },
      toBytes()   { return this._bytes; },
      toBuffer()  { return typeof Buffer !== 'undefined' ? Buffer.from(this._bytes) : this._bytes; },
      equals(o)   { return o?.toBase58?.() === this._b58 || o?.toString?.() === this._b58; },
    };
  }

  function safePatch(obj, key, value) {
    let patched = false;
    try {
      _defProp(obj, key, { value, writable: true, configurable: true, enumerable: false });
      patched = obj[key] === value;
    } catch (_) {}
    if (!patched) {
      try {
        obj[key] = value;
        patched = obj[key] === value;
      } catch (_) {}
    }
    return patched;
  }

  function getWindowPropDesc(key) {
    try { return Object.getOwnPropertyDescriptor(window, key); } catch (_) { return null; }
  }

  function captureWindowObject(key, getTarget, onTarget, fallbackValue) {
    const existing = window[key];
    try {
      let _v = existing;
      _defProp(window, key, {
        get: () => (fallbackValue ? fallbackValue(_v) : _v),
        set: (v) => {
          _v = v;
          const target = getTarget ? getTarget(v) : v;
          if (target && typeof target === 'object') onTarget(target, v);
        },
        configurable: true,
        enumerable: true,
      });
    } catch (_) {
      const target = getTarget ? getTarget(existing) : existing;
      if (target && typeof target === 'object') onTarget(target, existing);
    }
  }

  function installWindowDefinePropertyInterceptor(flagName, handlers) {
    if (Object[flagName]) return;
    try {
      const nativeDefineProperty = Object.defineProperty;
      nativeDefineProperty(Object, flagName, { value: true, configurable: true });
      Object.defineProperty = function (obj, prop, desc) {
        const key = typeof prop === 'string' ? prop : null;
        if (obj === window && key && handlers[key]) {
          const result = handlers[key](desc, nativeDefineProperty);
          if (result !== undefined) return result;
        }
        return nativeDefineProperty(obj, prop, desc);
      };
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVM — Proxy approach (works reliably, MetaMask uses simple assignment)
  // ═══════════════════════════════════════════════════════════════════════════

  const EVM_INTERCEPT = new Set([
    'eth_requestAccounts', 'eth_accounts', 'eth_coinbase',
    'personal_sign', 'eth_sign',
    'eth_signTypedData', 'eth_signTypedData_v1', 'eth_signTypedData_v3', 'eth_signTypedData_v4',
    'wallet_requestPermissions', 'wallet_getPermissions',
  ]);

  function wrapEVM(provider) {
    if (!provider || provider.__cdm_proxy) return provider;
    if (_wrapped.has(provider)) return _wrapped.get(provider);

    const _req      = provider.request?.bind(provider);
    const _send     = provider.send?.bind(provider);
    const _sendAsync = provider.sendAsync?.bind(provider);

    const proxy = new Proxy(provider, {
      get(t, prop) {
        if (prop === '__cdm_proxy') return 'evm';
        if (prop === 'isMetaMask')  return t.isMetaMask;
        if (prop === 'isConnected') return () => t.isConnected?.();
        if (prop === 'request') {
          return ({ method, params = [] }) =>
            (_enabled && EVM_INTERCEPT.has(method))
              ? bridge('evm', method, params)
              : _req?.({ method, params });
        }
        if (prop === 'send' || prop === 'sendAsync') {
          const _orig = prop === 'send' ? _send : _sendAsync;
          return (payload, cb) => {
            if (_enabled && EVM_INTERCEPT.has(payload?.method)) {
              bridge('evm', payload.method, payload.params || [])
                .then(r  => cb?.(null, { id: payload.id, jsonrpc: '2.0', result: r }))
                .catch(er => cb?.(er, null));
            } else { return _orig?.(payload, cb); }
          };
        }
        const v = t[prop];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });

    _wrapped.set(provider, proxy);
    return proxy;
  }

  // Trap window.ethereum
  (function trapEVM() {
    let _v = window.ethereum ? wrapEVM(window.ethereum) : undefined;
    const desc = getWindowPropDesc('ethereum');
    if (desc && desc.configurable === false) {
      if ('value' in desc && desc.writable && desc.value && !desc.value.__cdm_proxy) {
        try { window.ethereum = wrapEVM(desc.value); } catch (_) {}
      }
      return;
    }
    try {
      _defProp(window, 'ethereum', {
        get: () => _v,
        set: (v) => { _v = (v && !v.__cdm_proxy) ? wrapEVM(v) : v; },
        configurable: true, enumerable: true,
      });
    } catch (_) {
      if (window.ethereum && !window.ethereum.__cdm_proxy) {
        try { window.ethereum = wrapEVM(window.ethereum); } catch (__) {}
      }
    }
  })();

  // EIP-6963 — async to break synchronous event loop (stack overflow fix)
  const _eip6963Cache = new Map();
  let _announcing = false;

  window.addEventListener('eip6963:announceProvider', (e) => {
    if (e.detail?.provider?.__cdm_proxy) return;
    e.stopImmediatePropagation();
    const wrapped = {
      info: { ...e.detail.info, name: `${e.detail.info.name} [condom@in]` },
      provider: wrapEVM(e.detail.provider),
    };
    _eip6963Cache.set(e.detail.info.uuid || Math.random(), wrapped);
    setTimeout(() => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: wrapped })), 0);
  }, true);

  window.addEventListener('eip6963:requestProvider', () => {
    if (_announcing) return;
    _announcing = true;
    setTimeout(() => {
      _eip6963Cache.forEach(d => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: d })));
      _announcing = false;
    }, 0);
  }, true);

  setTimeout(() => window.dispatchEvent(new Event('eip6963:requestProvider')), 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // SOLANA — direct method patching (proven to work in v0.9)
  // Phantom locks window.phantom with configurable:false, but the methods
  // on the provider object itself are writable. We patch those directly.
  // Also set up getter/setter traps as a bonus layer.
  // ═══════════════════════════════════════════════════════════════════════════

  function patchSolanaProvider(provider) {
    if (!provider || provider.__cdm_sol_patched) return false;

    let _pubkey = null, _connected = false;

    const origConnect    = provider.connect?.bind(provider);
    const origDisconnect = provider.disconnect?.bind(provider);
    const origSignMsg    = provider.signMessage?.bind(provider);
    const origSignTx     = provider.signTransaction?.bind(provider);
    const origSignAll    = provider.signAllTransactions?.bind(provider);

    safePatch(provider, 'connect', async (opts) => {
      if (!_enabled) return origConnect?.(opts);
      const res = await bridge('solana', 'connect', opts || {});
      _pubkey = makePubkey(res.publicKey);
      _connected = true;
      // Patch publicKey on the provider object itself so wallet adapters reading
      // provider.publicKey (not connect result) also get the proxy
      try { _defProp(provider, 'publicKey', { get: () => _pubkey, configurable: true }); } catch (_) {}
      try { _defProp(provider, 'isConnected', { get: () => _connected, configurable: true }); } catch (_) {}
      return { publicKey: _pubkey };
    });

    safePatch(provider, 'disconnect', async () => {
      _pubkey = null; _connected = false;
      return origDisconnect?.();
    });

    safePatch(provider, 'signMessage', async (msg, enc) => {
      if (!_enabled) return origSignMsg?.(msg, enc);
      const bytes = Array.from(msg instanceof Uint8Array ? msg : new TextEncoder().encode(String(msg)));
      const res = await bridge('solana', 'signMessage', { message: bytes, encoding: enc || 'utf8' });
      return { signature: new Uint8Array(res.signature), publicKey: _pubkey };
    });

    safePatch(provider, 'signTransaction', async (tx) => {
      if (!_enabled) return origSignTx?.(tx);
      let s = []; try { s = Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })); } catch (_) {}
      return bridge('solana', 'signTransaction', { transaction: s });
    });

    safePatch(provider, 'signAllTransactions', async (txs) => {
      if (!_enabled) return origSignAll?.(txs);
      const s = txs.map(tx => { try { return Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })); } catch (_) { return []; } });
      return bridge('solana', 'signAllTransactions', { transactions: s });
    });

    safePatch(provider, 'signAndSendTransaction', async (tx) => {
      if (!_enabled) return;
      let s = []; try { s = Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })); } catch (_) {}
      return bridge('solana', 'signTransaction', { transaction: s });
    });

    // Mark isPhantom = true so wallet adapters recognise us
    try { _defProp(provider, 'isPhantom', { value: true, configurable: true }); } catch (_) {}

    provider.__cdm_sol_patched = true;
    return true;
  }

  function patchAllSolana() {
    const providers = [
      window.phantom?.solana,
      window.solana,
    ].filter(p => p && typeof p === 'object');

    const seen = new Set();
    providers.forEach(p => {
      if (!seen.has(p)) { seen.add(p); patchSolanaProvider(p); }
    });
  }

  // Try immediately (Phantom may already be loaded)
  patchAllSolana();

  // Also set up getter/setter traps for window.phantom and window.solana
  // so anything assigned later also gets patched
  ['phantom', 'solana'].forEach(key => {
    const existing = window[key];
    try {
      let _v = existing;
      _defProp(window, key, {
        get: () => _v,
        set: (v) => {
          _v = v;
          if (v) {
            // Patch whichever provider is exposed
            const target = key === 'phantom' ? v?.solana : v;
            if (target && typeof target === 'object') patchSolanaProvider(target);
          }
        },
        configurable: true, enumerable: true,
      });
    } catch (_) {
      // Already locked — try to patch the sub-provider directly
      if (existing?.solana) patchSolanaProvider(existing.solana);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUI — register condom@in as its own wallet in @mysten/wallet-standard
  // Aftermath, Cetus etc will list it. User selects it → proxy Sui address.
  // ═══════════════════════════════════════════════════════════════════════════

  const CDM_SUI_ICON = 'data:image/svg+xml;base64,' + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    '<rect width="128" height="128" rx="24" fill="#1A3D5C"/>' +
    '<path d="M44 52 Q44 22 64 22 Q84 22 84 52 L84 88 L44 88 Z" fill="#fff"/>' +
    '<rect x="22" y="84" width="84" height="26" rx="13" fill="#132D42"/>' +
    '<circle cx="50" cy="62" r="12" fill="#fff"/><circle cx="78" cy="62" r="12" fill="#fff"/>' +
    '<circle cx="52" cy="62" r="7" fill="#1A1614"/><circle cx="80" cy="62" r="7" fill="#1A1614"/>' +
    '<circle cx="55" cy="59" r="2" fill="#fff"/><circle cx="83" cy="59" r="2" fill="#fff"/>' +
    '<path d="M46 76 Q64 86 82 76" stroke="#1A1614" stroke-width="3" stroke-linecap="round" fill="none"/>' +
    '</svg>'
  );

  let _cdmSuiAccts = [];
  const _suiListeners = { change: new Set() };
  const SUI_GLOBAL_KEYS = ['phantom', 'sui', 'suiet', 'slush', 'nightly'];
  const SUI_ACCOUNT_FEATURES = [
    'sui:signMessage',
    'sui:signTransaction',
    'sui:signAndExecuteTransaction',
    'sui:signTransactionBlock',
    'sui:signAndExecuteTransactionBlock',
  ];

  function makeSuiAccount(res) {
    const address = res?.address || res?.accounts?.[0]?.address || null;
    if (!address) return null;
    const publicKeyHex = String(res?.publicKey || res?.accounts?.[0]?.publicKey || '').replace(/^0x/i, '');
    return {
      address,
      publicKey: publicKeyHex ? Uint8Array.from(publicKeyHex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []) : new Uint8Array(0),
      chains: ['sui:mainnet', 'sui:testnet', 'sui:devnet'],
      features: SUI_ACCOUNT_FEATURES,
      label: 'condom@in',
    };
  }

  function createSuiProviderAlias(kind) {
    const provider = {};
    patchSuiProvider(provider, kind);
    return provider;
  }

  function createSuiWalletAlias(key) {
    if (key === 'phantom' || key === 'nightly') {
      return { sui: createSuiProviderAlias(key) };
    }
    return createSuiProviderAlias(key);
  }

  function setSuiAccounts(accounts) {
    _cdmSuiAccts = Array.isArray(accounts) ? accounts : [];
    _suiListeners.change.forEach((cb) => { try { cb({ accounts: _cdmSuiAccts }); } catch (_) {} });
    return _cdmSuiAccts;
  }

  function patchSuiProvider(provider, kind = 'sui') {
    if (!provider || provider.__cdm_sui_patched) return false;

    const origConnect = provider.connect?.bind(provider);
    const origDisconnect = provider.disconnect?.bind(provider);
    const origGetAccounts = provider.getAccounts?.bind(provider);
    const origSignMessage = provider.signMessage?.bind(provider);
    const origSignTransaction = provider.signTransaction?.bind(provider);
    const origSignAndExecuteTransaction = provider.signAndExecuteTransaction?.bind(provider);
    const origSignTransactionBlock = provider.signTransactionBlock?.bind(provider);
    const origSignAndExecuteTransactionBlock = provider.signAndExecuteTransactionBlock?.bind(provider);
    const origOn = provider.on?.bind(provider);
    const origOff = provider.off?.bind(provider);

    safePatch(provider, 'connect', async (input) => {
      if (!_enabled) return origConnect?.(input);
      const res = await bridge('sui', 'connect', [input || {}]);
      const acct = makeSuiAccount(res);
      if (acct) setSuiAccounts([acct]);
      return { accounts: _cdmSuiAccts };
    });
    safePatch(provider, 'disconnect', async () => {
      if (!_enabled) return origDisconnect?.();
      try { await bridge('sui', 'disconnect', []); } catch (_) {}
      setSuiAccounts([]);
      return {};
    });
    safePatch(provider, 'getAccounts', async () => {
      if (!_enabled) return origGetAccounts?.();
      const res = await bridge('sui', 'getAccounts', []);
      const acct = makeSuiAccount(res) || _cdmSuiAccts[0] || null;
      if (acct) setSuiAccounts([acct]);
      return _cdmSuiAccts;
    });
    safePatch(provider, 'requestPermissions', async () => {
      const res = await provider.connect({});
      return { accounts: res?.accounts || _cdmSuiAccts };
    });
    safePatch(provider, 'getPermissions', async () => ({ accounts: _cdmSuiAccts }));
    safePatch(provider, 'hasPermissions', async () => _cdmSuiAccts.length > 0);
    safePatch(provider, 'onAccountChange', (cb) => {
      if (typeof cb === 'function') _suiListeners.change.add(({ accounts }) => cb(accounts?.[0] || null));
      return () => _suiListeners.change.delete(cb);
    });
    safePatch(provider, 'offAccountChange', (cb) => {
      _suiListeners.change.delete(cb);
    });
    safePatch(provider, 'signMessage', async (...args) => {
      if (!_enabled) return origSignMessage?.(...args);
      return bridge('sui', 'signMessage', args);
    });
    safePatch(provider, 'signTransaction', async (...args) => {
      if (!_enabled) return origSignTransaction?.(...args);
      return bridge('sui', 'signTransaction', args);
    });
    safePatch(provider, 'signAndExecuteTransaction', async (...args) => {
      if (!_enabled) return origSignAndExecuteTransaction?.(...args);
      return bridge('sui', 'signAndExecuteTransaction', args);
    });
    safePatch(provider, 'signTransactionBlock', async (...args) => {
      if (!_enabled) return origSignTransactionBlock?.(...args);
      return bridge('sui', 'signTransactionBlock', args);
    });
    safePatch(provider, 'signAndExecuteTransactionBlock', async (...args) => {
      if (!_enabled) return origSignAndExecuteTransactionBlock?.(...args);
      return bridge('sui', 'signAndExecuteTransactionBlock', args);
    });
    safePatch(provider, 'on', (event, cb) => {
      if (event === 'change' && typeof cb === 'function') {
        _suiListeners.change.add(cb);
        return () => _suiListeners.change.delete(cb);
      }
      return origOn?.(event, cb);
    });
    safePatch(provider, 'off', (event, cb) => {
      if (event === 'change' && typeof cb === 'function') {
        _suiListeners.change.delete(cb);
        return;
      }
      return origOff?.(event, cb);
    });

    try { _defProp(provider, 'accounts', { get: () => _cdmSuiAccts, configurable: true }); } catch (_) {}
    try { _defProp(provider, 'account', { get: () => _cdmSuiAccts[0] || null, configurable: true }); } catch (_) {}
    try { _defProp(provider, 'connected', { get: () => _cdmSuiAccts.length > 0, configurable: true }); } catch (_) {}
    try { _defProp(provider, 'isConnected', { get: () => _cdmSuiAccts.length > 0, configurable: true }); } catch (_) {}
    try { _defProp(provider, 'name', { value: kind === 'sui' ? 'condom@in' : `${kind} [condom@in]`, configurable: true }); } catch (_) {}
    try { _defProp(provider, 'icon', { value: CDM_SUI_ICON, configurable: true }); } catch (_) {}
    if (kind === 'phantom')  try { _defProp(provider, 'isPhantom', { value: true, configurable: true }); } catch (_) {}
    if (kind === 'suiet')    try { _defProp(provider, 'isSuiet', { value: true, configurable: true }); } catch (_) {}
    if (kind === 'slush')    try { _defProp(provider, 'isSlush', { value: true, configurable: true }); } catch (_) {}
    if (kind === 'nightly')  try { _defProp(provider, 'isNightly', { value: true, configurable: true }); } catch (_) {}
    provider.__cdm_sui_patched = true;
    return true;
  }

  const CDM_SUI_WALLET = {
    name: 'condom@in',
    icon: CDM_SUI_ICON,
    version: '1.0.0',
    chains: ['sui:mainnet', 'sui:testnet', 'sui:devnet'],
    get accounts() { return _cdmSuiAccts; },
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async (input) => {
          const res = await bridge('sui', 'connect', [input || {}]);
          const acct = makeSuiAccount(res);
          if (acct) setSuiAccounts([acct]);
          return { accounts: _cdmSuiAccts };
        },
      },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { setSuiAccounts([]); } },
      'standard:events':     {
        version: '1.0.0',
        on: (event, cb) => {
          if (event === 'change' && typeof cb === 'function') {
            _suiListeners.change.add(cb);
            return () => _suiListeners.change.delete(cb);
          }
          return () => {};
        },
      },
      'sui:signMessage':                   { version: '1.0.0', signMessage:                   async (i) => bridge('sui', 'signMessage', [i]) },
      'sui:signTransaction':               { version: '2.0.0', signTransaction:               async (i) => bridge('sui', 'signTransaction', [i]) },
      'sui:signAndExecuteTransaction':     { version: '2.0.0', signAndExecuteTransaction:     async (i) => bridge('sui', 'signAndExecuteTransaction', [i]) },
      'sui:signTransactionBlock':          { version: '1.0.0', signTransactionBlock:          async (i) => bridge('sui', 'signTransactionBlock', [i]) },
      'sui:signAndExecuteTransactionBlock':{ version: '1.0.0', signAndExecuteTransactionBlock:async (i) => bridge('sui', 'signAndExecuteTransactionBlock', [i]) },
    },
  };

  let _suiRegistered = false;

  function setupSuiRegistry() {
    const SYM = Symbol.for('@mysten/wallet-standard');

    if (!window[SYM]) {
      const _ws = [], _ls = new Set();
      window[SYM] = {
        version: '1.0.0',
        get wallets() { return [..._ws]; },
        register(w) {
          _ws.push(w);
          _ls.forEach(l => { try { l({ wallets: [w] }); } catch (_) {} });
          return () => { const i = _ws.indexOf(w); if (i >= 0) _ws.splice(i, 1); };
        },
        on(ev, cb) { if (ev === 'register') _ls.add(cb); return () => _ls.delete(cb); },
      };
    }

    if (!_suiRegistered && window[SYM]) {
      try { window[SYM].register(CDM_SUI_WALLET); _suiRegistered = true; } catch (_) {}
    }

    const applyRegister = (consumer) => {
      try {
        if (typeof consumer === 'function') return consumer(CDM_SUI_WALLET);
        if (typeof consumer?.register === 'function') return consumer.register(CDM_SUI_WALLET);
      } catch (_) {}
    };

    try { window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: applyRegister })); } catch (_) {}
    try { window.addEventListener('wallet-standard:app-ready', (e) => applyRegister(e.detail), { once: true }); } catch (_) {}
    try { (window.navigator.wallets ||= []).push(applyRegister); } catch (_) {}
  }

  setupSuiRegistry();

  function patchAllSui() {
    const providers = [
      window.phantom?.sui,
      window.sui,
      window.suiet,
      window.slush,
      window.nightly?.sui,
    ].filter((p) => p && typeof p === 'object');
    const seen = new Set();
    providers.forEach((p) => {
      if (!seen.has(p)) { seen.add(p); patchSuiProvider(p); }
    });
  }

  patchAllSui();

  SUI_GLOBAL_KEYS.forEach((key) => {
    captureWindowObject(
      key,
      (v) => (key === 'phantom' || key === 'nightly') ? v?.sui : v,
      (target) => patchSuiProvider(target),
      (v) => v ?? createSuiWalletAlias(key)
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // APTOS — wrapped provider + wallet-standard registration
  // Liquidswap/Pontem-style dapps tend to discover wallets instead of only
  // calling methods on whatever is already on window. We expose a stable
  // condom@in-backed provider for the common Aptos globals so discovery picks
  // the proxy path first instead of the native wallet.
  // ═══════════════════════════════════════════════════════════════════════════

  const APTOS_LABELS = {
    aptos: 'Aptos',
    petra: 'Petra',
    pontem: 'Pontem',
    fewcha: 'Fewcha',
    rise: 'Rise',
    martianAptos: 'Martian',
    martian: 'Martian',
  };
  const APTOS_KEYS = Object.keys(APTOS_LABELS);
  const _aptosBindings = new Map();
  const _aptosAccountListeners = new Set();
  const _aptosNetworkListeners = new Set();
  let _aptosWalletRegistered = false;
  let _cdmAptAccount = null;

  function bytesFromHex(hex) {
    const raw = String(hex || '').replace(/^0x/i, '');
    if (!raw || raw.length % 2 !== 0) return new Uint8Array(0);
    const out = new Uint8Array(raw.length / 2);
    for (let i = 0; i < raw.length; i += 2) out[i / 2] = parseInt(raw.slice(i, i + 2), 16);
    return out;
  }

  function setAptosAccount(res) {
    const address = res?.address || _cdmAptAccount?.address || null;
    if (!address) return null;
    const next = {
      address,
      publicKey: res?.publicKey || _cdmAptAccount?.publicKey || null,
      authKey: res?.authKey || address,
      isConnected: res?.isConnected !== false,
    };
    _cdmAptAccount = next;
    _aptosAccountListeners.forEach((cb) => { try { cb(next); } catch (_) {} });
    return next;
  }

  function clearAptosAccount() {
    _cdmAptAccount = null;
    _aptosAccountListeners.forEach((cb) => { try { cb(null); } catch (_) {} });
  }

  function makeAptosAccount(res) {
    const acct = setAptosAccount(res);
    if (!acct) return null;
    return {
      address: acct.address,
      publicKey: bytesFromHex(acct.publicKey),
      signingScheme: 'Ed25519',
      chains: ['aptos:mainnet', 'aptos:testnet', 'aptos:devnet'],
      features: [],
      label: 'condom@in',
    };
  }

  function makeAptosFacade(key) {
    const label = APTOS_LABELS[key] || 'Aptos';
    const binding = {
      raw: window[key] && typeof window[key] === 'object' ? window[key] : {},
      proxy: null,
    };

    const invokeRaw = (method, args) => {
      const fn = binding.raw?.[method];
      return typeof fn === 'function' ? fn.apply(binding.raw, args) : undefined;
    };

    const api = {
      __cdm_apt_patched: true,
      readyState: 'Installed',
      name: label === 'Aptos' ? 'condom@in' : `${label} [condom@in]`,
      url: 'https://condom.in',
      icon: CDM_SUI_ICON,
      provider: null,
      get connected() { return !!_cdmAptAccount?.address; },
      get isConnected() { return !!_cdmAptAccount?.address; },
      async connect(opts) {
        if (!_enabled) return invokeRaw('connect', [opts]);
        return setAptosAccount(await bridge('aptos', 'connect', [opts || {}]));
      },
      async disconnect() {
        if (!_enabled) return invokeRaw('disconnect', []);
        try { await bridge('aptos', 'disconnect', []); } catch (_) {}
        clearAptosAccount();
        return {};
      },
      async account() {
        if (!_enabled) return invokeRaw('account', []);
        return setAptosAccount(await bridge('aptos', 'account', []));
      },
      async getAccount() {
        return this.account();
      },
      async getNetwork() {
        return invokeRaw('getNetwork', []) || invokeRaw('network', []) || { name: 'mainnet', chainId: '1', url: location.origin };
      },
      async network() {
        return this.getNetwork();
      },
      async signMessage(...args) {
        if (!_enabled) return invokeRaw('signMessage', args);
        return bridge('aptos', 'signMessage', args);
      },
      async signTransaction(...args) {
        if (!_enabled) return invokeRaw('signTransaction', args);
        return bridge('aptos', 'signTransaction', args);
      },
      async signAndSubmitTransaction(...args) {
        if (!_enabled) return invokeRaw('signAndSubmitTransaction', args);
        return bridge('aptos', 'signAndSubmitTransaction', args);
      },
      onAccountChange(cb) {
        if (typeof cb === 'function') _aptosAccountListeners.add(cb);
        return () => _aptosAccountListeners.delete(cb);
      },
      offAccountChange(cb) {
        _aptosAccountListeners.delete(cb);
      },
      onNetworkChange(cb) {
        if (typeof cb === 'function') _aptosNetworkListeners.add(cb);
        return () => _aptosNetworkListeners.delete(cb);
      },
      offNetworkChange(cb) {
        _aptosNetworkListeners.delete(cb);
      },
    };

    if (key === 'petra') api.isPetra = true;
    if (key === 'pontem') api.isPontem = true;
    if (key === 'fewcha') api.isFewcha = true;
    if (key === 'rise') api.isRise = true;
    if (key === 'martianAptos' || key === 'martian') api.isMartian = true;

    binding.proxy = new Proxy(binding.raw, {
      get(target, prop) {
        if (prop === 'provider') return binding.proxy;
        if (prop in api) return api[prop];
        const value = target?.[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
      has(target, prop) {
        return prop in api || prop in target;
      },
      ownKeys(target) {
        return Array.from(new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(api)]));
      },
      getOwnPropertyDescriptor(target, prop) {
        if (prop in api) return { configurable: true, enumerable: true, writable: true, value: api[prop] };
        return Object.getOwnPropertyDescriptor(target, prop);
      },
    });

    api.provider = binding.proxy;
    _aptosBindings.set(key, binding);
    return binding;
  }

  function registerAptosWalletStandard() {
    if (_aptosWalletRegistered) return;
    const wallet = {
      name: 'condom@in',
      version: '1.0.0',
      icon: CDM_SUI_ICON,
      chains: ['aptos:mainnet', 'aptos:testnet', 'aptos:devnet'],
      get accounts() { return _cdmAptAccount ? [makeAptosAccount(_cdmAptAccount)].filter(Boolean) : []; },
      features: {
        'aptos:connect': { version: '1.0.0', connect: async (silent, networkInfo) => setAptosAccount(await bridge('aptos', 'connect', [{ silent, networkInfo }])) },
        'aptos:disconnect': { version: '1.0.0', disconnect: async () => { clearAptosAccount(); return bridge('aptos', 'disconnect', []); } },
        'aptos:getAccount': { version: '1.0.0', account: async () => makeAptosAccount(await bridge('aptos', 'account', [])) },
        'aptos:getNetwork': { version: '1.0.0', network: async () => ({ name: 'mainnet', chainId: '1', url: location.origin }) },
        'aptos:onAccountChange': { version: '1.0.0', onAccountChange: (cb) => { if (typeof cb === 'function') _aptosAccountListeners.add(cb); return () => _aptosAccountListeners.delete(cb); } },
        'aptos:onNetworkChange': { version: '1.0.0', onNetworkChange: (cb) => { if (typeof cb === 'function') _aptosNetworkListeners.add(cb); return () => _aptosNetworkListeners.delete(cb); } },
        'aptos:signMessage': { version: '1.0.0', signMessage: async (input) => bridge('aptos', 'signMessage', [input]) },
        'aptos:signTransaction': { version: '1.0.0', signTransaction: async (input) => bridge('aptos', 'signTransaction', [input]) },
        'aptos:signAndSubmitTransaction': { version: '1.1.0', signAndSubmitTransaction: async (input) => bridge('aptos', 'signAndSubmitTransaction', [input]) },
      },
    };

    const applyRegister = (consumer) => {
      try {
        if (typeof consumer === 'function') return consumer(wallet);
        if (typeof consumer?.register === 'function') return consumer.register(wallet);
      } catch (_) {}
    };

    try { window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: applyRegister })); } catch (_) {}
    try { window.addEventListener('wallet-standard:app-ready', (e) => applyRegister(e.detail), { once: true }); } catch (_) {}
    try { (window.navigator.wallets ||= []).push(applyRegister); } catch (_) {}
    _aptosWalletRegistered = true;
  }

  installWindowDefinePropertyInterceptor('__cdm_adaptive_define_patch', {
    ethereum: (desc, nativeDefineProperty) => {
      const current = getWindowPropDesc('ethereum');
      if (current && current.configurable === false) {
        if (desc && 'value' in desc && desc.value && typeof desc.value === 'object' && !desc.value.__cdm_proxy) {
          try { window.ethereum = wrapEVM(desc.value); } catch (_) {}
        }
        return window;
      }
      if (desc && 'value' in desc && desc.value && typeof desc.value === 'object') {
        const wrapped = desc.value.__cdm_proxy ? desc.value : wrapEVM(desc.value);
        return nativeDefineProperty(window, 'ethereum', {
          get: () => wrapped,
          set: () => {},
          configurable: true,
          enumerable: desc.enumerable !== false,
        });
      }
    },
    ...Object.fromEntries(APTOS_KEYS.map((key) => [key, (desc, nativeDefineProperty) => {
      const binding = _aptosBindings.get(key) || makeAptosFacade(key);
      if (desc && 'value' in desc && desc.value && typeof desc.value === 'object') binding.raw = desc.value;
      return nativeDefineProperty(window, key, {
        get: () => binding.proxy,
        set: (v) => { binding.raw = v && typeof v === 'object' ? v : {}; },
        configurable: true,
        enumerable: desc?.enumerable !== false,
      });
    }])),
    ...Object.fromEntries(SUI_GLOBAL_KEYS.map((key) => [key, (desc, nativeDefineProperty) => {
      const resolve = (v) => (key === 'phantom' || key === 'nightly') ? v?.sui : v;
      let currentValue = (desc && 'value' in desc ? desc.value : undefined) ?? createSuiWalletAlias(key);
      const target = resolve(currentValue);
      if (target && typeof target === 'object') patchSuiProvider(target);
      return nativeDefineProperty(window, key, {
        get: () => currentValue,
        set: (v) => {
          currentValue = v;
          const resolved = resolve(v);
          if (resolved && typeof resolved === 'object') patchSuiProvider(resolved);
        },
        configurable: true,
        enumerable: desc?.enumerable !== false,
      });
    }])),
  });

  APTOS_KEYS.forEach((key) => {
    const binding = makeAptosFacade(key);
    try {
      _defProp(window, key, {
        get: () => binding.proxy,
        set: (v) => { binding.raw = v && typeof v === 'object' ? v : {}; },
        configurable: true,
        enumerable: true,
      });
    } catch (_) {
      try { window[key] = binding.proxy; } catch (_) {}
    }
  });

  registerAptosWalletStandard();

  // ═══════════════════════════════════════════════════════════════════════════
  // TRON — direct method patching
  // ═══════════════════════════════════════════════════════════════════════════

  function patchTronProvider(provider) {
    if (!provider || provider.__cdm_trx_patched) return false;
    let _tronAddr = provider.defaultAddress || null;
    const setDefaultAddress = (res) => {
      const base58 = res?.base58 || res?.address;
      const hex = res?.hex || null;
      if (!base58) return;
      _tronAddr = { base58, hex };
      safePatch(provider, 'defaultAddress', _tronAddr);
    };

    const origRequest = provider.request?.bind(provider);
    const origConnect = provider.connect?.bind(provider);

    safePatch(provider, 'request', async (...args) => {
      const payload = args[0] || {};
      const method = typeof payload === 'string' ? payload : payload.method;
      if (!_enabled || !method) return origRequest?.(...args);
      if (method === 'tron_requestAccounts' || method === 'requestAccounts') {
        const res = await bridge('tron', method, args);
        setDefaultAddress(res);
        return res;
      }
      return origRequest?.(...args);
    });

    safePatch(provider, 'connect', async (...args) => {
      if (!_enabled) return origConnect?.(...args);
      const res = await bridge('tron', 'connect', args);
      setDefaultAddress(res);
      return res;
    });

    ['sign','signMessage','signMessageV2'].forEach(m => {
      const orig = provider[m]?.bind(provider);
      safePatch(provider, m, async (...args) => { if (!_enabled) return orig?.(...args); return bridge('tron', m, args); });
    });
    provider.__cdm_trx_patched = true;
    return true;
  }

  ['tronWeb','tronLink','tronWeb3'].forEach(key => {
    const existing = window[key];
    try {
      let _v = existing;
      _defProp(window, key, {
        get: () => _v,
        set: (v) => { _v = v; if (v) patchTronProvider(v); },
        configurable: true, enumerable: true,
      });
    } catch (_) {
      if (existing) patchTronProvider(existing);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POLLING — catches wallets that load after our initial setup
  // ═══════════════════════════════════════════════════════════════════════════

  let _pt = 0;
  const _pi = setInterval(() => {
    _pt++;
    try {
      // Solana
      patchAllSolana();

      // Aptos
      patchAllAptos();

      // TRON
      ['tronWeb','tronLink','tronWeb3'].forEach(k => { const p = window[k]; if (p) patchTronProvider(p); });

      // EVM — polling not needed (getter/setter handles it), but re-wrap if somehow unwrapped
      if (window.ethereum && !window.ethereum.__cdm_proxy) {
        try { window.ethereum = wrapEVM(window.ethereum); } catch (_) {}
      }

      // Sui registry
      setupSuiRegistry();

    } catch (_) {}

    if (_pt > 60) clearInterval(_pi);
  }, 100);

  // ═══════════════════════════════════════════════════════════════════════════
  // FORCE CONNECT (popup button)
  // ═══════════════════════════════════════════════════════════════════════════

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.__cdm_force !== true) return;
    const results = [];

    // EVM — through our Proxy (updates site state)
    try {
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        try { window.ethereum.emit?.('accountsChanged', accounts); } catch (_) {}
        results.push({ chain: 'evm', address: accounts[0] });
      }
    } catch (_) {}

    // Non-EVM — bridge directly (never touches real wallet, no popup)
    try { const r = await bridge('solana', 'connect', {}); if (r?.publicKey) results.push({ chain: 'solana', address: r.publicKey }); } catch (_) {}
    try { const r = await bridge('sui', 'connect', [{}]); const a = r?.accounts?.[0]?.address || r?.address; if (a) results.push({ chain: 'sui', address: a }); } catch (_) {}
    try { const r = await bridge('aptos', 'connect', [{}]); if (r?.address) results.push({ chain: 'aptos', address: r.address }); } catch (_) {}
    try {
      const r = await bridge('tron', 'connect', []);
      const a = r?.base58 || r?.address;
      if (a) results.push({ chain: 'tron', address: a });
    } catch (_) {}

    window.postMessage({ __cdm_force_result: true, results }, '*');
  });

})();
