/**
 * Strict-capture acceptance fixture (jsdom).
 *
 * Gap this closes: `needs_owner` was only ever covered as an output SHAPE in
 * test/native-host.test.mjs, and never against a post that genuinely fails recovery.
 * A live X post cannot supply that reliably - whether a given post's media is
 * unrecoverable today is not reproducible, and hunting for a broken one is not a test.
 *
 * So this drives the real boundary against controlled evidence: a real status page in
 * jsdom, the real engine, and a media/syndication layer where every fetch returns 404.
 * 404 is authoritative in both layers (the bytes are gone from X's CDN, the post is gone
 * from syndication), so no recovery layer can succeed - that is what "unrecoverable"
 * means here, rather than a stub that merely refuses to answer.
 *
 * The path exercised is the whole unattended one:
 *   extensionControllerMessage('capture-share')   <- what the service worker sends
 *     -> runAutomatedShareCapture
 *       -> runExport('share', { automation: true })
 *         -> recovery layers -> assessExportCompleteness -> repairExportBlockers
 *           -> NeedsOwnerError
 *     -> { ok: false, error: 'needs_owner', blockers, counts }
 *   -> formatResult()                              <- what the CLI prints to stdout
 *
 * This is TEST-verified, not live-verified: no browser, no network, no share Worker.
 *
 * Run with: node test/strict-capture.test.mjs   (or npm test)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { formatResult } from '../scripts/sourcecapsule-capture.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// Require BEFORE any global.document exists, so the userscript's browser bootstrap
// stays dormant and we drive the exported functions ourselves.
const engine = require(join(here, '..', 'sourcecapsule.user.js'));

const STATUS_URL = 'https://x.com/archivist/status/1900000000000000000';

// A single post with one image. The image is what becomes unrecoverable.
const PAGE = `<!doctype html><html><body>
  <div data-testid="primaryColumn">
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><a href="/archivist"><span>The Archivist</span></a><a href="/archivist"><span>@archivist</span></a></div>
      <div data-testid="tweetText" lang="en"><span>A post whose image X no longer serves.</span></div>
      <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/GoneForever?format=jpg&name=small" alt=""></div>
      <a href="/archivist/status/1900000000000000000"><time datetime="2026-08-01T12:00:00Z">Aug 1</time></a>
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

// Every media and syndication fetch answers 404. In both layers 404 is treated as
// authoritative rather than transient, so retries stop early and the repair round has
// nothing left to try. Recorded so the test can prove recovery was actually attempted.
const requestedUrls = [];
global.GM_xmlhttpRequest = (options) => {
  requestedUrls.push(options.url);
  options.onload({ status: 404, responseText: '', response: null, responseHeaders: '' });
};

// Nothing may leave the machine. Node has a real global fetch, so it has to be replaced
// or a missed path would hit the network for real.
global.fetch = (url) => {
  requestedUrls.push(String(url));
  return Promise.reject(new Error(`blocked network call to ${url}`));
};

// The share Worker must never be reached: the gate fires before assembly. A call there
// would mean an unattended run published a capsule with a dead end in it.
const shareAttempts = () => requestedUrls.filter((url) => url.includes('workers.dev')).length;

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

console.log('SourceCapsule strict-capture acceptance test\n');

// Strict mode is the default, but the fixture states it rather than assuming it: this
// test is meaningless if the gate is off.
engine.extensionControllerMessage({
  type: 'sourcecapsule:controller',
  version: 1,
  action: 'set-preference',
  value: { key: 'strictExport', value: true },
});

let reply;

await check('unattended capture-share is refused when evidence is unrecoverable', async () => {
  reply = await engine.extensionControllerMessage({
    type: 'sourcecapsule:controller',
    version: 1,
    action: 'capture-share',
    value: { expiryDays: 7 },
  });
  assert.ok(reply, 'the controller returned nothing');
  assert.equal(reply.ok, false, `expected a refusal, got: ${JSON.stringify(reply)}`);
  assert.equal(reply.error, 'needs_owner', `expected needs_owner, got: ${JSON.stringify(reply)}`);
});

await check('the refusal names the blocker instead of a bare failure', () => {
  assert.ok(Array.isArray(reply.blockers), 'blockers should be an array');
  assert.ok(reply.blockers.length > 0, 'a refusal with no blockers explains nothing');
  const kinds = reply.blockers.map((b) => b.kind);
  assert.ok(
    kinds.includes('image-fetch-failed'),
    `expected an image-fetch-failed blocker, got: ${kinds.join(', ')}`
  );
  assert.match(reply.message, /strict/i);
  assert.equal(typeof reply.counts, 'object');
});

await check('recovery was genuinely attempted before the refusal', () => {
  assert.ok(
    requestedUrls.some((url) => url.includes('pbs.twimg.com')),
    'the media layer never tried to fetch the image'
  );
  assert.ok(
    requestedUrls.some((url) => url.includes('cdn.syndication.twimg.com')),
    'the syndication layer never ran'
  );
  // The repair round re-runs the failed media fetch, so the image is requested more
  // than once. A single attempt would mean the gate fired before repair.
  const imageAttempts = requestedUrls.filter((url) => url.includes('GoneForever')).length;
  assert.ok(
    imageAttempts > 1,
    `expected the repair round to retry; saw ${imageAttempts} attempt(s)`
  );
});

await check('no capsule is published when the gate refuses', () => {
  assert.equal(shareAttempts(), 0, 'an unattended refusal must not reach the share Worker');
});

await check('the CLI prints the refusal on its published contract', () => {
  const out = formatResult(reply);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'needs_owner');
  assert.ok(Array.isArray(out.blockers) && out.blockers.length > 0);
  assert.ok(out.message);
  // stdout is a contract: transport fields must not leak through.
  assert.equal(out.id, undefined);
  assert.ok(!('assessment' in out));
  // And it must survive the JSON round trip the CLI actually performs.
  const parsed = JSON.parse(JSON.stringify(out, null, 2));
  assert.equal(parsed.error, 'needs_owner');
});

await check('turning strict mode off is the only thing that changes the verdict', async () => {
  // Proves the refusal comes from the gate rather than from an unrelated crash: with
  // the same unrecoverable evidence and strict mode off, the run gets past the gate.
  // It still fails afterwards, at the share upload - a DIFFERENT, later error.
  engine.extensionControllerMessage({
    type: 'sourcecapsule:controller',
    version: 1,
    action: 'set-preference',
    value: { key: 'strictExport', value: false },
  });
  const lenient = await engine.extensionControllerMessage({
    type: 'sourcecapsule:controller',
    version: 1,
    action: 'capture-share',
    value: { expiryDays: 7 },
  });
  assert.equal(lenient.ok, false, 'the fixture cannot actually publish, so this still fails');
  assert.notEqual(
    lenient.error,
    'needs_owner',
    'with strict mode off the run must get past the gate, not stop at it'
  );
  engine.extensionControllerMessage({
    type: 'sourcecapsule:controller',
    version: 1,
    action: 'set-preference',
    value: { key: 'strictExport', value: true },
  });
});

console.log('');
if (failures) {
  console.error(`${failures} strict-capture check(s) failed`);
  process.exit(1);
}
console.log('All strict-capture checks passed');
