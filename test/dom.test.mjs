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

check('inlineHtmlFromTweetText captures nested-span text', () => {
  const el = dom.window.document.querySelectorAll('div[data-testid="tweetText"]')[1];
  const html = engine.inlineHtmlFromTweetText(el);
  assert.ok(html.includes('来美股主要做三个股票'), `got: ${JSON.stringify(html)}`);
  assert.ok(html.includes('对我们这些炒币的可能就够了'), `got: ${JSON.stringify(html)}`);
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

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll DOM checks passed.');
void TWEET_TEXT;
