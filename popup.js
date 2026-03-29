/**
 * condom@in — popup.js
 * NO inline onclick. All handlers wired via addEventListener.
 * MV3 CSP compliant.
 */

const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;

const ON = {
  badge:'wrapped', bc:'on',
  body:  dark ? '#4A90C8' : '#1A3D5C',
  rim:   dark ? '#2E6090' : '#132D42',
  blend: dark ? '#4A90C8' : '#1A3D5C',
  tip:   dark ? '#62A8D8' : '#2A5078',
  eye: 5.5, mouth: 'M29,58 Q44,68 59,58',
  title: 'your wallet is covered.',
  sub:   'sites get the proxy. you keep everything.',
  tlbl: 'protected',
  halo: dark ? 'rgba(74,144,196,.14)' : 'rgba(26,61,92,.08)',
};
const OFF = {
  badge:'exposed', bc:'off',
  body: '#E8C4A8', rim: '#C8A888', blend: '#E8C4A8', tip: '#F0D4BC',
  eye: 3.8, mouth: 'M29,63 Q44,56 59,63',
  title: 'going in raw.',
  sub:   'wrap it before you connect.',
  tlbl: 'raw',
  halo: 'rgba(227,24,55,.07)',
};
const CM = {
  evm:    { label:'EVM',    id:'cp-evm' },
  solana: { label:'Solana', id:'cp-sol' },
  sui:    { label:'Sui',    id:'cp-sui' },
  aptos:  { label:'Aptos',  id:'cp-apt' },
  tron:   { label:'TRON',   id:'cp-trx' },
};
const CL = { evm:'EVM', solana:'Solana', sui:'Sui', aptos:'Aptos', tron:'TRON' };
const HOST_CHAIN_HINTS = [
  { chain: 'sui', match: /(^|\.)cetus\.zone$|(^|\.)aftermath\.finance$|(^|\.)tradeport\.xyz$|(^|\.)suiswap\.app$/i },
  { chain: 'solana', match: /(^|\.)jup\.ag$|(^|\.)jupiter\.ag$|(^|\.)raydium\.io$|(^|\.)magiceden\.io$/i },
  { chain: 'aptos', match: /(^|\.)liquidswap\.com$|(^|\.)aptoslabs\.com$/i },
  { chain: 'tron', match: /(^|\.)sun\.io$|(^|\.)tronscan\.org$/i },
];

let STATE = null, isOn = true, rawAddr = '', currentChain = 'evm';
const $ = id => document.getElementById(id);
const send = m => chrome.runtime.sendMessage(m);

// ── State ──────────────────────────────────────────────────────────────────

function applyState(on) {
  const s = on ? ON : OFF;
  $('ttrack').classList.toggle('on', on);
  $('badge').textContent = s.badge;
  $('badge').className = 'badge ' + s.bc;
  ['cbody','cblend'].forEach(id => $(id).setAttribute('fill', s.body));
  $('crim').setAttribute('fill', s.rim);
  $('ctip').setAttribute('fill', s.tip);
  $('pupL').setAttribute('r', s.eye);
  $('pupR').setAttribute('r', s.eye);
  $('mth').setAttribute('d', s.mouth);
  $('mglow').style.background = `radial-gradient(circle, ${s.halo} 0%, transparent 70%)`;
  const t = $('htitle'), sb = $('hsub');
  t.style.opacity = 0; sb.style.opacity = 0;
  setTimeout(() => {
    t.textContent = s.title; sb.textContent = s.sub;
    t.style.opacity = 1; sb.style.opacity = 1;
  }, 200);
  $('tlbl').textContent = s.tlbl;
  $('lOn').className  = 'tl' + (on ? ' act' : '');
  $('lOff').className = 'tl' + (on ? '' : ' act');
}

async function doToggle() {
  isOn = !isOn;
  applyState(isOn);
  try { await send({ type: 'SET_ENABLED', enabled: isOn }); } catch(e) {}
}

// ── Load ───────────────────────────────────────────────────────────────────

async function loadState() {
  try { STATE = await send({ type: 'GET_STATS' }); render(); } catch(e) {}
}

function render() {
  if (!STATE) return;
  isOn = STATE.enabled !== false;
  applyState(isOn);

  $('stSites').textContent = STATE.siteCount  ?? '—';
  $('stSigs').textContent  = STATE.totalSigs   ?? '—';
  const te = $('stThreats');
  te.textContent = STATE.totalThreats ?? '—';
  te.className   = 'sv' + ((STATE.totalThreats || 0) > 0 ? ' r' : '');

  Object.entries(CM).forEach(([chain, m]) => {
    const el = $(m.id); if (!el) return;
    const d = (STATE.chainBreakdown || {})[chain];
    const active = d?.count > 0;
    el.textContent = active ? `${m.label} ×${d.count}` : m.label;
    el.classList.toggle('dim', !active);
  });

  loadProxy();
  if ($('sheet')?.classList.contains('show')) {
    renderSites();
    renderLog();
  }
}

async function loadProxy() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const origin = new URL(tab.url).hostname;
    const res = await send({ type: 'GET_SITE_PROXY', origin });
    const hintedChain = HOST_CHAIN_HINTS.find((h) => h.match.test(origin))?.chain || null;

    const candidates = [
      { chain:'solana', data: res?.solana },
      { chain:'evm',    data: res?.evm    },
      { chain:'sui',    data: res?.sui    },
      { chain:'aptos',  data: res?.aptos  },
      { chain:'tron',   data: res?.tron   },
    ].filter(c => c.data?.address);
    const connectedCandidates = candidates.filter(c => c.data?.connected || (c.data?.sigCount || 0) > 0);
    const sortByActivity = (list) => list.slice().sort((a, b) => {
      const recency = (b.data.lastUsedAt || 0) - (a.data.lastUsedAt || 0);
      if (recency !== 0) return recency;
      return (b.data.sigCount||0) - (a.data.sigCount||0);
    });

    const hintedBest = hintedChain
      ? sortByActivity(connectedCandidates.filter(c => c.chain === hintedChain))[0]
      : null;
    const best = hintedBest || sortByActivity(connectedCandidates)[0] || null;

    const el = $('proxyAddr');
    const lbl = $('plbl');
    if (best) {
      const addr = best.data.address;
      currentChain = best.chain;
      rawAddr = addr;
      if (lbl) lbl.textContent = 'this site\'s proxy  ·  ' + best.chain;
      const short = addr.length > 18
        ? `<span class="hi">${addr.slice(0,6)}</span>${addr.slice(6,-6)}<span class="hi">${addr.slice(-6)}</span>`
        : `<span class="hi">${addr}</span>`;
      el.innerHTML = short;
      el.classList.remove('mt');
      // show copy, hide force
      const cb = $('copyBtn'), fb = $('forceBtn');
      if (cb) cb.style.display = '';
      if (fb) fb.style.display = 'none';
    } else {
      currentChain = hintedChain || 'evm';
      rawAddr = '';
      if (lbl) lbl.textContent = hintedChain ? `this site's proxy  ·  ${hintedChain}` : "this site's proxy";
      el.textContent = 'not connected — click connect';
      el.classList.add('mt');
      // show force, hide copy
      const cb = $('copyBtn'), fb = $('forceBtn');
      if (cb) cb.style.display = 'none';
      if (fb) fb.style.display = '';
    }
  } catch(e) {}
}

// ── Actions ────────────────────────────────────────────────────────────────

function copyProxy() {
  if (!rawAddr) return;
  navigator.clipboard.writeText(rawAddr).then(() => {
    const b = $('copyBtn'), p = b.textContent;
    b.textContent = 'copied!';
    setTimeout(() => b.textContent = p, 1600);
  });
}

async function rotateCurrent() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const origin = new URL(tab.url).hostname;
    const btn = $('swapBtn');
    btn.textContent = 'fresh one ✓';
    setTimeout(() => btn.textContent = 'swap condom', 2000);
    await send({ type: 'ROTATE_SITE', origin, chain: currentChain || 'evm' });
    await loadState();
  } catch(e) {}
}

function openSheet()  { renderSites(); renderLog(); $('sheet').classList.add('show'); }
function closeSheet() { $('sheet').classList.remove('show'); }

function renderSites() {
  const c = $('sitesList'); if (!c) return;
  if (!STATE?.proxies?.length) {
    c.innerHTML = '<div class="empty">no sites connected yet.<br>visit any dapp and connect.<br>condom@in intercepts automatically.</div>';
    return;
  }
  c.innerHTML = STATE.proxies.map(p => {
    const chain = CL[p.chain] || p.chain;
    const isSol = p.chain === 'solana';
    const initials = p.origin.replace('www.','').slice(0,2).toUpperCase();
    return `<div class="si" data-origin="${p.origin}" data-chain="${p.chain}">
      <div class="si-icon">${initials}</div>
      <div class="si-body">
        <div class="si-name">${p.origin}</div>
        <div class="si-addr">${p.address ? p.address.slice(0,8)+'…'+p.address.slice(-6) : '—'}</div>
        <div class="si-tags">
          <span class="si-ch${isSol ? ' sol' : ''}">${chain}</span>
          ${(p.threatCount||0) > 0 ? '<span class="si-threat">threat</span>' : ''}
        </div>
      </div>
      <div class="si-right">
        <div class="si-cv">${p.sigCount||0}</div>
        <div class="si-cl">handled</div>
        <button class="si-rot">swap →</button>
      </div>
    </div>`;
  }).join('');
}

function renderLog() {
  const c = $('activityLog'); if (!c) return;
  const items = (STATE?.activityLog || []).slice(0, 6);
  if (!items.length) {
    c.innerHTML = '<div class="empty">no blocks yet.<br>when condom@in catches something sketchy,<br>it shows up here.</div>';
    return;
  }
  c.innerHTML = items.map(item => {
    const tone = item.type === 'danger' ? 'danger' : item.type === 'warn' ? 'warn' : '';
    const when = new Date(item.ts || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `<div class="log ${tone}">
      <div class="log-title">${item.msg}</div>
      <div class="log-meta">${item.origin || 'system'} · ${when}</div>
    </div>`;
  }).join('');
}

async function rotateAll() {
  const btn = $('rotAllBtn');
  btn.textContent = 'all rotated ✓';
  btn.style.background = '#1BA835';
  setTimeout(() => { btn.textContent = 'rotate all proxies'; btn.style.background = ''; }, 2500);
  try { await send({ type: 'ROTATE_ALL' }); await loadState(); } catch(e) {}
}

// ── Wire up ALL handlers here — no inline onclick anywhere ─────────────────

async function forceConnect() {
  const btn = $('forceBtn');
  if (!btn) return;
  btn.textContent = 'connecting...';
  btn.classList.add('loading');

  // Listen for result from injected.js (relayed via background)
  const onResult = (msg) => {
    if (msg.type !== 'FORCE_CONNECT_RESULT') return;
    const count = (msg.results || []).length;
    btn.classList.remove('loading');
    if (count > 0) {
      btn.textContent = 'connected!';
      btn.classList.add('done');
      setTimeout(() => {
        btn.textContent = 'connect';
        btn.classList.remove('done');
        loadState(); // refresh proxy display
      }, 1800);
    } else {
      btn.textContent = 'no wallet found';
      setTimeout(() => { btn.textContent = 'connect'; }, 2500);
    }
    chrome.runtime.onMessage.removeListener(onResult);
  };
  chrome.runtime.onMessage.addListener(onResult);

  // Timeout fallback
  setTimeout(() => {
    chrome.runtime.onMessage.removeListener(onResult);
    if (btn.classList.contains('loading')) {
      btn.classList.remove('loading');
      btn.textContent = 'try again';
      setTimeout(() => btn.textContent = 'connect', 2000);
    }
  }, 6000);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await chrome.tabs.sendMessage(tab.id, { type: 'FORCE_CONNECT' });
  } catch(e) {
    btn.classList.remove('loading');
    btn.textContent = 'reload tab first';
    setTimeout(() => btn.textContent = 'connect', 2500);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('ttrack').addEventListener('click', doToggle);
  $('copyBtn').addEventListener('click', copyProxy);
  $('swapBtn').addEventListener('click', rotateCurrent);
  $('histBtn').addEventListener('click', openSheet);
  $('sheetClose').addEventListener('click', closeSheet);
  $('rotAllBtn').addEventListener('click', rotateAll);
  $('forceBtn').addEventListener('click', forceConnect);

  // Event delegation for dynamically rendered swap buttons in the sheet
  $('sitesList').addEventListener('click', async e => {
    const btn = e.target.closest('.si-rot');
    if (!btn) return;
    const si = btn.closest('.si');
    if (!si) return;
    const { origin, chain } = si.dataset;
    btn.textContent = 'done ✓'; btn.style.background = '#1BA835';
    setTimeout(() => { btn.textContent = 'swap →'; btn.style.background = ''; }, 2000);
    try { await send({ type: 'ROTATE_SITE', origin, chain }); await loadState(); renderSites(); } catch(e) {}
  });

  loadState();
  setInterval(loadState, 5000);
});
