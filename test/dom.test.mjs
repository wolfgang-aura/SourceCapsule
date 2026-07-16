/**
 * DOM extraction test (jsdom).
 *
 * Simulates a real X status page and runs the FULL pipeline
 * (detectPageType -> buildModelForPost -> assembleHtml) to verify the tweet text
 * actually lands in the exported body. This is the layer the smoke test can't
 * reach. The fixture mirrors X's known structure (data-testid hooks, nested
 * <span> text); update it here if X's markup changes.
 *
 * Run with: npm run test:dom   (or npm test, which runs both)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// IMPORTANT: require BEFORE any global.document exists so the userscript's
// browser bootstrap (init()) stays dormant. The exported functions resolve the
// `document`/`Node`/`location` globals at call time, which we set up below.
const engine = require(join(here, '..', 'sourcecapsule.user.js'));

const TWEET_TEXT = '来美股主要做三个股票 mstr，sbet，crcl. 对我们这些炒币的可能就够了.';
const STATUS_URL = 'https://x.com/Vegahao/status/1790000000000000000';

// A representative single-post page. Text is split across nested spans like X does.
// The first article is context above the focused post; live X often renders this
// on reply/status pages, so extraction must match location.pathname's status id.
const PAGE = `<!doctype html><html><body>
  <div data-testid="primaryColumn">
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><a href="/xiaomustock"><span>Context Author</span></a><a href="/xiaomustock"><span>@xiaomustock</span></a></div>
      <div data-testid="tweetText" lang="zh"><span>Wrong context tweet should not export.</span></div>
      <a href="/xiaomustock/status/1111111111111111111"><time datetime="2026-06-25T11:00:00Z">Jun 25</time></a>
    </article>
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><a href="/Vegahao"><span>Vega Hao</span></a><a href="/Vegahao"><span>@Vegahao</span></a></div>
      <div data-testid="Tweet-User-Avatar"><img src="https://pbs.twimg.com/profile_images/1/abc_normal.jpg"></div>
      <div data-testid="tweetText" lang="zh"><span><span>来美股主要做三个股票 </span><span>mstr，sbet，crcl. 对我们这些炒币的可能就够了.</span></span></div>
      <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/Xyz123?format=jpg&name=small" alt=""></div>
      <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/Xyz124?format=jpg&name=small" alt=""></div>
      <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/Xyz125?format=jpg&name=small" alt=""></div>
      <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/Xyz126?format=jpg&name=small" alt=""></div>
      <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/Xyz127?format=jpg&name=small" alt=""></div>
      <div role="link" tabindex="0">
        <div data-testid="User-Name"><a href="/quoted"><span>Quoted Author</span></a><a href="/quoted"><span>@quoted</span></a></div>
        <div data-testid="tweetText" lang="en"><span>Quoted text should export.</span></div>
        <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/QuoteImage?format=jpg&name=small" alt=""></div>
        <div data-testid="videoPlayer"><video poster="https://pbs.twimg.com/media/QuoteVideoPoster?format=jpg&name=small"></video></div>
        <a href="/quoted/status/4444444444444444444"><time datetime="2026-06-25T12:00:30Z">Jun 25</time></a>
      </div>
      <div role="link" tabindex="0">
        <div data-testid="User-Name"><a href="/quoted2"><span>Second Quote</span></a><a href="/quoted2"><span>@quoted2</span></a></div>
        <div data-testid="tweetText" lang="en"><span>Second quoted video should export.</span></div>
        <div data-testid="videoPlayer"><video poster="https://pbs.twimg.com/media/Quote2VideoPoster?format=jpg&name=small"></video></div>
        <a href="/quoted2/status/5555555555555555555"><time datetime="2026-06-25T12:00:40Z">Jun 25</time></a>
      </div>
      <article data-testid="tweet" role="article">
        <div data-testid="User-Name"><a href="/other"><span>Nested Other</span></a><a href="/other"><span>@other</span></a></div>
        <div data-testid="tweetText" lang="en"><span>Nested unrelated text should not export.</span></div>
        <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/NestedBad?format=jpg&name=small" alt=""></div>
        <a href="/other/status/2222222222222222222"><time datetime="2026-06-25T12:01:00Z">Jun 25</time></a>
      </article>
      <a href="/Vegahao/status/1790000000000000000"><time datetime="2026-06-25T12:00:00Z">Jun 25</time></a>
    </article>
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><a href="/Vegahao"><span>Vega Hao</span></a><a href="/Vegahao"><span>@Vegahao</span></a></div>
      <div data-testid="tweetText" lang="en"><span>Thread continuation should export.</span></div>
      <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/Thread1?format=jpg&name=small" alt=""></div>
      <a href="/Vegahao/status/1790000000000000001"><time datetime="2026-06-25T12:02:00Z">Jun 25</time></a>
    </article>
    <div data-testid="cellInnerDiv"><h2 role="heading">Discover more</h2></div>
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><a href="/Vegahao"><span>Vega Hao</span></a><a href="/Vegahao"><span>@Vegahao</span></a></div>
      <div data-testid="tweetText" lang="en"><span>Same-author recommendation must not export.</span></div>
      <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/RecommendedBad?format=jpg&name=small" alt=""></div>
      <a href="/Vegahao/status/1790000000000000002"><time datetime="2026-06-25T12:02:30Z">Jun 25</time></a>
    </article>
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><a href="/other"><span>Reply Author</span></a><a href="/other"><span>@other</span></a></div>
      <div data-testid="tweetText" lang="en"><span>Unrelated reply should not export.</span></div>
      <a href="/other/status/3333333333333333333"><time datetime="2026-06-25T12:03:00Z">Jun 25</time></a>
    </article>
  </div>
</body></html>`;

const dom = new JSDOM(PAGE, { url: STATUS_URL });
// Wire the globals the extraction layer reads.
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.location = dom.window.location;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

console.log('SourceCapsule DOM extraction test\n');

check('detectPageType() recognizes a status page as a post', () => {
  assert.equal(engine.detectPageType(), 'post');
});

check(
  'extension controller reads/writes the existing preference model and rejects malformed input',
  () => {
    const state = engine.extensionControllerMessage({
      type: 'sourcecapsule:controller',
      version: 1,
      action: 'get-state',
    });
    assert.equal(state.ok, true);
    assert.equal(state.prefs.layout, 'date');
    const changed = engine.extensionControllerMessage({
      type: 'sourcecapsule:controller',
      version: 1,
      action: 'set-preference',
      value: { key: 'layout', value: 'flat' },
    });
    assert.equal(changed.ok, true);
    assert.equal(
      engine.extensionControllerMessage({
        type: 'sourcecapsule:controller',
        version: 1,
        action: 'get-state',
      }).prefs.layout,
      'flat'
    );
    assert.equal(engine.extensionControllerMessage({ type: 'wrong' }).ok, false);
  }
);

check('extension folder command renders a direct in-page picker fallback', () => {
  const result = engine.extensionControllerMessage({
    type: 'sourcecapsule:controller',
    version: 1,
    action: 'pick-folder',
  });
  assert.equal(result.ok, true);
  assert.equal(result.requiresPageAction, true);
  const prompt = document.querySelector('.xa-folder-picker-prompt');
  assert.ok(prompt);
  assert.match(prompt.textContent, /requires a click on this page/i);
  prompt.querySelector('.xa-modal-cancel').click();
});

await checkAsync('extension folder bridge returns a validated directory handle', async () => {
  globalThis.__SOURCECAPSULE_EXTENSION__ = true;
  const fakeHandle = { kind: 'directory', name: 'SourceCapsule Test' };
  window.addEventListener(
    'sourcecapsule:pick-directory',
    (event) => {
      window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          source: window,
          origin: location.origin,
          data: {
            source: 'SourceCapsule:folder-picker',
            contractVersion: 1,
            type: 'result',
            requestId: event.detail.requestId,
            ok: true,
            handle: fakeHandle,
          },
        })
      );
    },
    { once: true }
  );
  assert.equal(engine.folderPickerAvailable(), true);
  assert.equal(await engine.pickDirectoryViaExtensionBridge({ timeoutMs: 100 }), fakeHandle);
  delete globalThis.__SOURCECAPSULE_EXTENSION__;
});

check('extension capability handshake selects ZIP fallback when the picker is unavailable', () => {
  globalThis.__SOURCECAPSULE_EXTENSION__ = true;
  engine.handleNetworkCapturePayload({
    source: 'SourceCapsule:network-capture',
    contractVersion: 1,
    type: 'installed',
    transport: 'extension-main',
    folderPickerAvailable: false,
  });
  const state = engine.extensionControllerMessage({
    type: 'sourcecapsule:controller',
    version: 1,
    action: 'get-state',
  });
  assert.equal(state.folderPickerSupported, false);
  assert.equal(state.libraryDelivery, 'zip');
  assert.equal(engine.folderPickerAvailable(), false);
  delete globalThis.__SOURCECAPSULE_EXTENSION__;
});

check('share success remains visible when automatic clipboard copy is blocked', () => {
  const viewUrl = 'http://127.0.0.1:8787/c/1234567890abcdef';
  engine.showShareResult({ viewUrl }, { copied: false });
  const result = document.querySelector('.xa-share-result');
  assert.ok(result, 'share result dialog should be visible');
  assert.equal(result.querySelector('#xa-share-url').value, viewUrl);
  assert.match(result.querySelector('.xa-share-status').textContent, /could not copy/i);
  assert.equal(result.querySelector('.xa-modal-open').href, viewUrl);
  result.querySelector('.xa-modal-cancel').click();
  assert.equal(document.querySelector('.xa-share-result'), null);
});

await checkAsync(
  'recent AI readable links modal keeps expired links greyed out and removable',
  async () => {
    const active = {
      id: 'active',
      title: 'Active capture',
      viewUrl: 'http://127.0.0.1:8787/c/active',
      markdownUrl: 'http://127.0.0.1:8787/c/active.md',
      sourceUrl: STATUS_URL,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    const expired = {
      id: 'expired',
      title: 'Expired capture',
      viewUrl: 'http://127.0.0.1:8787/c/expired',
      sourceUrl: STATUS_URL,
      expiresAt: new Date(Date.now() - 86400000).toISOString(),
    };
    engine.setShareLinks([active, expired]);
    window.confirm = () => true;
    engine.showRecentShareLinks();
    const modal = document.querySelector('.xa-recent-links-modal');
    assert.ok(modal, 'recent links modal should be visible');
    const rows = Array.from(modal.querySelectorAll('.xa-recent-link'));
    assert.equal(rows.length, 2);
    assert.ok(rows[1].classList.contains('expired'), 'expired link should be greyed out');
    assert.match(rows[1].textContent, /Expired:/);
    rows[1].querySelector('.danger').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      engine.getShareLinks().map((item) => item.id),
      ['active']
    );
    modal.querySelector('.xa-modal-cancel').click();
  }
);

check('AI readable link receipt records expiry, URLs, and missing media warnings', () => {
  const receipt = engine.aiLinkReceiptText(
    {
      id: 'abc',
      viewUrl: 'https://sourcecapsule-share.example/c/abc',
      markdownUrl: 'https://sourcecapsule-share.example/c/abc.md',
      createdAt: '2026-07-09T00:00:00.000Z',
      expiresAt: '2026-07-16T00:00:00.000Z',
    },
    {
      title: 'Receipt test',
      sourceUrl: STATUS_URL,
      blocks: [{ kind: 'image', url: 'https://pbs.twimg.com/media/missing.jpg', failed: true }],
    }
  );
  assert.match(receipt, /AI readable link: https:\/\/sourcecapsule-share\.example\/c\/abc/);
  assert.match(receipt, /Markdown link: https:\/\/sourcecapsule-share\.example\/c\/abc\.md/);
  assert.match(receipt, /Missing media: 1/);
  assert.match(receipt, /Re-export from X/);
});

await checkAsync('media byte fetch retries transient userscript request failures', async () => {
  let calls = 0;
  global.GM_xmlhttpRequest = (options) => {
    calls++;
    if (calls === 1) {
      options.onerror({ message: 'temporary network failure' });
      return;
    }
    options.onload({
      status: 200,
      response: new Uint8Array([1, 2, 3, 4]).buffer,
      responseHeaders: 'content-type: image/jpeg\r\n',
    });
  };
  const fetched = await engine.gmFetchBytes('https://pbs.twimg.com/media/retry?format=jpg');
  assert.equal(calls, 2);
  assert.equal(fetched.mime, 'image/jpeg');
  assert.deepEqual(Array.from(fetched.bytes), [1, 2, 3, 4]);
  delete global.GM_xmlhttpRequest;
});

check('recoverable media failures stay visible in the honesty report', () => {
  const reportedModel = {
    title: 'Reported media',
    sourceUrl: STATUS_URL,
    author: { name: 'Media Test', handle: '@media' },
    blocks: [
      {
        kind: 'paragraph',
        html: 'A post with an image.',
      },
      {
        kind: 'image',
        _xaMediaId: 'image-001',
        url: 'https://pbs.twimg.com/media/missing?format=jpg&name=orig',
        sourceUrl: STATUS_URL,
        failed: true,
      },
    ],
  };
  const stats = engine.archiveStats(reportedModel);
  const failures = engine.recoverableMediaFailures(stats);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].type, 'image');
  assert.equal(stats.missingMedia, 1);
  assert.match(stats.warnings.join('\n'), /unavailable at export time/);
});

check('known non-downloadable media is honest but not treated as patchable', () => {
  const hlsModel = {
    title: 'HLS only',
    sourceUrl: STATUS_URL,
    author: { name: 'Media Test', handle: '@media' },
    blocks: [
      { kind: 'paragraph', html: 'A post with HLS-only video.' },
      {
        kind: 'video',
        _xaMediaId: 'video-001',
        hlsUrl: 'https://video.twimg.com/ext_tw_video/hls.m3u8',
        sourceUrl: STATUS_URL,
        unsupported: true,
        videoFailureReason: 'hls_only',
      },
    ],
  };
  const stats = engine.archiveStats(hlsModel);
  assert.equal(stats.incompleteMedia, 1);
  assert.equal(engine.recoverableMediaFailures(stats).length, 0);
});

check('inlineHtmlFromTweetText captures nested-span text', () => {
  const el = dom.window.document.querySelectorAll('div[data-testid="tweetText"]')[1];
  const html = engine.inlineHtmlFromTweetText(el);
  assert.ok(html.includes('来美股主要做三个股票'), `got: ${JSON.stringify(html)}`);
  assert.ok(html.includes('对我们这些炒币的可能就够了'), `got: ${JSON.stringify(html)}`);
});

check('quote detection survives X removing tabindex from the clickable card', () => {
  const host = document.createElement('article');
  host.setAttribute('data-testid', 'tweet');
  host.innerHTML = `
    <div data-testid="tweetText" lang="en">Outer post</div>
    <div role="link">
      <div data-testid="User-Name"><span>Quoted</span><span>@quoted</span></div>
      <div data-testid="tweetText" lang="en">Quote without tabindex</div>
      <a href="/quoted/status/700"><time datetime="2026-07-10T00:00:00Z">Jul 10</time></a>
    </div>
    <a href="/outer/status/701"><time datetime="2026-07-10T00:01:00Z">Jul 10</time></a>`;
  const blocks = engine.buildTweetBlocks(host).blocks;
  const quote = blocks.find((block) => block.kind === 'quote');
  assert.ok(quote);
  assert.equal(quote.sourceUrl, 'https://x.com/quoted/status/700');
  assert.match(quote.blocks[0].html, /without tabindex/);
});

check('articleListType: "unordered" class is bullets, not numbers (no substring trap)', () => {
  const d = dom.window.document;
  const make = (attr, val) => {
    const el = d.createElement('div');
    el.setAttribute(attr, val);
    el.textContent = 'a list item';
    return el;
  };
  // The bug: /ordered/ matched the "ordered" inside "unordered", so bullets became numbers.
  assert.equal(
    engine.articleListType(make('class', 'public-DraftStyleDefault-unorderedListItem')),
    'unordered'
  );
  assert.equal(engine.articleListType(make('aria-label', 'Bulleted list')), 'unordered');
  assert.equal(engine.articleListType(make('data-list-type', 'ordered')), 'ordered');
  assert.equal(engine.articleListType(make('aria-label', 'Numbered list')), 'ordered');
});

check('thread boundary detection preserves a real continuation and stops at Discover more', () => {
  const column = document.querySelector('[data-testid="primaryColumn"]');
  const posts = Array.from(column.querySelectorAll(':scope > article[data-testid="tweet"]'));
  assert.equal(engine.hasThreadBoundaryBefore(posts[2], column), false);
  assert.equal(engine.hasThreadBoundaryBefore(posts[3], column), true);
  assert.equal(engine.statusIdIsAfter('1790000000000000001', '1790000000000000000'), true);
  assert.equal(engine.statusIdIsAfter('1790000000000000000', '1790000000000000001'), false);
});

const model = engine.buildModelForPost();

function allBlocks(blocks) {
  return blocks.flatMap((block) =>
    block.kind === 'quote' ? [block, ...allBlocks(block.blocks || [])] : [block]
  );
}

check('buildModelForPost yields a paragraph block with the tweet text', () => {
  const para = model.blocks.find((b) => b.kind === 'paragraph');
  assert.ok(para, `no paragraph block; blocks=${JSON.stringify(model.blocks.map((b) => b.kind))}`);
  assert.ok(para.html.includes('来美股主要做三个股票'), `paragraph html: ${para.html}`);
  assert.ok(!para.html.includes('Wrong context tweet'), `selected the context tweet: ${para.html}`);
});

check('buildModelForPost captures same-author thread continuations only', () => {
  const paragraphs = allBlocks(model.blocks)
    .filter((b) => b.kind === 'paragraph')
    .map((b) => b.html);
  assert.ok(paragraphs.some((html) => html.includes('Thread continuation should export.')));
  assert.ok(paragraphs.some((html) => html.includes('Quoted text should export.')));
  assert.ok(paragraphs.some((html) => html.includes('Second quoted video should export.')));
  assert.ok(!paragraphs.some((html) => html.includes('Unrelated reply should not export.')));
  assert.ok(!paragraphs.some((html) => html.includes('Nested unrelated text should not export.')));
  assert.ok(
    !paragraphs.some((html) => html.includes('Same-author recommendation must not export.'))
  );
});

check('full-thread mode is explicit for a clicked post and adds post boundaries', () => {
  const focused = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find(
    (tweet) => tweet.textContent.includes('mstr')
  );
  const single = engine.buildModelForPost(focused);
  assert.equal(single.thread, undefined);
  const fullThread = engine.buildModelForPost(focused, { includeThread: true });
  assert.equal(fullThread.thread.capturedPosts, 2);
  assert.deepEqual(fullThread.thread.sourcePostIds, ['1790000000000000000', '1790000000000000001']);
  assert.equal(model.thread.capturedPosts, 2);
  assert.equal(model.blocks.filter((block) => block.kind === 'thread-marker').length, 2);
});

check(
  'focused thread root is labelled as a thread while continuation controls stay post-only',
  () => {
    const column = document.querySelector('[data-testid="primaryColumn"]');
    const posts = Array.from(column.querySelectorAll(':scope > article[data-testid="tweet"]'));
    const focused = posts.find((tweet) => tweet.textContent.includes('mstr'));
    const continuation = posts.find((tweet) =>
      tweet.textContent.includes('Thread continuation should export.')
    );
    const focusedMode = engine.postControlCaptureMode(focused, column);
    assert.equal(focusedMode.isThread, true);
    assert.equal(focusedMode.includeThread, true);
    assert.equal(focusedMode.label, 'Save thread');
    // Manual checklist T02 requires the drop-down's first item to be "Save full
    // thread" on every focused post - assert order, not just presence.
    assert.equal(focusedMode.menuItems[0].key, 'library-thread');
    const continuationMode = engine.postControlCaptureMode(continuation, column);
    assert.equal(continuationMode.isThread, false);
    assert.equal(continuationMode.includeThread, false);
    assert.equal(continuationMode.label, 'Save post');
    assert.ok(!continuationMode.menuItems.some((item) => item.key === 'library-thread'));
  }
);

check(
  'focused post with only one visible tweet still offers Save full thread as an escape hatch',
  () => {
    // Regression: on a real thread page, X's virtualization can render only the focused
    // post at button-render time (follow-ups scroll into view later). Auto-detection
    // then says isThread=false, but the user KNOWS it's a thread. The menu must still
    // expose "Save full thread" so the user can force the correct capture; runExport
    // with includeThread:true scrolls the whole column before building the model.
    const soloDom = new JSDOM(
      `<!doctype html><html><body><div data-testid="primaryColumn">
        <article data-testid="tweet" role="article">
          <div data-testid="User-Name"><a href="/solo"><span>Solo</span></a><a href="/solo"><span>@solo</span></a></div>
          <div data-testid="tweetText"><span>First post; the thread continuation hasn't loaded yet.</span></div>
          <a href="/solo/status/2000000000000000000"><time datetime="2026-07-09T01:00:00Z">1h</time></a>
          <button data-testid="caret" type="button">...</button>
        </article>
      </div></body></html>`,
      { url: 'https://x.com/solo/status/2000000000000000000' }
    );
    const priorWindow = global.window;
    global.window = soloDom.window;
    global.document = soloDom.window.document;
    global.Node = soloDom.window.Node;
    global.location = soloDom.window.location;
    global.localStorage = soloDom.window.localStorage;
    global.getComputedStyle = soloDom.window.getComputedStyle;
    try {
      const column = document.querySelector('[data-testid="primaryColumn"]');
      const focused = column.querySelector('article[data-testid="tweet"]');
      const mode = engine.postControlCaptureMode(focused, column);
      // Auto-detection correctly reports a single post at THIS instant...
      assert.equal(mode.isThread, false);
      assert.equal(mode.label, 'Save post');
      // ...but the menu still exposes the escape hatch, and it must be the
      // first item so T02's "drop-down's first item is Save full thread" holds.
      assert.equal(
        mode.menuItems[0].key,
        'library-thread',
        'focused post must always offer Save full thread as the first menu item'
      );
    } finally {
      // Restore the shared thread fixture for later checks.
      global.window = priorWindow;
      global.document = priorWindow.document;
      global.Node = priorWindow.Node;
      global.location = priorWindow.location;
      global.localStorage = priorWindow.localStorage;
      global.getComputedStyle = priorWindow.getComputedStyle;
    }
  }
);

check('home timeline gets visible per-post save controls without opening a post', () => {
  const homeDom = new JSDOM(
    `<!doctype html><html><body><div data-testid="primaryColumn">
      <article data-testid="tweet" role="article">
        <div data-testid="User-Name"><a href="/roundtable"><span>Roundtable</span></a><a href="/roundtable"><span>@roundtable</span></a></div>
        <div data-testid="tweetText"><span>Timeline post one.</span></div>
        <a href="/roundtable/status/101"><time datetime="2026-07-09T01:00:00Z">1h</time></a>
        <button data-testid="caret" type="button">...</button>
      </article>
      <article data-testid="tweet" role="article">
        <div data-testid="User-Name"><a href="/second"><span>Second</span></a><a href="/second"><span>@second</span></a></div>
        <div data-testid="tweetText"><span>Timeline post two.</span></div>
        <a href="/second/status/102"><time datetime="2026-07-09T02:00:00Z">2h</time></a>
        <button data-testid="caret" type="button">...</button>
      </article>
      <article data-testid="tweet" role="article">
        <div data-testid="User-Name"><a href="/writer"><span>Writer</span></a><a href="/writer"><span>@writer</span></a></div>
        <a href="/writer/status/103"><time datetime="2026-07-09T03:00:00Z">3h</time></a>
        <a href="/i/article/103"><span>Long article preview</span></a>
        <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/ArticleOnly?format=jpg&name=small" alt="Article cover"></div>
        <button data-testid="caret" type="button">...</button>
      </article>
    </div></body></html>`,
    { url: 'https://x.com/home' }
  );
  global.window = homeDom.window;
  global.document = homeDom.window.document;
  global.Node = homeDom.window.Node;
  global.location = homeDom.window.location;
  global.localStorage = homeDom.window.localStorage;
  global.getComputedStyle = homeDom.window.getComputedStyle;
  global.window.confirm = () => false;

  assert.equal(engine.detectPageType(), null);
  engine.ensureButton();
  assert.equal(document.querySelector('#sourcecapsule-btn'), null);
  const controls = Array.from(document.querySelectorAll('.sourcecapsule-post-ctl'));
  assert.equal(controls.length, 3);
  assert.ok(controls.every((control) => control.classList.contains('xa-ctl-inline')));
  assert.deepEqual(
    controls.map((control) => control.querySelector('.xa-ctl-trigger').textContent),
    ['Save post', 'Save post', 'Open post first']
  );
  const menus = Array.from(document.querySelectorAll('.xa-ctl-menu'));
  assert.equal(menus.length, 3);
  const menuLabels = Array.from(menus[0].querySelectorAll('.xa-ctl-item')).map((item) =>
    item.textContent.trim()
  );
  assert.ok(!menuLabels.includes('Save full thread'));
  assert.ok(menuLabels.includes('Save with note / tags'));
  const optionsButton = controls[0].querySelector('.xa-ctl-options');
  assert.equal(optionsButton.getAttribute('aria-haspopup'), 'menu');
  assert.equal(menus[0].getAttribute('role'), 'menu');
  assert.ok(
    Array.from(menus[0].querySelectorAll('.xa-ctl-item')).every(
      (item) => item.getAttribute('role') === 'menuitem'
    )
  );
  optionsButton.click();
  assert.equal(menus[0].hidden, false);
  assert.equal(optionsButton.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, menus[0].querySelector('.xa-ctl-item'));
  assert.match(menus[0].style.left, /px$/);
  assert.match(menus[0].style.top, /px$/);
  menus[0].dispatchEvent(new homeDom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(menus[0].hidden, true);
  assert.equal(optionsButton.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, optionsButton);
  const riskyTweet = document.querySelectorAll('article[data-testid="tweet"]')[2];
  assert.match(engine.timelineArticlePreviewReason(riskyTweet), /Article preview/);
  controls[2].querySelector('.xa-ctl-trigger').click();
  const toast = document.getElementById('sourcecapsule-toast');
  assert.match(toast.textContent, /Open the post first/);
  assert.equal(toast.getAttribute('role'), 'status');
  assert.equal(toast.getAttribute('aria-live'), 'polite');
});

check('buildModelForPost uses the focused post permalink as sourceUrl', () => {
  assert.equal(model.sourceUrl, STATUS_URL);
  assert.equal(model.publishedAt, '2026-06-25T12:00:00.000Z');
});

check('buildModelForPost also captures the image', () => {
  const images = allBlocks(model.blocks).filter((b) => b.kind === 'image');
  const videos = allBlocks(model.blocks).filter((b) => b.kind === 'video');
  const img = images[0];
  assert.ok(img, 'expected an image block');
  assert.ok(img.url.includes('name=orig'), `image not upgraded: ${img.url}`);
  assert.equal(
    images.length,
    7,
    'expected all focused + thread + quote images, with nested bleed excluded'
  );
  assert.equal(videos.length, 2, 'expected all quote video fallbacks to be captured');
  assert.ok(!images.some((image) => image.url.includes('NestedBad')));
  assert.ok(!images.some((image) => image.url.includes('RecommendedBad')));
});

check('assembleHtml puts the tweet text in the <article> body', () => {
  // Inline the would-be data URIs trivially so assembly has something to render.
  model.blocks.filter((b) => b.kind === 'image').forEach((b) => (b.dataUri = 'data:,'));
  if (model.author) model.author.avatarDataUri = 'data:,';
  const html = engine.assembleHtml(model);
  const bodyMatch = html.match(/<article class="xa-body">([\s\S]*?)<\/article>/);
  assert.ok(bodyMatch, 'no body found');
  assert.ok(
    bodyMatch[1].includes('来美股主要做三个股票'),
    'TWEET TEXT MISSING FROM BODY — this is the reported bug'
  );
});

const ARTICLE_STATUS_URL = 'https://x.com/Vegahao/status/2069733529785905289';
const ARTICLE_PAGE = `<!doctype html><html><body>
  <div data-testid="primaryColumn">
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><a href="/Vegahao"><span>Vega Hao</span></a><a href="/Vegahao"><span>@Vegahao</span></a></div>
      <div data-testid="twitterArticleReadView">
        <div data-testid="twitter-article-title"><span>我扒了川沐 1828 条推文：他为什么死盯海力士、MRVL 和 NOK？</span></div>
        <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/ArticleHero?format=jpg&name=small" alt="Article hero"></div>
        <div data-testid="longformRichTextComponent">
          <div data-block="true">
            <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/StandaloneArticleImage?format=jpg&name=small" alt="Standalone article chart"></div>
          </div>
          <div data-block="true" lang="en">
            <div data-testid="User-Name"><a href="/xiaomustock"><span>Trumoo</span></a><a href="/xiaomustock"><span>@xiaomustock</span></a></div>
            <a href="/xiaomustock/status/1944620438728101976"><time datetime="2025-07-14T12:00:00Z">Jul 14, 2025</time></a>
            <span>Inline quote text must stay in a quote.</span>
            <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/OuterQuoteImage?format=jpg&name=small" alt="Outer quote image"></div>
            <a href="/xiaomustock/status/1944620438728101976/photo/2">
              <img src="https://pbs.twimg.com/media/OuterLooseImage?format=jpg&name=small" alt="Outer loose image">
            </a>
            <div role="link" tabindex="0">
              <div data-testid="User-Name"><a href="/nested"><span>Nested Quote</span></a><a href="/nested"><span>@nested</span></a></div>
              <div data-testid="tweetText" lang="en"><span>Nested quote text must stay nested.</span></div>
              <a href="/nested/status/6666666666666666666"><time datetime="2025-07-14T12:01:00Z">Jul 14</time></a>
            </div>
            <span>Show more</span>
            <a href="/xiaomustock/status/1944620438728101976/photo/1"></a>
            <div role="group" aria-label="36 replies, 51 reposts, 235 likes, 717K views">
              <span>36</span><span>51</span><span>235</span><a href="/xiaomustock/status/1944620438728101976/analytics">717K</a>
            </div>
          </div>
          <div data-block="true"><span data-text="true">很多人看川沐，只记住了三个字：</span></div>
          <div data-block="true"><span data-text="true">海力士。</span></div>
          <div data-block="true"><span data-text="true">第一章：Codex 桌面端到底是什么</span></div>
          <div data-block="true"><span data-text="true">一、川沐的主线是怎么迁移的？</span></div>
          <div data-block="true"><span data-text="true">在输入框里写一个具体的需求:</span></div>
          <blockquote data-block="true" style="border-left: 4px solid rgb(239, 243, 244)">
            <span data-text="true">帮我做一个个人介绍页面。要求:
- 顶部有一个大标题
- 下面有一段自我介绍
- 做成一个单独的 HTML 文件</span>
          </blockquote>
          <div data-block="true"><span data-text="true">7.1 Pairing connection</span></div>
          <div data-block="true" data-list="ordered"><strong>Open Codex desktop</strong></div>
          <div data-block="true" data-list="ordered"><span>Find <em>Set up Codex mobile</em></span></div>
          <div data-block="true" data-list="ordered"><a href="https://example.com">Scan the QR code</a></div>
          <div data-block="true"><span>Use <strong>bold</strong> and <em>italic</em> safely.</span></div>
          <div data-block="true"><span data-text="true">———</span></div>
          <div data-block="true"><div role="separator" style="border-top: 1px solid rgb(239, 243, 244);"></div></div>
          <div data-block="true"><span data-text="true">第三章： 调速度、管额度</span></div>
          <div data-block="true"><strong>&#x600e;&#x4e48;&#x9009;</strong></div>
          <div data-block="true"><span data-text="true">## 基础行为</span></div>
          <div data-block="true"><span data-text="true">- Default to Chinese replies
- Keep answers concise
- Confirm irreversible operations first</span></div>
          <div data-block="true"><span data-text="true">model = "gpt-5.5"</span></div>
        </div>
        <div role="link" tabindex="0">
          <div data-testid="User-Name"><a href="/xiaomustock"><span>川沐｜Trumoo</span></a><a href="/xiaomustock"><span>@xiaomustock</span></a></div>
          <div data-testid="tweetText" lang="zh"><span>来美股主要做三个股票 mstr，sbet，crcl.</span></div>
          <a href="/xiaomustock/status/2016007035872280963"><time datetime="2026-01-27T12:00:00Z">Jan 27</time></a>
        </div>
      </div>
      <a href="/Vegahao/status/2069733529785905289"><time datetime="2026-06-25T12:00:00Z">Jun 25</time></a>
    </article>
  </div>
</body></html>`;

const articleDom = new JSDOM(ARTICLE_PAGE, { url: ARTICLE_STATUS_URL });
global.window = articleDom.window;
global.document = articleDom.window.document;
global.Node = articleDom.window.Node;
global.location = articleDom.window.location;

check('detectPageType() treats status pages with an Article reader as articles', () => {
  assert.equal(engine.detectPageType(), 'article');
});

const articleModel = engine.buildModelForArticle();

check('buildModelForArticle captures longform article text as body paragraphs', () => {
  assert.equal(articleModel.type, 'article');
  assert.equal(articleModel.publishedAt, '2026-06-25T12:00:00.000Z');
  assert.ok(articleModel.heading.includes('我扒了川沐 1828 条推文'));
  const paragraphs = articleModel.blocks.filter((b) => b.kind === 'paragraph').map((b) => b.html);
  assert.ok(paragraphs.some((html) => html.includes('很多人看川沐')));
  assert.ok(paragraphs.some((html) => html.includes('海力士')));
  assert.ok(!paragraphs[0].includes('来美股主要做三个股票'), 'embedded tweet became article body');
  assert.ok(
    !paragraphs.some((html) => html.includes('Inline quote text must stay in a quote')),
    'tweet-like article block became article body'
  );
  assert.ok(
    !paragraphs.some((html) => html.includes('Standalone article chart')),
    'media-only article block became text'
  );
});

check('buildModelForArticle preserves rich article headings, lists, and inline formatting', () => {
  const heading = articleModel.blocks.find(
    (b) => b.kind === 'heading' && b.text === '7.1 Pairing connection'
  );
  assert.ok(heading, 'numeric section heading was not preserved');
  assert.equal(heading.level, 3);
  const list = articleModel.blocks.find((b) => b.kind === 'list' && b.ordered);
  assert.ok(list, 'ordered list was not preserved');
  assert.deepEqual(list.items, [
    '<strong>Open Codex desktop</strong>',
    'Find <em>Set up Codex mobile</em>',
    '<a href="https://example.com/">Scan the QR code</a>',
  ]);
  const richParagraph = articleModel.blocks.find(
    (b) => b.kind === 'paragraph' && b.html.includes('<strong>bold</strong>')
  );
  assert.ok(richParagraph, 'inline bold was not preserved');
  assert.ok(richParagraph.html.includes('<em>italic</em>'), 'inline italic was not preserved');
  assert.ok(
    articleModel.blocks.filter((b) => b.kind === 'divider').length >= 2,
    'text and visual dividers were not preserved'
  );
  assert.ok(
    articleModel.blocks.some((b) => b.kind === 'heading' && b.text === '第三章： 调速度、管额度'),
    'Chinese chapter heading was not preserved'
  );
  assert.ok(
    articleModel.blocks.some(
      (b) => b.kind === 'heading' && b.text === '第一章：Codex 桌面端到底是什么'
    ),
    'Chinese first-chapter heading was not preserved'
  );
  assert.ok(
    articleModel.blocks.some(
      (b) => b.kind === 'heading' && b.text === '一、川沐的主线是怎么迁移的？'
    ),
    'Chinese enumerated heading was not preserved'
  );
  assert.ok(
    articleModel.blocks.some(
      (b) => b.kind === 'heading' && b.text === '在输入框里写一个具体的需求:'
    ),
    'short Chinese colon heading was not preserved'
  );
  assert.ok(
    articleModel.blocks.some((b) => b.kind === 'heading' && b.text === '\u600e\u4e48\u9009'),
    'short Chinese question heading was not preserved'
  );
  assert.ok(
    articleModel.blocks.some((b) => b.kind === 'heading' && b.text === '基础行为'),
    'markdown-style heading was not preserved'
  );
  const blockquote = articleModel.blocks.find((b) => b.kind === 'blockquote');
  assert.ok(blockquote, 'blockquote/callout was not preserved');
  assert.ok(
    blockquote.blocks.some(
      (b) => b.kind === 'paragraph' && b.html.includes('帮我做一个个人介绍页面')
    )
  );
  assert.ok(
    blockquote.blocks.some((b) => b.kind === 'list' && b.items.includes('顶部有一个大标题')),
    'blockquote list was not preserved'
  );
  const unordered = articleModel.blocks.find(
    (b) => b.kind === 'list' && !b.ordered && b.items.includes('Keep answers concise')
  );
  assert.ok(unordered, 'dash list was not preserved');
  assert.ok(
    articleModel.blocks.some((b) => b.kind === 'code' && b.text === 'model = "gpt-5.5"'),
    'config-like code line was not preserved'
  );
});

check('buildModelForArticle captures article media and embedded quote separately', () => {
  const images = articleModel.blocks.filter((b) => b.kind === 'image');
  const quotes = articleModel.blocks.filter((b) => b.kind === 'quote');
  assert.equal(images.length, 2);
  assert.ok(images.some((image) => image.url.includes('StandaloneArticleImage')));
  assert.equal(quotes.length, 2);
  assert.ok(
    quotes.some((quote) =>
      quote.blocks.some((b) => b.kind === 'paragraph' && b.html.includes('mstr'))
    )
  );
  const inlineQuote = quotes.find((quote) =>
    quote.blocks.some((b) => b.kind === 'paragraph' && b.html.includes('Inline quote text'))
  );
  assert.ok(inlineQuote, 'tweet-like article block was not exported as a quote');
  const inlineQuoteText = inlineQuote.blocks
    .filter((b) => b.kind === 'paragraph')
    .map((b) => b.html)
    .join(' ');
  assert.ok(!inlineQuoteText.includes('Show more'));
  assert.ok(!inlineQuoteText.includes('717K'));
  assert.ok(!inlineQuoteText.includes('Jul 14'));
  assert.ok(
    inlineQuote.blocks.some((b) => b.kind === 'image' && b.url.includes('OuterQuoteImage'))
  );
  assert.ok(
    inlineQuote.blocks.some((b) => b.kind === 'image' && b.url.includes('OuterLooseImage'))
  );
  const nestedQuote = inlineQuote.blocks.find((b) => b.kind === 'quote');
  assert.ok(nestedQuote, 'nested quote inside the outer quote was lost');
  assert.ok(
    nestedQuote.blocks.some(
      (b) => b.kind === 'paragraph' && b.html.includes('Nested quote text must stay nested')
    )
  );
});

// Regression: the article author must be the post author (from the canonical page
// URL), NOT an embedded/quoted tweet's author. X renders the author header outside
// the read-view body, so the first in-body User-Name belongs to a quote (@xiaomustock
// here) - taking that one misattributed the whole archive. The URL handle (@Vegahao)
// is authoritative.
check('buildModelForArticle attributes the article to the post author, not a quote', () => {
  // Handle comes from the canonical URL, so it is exact and authoritative.
  assert.equal(articleModel.author.handle, '@Vegahao');
  assert.notEqual(articleModel.author.handle, '@xiaomustock');
  // Display name comes from the matching DOM block (jsdom lacks innerText newlines,
  // so assert containment, not equality). It must be the author, not the quote.
  assert.ok(articleModel.author.name.includes('Vega Hao'), 'author display name lost');
  assert.ok(!articleModel.author.name.includes('Trumoo'), 'pulled a quote author as the name');
});

check('article-body image harvest survives virtualization without leaking quote media', () => {
  engine.resetMediaState();
  engine.harvestMediaNow();
  articleDom.window.document.querySelector('img[src*="StandaloneArticleImage"]').remove();
  const rebuilt = engine.buildModelForArticle();
  const bodyImages = rebuilt.blocks.filter((block) => block.kind === 'image');
  assert.ok(
    bodyImages.some((image) => image.url.includes('StandaloneArticleImage')),
    'harvested Article image was lost after X removed its DOM node'
  );
  assert.ok(
    !bodyImages.some((image) => image.url.includes('OuterQuoteImage')),
    'quoted-post media leaked into the Article body harvest'
  );
});

// ---------------------------------------------------------------------------
// Media harvest survives virtualization (the v0.2.5 fix). X recycles off-screen
// media out of the DOM, so we snapshot it during the scroll. Simulate that here:
// harvest while the image is present, remove the node, then assert extraction
// still places the image in the model.
// ---------------------------------------------------------------------------
const HARVEST_URL = 'https://x.com/lazyuser/status/3070000000000000000';
const HARVEST_PAGE = `<!doctype html><html><body>
  <div data-testid="primaryColumn">
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><a href="/lazyuser"><span>Lazy User</span></a><a href="/lazyuser"><span>@lazyuser</span></a></div>
      <div data-testid="tweetText" lang="en"><span>A tweet whose image lazy-loads.</span></div>
      <div data-testid="tweetPhoto"><img id="lazyimg" src="https://pbs.twimg.com/media/LazyChart?format=jpg&name=small" alt="chart"></div>
      <img id="looseimg" src="https://pbs.twimg.com/media/LooseInfographic?format=jpg&name=small" alt="article infographic">
      <a href="/lazyuser/status/3070000000000000000"><time datetime="2026-06-26T00:00:00Z">Jun 26</time></a>
    </article>
  </div>
</body></html>`;

const hdom = new JSDOM(HARVEST_PAGE, { url: HARVEST_URL });
global.window = hdom.window;
global.document = hdom.window.document;
global.Node = hdom.window.Node;
global.location = hdom.window.location;

const flatImages = (m) =>
  m.blocks
    .flatMap((b) => (b.kind === 'quote' ? [b, ...b.blocks] : [b]))
    .filter((b) => b.kind === 'image');

check('harvested media survives virtualization (node removed after harvest)', () => {
  engine.resetMediaState();
  engine.harvestMediaNow(); // snapshot images while present
  hdom.window.document.getElementById('lazyimg').remove(); // X virtualizes them away
  hdom.window.document.getElementById('looseimg').remove();
  const m = engine.buildModelForPost();
  const urls = flatImages(m).map((b) => b.url);
  assert.ok(
    urls.some((u) => u.includes('LazyChart')),
    'harvested tweetPhoto image was lost after its DOM node was removed'
  );
  // A media image NOT inside a tweetPhoto is an article/body image, not the
  // tweet's own media — it must NOT be attributed to (stuffed into) the tweet.
  assert.ok(
    !urls.some((u) => u.includes('LooseInfographic')),
    'a non-tweetPhoto image was wrongly attributed to the tweet'
  );
});

check('control: without harvest, a removed image is genuinely absent', () => {
  engine.resetMediaState(); // clear the harvest
  const m = engine.buildModelForPost();
  assert.ok(
    !flatImages(m).some((b) => b.url.includes('LazyChart')),
    'image present without harvest — the previous test would be meaningless'
  );
});

// ---------------------------------------------------------------------------
// dedupeQuoteCards: X renders the same embedded tweet in multiple DOM spots, so
// the same quote is detected twice with its images split across the copies, and
// some quote images also leak into the article body. The model-level cleanup
// merges duplicate quote cards (by status id) and drops body images that are
// already shown inside a quote.
// ---------------------------------------------------------------------------
check('dedupeQuoteCards merges split quote cards and removes body dupes', () => {
  const blocks = [
    {
      kind: 'quote',
      sourceUrl: 'https://x.com/a/status/1',
      blocks: [{ kind: 'image', url: 'IMG_A' }],
    },
    { kind: 'paragraph', html: 'between' },
    {
      kind: 'quote',
      sourceUrl: 'https://x.com/a/status/1',
      blocks: [{ kind: 'image', url: 'IMG_B' }],
    },
    { kind: 'image', url: 'IMG_A' }, // body image that duplicates a quote image
    { kind: 'image', url: 'IMG_C' }, // genuine article-body image
  ];
  const out = engine.dedupeQuoteCards(blocks);
  const quotes = out.filter((b) => b.kind === 'quote');
  assert.equal(quotes.length, 1, 'duplicate quote cards should collapse to one');
  const qImgs = quotes[0].blocks
    .filter((b) => b.kind === 'image')
    .map((b) => b.url)
    .sort();
  assert.deepEqual(qImgs, ['IMG_A', 'IMG_B'], 'merged card keeps images from both copies');
  const bodyImgs = out.filter((b) => b.kind === 'image').map((b) => b.url);
  assert.deepEqual(bodyImgs, ['IMG_C'], 'body dup removed, genuine body image kept');
});

check('dedupeQuoteCards preserves the same tweet when embedded in separate sections', () => {
  const blocks = [
    {
      kind: 'quote',
      sourceUrl: 'https://x.com/a/status/1',
      blocks: [{ kind: 'paragraph', html: 'first intentional embed' }],
    },
    { kind: 'paragraph', html: 'section break 1' },
    { kind: 'paragraph', html: 'section break 2' },
    { kind: 'paragraph', html: 'section break 3' },
    { kind: 'paragraph', html: 'section break 4' },
    { kind: 'paragraph', html: 'section break 5' },
    { kind: 'paragraph', html: 'section break 6' },
    {
      kind: 'quote',
      sourceUrl: 'https://x.com/a/status/1',
      blocks: [{ kind: 'paragraph', html: 'second intentional embed' }],
    },
  ];
  const out = engine.dedupeQuoteCards(blocks);
  const quotes = out.filter((b) => b.kind === 'quote');
  assert.equal(quotes.length, 2, 'repeated embeds in separate sections should stay in place');
  assert.ok(quotes[0].blocks[0].html.includes('first intentional embed'));
  assert.ok(quotes[1].blocks[0].html.includes('second intentional embed'));
});

// ---------------------------------------------------------------------------
// mediaOwnerStatusId: an Article's main wrapper is an article[data-testid="tweet"]
// whose first status link is the FIRST embedded tweet's id. Article infographics
// must NOT be attributed to it (they belong in the body); only genuine embedded
// tweets (in simpleTweet) and the primary post get their images.
// ---------------------------------------------------------------------------
const OWNER_URL = 'https://x.com/vegahao/status/2069000000000000000';
const OWNER_PAGE = `<!doctype html><html><body>
  <div data-testid="primaryColumn">
    <article data-testid="tweet" role="article">
      <div data-testid="tweetPhoto"><img id="info" src="https://pbs.twimg.com/media/Infographic?format=jpg&name=small"></div>
      <section data-block="true"><div data-testid="simpleTweet"><article data-testid="tweet" role="article">
        <div data-testid="tweetPhoto"><img id="emb" src="https://pbs.twimg.com/media/EmbChart?format=jpg&name=small"></div>
        <a href="/x/status/1944000000000000000"><time datetime="2025-07-14T00:00:00Z">Jul 14</time></a>
      </article></div></section>
    </article>
  </div>
</body></html>`;
const odom = new JSDOM(OWNER_PAGE, { url: OWNER_URL });
global.window = odom.window;
global.document = odom.window.document;
global.Node = odom.window.Node;
global.location = odom.window.location;

check('mediaOwnerStatusId: article-wrapper image is not attributed; embedded image is', () => {
  const info = odom.window.document.getElementById('info');
  const emb = odom.window.document.getElementById('emb');
  assert.equal(
    engine.mediaOwnerStatusId(info),
    '',
    'article infographic must not be tagged to a tweet'
  );
  assert.equal(
    engine.mediaOwnerStatusId(emb),
    '1944000000000000000',
    'embedded-tweet image must be tagged to its own tweet'
  );
});

// ---------------------------------------------------------------------------
// Syndication transforms: each embedded tweet is fetched by id from X's public
// endpoint, giving authoritative text + media (no DOM guessing). These tests
// cover the pure transform from a syndication payload to a quote model block.
// ---------------------------------------------------------------------------
const SAMPLE_SYNDICATION = {
  __typename: 'Tweet',
  id_str: '2059281082315342211',
  created_at: '2026-06-25T06:00:00.000Z',
  text: '左脚存储右脚光 https://t.co/pic see https://t.co/link',
  user: {
    name: '川沐｜Trumoo',
    screen_name: 'xiaomustock',
    profile_image_url_https: 'https://pbs.twimg.com/profile_images/1/x_normal.jpg',
  },
  entities: {
    media: [{ url: 'https://t.co/pic' }],
    urls: [
      {
        url: 'https://t.co/link',
        expanded_url: 'https://example.com/page',
        display_url: 'example.com/page',
      },
    ],
  },
  mediaDetails: [
    {
      type: 'photo',
      media_url_https: 'https://pbs.twimg.com/media/Chart?format=jpg&name=small',
      ext_alt_text: 'chart',
    },
    {
      type: 'video',
      media_url_https: 'https://pbs.twimg.com/media/Poster.jpg',
      original_info: { width: 1168, height: 720 },
      video_info: {
        duration_millis: 884791.667,
        variants: [
          { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x.m3u8' },
          {
            content_type: 'video/mp4',
            bitrate: 2176000,
            url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1168x720/hi.mp4',
          },
          {
            content_type: 'video/mp4',
            bitrate: 832000,
            url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/438x270/lo.mp4',
          },
        ],
      },
    },
  ],
  quoted_tweet: {
    __typename: 'Tweet',
    id_str: '999',
    created_at: '2026-06-25T06:05:00.000Z',
    text: 'nested quote text',
    user: {
      name: 'Nested',
      screen_name: 'nested',
      profile_image_url_https: 'https://pbs.twimg.com/profile_images/2/y_normal.jpg',
    },
    entities: {},
    mediaDetails: [],
  },
};

check('syndicationToQuoteBlock builds an authoritative quote (text, media, nested)', () => {
  const q = engine.syndicationToQuoteBlock(SAMPLE_SYNDICATION);
  assert.equal(q.kind, 'quote');
  assert.equal(q.author.name, '川沐｜Trumoo');
  assert.equal(q.author.handle, '@xiaomustock');
  assert.ok(q.author.avatarUrl.includes('_400x400'), 'avatar upgraded');
  assert.equal(q.sourceUrl, 'https://x.com/xiaomustock/status/2059281082315342211');
  assert.equal(q.publishedAt, '2026-06-25T06:00:00.000Z');

  const para = q.blocks.find((b) => b.kind === 'paragraph');
  assert.ok(para.html.includes('左脚存储右脚光'));
  assert.ok(!para.html.includes('t.co/pic'), 'media t.co link stripped');
  assert.ok(
    para.html.includes('<a href="https://example.com/page">example.com/page</a>'),
    'url linkified to expanded form'
  );

  const img = q.blocks.find((b) => b.kind === 'image');
  assert.ok(img.url.includes('Chart') && img.url.includes('name=orig'), `image: ${img && img.url}`);

  const card = q.blocks.find((b) => b.kind === 'link-card');
  assert.equal(card.url, 'https://example.com/page');
  assert.equal(card.shortUrl, 'https://t.co/link');
  assert.equal(card.domain, 'example.com');

  const vid = q.blocks.find((b) => b.kind === 'video');
  assert.equal(
    vid.mp4Url,
    'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1168x720/hi.mp4',
    'picks highest-bitrate mp4 before falling back'
  );
  assert.equal(vid.width, 1168);
  assert.equal(vid.height, 720);
  assert.equal(vid.duration, 884.791667);
  assert.ok(vid.posterUrl.includes('Poster'));
  assert.equal(vid.videoCandidates[0].bitrate, 2176000);

  const nested = q.blocks.find((b) => b.kind === 'quote');
  assert.ok(nested, 'quoted_tweet becomes a nested quote');
  assert.equal(nested.author.handle, '@nested');
  assert.equal(nested.publishedAt, '2026-06-25T06:05:00.000Z');
  assert.ok(
    nested.blocks.some((b) => b.kind === 'paragraph' && b.html.includes('nested quote text'))
  );
});

check(
  'syndication quote upgrade preserves DOM-only polls and rich card metadata recursively',
  () => {
    const existing = {
      kind: 'quote',
      blocks: [
        { kind: 'paragraph', html: 'stale text' },
        {
          kind: 'link-card',
          url: 'https://t.co/link',
          title: 'Rich title from X card',
          imageUrl: 'https://pbs.twimg.com/card_img/preview.jpg',
        },
        { kind: 'poll', choices: [{ label: 'Yes' }, { label: 'No' }] },
        {
          kind: 'quote',
          sourceUrl: 'https://x.com/nested/status/999',
          blocks: [{ kind: 'poll', choices: [{ label: 'Nested choice' }] }],
        },
      ],
    };
    const fresh = engine.mergeQuoteAfterSyndication(
      existing,
      engine.syndicationToQuoteBlock(SAMPLE_SYNDICATION)
    );
    const card = fresh.blocks.find((block) => block.kind === 'link-card');
    assert.equal(card.url, 'https://example.com/page', 'expanded URL remains authoritative');
    assert.equal(card.title, 'Rich title from X card');
    assert.equal(card.imageUrl, 'https://pbs.twimg.com/card_img/preview.jpg');
    assert.ok(
      fresh.blocks.some((block) => block.kind === 'poll'),
      'outer poll preserved'
    );
    const nested = fresh.blocks.find((block) => block.kind === 'quote');
    assert.ok(
      nested.blocks.some((block) => block.kind === 'poll'),
      'nested poll preserved'
    );
  }
);

check('syndication tweet text is not double-escaped (X pre-encodes & < >)', () => {
  const q = engine.syndicationToQuoteBlock({
    __typename: 'Tweet',
    id_str: '42',
    created_at: '2026-06-25T06:00:00.000Z',
    // X syndication returns text with &, <, > already HTML-encoded.
    text: 'objectively &amp; fairly, 1 &lt; 2 &gt; 0',
    user: {
      name: 'News',
      screen_name: 'news',
      profile_image_url_https: 'https://pbs.twimg.com/profile_images/1/x_normal.jpg',
    },
    entities: {},
    mediaDetails: [],
  });
  const para = q.blocks.find((b) => b.kind === 'paragraph');
  // & < > must be single-encoded (so they render as & < >), never double-encoded.
  assert.ok(para.html.includes('objectively &amp; fairly'), `got: ${para.html}`);
  assert.ok(para.html.includes('1 &lt; 2 &gt; 0'), `got: ${para.html}`);
  assert.ok(!para.html.includes('&amp;amp;'), 'must not double-encode &');
  assert.ok(!para.html.includes('&amp;lt;'), 'must not double-encode <');
});

check('syndicationToQuoteBlock marks long-form (note_tweet) posts as truncated', () => {
  const base = {
    __typename: 'Tweet',
    id_str: '7',
    created_at: '2026-06-25T06:00:00.000Z',
    text: 'preview text only',
    user: {
      name: 'A',
      screen_name: 'a',
      profile_image_url_https: 'https://pbs.twimg.com/profile_images/1/x_normal.jpg',
    },
    entities: {},
    mediaDetails: [],
  };
  // A normal tweet is not truncated; a tweet carrying a note_tweet reference is.
  assert.equal(engine.syndicationToQuoteBlock(base).truncated, false);
  assert.equal(
    engine.syndicationToQuoteBlock({ ...base, note_tweet: { id: 'NoteTweetResults:1' } }).truncated,
    true
  );
});

check('syndicationToken is a non-empty token without zero-runs or dots', () => {
  const tok = engine.syndicationToken('1944620438728101976');
  assert.equal(typeof tok, 'string');
  assert.ok(tok.length > 0);
  assert.ok(!/[.]/.test(tok) && !/00/.test(tok), `token shape: ${tok}`);
});

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

check('mediaKeyFromUrl canonicalizes DOM and syndication URL shapes to one key', () => {
  const domShape = engine.mediaKeyFromUrl(
    'https://pbs.twimg.com/media/GxAbC123_x?format=jpg&name=small'
  );
  const synShape = engine.mediaKeyFromUrl('https://pbs.twimg.com/media/GxAbC123_x.jpg');
  assert.equal(domShape, 'media:GxAbC123_x');
  assert.equal(domShape, synShape);
  assert.equal(
    engine.mediaKeyFromUrl('https://pbs.twimg.com/ext_tw_video_thumb/123456/pu/img/x.jpg'),
    'video:123456'
  );
  assert.equal(engine.mediaKeyFromUrl('https://pbs.twimg.com/profile_images/1/a.jpg'), '');
});

await checkAsync(
  'thread media enrichment recovers lazy-load losses into the right post, no dupes',
  async () => {
    const model = {
      type: 'post',
      blocks: [
        {
          kind: 'thread-marker',
          statusId: '111',
          sourceUrl: 'https://x.com/a/status/111',
          index: 1,
          total: 2,
        },
        { kind: 'paragraph', html: 'first post, its image was lost to lazy loading' },
        {
          kind: 'thread-marker',
          statusId: '222',
          sourceUrl: 'https://x.com/a/status/222',
          index: 2,
          total: 2,
        },
        { kind: 'paragraph', html: 'second post, image already captured from the DOM' },
        {
          kind: 'image',
          url: 'https://pbs.twimg.com/media/KEEP22?format=jpg&name=small',
          alt: '',
        },
      ],
      thread: { capturedPosts: 2, sourcePostIds: ['111', '222'], completeness: 'best-effort' },
    };
    const syndication = {
      111: {
        __typename: 'Tweet',
        text: 'first',
        mediaDetails: [
          { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/LOST11.jpg' },
        ],
      },
      222: {
        __typename: 'Tweet',
        text: 'second',
        // Same asset the DOM already captured, in syndication's URL shape: must NOT duplicate.
        mediaDetails: [
          { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/KEEP22.jpg' },
        ],
      },
    };
    await engine.enrichThreadViaSyndication(model, null, async (id) => {
      if (!syndication[id]) throw new Error('unexpected fetch ' + id);
      return syndication[id];
    });
    const images = model.blocks.filter((b) => b.kind === 'image');
    assert.equal(images.length, 2, 'one recovered + one kept, no duplicates');
    const marker2 = model.blocks.findIndex(
      (b) => b.kind === 'thread-marker' && b.statusId === '222'
    );
    const recovered = model.blocks.findIndex((b) => b.kind === 'image' && /LOST11/.test(b.url));
    assert.ok(recovered !== -1, 'missing image was recovered from syndication');
    assert.ok(recovered < marker2, 'recovered image belongs to post 1, before the post 2 marker');
    assert.equal(model.thread.mediaRecovered, 1);
  }
);

await checkAsync('thread media enrichment survives per-post syndication failures', async () => {
  const model = {
    type: 'post',
    blocks: [
      { kind: 'thread-marker', statusId: '111', sourceUrl: 'https://x.com/a/status/111' },
      { kind: 'paragraph', html: 'one' },
      { kind: 'thread-marker', statusId: '222', sourceUrl: 'https://x.com/a/status/222' },
      { kind: 'paragraph', html: 'two' },
    ],
    thread: { capturedPosts: 2, sourcePostIds: ['111', '222'], completeness: 'best-effort' },
  };
  await engine.enrichThreadViaSyndication(model, null, async (id) => {
    if (id === '111') throw new Error('syndication: HTTP 404');
    return {
      __typename: 'Tweet',
      text: 'two',
      mediaDetails: [
        {
          type: 'video',
          media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/999/pu/img/p.jpg',
          video_info: {
            duration_millis: 5000,
            variants: [
              { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/v.mp4' },
            ],
          },
        },
      ],
    };
  });
  const videos = model.blocks.filter((b) => b.kind === 'video');
  assert.equal(videos.length, 1, 'post 2 video recovered despite post 1 failure');
  assert.equal(videos[0].mp4Url, 'https://video.twimg.com/v.mp4');
  assert.equal(model.thread.mediaRecovered, 1);
});

check('extractLinkCard captures the card URL + title, skips cards inside quotes', () => {
  const d = dom.window.document;
  const make = (href) => {
    const wrap = d.createElement('div');
    wrap.innerHTML = `<div data-testid="card.wrapper"><a href="${href}"><span>explain-diff skill</span><span>From gist.github.com</span></a></div>`;
    return wrap;
  };
  const tweetEl = make('https://t.co/AbC123');
  const card = engine.extractLinkCard(tweetEl, [], 'https://x.com/a/status/1');
  assert.ok(card, 'card extracted');
  assert.equal(card.kind, 'link-card');
  assert.equal(card.url, 'https://t.co/AbC123');
  assert.equal(card.title, 'explain-diff skill');
  assert.equal(card.domain, 'gist.github.com');
  // The same card inside a quoted tweet belongs to the quote, not the main post.
  const quoted = make('https://t.co/AbC123');
  const outer = d.createElement('div');
  outer.appendChild(quoted);
  assert.equal(engine.extractLinkCard(outer, [quoted], 'https://x.com/a/status/1'), null);
});

check('quote source recovery reads canonical status URLs from non-anchor DOM attributes', () => {
  const quote = document.createElement('div');
  quote.setAttribute('role', 'link');
  quote.setAttribute('tabindex', '0');
  quote.setAttribute('data-source-url', '/context/status/9876543210123456789');
  quote.innerHTML = '<div data-testid="tweetText">Context post</div>';
  assert.equal(
    engine.quoteSourceUrlFromElement(quote, { handle: '@context' }),
    'https://x.com/context/status/9876543210123456789'
  );
});

await checkAsync(
  'syndication relation recovery restores a missing reply-context permalink',
  async () => {
    const model = {
      type: 'post',
      sourceUrl: 'https://x.com/answer/status/200',
      blocks: [
        { kind: 'paragraph', html: 'Answer' },
        {
          kind: 'quote',
          author: { name: 'Questioner', handle: '@questioner' },
          sourceUrl: '',
          blocks: [{ kind: 'paragraph', html: 'Question text' }],
        },
      ],
    };
    await engine.recoverMissingQuoteSourcesViaSyndication(model, null, async (statusId) => {
      assert.equal(statusId, '200');
      return {
        __typename: 'Tweet',
        text: 'Answer',
        in_reply_to_status_id_str: '100',
        in_reply_to_screen_name: 'questioner',
      };
    });
    const quote = model.blocks.find((block) => block.kind === 'quote');
    assert.equal(quote.sourceUrl, 'https://x.com/questioner/status/100');
    assert.equal(quote.relation, 'reply');
  }
);

check('buildTweetBlocks flags long-form previews and keeps the link card', () => {
  const d = dom.window.document;
  const tweetEl = d.createElement('article');
  tweetEl.setAttribute('data-testid', 'tweet');
  tweetEl.innerHTML = `
    <div data-testid="User-Name"><a href="/longform"><span>Long Form</span></a><a href="/longform"><span>@longform</span></a></div>
    <div data-testid="tweetText" lang="en"><span>Only the preview of this long post. I'm</span></div>
    <div data-testid="tweet-text-show-more-link">Show more</div>
    <div data-testid="card.wrapper"><a href="https://t.co/Xyz789"><span>a linked page</span><span>From example.com</span></a></div>
    <a href="/longform/status/9999999999999999999"><time datetime="2026-07-02T03:26:39Z">Jul 2</time></a>`;
  const { blocks, textTruncated } = engine.buildTweetBlocks(tweetEl);
  assert.equal(textTruncated, true, 'Show more link marks the text as a preview');
  const card = blocks.find((b) => b.kind === 'link-card');
  assert.ok(card, 'link card captured alongside the text');
  assert.equal(card.url, 'https://t.co/Xyz789');
});

await checkAsync(
  'syndication pass recovers lost links, upgrades t.co cards, flags note posts',
  async () => {
    const model = {
      type: 'post',
      blocks: [
        { kind: 'thread-marker', statusId: '111', sourceUrl: 'https://x.com/a/status/111' },
        { kind: 'paragraph', html: 'post with a DOM-captured card kept as t.co' },
        { kind: 'link-card', url: 'https://t.co/AbC123', title: '', domain: '' },
        { kind: 'thread-marker', statusId: '222', sourceUrl: 'https://x.com/a/status/222' },
        { kind: 'paragraph', html: 'long-form post whose card was lost to lazy loading' },
      ],
      thread: { capturedPosts: 2, sourcePostIds: ['111', '222'], completeness: 'best-effort' },
    };
    const syndication = {
      111: {
        __typename: 'Tweet',
        text: 'one',
        entities: {
          urls: [
            {
              url: 'https://t.co/AbC123',
              expanded_url: 'https://gist.github.com/g/1',
              display_url: 'gist.github.com/g/1',
            },
          ],
        },
      },
      222: {
        __typename: 'Tweet',
        text: 'two',
        note_tweet: { id: 'NoteTweetResults:2' },
        entities: {
          urls: [
            {
              url: 'https://t.co/LoSt42',
              expanded_url: 'https://example.com/paper',
              display_url: 'example.com/paper',
            },
            // A status permalink is a post reference, never an external link card.
            {
              url: 'https://t.co/QuOte',
              expanded_url: 'https://x.com/someone/status/12345',
              display_url: 'x.com/someone/status/1...',
            },
          ],
        },
      },
    };
    await engine.enrichThreadViaSyndication(model, null, async (id) => syndication[id]);

    const upgraded = model.blocks.find((b) => b.kind === 'link-card' && /gist\.github/.test(b.url));
    assert.ok(upgraded, 'DOM card URL upgraded from t.co to the expanded URL');
    assert.equal(upgraded.domain, 'gist.github.com');

    const cards = model.blocks.filter((b) => b.kind === 'link-card');
    assert.equal(cards.length, 2, 'lost card recovered; status permalink NOT turned into a card');
    assert.ok(cards.some((b) => b.url === 'https://example.com/paper'));

    const notice = model.blocks.findIndex((b) => b.kind === 'truncation-notice');
    assert.ok(notice !== -1, 'note_tweet post got a truncation notice');
    assert.equal(notice, model.blocks.length - 1, 'notice is the last word of its post segment');
    assert.equal(model.thread.truncatedPosts, 1);
  }
);

check('renderBlock renders link cards and truncation notices honestly', () => {
  const cardHtml = engine.renderBlock({
    kind: 'link-card',
    url: 'https://gist.github.com/g/1',
    title: 'explain-diff skill',
    domain: 'gist.github.com',
  });
  assert.match(cardHtml, /href="https:\/\/gist\.github\.com\/g\/1"/);
  assert.match(cardHtml, /explain-diff skill/);
  assert.match(cardHtml, /rel="noopener noreferrer"/);

  const noticeHtml = engine.renderBlock({
    kind: 'truncation-notice',
    sourceUrl: 'https://x.com/a/status/222',
  });
  assert.match(noticeHtml, /only the preview above was available at export/);
  assert.match(noticeHtml, /href="https:\/\/x\.com\/a\/status\/222"/);
  assert.match(noticeHtml, /data-xa-truncated="1"/);
});

check('LLM Markdown carries link cards and the long-form warning', () => {
  const md = engine.renderLlmMarkdown(
    {
      type: 'post',
      title: 'T on X',
      author: { name: 'T', handle: '@t' },
      sourceUrl: 'https://x.com/t/status/1',
      exportedAt: '2026-07-02T00:00:00Z',
      blocks: [
        { kind: 'paragraph', html: 'text' },
        {
          kind: 'link-card',
          url: 'https://gist.github.com/g/1',
          title: 'explain-diff skill',
          domain: 'gist.github.com',
        },
        { kind: 'truncation-notice', sourceUrl: 'https://x.com/t/status/1' },
      ],
    },
    ''
  );
  assert.match(md, /\[Link card\] explain-diff skill: https:\/\/gist\.github\.com\/g\/1/);
  assert.match(md, /long-form post and only its preview text was available/);
});

// ---------------------------------------------------------------------------
// Long-form (note) full-text recovery from passively captured GraphQL payloads
// ---------------------------------------------------------------------------

// A trimmed TweetDetail-shaped payload: the note text lives at
// result.note_tweet.note_tweet_results.result.text, next to rest_id.
const NOTE_FULL_TEXT =
  'This is the full long-form text.\nIt has several paragraphs and a link https://t.co/NoTe1 at the end, and it is much longer than the preview X shows in threads.';
const NOTE_GRAPHQL_BODY = JSON.stringify({
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [
        {
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: '888',
                      note_tweet: {
                        is_expandable: true,
                        note_tweet_results: {
                          result: {
                            text: NOTE_FULL_TEXT,
                            entity_set: {
                              urls: [
                                {
                                  url: 'https://t.co/NoTe1',
                                  expanded_url: 'https://example.com/full-paper',
                                  display_url: 'example.com/full-paper',
                                },
                              ],
                            },
                          },
                        },
                      },
                      legacy: { id_str: '888', full_text: 'This is the full long-form…' },
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    },
  },
});

check('noteTweetsFromCapturedBody extracts id + full text + urls from TweetDetail JSON', () => {
  const notes = engine.noteTweetsFromCapturedBody(NOTE_GRAPHQL_BODY);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, '888');
  assert.equal(notes[0].text, NOTE_FULL_TEXT);
  assert.equal(notes[0].urls.length, 1);
  // Non-JSON and note-free bodies are ignored quietly.
  assert.equal(engine.noteTweetsFromCapturedBody('#EXTM3U\nvideo.twimg.com/x.m3u8').length, 0);
  assert.equal(engine.noteTweetsFromCapturedBody('{"data":{"no_notes":true}}').length, 0);
});

check('noteTweetParagraphBlocks splits paragraphs, escapes, and linkifies t.co urls', () => {
  const blocks = engine.noteTweetParagraphBlocks({
    text: 'First <line> & escaped.\n\nSecond with https://t.co/NoTe1 link.',
    urls: [
      {
        url: 'https://t.co/NoTe1',
        expanded_url: 'https://example.com/full-paper',
        display_url: 'example.com/full-paper',
      },
    ],
  });
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].html, /First &lt;line&gt; &amp; escaped\./);
  assert.match(
    blocks[1].html,
    /<a href="https:\/\/example\.com\/full-paper">example\.com\/full-paper<\/a>/
  );
});

await checkAsync(
  'syndication pass swaps the note preview for network-captured full text',
  async () => {
    // Feed the captured GraphQL body through the real network-capture entry point,
    // exactly as the page bridge delivers it.
    engine.handleNetworkCapturePayload({
      source: 'SourceCapsule:network-capture',
      type: 'response',
      url: 'https://x.com/i/api/graphql/abc/TweetDetail',
      transport: 'fetch:test',
      body: NOTE_GRAPHQL_BODY,
    });
    const model = {
      type: 'post',
      blocks: [
        { kind: 'thread-marker', statusId: '888', sourceUrl: 'https://x.com/a/status/888' },
        { kind: 'paragraph', html: 'This is the full long-form…' },
        { kind: 'image', url: 'https://pbs.twimg.com/media/NoteImg?format=jpg&name=small' },
      ],
      thread: { capturedPosts: 1, sourcePostIds: ['888'], completeness: 'best-effort' },
    };
    await engine.enrichThreadViaSyndication(model, null, async () => ({
      __typename: 'Tweet',
      text: 'This is the full long-form…',
      note_tweet: { id: 'NoteTweetResults:888' },
    }));
    const paragraphs = model.blocks.filter((b) => b.kind === 'paragraph');
    assert.ok(paragraphs.length >= 2, 'full text split into paragraphs replaced the preview');
    assert.match(paragraphs[0].html, /This is the full long-form text\./);
    assert.ok(!paragraphs.some((b) => /long-form…/.test(b.html)), 'preview paragraph removed');
    assert.ok(
      model.blocks.some((b) => b.kind === 'image'),
      'media blocks in the segment are kept'
    );
    assert.equal(
      model.blocks.findIndex((b) => b.kind === 'truncation-notice'),
      -1,
      'no truncation notice when the full text was recovered'
    );
    assert.ok(
      model.blocks.some((b) => b.kind === 'note-recovered'),
      'provenance notice added'
    );
    assert.equal(model.thread.recoveredNotes, 1);
    assert.ok(!model.thread.truncatedPosts, 'recovered post is not counted as truncated');
  }
);

await checkAsync(
  'syndication pass still flags a note post honestly when nothing was captured',
  async () => {
    const model = {
      type: 'post',
      blocks: [
        { kind: 'thread-marker', statusId: '999', sourceUrl: 'https://x.com/a/status/999' },
        { kind: 'paragraph', html: 'preview only' },
      ],
      thread: { capturedPosts: 1, sourcePostIds: ['999'], completeness: 'best-effort' },
    };
    await engine.enrichThreadViaSyndication(model, null, async () => ({
      __typename: 'Tweet',
      text: 'preview only',
      note_tweet: { id: 'NoteTweetResults:999' },
    }));
    assert.ok(
      model.blocks.some((b) => b.kind === 'truncation-notice'),
      'falls back to the truncation notice'
    );
    assert.equal(model.thread.truncatedPosts, 1);
    assert.ok(!model.thread.recoveredNotes);
  }
);

check('recoverQuoteNoteText upgrades a truncated quote and keeps its media', () => {
  const quote = {
    kind: 'quote',
    truncated: true,
    blocks: [
      { kind: 'paragraph', html: 'preview…' },
      { kind: 'image', url: 'https://pbs.twimg.com/media/QNote?format=jpg&name=small' },
    ],
  };
  const upgraded = engine.recoverQuoteNoteText(quote, {
    id: '777',
    text: 'Full quoted note text.\nSecond paragraph.',
    urls: [],
  });
  assert.equal(upgraded, true);
  assert.equal(quote.truncated, false);
  assert.equal(quote.noteRecovered, true);
  const kinds = quote.blocks.map((b) => b.kind);
  assert.deepEqual(kinds, ['paragraph', 'paragraph', 'image']);
  assert.match(quote.blocks[0].html, /Full quoted note text\./);
  // No note available -> quote untouched, stays honestly truncated.
  const untouched = { kind: 'quote', truncated: true, blocks: [] };
  assert.equal(engine.recoverQuoteNoteText(untouched, null), false);
  assert.equal(untouched.truncated, true);
});

check('renderBlock and LLM markdown report recovered long-form text honestly', () => {
  const html = engine.renderBlock({
    kind: 'note-recovered',
    sourceUrl: 'https://x.com/a/status/888',
  });
  assert.match(html, /data-xa-note-recovered="1"/);
  assert.match(html, /full text above was recovered/);

  const md = engine.renderLlmMarkdown(
    {
      type: 'post',
      title: 'T on X',
      author: { name: 'T', handle: '@t' },
      sourceUrl: 'https://x.com/t/status/1',
      exportedAt: '2026-07-04T00:00:00Z',
      blocks: [
        { kind: 'paragraph', html: 'full note text here' },
        { kind: 'note-recovered', sourceUrl: 'https://x.com/t/status/1' },
      ],
    },
    ''
  );
  assert.match(md, /full text above was recovered from data X delivered to the browser/);
  assert.ok(!/only its preview text was available/.test(md), 'no stale truncation warning');
});

check('poll extraction keeps outer and quoted polls separate without inventing results', () => {
  const host = document.createElement('article');
  host.setAttribute('data-testid', 'tweet');
  host.innerHTML = `
    <div data-testid="tweetText" lang="en">Outer poll</div>
    <div data-testid="cardPoll" role="radiogroup">
      <div role="radio"><span>Tea</span></div><div role="radio"><span>Coffee</span></div>
      <span>2 hours left</span>
    </div>
    <div role="link" tabindex="0">
      <div data-testid="User-Name"><span>Quoted</span><span>@quotedpoll</span></div>
      <div data-testid="tweetText" lang="en">Quoted closed poll</div>
      <div data-testid="cardPoll" role="radiogroup">
        <div role="progressbar" aria-label="Yes, 60%"><span>Yes</span><span>60%</span></div>
        <div role="progressbar" aria-label="No, 40%"><span>No</span><span>40%</span></div>
        <span>1,234 votes</span><span>Poll closed</span>
      </div>
      <a href="/quotedpoll/status/902"><time datetime="2026-07-01T00:00:00Z">Jul 1</time></a>
    </div>
    <a href="/outer/status/901"><time datetime="2026-07-01T00:01:00Z">Jul 1</time></a>`;
  document.body.appendChild(host);
  const built = engine.buildTweetBlocks(host);
  const outerPolls = built.blocks.filter((block) => block.kind === 'poll');
  const quote = built.blocks.find((block) => block.kind === 'quote');
  const quotePolls = quote.blocks.filter((block) => block.kind === 'poll');
  assert.equal(outerPolls.length, 1);
  assert.deepEqual(
    outerPolls[0].choices.map((choice) => choice.label),
    ['Tea', 'Coffee']
  );
  assert.equal(outerPolls[0].resultsUnavailable, true);
  assert.equal(outerPolls[0].status, '2 hours left');
  assert.equal(quotePolls.length, 1);
  assert.deepEqual(
    quotePolls[0].choices.map((choice) => choice.percentage),
    ['60%', '40%']
  );
  assert.equal(quotePolls[0].totalVotes, '1,234');
  assert.equal(quotePolls[0].resultsUnavailable, false);
  assert.equal(outerPolls[0].sourcePostId, '901');
  assert.equal(quotePolls[0].sourcePostId, '902');
  host.remove();
});

check('post-vote poll results are recovered without radio-group or cardPoll markup', () => {
  const host = document.createElement('article');
  host.setAttribute('data-testid', 'tweet');
  host.innerHTML = `
    <div data-testid="tweetText" lang="en">Who would you vote for?</div>
    <div class="results-only-wrapper">
      <div><span>Kamala Harris</span><span>52%</span></div>
      <div><span>Marco Rubio</span><span>37%</span></div>
      <div><span>Other</span><span>11%</span></div>
      <div><span>10,030 votes</span><span>1 day left</span></div>
    </div>
    <a href="/poller/status/903"><time datetime="2026-07-01T00:02:00Z">Jul 1</time></a>`;
  document.body.appendChild(host);
  const poll = engine.extractPollBlock(host, [], 'https://x.com/poller/status/903');
  assert.ok(poll, 'results-only markup should still produce a poll block');
  assert.deepEqual(
    poll.choices.map((choice) => [choice.label, choice.percentage]),
    [
      ['Kamala Harris', '52%'],
      ['Marco Rubio', '37%'],
      ['Other', '11%'],
    ]
  );
  assert.equal(poll.totalVotes, '10,030');
  assert.equal(poll.status, '1 day left');
  assert.equal(poll.resultsUnavailable, false);
  host.remove();
});

check('threads can carry multiple poll blocks through HTML, Markdown, and manifest', () => {
  const pollModel = {
    type: 'post',
    title: 'Poll thread',
    author: { name: 'Poller', handle: '@poller' },
    sourceUrl: 'https://x.com/poller/status/1',
    exportedAt: '2026-07-01T00:00:00Z',
    thread: { capturedPosts: 2, completeness: 'best-effort' },
    blocks: [
      {
        kind: 'poll',
        choices: [{ label: 'A' }, { label: 'B' }],
        sourcePostId: '1',
        resultsUnavailable: true,
      },
      { kind: 'thread-marker', index: 2, total: 2, sourceUrl: 'https://x.com/poller/status/2' },
      {
        kind: 'poll',
        choices: [{ label: 'C', percentage: '100%' }],
        sourcePostId: '2',
        resultsUnavailable: false,
      },
    ],
  };
  const pollHtml = engine.assembleHtml(pollModel);
  const manifest = JSON.parse(engine.renderArchiveManifestJson(pollModel));
  const pollMd = engine.renderLlmMarkdown(pollModel);
  assert.equal((pollHtml.match(/class="xa-poll"/g) || []).length, 2);
  assert.equal(manifest.capture.polls, 2);
  assert.equal(manifest.polls.length, 2);
  assert.equal((pollMd.match(/\*\*Poll\*\*/g) || []).length, 2);
});

await checkAsync(
  'persistent receipt copies retained Markdown, preserves local success on share failure, and dismisses with Escape',
  async () => {
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let copied = '';
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: async (value) => {
            copied = value;
          },
        },
      },
    });
    const receiptModel = {
      type: 'post',
      title: 'Receipt',
      author: { name: 'R', handle: '@r' },
      sourceUrl: 'https://x.com/r/status/1',
      exportedAt: '2026-07-01T00:00:00Z',
      blocks: [
        { kind: 'paragraph', html: 'Saved text' },
        {
          kind: 'poll',
          choices: [{ label: 'Yes' }, { label: 'No' }],
          sourcePostId: '1',
          sourceUrl: 'https://x.com/r/status/1',
          resultsUnavailable: true,
        },
      ],
    };
    engine.showCaptureReceipt({
      model: receiptModel,
      savedLocation: 'Library/2026-07-01/r-1',
      markdown: 'retained clean markdown',
      onShare: async () => {
        throw new Error('network unavailable');
      },
    });
    const receipt = document.querySelector('.xa-capture-receipt');
    assert.ok(receipt);
    assert.match(receipt.querySelector('.xa-receipt-status').textContent, /Complete/);
    assert.match(receipt.querySelector('.xa-receipt-grid').textContent, /Polls captured1/);
    receipt.querySelector('.xa-receipt-copy').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(copied, 'retained clean markdown');
    receipt.querySelector('.xa-receipt-share').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(
      receipt.querySelector('.xa-receipt-action-status').textContent,
      /Local save is safe/
    );
    document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    assert.equal(document.querySelector('.xa-capture-receipt'), null);
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
);

check('receipt expands honest incomplete-media details', () => {
  const staleToast = document.createElement('div');
  staleToast.id = 'sourcecapsule-toast';
  staleToast.className = 'show';
  staleToast.textContent = 'Assembling files...';
  document.body.appendChild(staleToast);
  engine.showCaptureReceipt({
    model: {
      type: 'post',
      title: 'Incomplete',
      author: { handle: '@r' },
      sourceUrl: 'https://x.com/r/status/2',
      exportedAt: '2026-07-01T00:00:00Z',
      blocks: [{ kind: 'image', url: 'https://pbs.twimg.com/media/missing.jpg', failed: true }],
    },
    savedLocation: 'incomplete.html',
    markdown: 'incomplete',
  });
  const receipt = document.querySelector('.xa-capture-receipt');
  assert.match(receipt.querySelector('.xa-receipt-status').textContent, /missing/);
  assert.equal(receipt.querySelector('.xa-receipt-details').open, true);
  const style = document.getElementById('sourcecapsule-style').textContent;
  assert.match(style, /\.xa-modal\{[^}]*max-height:[^}]*overflow:auto/s);
  assert.match(style, /\.xa-receipt-details\[open\]\{[^}]*overflow:auto/s);
  assert.equal(staleToast.classList.contains('show'), false);
  receipt.querySelector('.xa-modal-cancel').click();
  staleToast.remove();
});

// ---------------------------------------------------------------------------
// Quoted-post source-URL recovery (the "dead source link" regression: an
// export shipped 3 quote cards with a "Source URL unavailable" notice because
// both the DOM anchor AND the pool-based syndication candidate matching failed
// to resolve their permalinks).
// ---------------------------------------------------------------------------

check('quotedRefsFromCapturedBody harvests parent -> quoted refs from GraphQL bodies', () => {
  const body = JSON.stringify({
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            entries: [
              {
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        rest_id: '2075268145670209993',
                        legacy: { quoted_status_id_str: '1234567890000000001' },
                        quoted_status_result: {
                          result: {
                            rest_id: '1234567890000000001',
                            legacy: { id_str: '1234567890000000001' },
                            core: {
                              user_results: {
                                result: { legacy: { screen_name: 'BrianRoemmele' } },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    },
  });
  const refs = engine.quotedRefsFromCapturedBody(body);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].parentId, '2075268145670209993');
  assert.equal(refs[0].quotedId, '1234567890000000001');
  assert.equal(refs[0].quotedHandle, 'BrianRoemmele');
  // Non-JSON and refless bodies are ignored quietly.
  assert.equal(engine.quotedRefsFromCapturedBody('#EXTM3U\nvideo').length, 0);
  assert.equal(engine.quotedRefsFromCapturedBody('{"data":{"no":true}}').length, 0);
});

check('quotedRefsFromCapturedBody also accepts the legacy quoted_status.user shape', () => {
  const body = JSON.stringify({
    tweets: [
      {
        rest_id: '999',
        legacy: { id_str: '999', quoted_status_id_str: '111' },
        quoted_status: { user: { screen_name: 'stonk_daddy' } },
      },
    ],
  });
  const refs = engine.quotedRefsFromCapturedBody(body);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].parentId, '999');
  assert.equal(refs[0].quotedId, '111');
  assert.equal(refs[0].quotedHandle, 'stonk_daddy');
});

check(
  'recoverMissingQuoteSourcesFromCapture patches thread-embedded quotes from captured refs',
  () => {
    const captured = new Map([
      ['2075268145670209993', { quotedId: '1234567890000000001', quotedHandle: 'BrianRoemmele' }],
      ['3000000000000000002', { quotedId: '5555555555555555555', quotedHandle: 'stonk_daddy' }],
    ]);
    const model = {
      sourceUrl: 'https://x.com/alex_prompter/status/2075268145670209993',
      blocks: [
        {
          kind: 'thread-marker',
          statusId: '2075268145670209993',
          sourceUrl: 'https://x.com/alex_prompter/status/2075268145670209993',
        },
        { kind: 'paragraph', html: 'Body 1' },
        {
          kind: 'quote',
          author: { handle: '@BrianRoemmele' },
          sourceUrl: '',
          blocks: [{ kind: 'paragraph', html: 'quoted content' }],
        },
        {
          kind: 'thread-marker',
          statusId: '3000000000000000002',
          sourceUrl: 'https://x.com/alex_prompter/status/3000000000000000002',
        },
        { kind: 'paragraph', html: 'Body 2' },
        {
          kind: 'quote',
          author: { handle: '@stonk_daddy' },
          sourceUrl: '',
          blocks: [{ kind: 'paragraph', html: 'another quoted' }],
        },
      ],
    };
    const patched = engine.recoverMissingQuoteSourcesFromCapture(
      model,
      (parentId) => captured.get(parentId) || null
    );
    assert.equal(patched, 2);
    const quotes = model.blocks.filter((b) => b.kind === 'quote');
    assert.equal(quotes[0].sourceUrl, 'https://x.com/BrianRoemmele/status/1234567890000000001');
    assert.equal(quotes[1].sourceUrl, 'https://x.com/stonk_daddy/status/5555555555555555555');
  }
);

check('recoverMissingQuoteSourcesFromCapture handles a single-post model without markers', () => {
  const model = {
    sourceUrl: 'https://x.com/a/status/42',
    blocks: [
      { kind: 'paragraph', html: 'Main post' },
      {
        kind: 'quote',
        author: { handle: '@ctx' },
        sourceUrl: '',
        blocks: [{ kind: 'paragraph', html: 'body' }],
      },
    ],
  };
  const patched = engine.recoverMissingQuoteSourcesFromCapture(model, (parentId) =>
    parentId === '42' ? { quotedId: '99', quotedHandle: 'ctx' } : null
  );
  assert.equal(patched, 1);
  assert.equal(model.blocks[1].sourceUrl, 'https://x.com/ctx/status/99');
});

check('recoverMissingQuoteSourcesFromCapture leaves already-resolved quotes alone', () => {
  const model = {
    sourceUrl: 'https://x.com/a/status/1',
    blocks: [
      {
        kind: 'quote',
        author: { handle: '@x' },
        sourceUrl: 'https://x.com/x/status/9',
        blocks: [{ kind: 'paragraph', html: 'body' }],
      },
    ],
  };
  const patched = engine.recoverMissingQuoteSourcesFromCapture(model, () => ({
    quotedId: '77',
    quotedHandle: 'x',
  }));
  assert.equal(patched, 0);
  assert.equal(model.blocks[0].sourceUrl, 'https://x.com/x/status/9');
});

await checkAsync(
  'enrichThreadViaSyndication patches quote sourceUrl AND rebuilds card from its own quoted_tweet',
  async () => {
    const model = {
      blocks: [
        {
          kind: 'thread-marker',
          statusId: '2075268145670209993',
          sourceUrl: 'https://x.com/alex_prompter/status/2075268145670209993',
        },
        { kind: 'paragraph', html: 'Post 3 body' },
        {
          kind: 'quote',
          author: { handle: '@BrianRoemmele' },
          sourceUrl: '',
          blocks: [{ kind: 'paragraph', html: 'stale DOM-scraped body' }],
        },
      ],
      thread: {
        capturedPosts: 1,
        sourcePostIds: ['2075268145670209993'],
        completeness: 'best-effort',
      },
    };
    await engine.enrichThreadViaSyndication(model, null, async () => ({
      __typename: 'Tweet',
      text: 'Post 3 body',
      quoted_tweet: {
        id_str: '1234567890000000001',
        user: { screen_name: 'BrianRoemmele', name: 'Brian Roemmele' },
        text: 'Grok 4.5 exceeds Claude and ChatGPT in most cases…',
        created_at: '2026-07-08T18:22:34.000Z',
      },
    }));
    const quote = model.blocks.find((b) => b.kind === 'quote');
    assert.equal(quote.sourceUrl, 'https://x.com/BrianRoemmele/status/1234567890000000001');
    // The DOM-scraped body was replaced by authoritative syndication content.
    const bodyHtml = (quote.blocks.find((b) => b.kind === 'paragraph') || {}).html || '';
    assert.match(bodyHtml, /Grok 4\.5/);
    assert.doesNotMatch(bodyHtml, /stale DOM-scraped body/);
  }
);

check('quote renderer falls back to author profile when sourceUrl is missing', () => {
  const model = {
    type: 'post',
    title: 'Fallback',
    author: { name: 'A', handle: '@a' },
    sourceUrl: 'https://x.com/a/status/1',
    exportedAt: '2026-07-06T00:00:00Z',
    blocks: [
      { kind: 'paragraph', html: 'Body' },
      {
        kind: 'quote',
        author: { name: 'Brian Roemmele', handle: '@BrianRoemmele' },
        sourceUrl: '',
        blocks: [{ kind: 'paragraph', html: 'quoted body' }],
      },
    ],
  };
  const html = engine.assembleHtml(model);
  assert.doesNotMatch(html, /Source URL unavailable/);
  assert.match(
    html,
    /<a class="xa-quote-link" href="https:\/\/x\.com\/BrianRoemmele"[^>]*>View @BrianRoemmele on X/
  );
  assert.match(html, /data-xa-source-fallback="author-profile"/);
});

check('quote renderer with a real sourceUrl uses it, not the profile fallback', () => {
  const model = {
    type: 'post',
    title: 'Real link',
    author: { name: 'A', handle: '@a' },
    sourceUrl: 'https://x.com/a/status/1',
    exportedAt: '2026-07-06T00:00:00Z',
    blocks: [
      {
        kind: 'quote',
        author: { name: 'Ctx', handle: '@ctx' },
        sourceUrl: 'https://x.com/ctx/status/9',
        blocks: [{ kind: 'paragraph', html: 'body' }],
      },
    ],
  };
  const html = engine.assembleHtml(model);
  assert.match(
    html,
    /<a class="xa-quote-link" href="https:\/\/x\.com\/ctx\/status\/9"[^>]*>View on X/
  );
  assert.doesNotMatch(html, /data-xa-source-fallback="author-profile"/);
});

// ---------------------------------------------------------------------------
// Strict export gate: refuse to silently ship broken exports.
// ---------------------------------------------------------------------------

check('assessExportCompleteness returns clean when everything landed', () => {
  const model = {
    type: 'post',
    sourceUrl: 'https://x.com/a/status/1',
    blocks: [
      { kind: 'paragraph', html: 'body' },
      {
        kind: 'image',
        url: 'https://pbs.twimg.com/media/x.jpg',
        dataUri: 'data:image/png;base64,AA',
      },
      {
        kind: 'video',
        mode: 'inline',
        dataUri: 'data:video/mp4;base64,AA',
        posterDataUri: 'data:image/png;base64,AA',
      },
      {
        kind: 'quote',
        author: { handle: '@ctx' },
        sourceUrl: 'https://x.com/ctx/status/9',
        blocks: [{ kind: 'paragraph', html: 'q' }],
      },
    ],
  };
  const a = engine.assessExportCompleteness(model);
  assert.equal(a.verdict, 'clean');
  assert.equal(a.blockers.length, 0);
});

check('assessExportCompleteness flags every visible dead-end category', () => {
  const model = {
    type: 'post',
    sourceUrl: 'https://x.com/a/status/1',
    blocks: [
      {
        kind: 'quote',
        author: { handle: '@BrianRoemmele' },
        sourceUrl: '',
        blocks: [{ kind: 'paragraph', html: 'q body' }],
      },
      {
        kind: 'quote',
        author: { handle: '@deleted' },
        sourceUrl: 'https://x.com/deleted/status/7',
        blocks: [],
      },
      { kind: 'image', url: 'https://pbs.twimg.com/media/x.jpg' },
      { kind: 'video', mode: 'poster', _xaMediaId: 'vid1' },
    ],
  };
  const a = engine.assessExportCompleteness(model);
  assert.equal(a.verdict, 'incomplete');
  assert.equal(a.counts.quotePermalinkMissing, 1);
  assert.equal(a.counts.quoteContentMissing, 1);
  assert.equal(a.counts.imageFetchFailed, 1);
  assert.equal(a.counts.videoNothingCaptured, 1);
  assert.equal(a.blockers.length, 4);
  assert.ok(a.blockers.some((b) => b.handle === '@BrianRoemmele'));
});

check('assessExportCompleteness respects documented best-effort states', () => {
  // HLS-only video with a poster still is expected best-effort per AGENTS.md;
  // a note-recovered quote landed the full text; neither counts as a blocker.
  const model = {
    type: 'post',
    sourceUrl: 'https://x.com/a/status/1',
    blocks: [
      {
        kind: 'video',
        mode: 'poster',
        unsupported: true,
        unsupportedType: 'hls',
        posterDataUri: 'data:image/png;base64,AA',
        sourceUrl: 'https://x.com/a/status/1',
      },
      {
        kind: 'quote',
        author: { handle: '@ctx' },
        sourceUrl: 'https://x.com/ctx/status/9',
        noteRecovered: true,
        blocks: [{ kind: 'paragraph', html: 'full recovered text' }],
      },
    ],
  };
  const a = engine.assessExportCompleteness(model);
  assert.equal(a.verdict, 'clean');
});

check('assessExportCompleteness deduplicates identical blockers across a thread', () => {
  const model = {
    type: 'post',
    blocks: [
      {
        kind: 'quote',
        author: { handle: '@x' },
        sourceUrl: '',
        blocks: [{ kind: 'paragraph', html: 'a' }],
      },
      {
        kind: 'quote',
        author: { handle: '@x' },
        sourceUrl: '',
        blocks: [{ kind: 'paragraph', html: 'a' }],
      },
    ],
  };
  const a = engine.assessExportCompleteness(model);
  assert.equal(a.blockers.length, 1);
});

check('buildDiagnosticBundle carries what a bug report needs and NO media bytes', () => {
  const model = {
    type: 'post',
    sourceUrl: 'https://x.com/a/status/1',
    author: { handle: '@a', avatarDataUri: 'data:image/png;base64,BIGBYTES' },
    blocks: [
      { kind: 'paragraph', html: 'body' },
      {
        kind: 'image',
        url: 'https://pbs.twimg.com/media/x.jpg',
        dataUri: 'data:image/png;base64,MORESTUFF',
      },
      {
        kind: 'quote',
        author: { handle: '@BrianRoemmele' },
        sourceUrl: '',
        blocks: [{ kind: 'paragraph', html: 'q body' }],
      },
    ],
  };
  const assessment = engine.assessExportCompleteness(model);
  const bundle = engine.buildDiagnosticBundle(model, assessment);
  const parsed = JSON.parse(bundle);
  assert.equal(parsed.verdict, 'incomplete');
  assert.equal(parsed.counts.quotePermalinkMissing, 1);
  assert.equal(parsed.modelSourceUrl, 'https://x.com/a/status/1');
  assert.match(parsed.generator, /SourceCapsule v/);
  // Must NOT leak media bytes; they should have been stripped to a marker.
  assert.doesNotMatch(bundle, /MORESTUFF/);
  assert.doesNotMatch(bundle, /BIGBYTES/);
  assert.match(bundle, /\[stripped: \d+ bytes\]/);
});

// ---------------------------------------------------------------------------
// First-try hardening: retry policy, single-post syndication pass, auto-repair.
// ---------------------------------------------------------------------------

await checkAsync('media byte fetch stops retrying on authoritative HTTP 404', async () => {
  let calls = 0;
  global.GM_xmlhttpRequest = (options) => {
    calls++;
    options.onload({ status: 404, response: null, responseHeaders: '' });
  };
  await assert.rejects(
    () => engine.gmFetchBytes('https://pbs.twimg.com/media/gone?format=jpg'),
    /HTTP 404/
  );
  assert.equal(calls, 1, '404 must not burn retries; the next variant candidate should run');
  delete global.GM_xmlhttpRequest;
});

await checkAsync(
  'enrichFocusedPostViaSyndication recovers media the DOM never rendered on a single post',
  async () => {
    const model = {
      type: 'post',
      sourceUrl: 'https://x.com/a/status/555',
      blocks: [{ kind: 'paragraph', html: 'lone post' }],
    };
    await engine.enrichFocusedPostViaSyndication(model, null, async (id) => {
      assert.equal(id, '555');
      return {
        __typename: 'Tweet',
        text: 'lone post',
        mediaDetails: [
          { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/LOSTSOLO.jpg' },
        ],
      };
    });
    const images = model.blocks.filter((b) => b.kind === 'image');
    assert.equal(images.length, 1, 'DOM-missed image added from syndication');
    assert.match(images[0].url, /LOSTSOLO/);
  }
);

await checkAsync(
  'focused-post syndication rebuilds a quote card the DOM never mounted',
  async () => {
    const model = {
      type: 'post',
      sourceUrl: 'https://x.com/parent/status/500',
      blocks: [{ kind: 'paragraph', html: 'Parent text' }],
    };
    await engine.enrichFocusedPostViaSyndication(model, null, async () => ({
      __typename: 'Tweet',
      id_str: '500',
      text: 'Parent text',
      quoted_tweet: {
        __typename: 'Tweet',
        id_str: '501',
        text: 'Quote that never mounted',
        user: { name: 'Quoted', screen_name: 'quoted' },
        entities: {},
        mediaDetails: [
          {
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/media/MissedQuote.jpg',
          },
        ],
      },
    }));
    const quote = model.blocks.find((block) => block.kind === 'quote');
    assert.ok(quote, 'authoritative parent payload should create the missing quote');
    assert.equal(quote.sourceUrl, 'https://x.com/quoted/status/501');
    assert.ok(quote.blocks.some((block) => block.kind === 'image'));
    assert.match(quote.blocks.find((block) => block.kind === 'paragraph').html, /never mounted/);
  }
);

await checkAsync(
  'enrichFocusedPostViaSyndication does not duplicate media the DOM already has',
  async () => {
    const model = {
      type: 'post',
      sourceUrl: 'https://x.com/a/status/556',
      blocks: [
        { kind: 'paragraph', html: 'post' },
        { kind: 'image', url: 'https://pbs.twimg.com/media/KEEPSOLO?format=jpg&name=orig' },
      ],
    };
    await engine.enrichFocusedPostViaSyndication(model, null, async () => ({
      __typename: 'Tweet',
      text: 'post',
      mediaDetails: [
        { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/KEEPSOLO.jpg' },
      ],
    }));
    assert.equal(model.blocks.filter((b) => b.kind === 'image').length, 1);
  }
);

await checkAsync(
  'enrichFocusedPostViaSyndication skips threads and articles (thread pass owns those)',
  async () => {
    let fetches = 0;
    const fetchTweet = async () => {
      fetches++;
      return { __typename: 'Tweet', text: 'x' };
    };
    await engine.enrichFocusedPostViaSyndication(
      {
        type: 'post',
        sourceUrl: 'https://x.com/a/status/1',
        blocks: [],
        thread: { capturedPosts: 2 },
      },
      null,
      fetchTweet
    );
    await engine.enrichFocusedPostViaSyndication(
      { type: 'article', sourceUrl: 'https://x.com/a/status/1', blocks: [] },
      null,
      fetchTweet
    );
    assert.equal(fetches, 0);
  }
);

await checkAsync(
  'repairExportBlockers rebuilds a dead quote card and returns a clean verdict',
  async () => {
    const model = {
      type: 'post',
      sourceUrl: 'https://x.com/a/status/1',
      blocks: [
        { kind: 'paragraph', html: 'body' },
        {
          kind: 'quote',
          author: { handle: '@flaky' },
          sourceUrl: 'https://x.com/flaky/status/42',
          blocks: [], // syndication failed transiently during the main pass
        },
      ],
    };
    const assessment = engine.assessExportCompleteness(model);
    assert.equal(assessment.verdict, 'incomplete');
    let rescued = false;
    const repaired = await engine.repairExportBlockers(model, assessment, null, {
      pauseMs: 0,
      fetchTweet: async (id) => {
        assert.equal(id, '42');
        // No id_str on purpose: the rebuild must keep the verified permalink
        // instead of overwriting it with a malformed one.
        return {
          __typename: 'Tweet',
          text: 'recovered quote text',
          user: { name: 'Flaky', screen_name: 'flaky' },
        };
      },
      rescue: async () => {
        rescued = true;
        return { attempted: 0, recovered: 0 };
      },
    });
    assert.equal(repaired.verdict, 'clean');
    assert.ok(rescued, 'media rescue pass must run after quote rebuild');
    const quote = model.blocks.find((b) => b.kind === 'quote');
    assert.ok(quote.blocks.length > 0, 'quote content rebuilt from syndication');
    assert.match(quote.blocks[0].html, /recovered quote text/);
  }
);

await checkAsync(
  'repairExportBlockers leaves unfixable blockers for the modal (no false clean)',
  async () => {
    const model = {
      type: 'post',
      sourceUrl: 'https://x.com/a/status/1',
      blocks: [
        {
          kind: 'quote',
          author: { handle: '@deleted' },
          sourceUrl: 'https://x.com/deleted/status/7',
          blocks: [],
        },
      ],
    };
    const assessment = engine.assessExportCompleteness(model);
    const repaired = await engine.repairExportBlockers(model, assessment, null, {
      pauseMs: 0,
      fetchTweet: async () => {
        const error = new Error('syndication: HTTP 404');
        error.status = 404;
        throw error;
      },
      rescue: async () => ({ attempted: 0, recovered: 0 }),
    });
    assert.equal(repaired.verdict, 'incomplete');
    assert.equal(repaired.counts.quoteContentMissing, 1);
  }
);

await checkAsync(
  'repairExportBlockers retries pool-based permalink recovery for quotes',
  async () => {
    const model = {
      type: 'post',
      sourceUrl: 'https://x.com/answer/status/200',
      blocks: [
        { kind: 'paragraph', html: 'Answer' },
        {
          kind: 'quote',
          author: { name: 'Questioner', handle: '@questioner' },
          sourceUrl: '',
          blocks: [{ kind: 'paragraph', html: 'Question text' }],
        },
      ],
    };
    const assessment = engine.assessExportCompleteness(model);
    assert.equal(assessment.counts.quotePermalinkMissing, 1);
    const repaired = await engine.repairExportBlockers(model, assessment, null, {
      pauseMs: 0,
      fetchTweet: async () => ({
        __typename: 'Tweet',
        text: 'Answer',
        in_reply_to_status_id_str: '100',
        in_reply_to_screen_name: 'questioner',
      }),
      rescue: async () => ({ attempted: 0, recovered: 0 }),
    });
    assert.equal(repaired.verdict, 'clean');
    const quote = model.blocks.find((b) => b.kind === 'quote');
    assert.equal(quote.sourceUrl, 'https://x.com/questioner/status/100');
  }
);

await checkAsync(
  'thread syndication heals a keyless DOM video block instead of duplicating it',
  async () => {
    const model = {
      type: 'post',
      blocks: [
        { kind: 'thread-marker', statusId: '111', sourceUrl: 'https://x.com/a/status/111' },
        { kind: 'paragraph', html: 'one' },
        // Player was still booting at capture time: no poster, no candidates.
        { kind: 'video', sourceUrl: 'https://x.com/a/status/111', videoCandidates: [] },
      ],
      thread: { capturedPosts: 1, sourcePostIds: ['111'], completeness: 'best-effort' },
    };
    await engine.enrichThreadViaSyndication(model, null, async () => ({
      __typename: 'Tweet',
      text: 'one',
      mediaDetails: [
        {
          type: 'video',
          media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/999/pu/img/p.jpg',
          video_info: {
            duration_millis: 5000,
            variants: [
              { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/v.mp4' },
            ],
          },
        },
      ],
    }));
    const videos = model.blocks.filter((b) => b.kind === 'video');
    assert.equal(videos.length, 1, 'healed in place, no dead twin');
    assert.equal(videos[0].mp4Url, 'https://video.twimg.com/v.mp4');
    assert.match(videos[0].posterUrl, /ext_tw_video_thumb/);
    assert.equal(model.thread.mediaRecovered, 1);
  }
);

await checkAsync(
  'strict-gate modal Retry recovery proceeds when the repair clears all blockers',
  async () => {
    const model = {
      type: 'post',
      sourceUrl: 'https://x.com/a/status/1',
      blocks: [{ kind: 'image', url: 'https://pbs.twimg.com/media/x.jpg' }],
    };
    const assessment = engine.assessExportCompleteness(model);
    assert.equal(assessment.verdict, 'incomplete');
    const promise = engine.confirmShipDespiteIncomplete({
      model,
      assessment,
      onRetry: async () => ({ verdict: 'clean', blockers: [], counts: {} }),
    });
    const retry = document.querySelector('.xa-strict-gate .xa-strict-retry');
    assert.ok(retry, 'Retry recovery button rendered when onRetry is provided');
    retry.click();
    const proceed = await promise;
    assert.equal(proceed, true, 'clean retry resolves as proceed');
    assert.ok(!document.querySelector('.xa-strict-gate'), 'modal removed after clean retry');
  }
);

await checkAsync(
  'strict-gate modal retry updates the blocker list when items remain, cancel still works',
  async () => {
    const model = {
      type: 'post',
      sourceUrl: 'https://x.com/a/status/1',
      blocks: [
        { kind: 'image', url: 'https://pbs.twimg.com/media/x.jpg' },
        {
          kind: 'quote',
          author: { handle: '@deleted' },
          sourceUrl: 'https://x.com/deleted/status/7',
          blocks: [],
        },
      ],
    };
    const assessment = engine.assessExportCompleteness(model);
    assert.equal(assessment.blockers.length, 2);
    const stillIncomplete = {
      verdict: 'incomplete',
      blockers: [assessment.blockers[1]],
      counts: { quoteContentMissing: 1 },
    };
    const promise = engine.confirmShipDespiteIncomplete({
      model,
      assessment,
      onRetry: async () => stillIncomplete,
    });
    document.querySelector('.xa-strict-gate .xa-strict-retry').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const count = document.querySelector('.xa-strict-gate .xa-strict-count');
    assert.equal(count.textContent, '1', 'blocker count re-rendered after partial repair');
    const status = document.querySelector('.xa-strict-gate .xa-receipt-action-status');
    assert.match(status.textContent, /Still incomplete: 1 item/);
    document.querySelector('.xa-strict-gate .xa-modal-cancel').click();
    const proceed = await promise;
    assert.equal(proceed, false);
    assert.ok(!document.querySelector('.xa-strict-gate'));
  }
);

check('strict-gate modal omits the retry button without an onRetry handler', () => {
  const model = {
    type: 'post',
    sourceUrl: 'https://x.com/a/status/1',
    blocks: [{ kind: 'image', url: 'https://pbs.twimg.com/media/x.jpg' }],
  };
  const assessment = engine.assessExportCompleteness(model);
  const promise = engine.confirmShipDespiteIncomplete({ model, assessment });
  assert.ok(!document.querySelector('.xa-strict-gate .xa-strict-retry'));
  document.querySelector('.xa-strict-gate .xa-modal-cancel').click();
  return promise;
});

check('media rescue retries never-attempted avatars from repaired quote cards', () => {
  const model = {
    type: 'post',
    author: {
      handle: '@main',
      avatarUrl: 'https://pbs.twimg.com/a_normal.jpg',
      avatarFailed: true,
    },
    blocks: [
      {
        kind: 'quote',
        // Rebuilt AFTER inlineMedia ran: avatar never attempted, no avatarFailed flag.
        author: { handle: '@fresh', avatarUrl: 'https://pbs.twimg.com/b_normal.jpg' },
        sourceUrl: 'https://x.com/fresh/status/9',
        blocks: [{ kind: 'paragraph', html: 'q' }],
      },
    ],
  };
  const tasks = engine.collectMediaRescueTasks(model);
  const avatarTasks = tasks.filter((t) => t.kind === 'avatar');
  assert.equal(avatarTasks.length, 2, 'both the failed and the never-attempted avatar retried');
});

// ---------------------------------------------------------------------------
// Quoted-post tombstones: the quoted post is gone on X itself (banned/deleted).
// Captured as an honest note, never a strict-gate blocker.
// ---------------------------------------------------------------------------

check('quoted-post tombstone (banned/deleted account) is captured as an honest note', () => {
  const d = dom.window.document;
  const tweetEl = d.createElement('article');
  tweetEl.setAttribute('data-testid', 'tweet');
  tweetEl.innerHTML = [
    '<div data-testid="tweetText">Aurory off the shelf</div>',
    '<div data-testid="tombstone"><span>This Post is from an account that no longer exists. ',
    '<a href="https://help.x.com/rules-and-policies">Learn more</a></span></div>',
  ].join('');
  const { blocks } = engine.buildTweetBlocks(tweetEl);
  const tombstone = blocks.find((b) => b.kind === 'quote-tombstone');
  assert.ok(tombstone, 'tombstone captured as a block');
  assert.match(tombstone.notice, /account that no longer exists/);
  // Never a strict-gate blocker: nothing was capturable, X itself shows a dead box.
  const assessment = engine.assessExportCompleteness({ type: 'post', blocks });
  assert.equal(assessment.verdict, 'clean');
});

check('tombstone inside a real quote card belongs to the quote, not the outer post', () => {
  const d = dom.window.document;
  const tweetEl = d.createElement('article');
  tweetEl.setAttribute('data-testid', 'tweet');
  tweetEl.innerHTML = [
    '<div data-testid="tweetText">Outer text</div>',
    '<div role="link" tabindex="0">',
    '<div data-testid="User-Name">Quoted Author @quoted</div>',
    '<div data-testid="tweetText">Quoted text</div>',
    '<div data-testid="tombstone"><span>This Post is unavailable.</span></div>',
    '</div>',
  ].join('');
  const { blocks } = engine.buildTweetBlocks(tweetEl);
  assert.ok(
    !blocks.some((b) => b.kind === 'quote-tombstone'),
    'outer level must not claim the nested tombstone'
  );
  const quote = blocks.find((b) => b.kind === 'quote');
  assert.ok(quote, 'quote card still captured');
  assert.ok(
    quote.blocks.some((b) => b.kind === 'quote-tombstone'),
    'nested tombstone captured inside the quote'
  );
});

check('quote-tombstone renders honestly in HTML, Markdown, stats, and stays complete', () => {
  const model = {
    type: 'post',
    title: 'Tombstone post',
    heading: '',
    author: { name: 'Author', handle: '@author' },
    sourceUrl: 'https://x.com/author/status/1',
    exportedAt: new Date('2026-07-10T00:00:00Z').toISOString(),
    blocks: [
      { kind: 'paragraph', html: 'Post text pointing at a dead quote.' },
      {
        kind: 'quote-tombstone',
        notice: 'This Post is from an account that no longer exists.',
        sourceUrl: 'https://x.com/author/status/1',
      },
    ],
  };
  const html = engine.assembleHtml(model);
  assert.match(html, /Quoted post unavailable on X/);
  assert.match(html, /account that no longer exists/);
  assert.match(html, /data-xa-missing-type="quoted-post-tombstone"/);
  const md = engine.renderLlmMarkdown(model);
  assert.match(md, /ALREADY unavailable on X at capture time/);
  assert.match(md, /not a capture failure/);
  const stats = engine.archiveStats(model);
  assert.equal(stats.quoteTombstones, 1);
  assert.equal(stats.missingMedia, 0, 'tombstone must not count as missing media');
  assert.equal(stats.incompleteMedia, 0);
  assert.match(stats.warnings.join('\n'), /already unavailable on X at capture time/);
});

// ---------------------------------------------------------------------------
// Reply context, parallel media downloads, link-card thumbnails.
// ---------------------------------------------------------------------------

await checkAsync('runWithConcurrency caps in-flight work and processes every item', async () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  let inFlight = 0;
  let maxInFlight = 0;
  const seen = [];
  await engine.runWithConcurrency(items, 3, async (item) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    seen.push(item);
    inFlight -= 1;
  });
  assert.equal(seen.length, 10, 'every item processed exactly once');
  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    items
  );
  assert.ok(maxInFlight <= 3, `at most 3 in flight (saw ${maxInFlight})`);
  assert.ok(maxInFlight > 1, 'actually ran in parallel');
});

await checkAsync('inlineMedia fetches link-card thumbnails and marks failures softly', async () => {
  global.GM_xmlhttpRequest = (options) => {
    if (options.url.includes('card_img/good')) {
      const jpeg = new Uint8Array(32);
      jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
      options.onload({
        status: 200,
        response: jpeg.buffer,
        responseHeaders: 'content-type: image/jpeg\r\n',
      });
      return;
    }
    options.onload({ status: 404, response: null, responseHeaders: '' });
  };
  const model = {
    type: 'post',
    sourceUrl: 'https://x.com/a/status/1',
    author: {},
    blocks: [
      {
        kind: 'link-card',
        url: 'https://example.com/good',
        imageUrl: 'https://pbs.twimg.com/card_img/good.jpg',
      },
      {
        kind: 'link-card',
        url: 'https://example.com/bad',
        imageUrl: 'https://pbs.twimg.com/card_img/bad.jpg',
      },
      { kind: 'link-card', url: 'https://example.com/none' },
    ],
  };
  await engine.inlineMedia(model);
  delete global.GM_xmlhttpRequest;
  const [good, bad, none] = model.blocks;
  assert.ok(good.imageDataUri, 'thumbnail bytes inlined');
  assert.ok(!good.imageFailed);
  assert.ok(!bad.imageDataUri);
  assert.equal(bad.imageFailed, true, 'failure recorded on the block');
  assert.ok(!none.imageDataUri && !none.imageFailed, 'card without thumbnail untouched');
  // Decorative only: a failed thumbnail must never gate the export.
  assert.equal(engine.assessExportCompleteness(model).verdict, 'clean');
  assert.equal(engine.archiveStats(model).missingMedia, 0);
});

check('extractLinkCard captures the card preview image URL', () => {
  const d = dom.window.document;
  const wrap = d.createElement('div');
  wrap.innerHTML = `<div data-testid="card.wrapper"><a href="https://t.co/AbC123"><img src="https://pbs.twimg.com/card_img/123/photo?format=jpg"><span>headline</span><span>From example.com</span></a></div>`;
  const card = engine.extractLinkCard(wrap, [], 'https://x.com/a/status/1');
  assert.ok(card);
  assert.match(card.imageUrl, /card_img/);
});

check('link-card renders its thumbnail only when the bytes actually landed', () => {
  const withThumb = engine.renderBlock({
    kind: 'link-card',
    url: 'https://example.com/x',
    title: 'Headline',
    domain: 'example.com',
    imageUrl: 'https://pbs.twimg.com/card_img/1.jpg',
    imageDataUri: 'data:image/jpeg;base64,AA',
  });
  assert.match(withThumb, /xa-card-img/);
  assert.match(withThumb, /data:image\/jpeg;base64,AA/);
  const withoutThumb = engine.renderBlock({
    kind: 'link-card',
    url: 'https://example.com/x',
    title: 'Headline',
    domain: 'example.com',
    imageUrl: 'https://pbs.twimg.com/card_img/1.jpg',
    imageFailed: true,
  });
  assert.doesNotMatch(withoutThumb, /xa-card-img/, 'no placeholder for a failed thumbnail');
});

await checkAsync('reply context prepends the parent post as a labelled card', async () => {
  const model = {
    type: 'post',
    title: 'Reply post',
    author: { name: 'Replier', handle: '@replier' },
    sourceUrl: 'https://x.com/replier/status/200',
    exportedAt: new Date('2026-07-10T00:00:00Z').toISOString(),
    blocks: [{ kind: 'paragraph', html: 'This. 100%.' }],
  };
  const fetches = [];
  await engine.enrichReplyContextViaSyndication(model, null, async (id) => {
    fetches.push(id);
    if (id === '200') {
      return { __typename: 'Tweet', text: 'This. 100%.', in_reply_to_status_id_str: '100' };
    }
    if (id === '100') {
      return {
        __typename: 'Tweet',
        id_str: '100',
        text: 'The original claim being answered.',
        user: { name: 'Original', screen_name: 'original' },
      };
    }
    throw new Error('unexpected fetch ' + id);
  });
  assert.deepEqual(fetches, ['200', '100']);
  const card = model.blocks[0];
  assert.equal(card.kind, 'quote');
  assert.equal(card.replyContext, true);
  assert.equal(card.sourceUrl, 'https://x.com/original/status/100');
  const html = engine.assembleHtml(model);
  assert.match(html, /In reply to/);
  assert.match(html, /data-xa-reply-context="1"/);
  const md = engine.renderLlmMarkdown(model);
  assert.match(md, /Reply Context Post 1/);
  assert.match(md, /the post the exported post was replying to/);
  // Idempotent: a second pass must not stack a second card.
  await engine.enrichReplyContextViaSyndication(model, null, async () => {
    throw new Error('must not fetch again');
  });
  assert.equal(model.blocks.filter((b) => b.replyContext).length, 1);
});

await checkAsync('reply context is a no-op for a post that is not a reply', async () => {
  const model = {
    type: 'post',
    sourceUrl: 'https://x.com/a/status/1',
    blocks: [{ kind: 'paragraph', html: 'standalone' }],
  };
  await engine.enrichReplyContextViaSyndication(model, null, async () => ({
    __typename: 'Tweet',
    text: 'standalone',
  }));
  assert.equal(model.blocks.length, 1);
});

await checkAsync('reply context leaves an honest note when the parent is gone on X', async () => {
  const model = {
    type: 'post',
    sourceUrl: 'https://x.com/replier/status/200',
    blocks: [{ kind: 'paragraph', html: 'reply into the void' }],
  };
  await engine.enrichReplyContextViaSyndication(model, null, async (id) => {
    if (id === '200') {
      return {
        __typename: 'Tweet',
        text: 'reply into the void',
        in_reply_to_status_id_str: '100',
        in_reply_to_screen_name: 'suspended_user',
      };
    }
    const error = new Error('syndication: HTTP 404');
    error.status = 404;
    throw error;
  });
  const note = model.blocks[0];
  assert.equal(note.kind, 'quote-tombstone');
  assert.equal(note.replyContext, true);
  assert.match(note.notice, /@suspended_user/);
  // Never a blocker - the parent is gone on X itself.
  assert.equal(engine.assessExportCompleteness(model).verdict, 'clean');
});

await checkAsync('reply context skips a parent already captured in the thread', async () => {
  const model = {
    type: 'post',
    sourceUrl: 'https://x.com/a/status/200',
    blocks: [
      { kind: 'thread-marker', statusId: '100', sourceUrl: 'https://x.com/a/status/100' },
      { kind: 'paragraph', html: 'post one' },
      { kind: 'thread-marker', statusId: '200', sourceUrl: 'https://x.com/a/status/200' },
      { kind: 'paragraph', html: 'post two' },
    ],
    thread: { capturedPosts: 2 },
  };
  await engine.enrichReplyContextViaSyndication(model, null, async (id) => {
    assert.equal(id, '200', 'only the root fetch; parent is already captured');
    return { __typename: 'Tweet', text: 'post two', in_reply_to_status_id_str: '100' };
  });
  assert.ok(!model.blocks.some((b) => b.replyContext), 'no duplicate context card');
});

check('extension controller accepts the replyContext preference', () => {
  const changed = engine.extensionControllerMessage({
    type: 'sourcecapsule:controller',
    version: 1,
    action: 'set-preference',
    value: { key: 'replyContext', value: false },
  });
  assert.equal(changed.ok, true);
  assert.equal(changed.prefs.replyContext, false);
  engine.extensionControllerMessage({
    type: 'sourcecapsule:controller',
    version: 1,
    action: 'set-preference',
    value: { key: 'replyContext', value: true },
  });
});

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll DOM checks passed.');
void TWEET_TEXT;
