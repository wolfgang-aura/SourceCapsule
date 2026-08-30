'use strict';

const PRODUCTION_HOSTS = new Set([
  'x.com',
  'twitter.com',
  'twimg.com',
  'cdn.syndication.twimg.com',
  'sourcecapsule-share.wolfgang-aura.workers.dev',
]);
const DEVELOPMENT_HOSTS_ENABLED = false;

function allowedUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      DEVELOPMENT_HOSTS_ENABLED &&
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(host)
    )
      return true;
    if (url.protocol !== 'https:') return false;
    return Array.from(PRODUCTION_HOSTS).some(
      (allowed) =>
        host === allowed ||
        (allowed !== 'cdn.syndication.twimg.com' && host.endsWith(`.${allowed}`))
    );
  } catch {
    return false;
  }
}

function base64ToBytes(value) {
  const binary = atob(value || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Reports why the native bridge is or is not connected. The service worker console is
// invisible to everything outside devtools, so this is how the failure becomes readable
// from a page, from the popup, or from an automated check.
function bridgeStatus(sendResponse) {
  const report = {
    ok: true,
    extensionId: chrome.runtime.id,
    hasConnectNative: typeof chrome.runtime.connectNative === 'function',
    permissions: chrome.runtime.getManifest().permissions || [],
    connected: !!nativePort,
    attempt: null,
  };
  if (nativePort) {
    sendResponse(report);
    return;
  }
  let probe;
  try {
    probe = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (error) {
    report.attempt = { stage: 'threw', message: error.message };
    sendResponse(report);
    return;
  }
  // A rejected host does not throw. It disconnects on the next turn with the reason in
  // lastError, so the answer has to wait for that.
  let settled = false;
  const finish = (stage, message) => {
    if (settled) return;
    settled = true;
    report.attempt = { stage, message };
    sendResponse(report);
  };
  probe.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    finish('disconnected', error ? error.message : 'no lastError');
  });
  probe.onMessage.addListener((message) => {
    finish('connected', JSON.stringify(message).slice(0, 200));
    try {
      probe.disconnect();
    } catch {
      /* already gone */
    }
  });
  setTimeout(() => finish('timeout', 'no message and no disconnect within 4s'), 4000);
}

function handleMessage(message, _sender, sendResponse) {
  if (message && message.type === 'sourcecapsule:bridge-status') {
    bridgeStatus(sendResponse);
    return true;
  }
  if (!message || message.type !== 'sourcecapsule:http') return false;
  const request = message.request || {};
  if (!allowedUrl(request.url)) {
    sendResponse({ ok: false, error: 'SourceCapsule blocked a request to an unapproved host.' });
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeout || 30000);
  const body = request.bodyBase64
    ? base64ToBytes(request.bodyBase64)
    : request.bodyText === null
      ? undefined
      : request.bodyText;
  fetch(request.url, {
    method: request.method || 'GET',
    headers: request.headers || {},
    body,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: controller.signal,
  })
    .then(async (response) => {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const headers = Array.from(response.headers.entries())
        .map(([name, value]) => `${name}: ${value}`)
        .join('\r\n');
      sendResponse({
        ok: true,
        status: response.status,
        responseHeaders: headers,
        responseText: new TextDecoder().decode(bytes),
        bodyBase64: bytesToBase64(bytes),
      });
    })
    .catch((error) => sendResponse({ ok: false, error: error.message }))
    .finally(() => clearTimeout(timer));
  return true;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(handleMessage);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { allowedUrl, handleMessage, PRODUCTION_HOSTS };
}

// --- Local automation bridge -----------------------------------------------------
// The CLI cannot talk to Chrome directly; Chrome spawns native hosts. So the service
// worker holds a long-lived port to the host, and the host relays CLI requests over a
// named pipe. Inbound native messages reset the MV3 idle timer, and the host sends a
// heartbeat every 20s, so this port is what keeps the worker resident.
const NATIVE_HOST = 'com.wolfgang_aura.sourcecapsule';
let nativePort = null;

// Development-build diagnostics. A service worker cannot write to disk and its console
// is only visible in devtools, so bridge failures are invisible to the CLI. In a
// development build (which grants http://127.0.0.1/*), each connect attempt is also
// posted to a local listener: scripts/bridge-diagnostics.mjs. No-op in production.
function reportBridgeDiagnostic(stage, detail) {
  if (!DEVELOPMENT_HOSTS_ENABLED) return;
  try {
    fetch('http://127.0.0.1:8799/diagnostic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, detail, at: new Date().toISOString() }),
    }).catch(() => {});
  } catch {
    /* diagnostics must never break the bridge */
  }
}

function respondToHost(id, payload) {
  if (!nativePort) return;
  try {
    nativePort.postMessage({ ...payload, id });
  } catch (error) {
    console.warn('[SourceCapsule] native reply failed:', error.message);
  }
}

// Server-side copy of the CLI's check. The CLI is convenience; this is the boundary that
// actually decides what gets opened, so it must not trust the caller's string.
const CANONICAL_X_URL =
  /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}(?:[/?#].*)?$/;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The content script answers 'get-state' as soon as it is running. Polling for that is
// more reliable than tabs.onUpdated, which fires before the script is listening.
async function waitForContentScript(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const state = await chrome.tabs.sendMessage(tabId, {
        type: 'sourcecapsule:controller',
        version: 1,
        action: 'get-state',
      });
      if (state && state.ok) return state;
      lastError = (state && state.error) || 'content script declined';
    } catch (error) {
      lastError = error.message;
    }
    await sleep(500);
  }
  throw new Error(`Content script never became ready: ${lastError}`);
}

async function captureShare(request) {
  if (!CANONICAL_X_URL.test(String(request.url || ''))) {
    return {
      ok: false,
      error: 'invalid_url',
      message: 'Only a canonical https://x.com/<handle>/status/<id> URL can be captured.',
    };
  }
  const timeoutMs = Math.min(Number(request.timeoutMs) || 300000, 900000);
  // A hidden tab gets rAF paused and timers throttled, which starves the media
  // force-load pass and manufactures strict-mode blockers. An ACTIVE tab in an
  // UNFOCUSED window is not throttled and still never steals focus from the owner.
  const window = await chrome.windows.create({
    url: request.url,
    focused: false,
    state: 'normal',
    width: 1280,
    height: 900,
  });
  const tabId = window.tabs && window.tabs[0] && window.tabs[0].id;
  if (!tabId) {
    return { ok: false, error: 'no_tab', message: 'Could not open a capture tab.' };
  }
  try {
    await waitForContentScript(tabId, Math.min(timeoutMs, 90000));
    const result = await chrome.tabs.sendMessage(tabId, {
      type: 'sourcecapsule:controller',
      version: 1,
      action: 'capture-share',
      value: { expiryDays: Number(request.expiryDays) || 0 },
    });
    return result || { ok: false, error: 'no_result', message: 'The capture returned nothing.' };
  } catch (error) {
    return { ok: false, error: 'capture_failed', message: error.message };
  } finally {
    try {
      await chrome.windows.remove(window.id);
    } catch (error) {
      console.warn('[SourceCapsule] could not close capture window:', error.message);
    }
  }
}

async function handleAutomationRequest(request) {
  if (request.action === 'ping') {
    return {
      ok: true,
      extensionVersion: chrome.runtime.getManifest().version,
      extensionId: chrome.runtime.id,
    };
  }
  if (request.action === 'capture-share') return captureShare(request);
  return { ok: false, error: 'unknown_action', message: `Unsupported action: ${request.action}` };
}

function connectNativeHost() {
  if (nativePort) return;
  reportBridgeDiagnostic('connect-attempt', {
    id: chrome.runtime.id,
    host: NATIVE_HOST,
    hasConnectNative: typeof chrome.runtime.connectNative === 'function',
  });
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (error) {
    console.warn('[SourceCapsule] native host unavailable:', error.message);
    reportBridgeDiagnostic('connect-threw', error.message);
    nativePort = null;
    return;
  }
  nativePort.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'sourcecapsule:heartbeat') return;
    if (message.type === 'sourcecapsule:host-status') {
      console.log('[SourceCapsule] native host status', JSON.stringify(message));
      reportBridgeDiagnostic('host-status', message);
      return;
    }
    if (!message.id || !message.action) return;
    handleAutomationRequest(message)
      .then((result) => respondToHost(message.id, result))
      .catch((error) =>
        respondToHost(message.id, { ok: false, error: 'internal', message: error.message })
      );
  });
  nativePort.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    console.warn('[SourceCapsule] native port closed:', error ? error.message : 'no error');
    reportBridgeDiagnostic('port-closed', error ? error.message : 'no lastError');
    nativePort = null;
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.connectNative) {
  chrome.runtime.onStartup.addListener(connectNativeHost);
  chrome.runtime.onInstalled.addListener(connectNativeHost);
  if (chrome.alarms) {
    chrome.alarms.create('sourcecapsule:native-reconnect', { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'sourcecapsule:native-reconnect') connectNativeHost();
    });
  }
  reportBridgeDiagnostic('worker-start', { id: chrome.runtime.id });
  connectNativeHost();
}
