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
assert.equal(pkg.version, '1.4.1');
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
const userscript = fs.readFileSync(path.join(root, 'sourcecapsule.user.js'), 'utf8');
assert.match(userscript, /@version\s+1\.4\.1/);
assert.match(userscript, /const VERSION = '1\.4\.1'/);

console.log('\nAll MV3 extension checks passed.');
