(function () {
  'use strict';

  globalThis.__SOURCECAPSULE_EXTENSION__ = true;

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBuffer(value) {
    const binary = atob(value || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function friendlyExtensionError(message) {
    if (/extension context invalidated/i.test(String(message || ''))) {
      return 'SourceCapsule was reloaded. Refresh this X page and try again.';
    }
    return message || 'Extension request failed.';
  }

  async function directHttpRequest(details, fetchImpl = fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), details.timeout || 30000);
    try {
      const response = await fetchImpl(details.url, {
        method: details.method || 'GET',
        headers: details.headers || {},
        body: details.data == null ? undefined : details.data,
        credentials: 'omit',
        signal: controller.signal,
      });
      const buffer = await response.arrayBuffer();
      const responseHeaders = Array.from(response.headers.entries())
        .map(([name, value]) => `${name}: ${value}`)
        .join('\r\n');
      return {
        status: response.status,
        response:
          details.responseType === 'arraybuffer' ? buffer : new TextDecoder().decode(buffer),
        responseText: new TextDecoder().decode(buffer),
        responseHeaders,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  globalThis.GM_registerMenuCommand = () => null;
  globalThis.GM_unregisterMenuCommand = () => {};
  globalThis.GM_xmlhttpRequest = (details) => {
    const data = details.data;
    let bodyText = null;
    let bodyBase64 = null;
    if (typeof data === 'string') bodyText = data;
    else if (data instanceof ArrayBuffer) bodyBase64 = bytesToBase64(new Uint8Array(data));
    else if (ArrayBuffer.isView(data)) {
      bodyBase64 = bytesToBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    const request = {
      type: 'sourcecapsule:http',
      request: {
        method: details.method || 'GET',
        url: details.url,
        headers: details.headers || {},
        bodyText,
        bodyBase64,
        timeout: details.timeout || 30000,
      },
    };
    const fail = (rawMessage) => {
      const message = friendlyExtensionError(rawMessage);
      if (/timeout/i.test(message)) details.ontimeout && details.ontimeout();
      else details.onerror && details.onerror({ error: message, message });
    };
    const fallback = (rawMessage) => {
      directHttpRequest(details)
        .then((result) => details.onload && details.onload(result))
        .catch((error) =>
          fail(`${friendlyExtensionError(rawMessage)}; direct fallback failed: ${error.message}`)
        );
    };
    try {
      chrome.runtime.sendMessage(request, (result) => {
        if (chrome.runtime.lastError || !result || !result.ok) {
          fallback(
            (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
              (result && result.error)
          );
          return;
        }
        const response =
          details.responseType === 'arraybuffer'
            ? base64ToBuffer(result.bodyBase64)
            : result.responseText;
        details.onload &&
          details.onload({
            status: result.status,
            response,
            responseText: result.responseText,
            responseHeaders: result.responseHeaders,
          });
      });
    } catch (error) {
      fallback(error.message);
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { directHttpRequest, friendlyExtensionError };
  }
})();
