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

check('inlineHtmlFromTweetText captures nested-span text', () => {
  const el = dom.window.document.querySelectorAll('div[data-testid="tweetText"]')[1];
  const html = engine.inlineHtmlFromTweetText(el);
  assert.ok(html.includes('来美股主要做三个股票'), `got: ${JSON.stringify(html)}`);
  assert.ok(html.includes('对我们这些炒币的可能就够了'), `got: ${JSON.stringify(html)}`);
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
    assert.deepEqual(engine.postControlCaptureMode(focused, column), {
      isThread: true,
      includeThread: true,
      label: 'Save thread',
      title: 'Quick-save this full thread to your SourceCapsule library',
    });
    assert.deepEqual(engine.postControlCaptureMode(continuation, column), {
      isThread: false,
      includeThread: false,
      label: 'Save post',
      title: 'Quick-save only this post to your SourceCapsule library',
    });
  }
);

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

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll DOM checks passed.');
void TWEET_TEXT;
