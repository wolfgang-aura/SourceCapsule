(function () {
  'use strict';

  const SOURCE = 'SourceCapsule:network-capture';
  const FOLDER_SOURCE = 'SourceCapsule:folder-picker';
  const FOLDER_REQUEST_EVENT = 'sourcecapsule:pick-directory';
  const MAX_BODY_CHARS = 2_000_000;
  const MAX_MESSAGES = 200;
  if (window.__SourceCapsuleExtensionBridgeInstalled) return;
  window.__SourceCapsuleExtensionBridgeInstalled = true;

  let sent = 0;
  const bodyPattern =
    /video_info|variants|video\.twimg\.com|amplify_video|ext_tw_video|tweet_video|note_tweet|quoted_status/i;
  const urlPattern =
    /\/graphql\/|\/i\/api\/|TweetDetail|TweetResult|Article|UserTweets|HomeTimeline/i;
  const shouldRead = (url, contentType) =>
    /json|javascript|text/i.test(contentType || '') || urlPattern.test(url || '');
  const emit = (url, body, transport) => {
    try {
      if (sent >= MAX_MESSAGES || !body) return;
      const text = String(body);
      if (!bodyPattern.test(text)) return;
      sent += 1;
      window.postMessage(
        {
          source: SOURCE,
          contractVersion: 1,
          type: 'response',
          url: String(url || '').slice(0, 4096),
          transport: `extension-main:${transport}`,
          truncated: text.length > MAX_BODY_CHARS,
          body: text.slice(0, MAX_BODY_CHARS),
        },
        window.location.origin
      );
    } catch {
      // Passive capture must never interfere with X.
    }
  };
  const announce = () =>
    window.postMessage(
      {
        source: SOURCE,
        contractVersion: 1,
        type: 'installed',
        transport: 'extension-main',
        folderPickerAvailable: typeof window.showDirectoryPicker === 'function',
      },
      window.location.origin
    );
  window.addEventListener('message', (event) => {
    if (
      event.source === window &&
      (!event.origin || event.origin === window.location.origin) &&
      event.data &&
      event.data.source === SOURCE &&
      event.data.type === 'ping'
    )
      announce();
  });

  let folderPickerPending = false;
  const postFolderResult = (requestId, result) => {
    window.postMessage(
      {
        source: FOLDER_SOURCE,
        contractVersion: 1,
        type: 'result',
        requestId,
        ...result,
      },
      window.location.origin
    );
  };
  window.addEventListener(FOLDER_REQUEST_EVENT, async (event) => {
    const detail = event && event.detail;
    const requestId = detail && String(detail.requestId || '');
    if (
      folderPickerPending ||
      !detail ||
      detail.source !== FOLDER_SOURCE ||
      detail.contractVersion !== 1 ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)
    )
      return;
    if (typeof window.showDirectoryPicker !== 'function') {
      postFolderResult(requestId, {
        ok: false,
        errorName: 'NotSupportedError',
        error: 'This browser does not expose the folder picker on X pages.',
      });
      return;
    }
    folderPickerPending = true;
    try {
      const handle = await window.showDirectoryPicker({
        id: 'sourcecapsule',
        mode: 'readwrite',
      });
      postFolderResult(requestId, { ok: true, handle });
    } catch (error) {
      postFolderResult(requestId, {
        ok: false,
        errorName: String((error && error.name) || 'Error').slice(0, 80),
        error: String((error && error.message) || 'Folder selection failed.').slice(0, 500),
      });
    } finally {
      folderPickerPending = false;
    }
  });

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (...args) {
      const responsePromise = originalFetch.apply(this, args);
      responsePromise
        .then((response) => {
          try {
            const url =
              response.url ||
              (typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '');
            const contentType =
              response.headers && response.headers.get
                ? response.headers.get('content-type') || ''
                : '';
            if (!response.clone || !shouldRead(url, contentType)) return;
            response
              .clone()
              .text()
              .then((body) => emit(url, body, 'fetch'))
              .catch(() => {});
          } catch {
            // Ignore observation failures.
          }
        })
        .catch(() => {});
      return responsePromise;
    };
  }

  const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (proto && proto.open && proto.send) {
    const originalOpen = proto.open;
    const originalSend = proto.send;
    proto.open = function (method, url, ...rest) {
      this.__SourceCapsuleUrl = String(url || '');
      return originalOpen.call(this, method, url, ...rest);
    };
    proto.send = function (...args) {
      this.addEventListener(
        'loadend',
        () => {
          try {
            const url = this.__SourceCapsuleUrl || this.responseURL || '';
            const contentType = this.getResponseHeader
              ? this.getResponseHeader('content-type') || ''
              : '';
            if (!shouldRead(url, contentType)) return;
            const body =
              !this.responseType || this.responseType === 'text'
                ? this.responseText || ''
                : this.responseType === 'json' && this.response
                  ? JSON.stringify(this.response)
                  : '';
            emit(url, body, 'xhr');
          } catch {
            // Ignore observation failures.
          }
        },
        { once: true }
      );
      return originalSend.apply(this, args);
    };
  }

  announce();
})();
