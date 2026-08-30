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

function handleMessage(message, _sender, sendResponse) {
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

function respondToHost(id, payload) {
  if (!nativePort) return;
  try {
    nativePort.postMessage({ ...payload, id });
  } catch (error) {
    console.warn('[SourceCapsule] native reply failed:', error.message);
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
  return { ok: false, error: 'unknown_action', message: `Unsupported action: ${request.action}` };
}

function connectNativeHost() {
  if (nativePort) return;
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (error) {
    console.warn('[SourceCapsule] native host unavailable:', error.message);
    nativePort = null;
    return;
  }
  nativePort.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'sourcecapsule:heartbeat') return;
    if (message.type === 'sourcecapsule:host-status') {
      console.log('[SourceCapsule] native host status', JSON.stringify(message));
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
  connectNativeHost();
}
