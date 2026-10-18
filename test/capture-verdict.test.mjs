/**
 * One completeness verdict (#91).
 *
 * The capsule's `Status:` line is the honest verdict. The unattended `complete` field and
 * the in-page receipt modal used to compute their own, and both said COMPLETE about a
 * capsule that said INCOMPLETE. This drives a real unattended capture-share into a stub
 * share Worker and checks that `complete` matches the uploaded .md, then checks the modal.
 *
 * TEST-verified only: no browser, no network.
 *
 * Run with: node test/capture-verdict.test.mjs   (or npm test)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// Require BEFORE any global.document exists, so the userscript's browser bootstrap
// stays dormant and we drive the exported functions ourselves.
const engine = require(join(here, '..', 'sourcecapsule.user.js'));

const ROOT_ID = '1900000000000000001';
const QUOTED_ID = '1900000000000000000';
const STATUS_URL = `https://x.com/archivist/status/${ROOT_ID}`;
const WORKER = 'https://share.example.workers.dev';

// A text-only post. Its quoted post is long-form, and X never delivered the full text,
// so the capsule can only carry the preview: an honest INCOMPLETE, never a blocker.
const PAGE = `<!doctype html><html><body>
  <div data-testid="primaryColumn">
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><a href="/archivist"><span>The Archivist</span></a><a href="/archivist"><span>@archivist</span></a></div>
      <div data-testid="tweetText" lang="en"><span>Read the long post I am quoting.</span></div>
      <a href="/archivist/status/${ROOT_ID}"><time datetime="2026-08-01T12:00:00Z">Aug 1</time></a>
    </article>
  </div>
</body></html>`;

const dom = new JSDOM(PAGE, { url: STATUS_URL });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.location = dom.window.location;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;

const quoted = {
  __typename: 'Tweet',
  id_str: QUOTED_ID,
  text: 'The first few hundred characters of a long-form post',
  created_at: '2026-07-31T12:00:00.000Z',
  user: { name: 'Writer', screen_name: 'writer' },
  note_tweet: { id: 'note-1' },
};
const syndication = {
  [ROOT_ID]: {
    __typename: 'Tweet',
    id_str: ROOT_ID,
    text: 'Read the long post I am quoting.',
    created_at: '2026-08-01T12:00:00.000Z',
    user: { name: 'The Archivist', screen_name: 'archivist' },
    quoted_tweet: quoted,
  },
  [QUOTED_ID]: quoted,
};

const uploaded = {};
global.GM_xmlhttpRequest = (options) => {
  const url = String(options.url);
  const reply = (status, body) =>
    options.onload({ status, responseText: body, response: body, responseHeaders: '' });
  const syndicationId = url.includes('cdn.syndication.twimg.com')
    ? new URL(url).searchParams.get('id')
    : '';
  if (syndicationId) {
    const payload = syndication[syndicationId];
    return payload ? reply(200, JSON.stringify(payload)) : reply(404, '');
  }
  // Whatever share endpoint is configured, the create call is this path.
  if (options.method === 'POST' && url.endsWith('/api/capsules')) {
    return reply(
      200,
      JSON.stringify({
        id: 'cap1',
        uploadUrl: `${WORKER}/api/upload/cap1`,
        uploadToken: 'test-token',
        finalizeUrl: `${WORKER}/api/finalize/cap1`,
        viewUrl: `${WORKER}/c/cap1`,
        markdownUrl: `${WORKER}/c/cap1.md`,
        expiresAt: '2026-08-08T12:00:00.000Z',
      })
    );
  }
  if (url.startsWith(`${WORKER}/api/upload/cap1/`)) {
    uploaded[decodeURIComponent(url.split('/').pop())] = options.data;
    return reply(200, '{}');
  }
  if (url === `${WORKER}/api/finalize/cap1`) return reply(200, '{}');
  return reply(404, '');
};
global.fetch = (url) => Promise.reject(new Error(`blocked network call to ${url}`));

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${e.stack || e.message}`);
  }
}

console.log('SourceCapsule capture-verdict test\n');

const controller = (action, value) =>
  engine.extensionControllerMessage({
    type: 'sourcecapsule:controller',
    version: 1,
    action,
    value,
  });
controller('set-preference', { key: 'strictExport', value: true });

await check('unattended complete matches the uploaded capsule Status line', async () => {
  const reply = await controller('capture-share', { expiryDays: 7 });
  assert.equal(reply.ok, true, `expected a published capsule, got: ${JSON.stringify(reply)}`);
  const md = String(uploaded['content.md'] || '');
  assert.match(md, /Status: INCOMPLETE/, 'the fixture capsule must itself say INCOMPLETE');
  assert.equal(reply.complete, false, 'complete must not contradict the capsule');
  assert.ok(
    reply.warnings.some((w) => /truncated/i.test(w)),
    `the warnings must say why: ${JSON.stringify(reply.warnings)}`
  );
});

const statusLine = (model) => (engine.renderLlmMarkdown(model).match(/^Status: (\w+)/m) || [])[1];
const receiptVerdict = (model) => {
  engine.showCaptureReceipt({ model, savedLocation: 'x.html', markdown: 'md' });
  const receipt = document.querySelector('.xa-capture-receipt');
  const status = receipt.querySelector('.xa-receipt-status');
  const verdict = status.classList.contains('warning') ? 'INCOMPLETE' : 'COMPLETE';
  receipt.remove();
  return { verdict, text: status.textContent };
};
const base = (blocks) => ({
  type: 'post',
  title: 'Receipt',
  author: { name: 'R', handle: '@r' },
  sourceUrl: 'https://x.com/r/status/5',
  exportedAt: '2026-07-01T00:00:00Z',
  blocks,
});

await check('the receipt modal flags a truncated quote the capsule flags', () => {
  const model = base([
    { kind: 'paragraph', html: 'Main' },
    {
      kind: 'quote',
      author: { name: 'W', handle: '@w' },
      sourceUrl: 'https://x.com/w/status/6',
      truncated: true,
      blocks: [{ kind: 'paragraph', html: 'Preview only' }],
    },
  ]);
  assert.equal(statusLine(model), 'INCOMPLETE');
  const { verdict, text } = receiptVerdict(model);
  assert.equal(verdict, 'INCOMPLETE');
  assert.match(text, /truncated/i);
});

await check('the receipt modal does not flag a poster-only video the capsule accepts', () => {
  const model = base([
    { kind: 'paragraph', html: 'Main' },
    {
      kind: 'video',
      posterUrl: 'https://pbs.twimg.com/ext_tw_video_thumb/7/pu/img/p.jpg',
      posterDataUri: 'data:image/jpeg;base64,AAAA',
      sourceUrl: 'https://x.com/r/status/5',
      mode: 'poster',
    },
  ]);
  assert.equal(statusLine(model), 'COMPLETE');
  assert.equal(receiptVerdict(model).verdict, 'COMPLETE');
});

const truncatedQuote = () =>
  base([
    { kind: 'paragraph', html: 'Main' },
    {
      kind: 'quote',
      author: { name: 'W', handle: '@w' },
      sourceUrl: 'https://x.com/w/status/6',
      truncated: true,
      blocks: [{ kind: 'paragraph', html: 'Preview only' }],
    },
  ]);
const created = (sharedModel) => ({
  viewUrl: `${WORKER}/c/cap2`,
  expiresAt: '2026-08-08T12:00:00.000Z',
  sharedModel,
});

await check('the share result says when the published capsule is incomplete', () => {
  engine.showShareResult(created(truncatedQuote()), { copied: true });
  const modal = document.querySelector('.xa-share-result');
  assert.match(modal.textContent, /incomplete/i);
  assert.match(modal.textContent, /truncated/i);
  modal.remove();
  engine.showShareResult(created(base([{ kind: 'paragraph', html: 'Main' }])), { copied: true });
  const clean = document.querySelector('.xa-share-result');
  assert.doesNotMatch(clean.textContent, /incomplete/i);
  clean.remove();
});

await check('an open receipt takes the shared copy verdict after a share', () => {
  const local = base([{ kind: 'paragraph', html: 'Main' }]);
  engine.showCaptureReceipt({ model: local, savedLocation: 'x.zip', markdown: 'md' });
  engine.showShareResult(created(truncatedQuote()), { copied: true });
  const receipt = document.querySelector('.xa-capture-receipt');
  const status = receipt.querySelector('.xa-receipt-status');
  assert.ok(status.classList.contains('warning'), 'the receipt must stop saying Complete');
  assert.match(status.textContent, /shared/i);
  receipt.remove();
});

console.log('');
if (failures) {
  console.error(`${failures} capture-verdict check(s) failed`);
  process.exit(1);
}
console.log('All capture-verdict checks passed');
