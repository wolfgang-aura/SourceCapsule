import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

console.log('SourceCapsule MV3 extension test\n');
console.log('[1/5] Building a clean production extension package...');
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-extension.mjs')], {
  cwd: root,
  stdio: 'inherit',
});

console.log('[2/5] Checking production request policy...');
const background = require(path.join(root, 'extension-src', 'background.js'));
assert.equal(
  background.allowedUrl('https://sourcecapsule-share.wolfgang-aura.workers.dev/api/capsules'),
  true
);
assert.equal(background.allowedUrl('https://pbs.twimg.com/media/example.jpg'), true);
assert.equal(background.allowedUrl('https://cdn.syndication.twimg.com/tweet-result?id=1'), true);
assert.equal(background.allowedUrl('https://evil.example/sourcecapsule'), false);
assert.equal(background.allowedUrl('http://localhost:8787/api/capsules'), false);
assert.equal(background.allowedUrl('http://127.0.0.1:8787/api/capsules'), false);

console.log('[3/5] Checking popup/controller message helpers...');
const popup = require(path.join(root, 'extension-src', 'popup.js'));
const compat = require(path.join(root, 'extension-src', 'compat.js'));
assert.deepEqual(popup.controllerMessage('get-state'), {
  type: 'sourcecapsule:controller',
  version: 1,
  action: 'get-state',
});
assert.equal(popup.isSupportedXUrl('https://x.com/example/status/1'), true);
assert.equal(popup.isSupportedXUrl('https://example.com/'), false);
assert.equal(popup.pageContextLabel('article'), 'Article');
assert.equal(popup.pageContextLabel('post'), 'Post or thread');
assert.equal(popup.pageContextLabel('x'), 'X page');
const popupHtml = fs.readFileSync(path.join(root, 'extension-src', 'popup.html'), 'utf8');
const popupCss = fs.readFileSync(path.join(root, 'extension-src', 'popup.css'), 'utf8');
assert.match(popupHtml, /id="status-card"[^>]*aria-live="polite"/);
assert.match(popupHtml, /role="switch"/);
assert.match(popupHtml, /id="save-feedback"[^>]*aria-live="polite"/);
assert.match(popupCss, /prefers-reduced-motion/);
const directBytes = Uint8Array.from([1, 2, 3, 4]);
const directResult = await compat.directHttpRequest(
  {
    url: 'https://pbs.twimg.com/media/test.jpg',
    responseType: 'arraybuffer',
    timeout: 1000,
  },
  async () => ({
    status: 200,
    headers: new Map([['content-type', 'image/jpeg']]),
    arrayBuffer: async () => directBytes.buffer,
  })
);
assert.equal(directResult.status, 200);
assert.deepEqual(Array.from(new Uint8Array(directResult.response)), [1, 2, 3, 4]);
assert.match(directResult.responseHeaders, /content-type: image\/jpeg/);

// The proxy must send ONE representation of the body. Sending decoded text plus base64
// roughly triples a media response and can pass Chrome's 64 MiB message limit.
const proxyBytes = Uint8Array.from([0, 255, 128, 7]);
const realProxyFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  status: 200,
  headers: new Map([['content-type', 'image/jpeg']]),
  arrayBuffer: async () => proxyBytes.buffer.slice(0),
});
const proxyThroughBackground = (extra) =>
  new Promise((resolve) =>
    background.handleMessage(
      {
        type: 'sourcecapsule:http',
        request: { url: 'https://pbs.twimg.com/media/a.jpg', bodyText: null, ...extra },
      },
      null,
      resolve
    )
  );
const proxiedBinary = await proxyThroughBackground({ responseType: 'arraybuffer' });
assert.equal(proxiedBinary.ok, true);
assert.equal(typeof proxiedBinary.bodyBase64, 'string');
assert.equal(proxiedBinary.responseText, undefined, 'binary replies carry base64 only');
const proxiedText = await proxyThroughBackground({ responseType: 'text' });
assert.equal(typeof proxiedText.responseText, 'string');
assert.equal(proxiedText.bodyBase64, undefined, 'text replies carry text only');
// End to end through compat.js: each caller gets the field it reads.
globalThis.chrome = {
  runtime: { sendMessage: (request, done) => background.handleMessage(request, null, done) },
};
const viaCompat = (responseType) =>
  new Promise((resolve, reject) =>
    globalThis.GM_xmlhttpRequest({
      url: 'https://pbs.twimg.com/media/a.jpg',
      responseType,
      onload: resolve,
      onerror: reject,
    })
  );
const compatBinary = await viaCompat('arraybuffer');
assert.deepEqual(Array.from(new Uint8Array(compatBinary.response)), [0, 255, 128, 7]);
const compatText = await viaCompat('text');
assert.equal(typeof compatText.responseText, 'string');
assert.equal(compatText.response, compatText.responseText);
delete globalThis.chrome;
globalThis.fetch = realProxyFetch;

console.log('[4/5] Checking passive bridge validation, caps, and duplicate suppression...');
const engine = require(path.join(root, 'sourcecapsule.user.js'));
const payload = {
  source: 'SourceCapsule:network-capture',
  contractVersion: 1,
  type: 'response',
  url: 'https://x.com/i/api/graphql/test/TweetDetail',
  transport: 'extension-main:fetch',
  body: JSON.stringify({
    video_info: {
      variants: [
        {
          content_type: 'video/mp4',
          url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/a.mp4',
        },
      ],
    },
  }),
};
assert.equal(engine.validateNetworkCapturePayload(payload), true);
assert.equal(engine.validateNetworkCapturePayload({ ...payload, contractVersion: 2 }), false);
assert.equal(
  engine.validateNetworkCapturePayload({ ...payload, body: 'x'.repeat(6_000_001) }),
  false
);
const sameEnvelopeA = { ...payload, body: '{"wrapper":"AAAA-middle-ZZZZ"}' };
const sameEnvelopeB = { ...payload, body: '{"wrapper":"AAAA-change-ZZZZ"}' };
assert.equal(sameEnvelopeA.body.length, sameEnvelopeB.body.length);
assert.notEqual(
  engine.networkCaptureSignature(sameEnvelopeA),
  engine.networkCaptureSignature(sameEnvelopeB),
  'same-size GraphQL envelopes that differ in the middle are not deduplicated'
);
assert.ok(engine.handleNetworkCapturePayload(payload).length > 0);
assert.equal(engine.handleNetworkCapturePayload(payload).length, 0);

const bridgeDom = new JSDOM('<!doctype html><title>Bridge test</title>', {
  url: 'https://x.com/test/status/1',
  runScripts: 'outside-only',
});
const bridgeHandle = { kind: 'directory', name: 'Bridge Folder' };
bridgeDom.window.showDirectoryPicker = async () => bridgeHandle;
const quoteOnlyBody = JSON.stringify({
  rest_id: '100',
  legacy: { quoted_status_id_str: '200' },
  quoted_status_result: {
    result: {
      rest_id: '200',
      core: {
        user_results: { result: { legacy: { screen_name: 'quoted_user' } } },
      },
    },
  },
});
bridgeDom.window.fetch = async (url) => ({
  url,
  headers: { get: () => 'application/json' },
  clone: () => ({ text: async () => quoteOnlyBody }),
});
bridgeDom.window.eval(fs.readFileSync(path.join(root, 'extension-src', 'page-bridge.js'), 'utf8'));
const quoteCaptureResult = new Promise((resolve) => {
  bridgeDom.window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'response') resolve(event.data);
  });
});
await bridgeDom.window.fetch('https://x.com/i/api/graphql/test/TweetDetail');
const quoteCapture = await quoteCaptureResult;
assert.equal(quoteCapture.body, quoteOnlyBody);
assert.match(quoteCapture.body, /quoted_status_id_str/);
assert.equal(engine.networkCapturePatterns().body.test(quoteOnlyBody), true);
// A page of PLAIN TEXT replies carries no media, note, or quote markers. Before
// `conversation_id_str` joined the filter these bodies were dropped before the reply
// archive ever saw them, which is invisible from the outside — hence this regression.
const plainReplyBody = JSON.stringify({
  rest_id: '300',
  core: { user_results: { result: { legacy: { screen_name: 'plain_replier' } } } },
  legacy: { conversation_id_str: '100', full_text: 'Just words, no media at all.' },
});
assert.equal(engine.networkCapturePatterns().body.test(plainReplyBody), true);
assert.equal(
  /video_info|variants|video\.twimg\.com|amplify_video|ext_tw_video|tweet_video|note_tweet|quoted_status/i.test(
    plainReplyBody
  ),
  false,
  'fixture must not accidentally match the pre-existing filter terms'
);
const bridgeSource = fs.readFileSync(path.join(root, 'extension-src', 'page-bridge.js'), 'utf8');
assert.match(
  bridgeSource,
  /conversation_id_str/,
  'extension bridge body filter must stay aligned with networkCapturePatterns()'
);
assert.equal(
  engine.networkCapturePatterns().url.test('https://x.com/i/api/graphql/test/SearchTimeline'),
  true
);
const searchBridgeDom = new JSDOM('<!doctype html><title>Search bridge test</title>', {
  url: 'https://x.com/search?q=conversation_id%3A100&f=live',
  runScripts: 'outside-only',
});
const plainSearchBody = JSON.stringify({
  rest_id: '101',
  legacy: { conversation_id_str: '100', full_text: 'No media, note, or quote fields' },
});
searchBridgeDom.window.fetch = async (url) => ({
  url,
  headers: { get: () => 'application/json' },
  clone: () => ({ text: async () => plainSearchBody }),
});
searchBridgeDom.window.eval(
  fs.readFileSync(path.join(root, 'extension-src', 'page-bridge.js'), 'utf8')
);
const searchCaptureResult = new Promise((resolve) => {
  searchBridgeDom.window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'response') resolve(event.data);
  });
});
await searchBridgeDom.window.fetch('https://x.com/i/api/graphql/test/SearchTimeline');
const searchCapture = await searchCaptureResult;
assert.equal(searchCapture.body, plainSearchBody);
const detailCaptureResult = new Promise((resolve) => {
  searchBridgeDom.window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'response' && /TweetDetail/.test(event.data.url || ''))
      resolve(event.data);
  });
});
await searchBridgeDom.window.fetch('https://x.com/i/api/graphql/test/TweetDetail');
const detailCapture = await detailCaptureResult;
assert.equal(detailCapture.body, plainSearchBody);
const bridgeResult = new Promise((resolve) => {
  bridgeDom.window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'SourceCapsule:folder-picker') resolve(event.data);
  });
});
bridgeDom.window.dispatchEvent(
  new bridgeDom.window.CustomEvent('sourcecapsule:pick-directory', {
    detail: {
      source: 'SourceCapsule:folder-picker',
      contractVersion: 1,
      requestId: 'folder-test-123',
    },
  })
);
const folderResult = await bridgeResult;
assert.equal(folderResult.ok, true);
assert.equal(folderResult.handle.name, 'Bridge Folder');

console.log('[4b/5] Checking the three network tees stay aligned and never starve the page...');
// The fetch/XHR tee exists three times: the unsafeWindow copy, the stringified copy the
// userscript injects, and extension-src/page-bridge.js. They must agree on patterns and
// on the rate cap, and none may go silent for the life of a long SPA session.
const bridgeBodyFor = (n) =>
  JSON.stringify({
    rest_id: String(n),
    legacy: { conversation_id_str: '100', full_text: `reply ${n}` },
  });
const stubBridgeFetch = (win) => {
  win.fetch = async (url) => ({
    url,
    headers: { get: () => 'application/json' },
    clone: () => ({ text: async () => bridgeBodyFor(String(url).split('n=')[1]) }),
  });
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const fireBridgeResponses = async (win, count, from) => {
  for (let i = 0; i < count; i++) {
    await win.fetch(`https://x.com/i/api/graphql/test/TweetDetail?n=${from + i}`);
  }
  await settle();
};
const newBridgeWindow = (patternSink) => {
  const dom = new JSDOM('<!doctype html><title>Tee</title>', {
    url: 'https://x.com/test/status/1',
    runScripts: 'outside-only',
  });
  if (patternSink) {
    const NativeRegExp = dom.window.RegExp;
    dom.window.RegExp = class extends NativeRegExp {
      constructor(pattern, flags) {
        super(pattern, flags);
        patternSink.push(this);
      }
    };
  }
  stubBridgeFetch(dom.window);
  return dom.window;
};
const realNow = Date.now;
let fakeNow = 5_000_000;
const withFakeClock = async (win, fn) => {
  Date.now = () => fakeNow;
  win.Date.now = () => fakeNow;
  try {
    await fn();
  } finally {
    Date.now = realNow;
  }
};
// Both MAIN-world copies post messages; run the identical scenario against each.
const injectedPatterns = [];
const messageBridges = {
  'page-bridge.js': (win) => win.eval(bridgeSource),
  'networkCaptureBridgeSource()': (win) => win.eval(engine.networkCaptureBridgeSource(6_000_000)),
};
for (const [name, install] of Object.entries(messageBridges)) {
  const win = newBridgeWindow(name.startsWith('network') ? injectedPatterns : null);
  const messages = [];
  win.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'response') messages.push(event.data);
  });
  await withFakeClock(win, async () => {
    install(win);
    await fireBridgeResponses(win, 250, 0);
    assert.equal(messages.length, 100, `${name}: one rate window admits at most 100 responses`);
    fakeNow += 11_000;
    await fireBridgeResponses(win, 1, 1000);
    assert.equal(messages.length, 101, `${name}: the page is not silenced for good`);
    const last = messages[messages.length - 1];
    assert.equal(last.dropped, 150, `${name}: drops are reported to the userscript`);
    assert.equal(last.contractVersion, 1, `${name}: every message carries contractVersion`);
  });
}
// The userscript-side copy hands payloads straight to handleNetworkCapturePayload.
{
  const win = newBridgeWindow(null);
  const diag = engine.networkCaptureDiagnostics;
  const seenBefore = diag.responsesSeen;
  const realLog = console.log;
  console.log = () => {}; // the engine logs once per captured response
  try {
    await withFakeClock(win, async () => {
      assert.equal(engine.installUnsafeWindowNetworkCapture(win), true);
      await fireBridgeResponses(win, 250, 2000);
      assert.equal(diag.responsesSeen - seenBefore, 100, 'unsafeWindow copy honours the same cap');
      fakeNow += 11_000;
      await fireBridgeResponses(win, 1, 3000);
      assert.equal(diag.responsesSeen - seenBefore, 101);
      assert.equal(diag.bridgeDropped, 150, 'drops surface in networkCaptureDiagnostics');
    });
  } finally {
    console.log = realLog;
  }
}
// Pattern drift fails here instead of silently in production.
const literalFrom = (source, name) => {
  const match = source.match(new RegExp(`const ${name} =\\s*(/.+/[a-z]*);`));
  assert.ok(match, `page-bridge.js declares ${name}`);
  return new Function(`return ${match[1]}`)();
};
const expectedPatterns = engine.networkCapturePatterns();
assert.equal(literalFrom(bridgeSource, 'bodyPattern').source, expectedPatterns.body.source);
assert.equal(literalFrom(bridgeSource, 'urlPattern').source, expectedPatterns.url.source);
const injectedSources = injectedPatterns.map((pattern) => pattern.source);
assert.ok(injectedSources.includes(expectedPatterns.body.source), 'injected body pattern drifted');
assert.ok(injectedSources.includes(expectedPatterns.url.source), 'injected url pattern drifted');

console.log('[5/5] Auditing package files, versions, and production hosts...');
const out = path.join(root, 'dist', 'sourcecapsule-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
const expectedFiles = [
  'background.js',
  'compat.js',
  'manifest.json',
  'page-bridge.js',
  'popup.css',
  'popup.html',
  'popup.js',
  'sourcecapsule.user.js',
];
assert.deepEqual(fs.readdirSync(out).sort(), expectedFiles);
assert.equal(manifest.version, pkg.version);
assert.ok(
  manifest.content_scripts.some(
    (entry) => entry.world === 'MAIN' && entry.js.includes('page-bridge.js')
  )
);
assert.equal(manifest.action.default_popup, 'popup.html');
const packagedText = expectedFiles
  .map((name) => fs.readFileSync(path.join(out, name), 'utf8'))
  .join('\n');
assert.doesNotMatch(JSON.stringify(manifest.host_permissions), /localhost|127\.0\.0\.1/);
assert.doesNotMatch(packagedText, /share\.sourcecapsule\.app/);
assert.match(packagedText, /sourcecapsule-share\.wolfgang-aura\.workers\.dev/);
// Version parity, enforced against the userscript header rather than a literal.
// The header is the master version (see SOURCE_OF_TRUTH.md), and there are FIVE places
// that must agree - the header, the in-script VERSION constant, package.json,
// manifest.json, and the newest CHANGELOG heading. A hard-coded expectation here meant
// every release had to hand-edit this test, and a missed copy elsewhere still shipped:
// userscript managers compare @version, so a bump that misses the header reaches nobody.
const userscript = fs.readFileSync(path.join(root, 'sourcecapsule.user.js'), 'utf8');
const headerVersion = (userscript.match(/@version\s+(\d+\.\d+\.\d+)/) || [])[1];
assert.ok(headerVersion, 'userscript header declares a semver @version');
assert.equal(pkg.version, headerVersion, 'package.json matches the userscript header');
assert.match(userscript, new RegExp(`const VERSION = '${headerVersion.replace(/\./g, '\\.')}'`));
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const newestRelease = (changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1];
assert.equal(newestRelease, headerVersion, 'newest CHANGELOG entry matches the shipped version');

console.log('\nAll MV3 extension checks passed.');
