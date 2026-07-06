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
