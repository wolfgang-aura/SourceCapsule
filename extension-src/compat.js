(function () {
  'use strict';

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
    chrome.runtime.sendMessage(
      {
        type: 'sourcecapsule:http',
        request: {
          method: details.method || 'GET',
          url: details.url,
          headers: details.headers || {},
          bodyText,
          bodyBase64,
          timeout: details.timeout || 30000,
        },
      },
      (result) => {
        if (chrome.runtime.lastError || !result || !result.ok) {
          const message =
            (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
            (result && result.error) ||
            'Extension request failed.';
          if (/timeout/i.test(message)) details.ontimeout && details.ontimeout();
          else details.onerror && details.onerror({ error: message });
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
      }
    );
  };
})();
