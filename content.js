/**
 * condom@in — content.js (ISOLATED world)
 * Bridge only. injected.js now runs in MAIN world via manifest.
 */

// Page (MAIN world) → background bridge
window.addEventListener('message', async (e) => {
  if (e.source !== window || !e.data?.__cdm_req) return;
  const { id, chain, method, params, origin } = e.data;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'PROXY_REQ', chain, method, params,
      origin: origin || location.hostname,
    });
    if (result?.__error) {
      window.postMessage({ __cdm_res: true, id, error: result.__error }, '*');
    } else {
      window.postMessage({ __cdm_res: true, id, result }, '*');
    }
  } catch (err) {
    window.postMessage({ __cdm_res: true, id, error: err.message }, '*');
  }
});

// Popup → page: relay enabled/disabled toggle
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_CHANGE') {
    window.postMessage({ __cdm_enabled: msg.enabled }, '*');
  }
});

// Relay force connect from popup → page
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'FORCE_CONNECT') {
    window.postMessage({ __cdm_force: true }, '*');
  }
});

// Relay force connect result from page → popup
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data?.__cdm_force_result) return;
  chrome.runtime.sendMessage({ type: 'FORCE_CONNECT_RESULT', results: e.data.results }).catch(() => {});
});
