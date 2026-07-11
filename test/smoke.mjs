/**
 * Smoke test for the STABLE engine (no browser needed).
 *
 * It requires the userscript as a CommonJS module (the file exposes its DOM-free
 * render functions at the bottom under a `typeof module` guard) and asserts that
 * assembleHtml() turns a sample model into a valid, fully self-contained HTML
 * document. The fragile DOM-extraction layer can only be tested against live X,
 * but this guarantees the assembly/inlining contract never silently breaks.
 *
 * Run with: npm test
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const engine = require(join(here, '..', 'sourcecapsule.user.js'));

assert.ok(
  engine.EXPORT_TYPES.some(
    (item) => item.key === 'library-share' && item.label === 'Save locally + create AI link'
  ),
  'combined local-save and AI readable link action is available'
);
assert.ok(
  engine.THREAD_EXPORT_TYPES.some(
    (item) => item.key === 'library-thread' && item.label === 'Save full thread'
  ),
  'thread menu keeps full-thread capture explicit'
);
assert.ok(
  !engine.POST_EXPORT_TYPES.some((item) => item.key === 'library-thread'),
  'ordinary post menu does not offer full-thread capture'
);
assert.deepEqual(engine.postExportRequest('library-thread'), {
  exportType: 'library',
  includeThread: true,
});
assert.deepEqual(engine.postExportRequest('copy'), {
  exportType: 'copy',
  includeThread: false,
});

// A 1x1 transparent PNG, already base64-inlined — stands in for fetched media.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const sampleModel = {
  type: 'article',
  title: 'How we built a self-contained exporter - a "test" & demo',
  heading: 'How we built a self-contained exporter - a "test" & demo',
  author: {
    name: 'Ada Lovelace',
    handle: '@ada',
    avatarDataUri: PNG,
    avatarMime: 'image/png',
    avatarSize: 68,
    avatarSha256: 'sha256:avatar-hash',
  },
  sourceUrl: 'https://x.com/ada/article/12345',
  publishedAt: new Date('2026-06-24T09:30:00Z').toISOString(),
  exportedAt: new Date('2026-06-25T10:00:00Z').toISOString(),
  blocks: [
    // heading.text is an UNtrusted field -> renderBlock must escape it.
    { kind: 'heading', level: 2, text: 'Intro <script>alert(1)</script>' },
    // paragraph.html / list.items are TRUSTED: the extraction layer
    // (inlineHtmlFromTweetText) has already escaped text and whitelisted tags.
    {
      kind: 'paragraph',
      html: 'Plain text with a <a href="https://example.com">link</a> &amp; an ampersand.',
    },
    {
      kind: 'list',
      ordered: false,
      items: ['First item', 'Second item with <a href="https://example.org/path">link</a>'],
    },
    {
      kind: 'poll',
      question: 'Which archive format?',
      choices: [
        { label: 'HTML', percentage: '75%' },
        { label: 'Markdown', percentage: '25%' },
      ],
      totalVotes: '120',
      status: 'Poll closed',
      sourcePostId: '12345',
      sourceUrl: 'https://x.com/ada/status/12345',
      resultsUnavailable: false,
    },
    {
      kind: 'image',
      url: 'https://pbs.twimg.com/media/x.jpg',
      alt: 'Image',
      dataUri: PNG,
      width: 1200,
      height: 800,
      mime: 'image/png',
      size: 68,
      sha256: 'sha256:duplicate-media-hash',
      sourceUrl: 'https://x.com/ada/article/12345',
    },
    { kind: 'image', url: 'https://pbs.twimg.com/media/missing.jpg', alt: 'broken', failed: true },
    {
      kind: 'video',
      mode: 'poster',
      posterDataUri: PNG,
      posterMime: 'image/png',
      posterSize: 68,
      posterSha256: 'sha256:video-poster-hash',
      sourceUrl: 'https://x.com/ada/status/999',
    },
    {
      kind: 'video',
      mode: 'inline',
      dataUri: 'data:video/mp4;base64,AAAA',
      mime: 'video/mp4',
      size: 456,
      sha256: 'sha256:video-hash',
      posterDataUri: PNG,
      posterMime: 'image/png',
      posterSize: 68,
      posterSha256: 'sha256:inline-video-poster-hash',
      width: 438,
      height: 270,
      duration: 884.79,
      sourceUrl: 'https://x.com/ada/status/1000',
    },
    {
      kind: 'video',
      mode: 'poster',
      sourceUrl: 'https://x.com/ada/status/deleted-video',
    },
    {
      kind: 'video',
      mode: 'inline',
      dataUri: 'data:video/mp4;base64,BBBB',
      mime: 'video/mp4',
      size: 789,
      sha256: 'sha256:video-without-poster-hash',
      posterUrl: 'https://pbs.twimg.com/media/failed-poster.jpg',
      width: 640,
      height: 360,
      duration: 12.2,
      sourceUrl: 'https://x.com/ada/status/1001',
    },
    {
      kind: 'video',
      mode: 'poster',
      unsupported: true,
      unsupportedType: 'hls',
      sourceUrl: 'https://x.com/ada/status/1002',
    },
    { kind: 'paragraph', html: 'Timeline reference: &#21407;&#25512;' },
    {
      kind: 'quote',
      author: { name: 'Charles Babbage', handle: '@charles', avatarDataUri: PNG },
      sourceUrl: 'https://x.com/charles/status/42',
      publishedAt: new Date('2026-06-24T11:00:00Z').toISOString(),
      blocks: [
        {
          kind: 'paragraph',
          html: 'A quoted post with its own image. This preview keeps going until it ends in an obviously incomplete number 20',
        },
        {
          kind: 'image',
          url: 'https://pbs.twimg.com/media/q.jpg',
          alt: 'Image',
          dataUri: PNG,
          mime: 'image/png',
          size: 68,
          sha256: 'sha256:duplicate-media-hash',
          width: 640,
          height: 480,
        },
        {
          kind: 'quote',
          author: { name: 'Nested Source', handle: '@nested' },
          sourceUrl: 'https://x.com/nested/status/43',
          publishedAt: new Date('2026-06-24T11:05:00Z').toISOString(),
          blocks: [{ kind: 'paragraph', html: 'Nested quoted context.' }],
        },
      ],
    },
    {
      kind: 'quote',
      author: {},
      sourceUrl: 'https://x.com/private/status/7',
      blocks: [],
    },
    {
      kind: 'quote',
      author: {},
      sourceUrl: 'https://x.com/deleted/status/8',
      blocks: [],
    },
    {
      kind: 'list',
      ordered: true,
      items: [
        '2026-06-24 timeline after cards: <a href="https://x.com/charles/status/42">&#21407;&#25512;</a>',
        '2026-06-25 source-only timeline: <a href="https://x.com/ada/status/1234567890">&#21407;&#25512;</a>',
      ],
    },
  ],
};

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

console.log('SourceCapsule smoke test\n');

const html = engine.assembleHtml(sampleModel);
const debugJson = JSON.parse(
  html.match(/<script id="sourcecapsule-debug" type="application\/json">([\s\S]*?)<\/script>/)[1]
);
const markdown = engine.renderLlmMarkdown(sampleModel, '', {
  companionHtmlFilename: 'sample-export.html',
});
const markdownZipPair = engine.renderLlmMarkdown(sampleModel, '', {
  companionHtmlFilename: 'sample-export.html',
  companionArchiveFilename: 'sample-export.zip',
});
const markdownMdOnly = engine.renderLlmMarkdown(sampleModel);
const bundle = engine.collectBundleMediaFiles(sampleModel);
const markdownBundle = engine.renderLlmMarkdown(sampleModel, '', { mediaFiles: bundle.pathById });

check('produces a valid HTML5 document', () => {
  assert.ok(html.startsWith('<!doctype html>'), 'missing doctype');
  assert.ok(html.includes('<html lang="en">') && html.includes('</html>'));
});

check('polls render in HTML, Markdown, and the structured manifest', () => {
  assert.match(html, /class="xa-poll"/);
  assert.match(html, /Which archive format\?/);
  assert.match(markdown, /\*\*Poll: Which archive format\?\*\*/);
  assert.match(markdown, /- HTML - 75%/);
  assert.equal(debugJson.capture.polls, 1);
  assert.equal(debugJson.polls[0].sourcePostId, '12345');
  assert.equal(debugJson.polls[0].resultsUnavailable, false);
});

check('hosted attribution is explicit and never leaks into local archives', () => {
  const shared = engine.assembleHtml(sampleModel, '', { distribution: 'shared' });
  assert.doesNotMatch(html, /Install SourceCapsule/);
  assert.match(shared, /Captured with SourceCapsule/);
  assert.match(shared, /Preserve complete X threads for AI and offline reading\./);
  assert.match(shared, /href="https:\/\/github\.com\/wolfgang-aura\/SourceCapsule#installation"/);
});

check('embeds an inline <style> (no external stylesheet/font)', () => {
  assert.ok(html.includes('<style>'), 'no inline style block');
  assert.ok(!/<link[^>]+stylesheet/i.test(html), 'found external stylesheet link');
  assert.ok(!/@import/i.test(html), 'found @import');
});

check('is fully self-contained: no http(s) asset src= remain', () => {
  // hrefs to x.com are allowed (they are links, not loaded resources); srcs must be data:.
  const httpSrc = html.match(/src="https?:\/\/[^"]+"/g);
  assert.equal(httpSrc, null, `external src found: ${httpSrc}`);
  assert.ok(html.includes('src="data:image/png;base64,'), 'expected inlined data URIs');
});

check('renders title, author and source header', () => {
  assert.ok(html.includes('Ada Lovelace'));
  assert.ok(html.includes('@ada'));
  assert.ok(html.includes('https://x.com/ada/article/12345'));
});

check('article renders an <h1> heading from model.heading', () => {
  assert.ok(/<h1 class="xa-title">/.test(html), 'article should have an h1 title');
});

check('output is pure ASCII (no characters that an install can corrupt)', () => {
  // Symbols are emitted as HTML entities, so the generated document stays ASCII too.
  const nonAscii = [...html].filter((c) => c.charCodeAt(0) > 127);
  assert.equal(nonAscii.length, 0, `non-ASCII in output: ${nonAscii.join(' ')}`);
});

check('infers Chinese document language without article-specific rules', () => {
  const zhModel = {
    type: 'article',
    title: '\u4e2d\u6587\u957f\u6587',
    heading: '\u4e2d\u6587\u957f\u6587',
    author: {},
    sourceUrl: 'https://x.com/example/article/1',
    exportedAt: new Date('2026-06-26T00:00:00Z').toISOString(),
    blocks: [
      {
        kind: 'paragraph',
        html: '\u8fd9\u662f\u4e00\u6bb5\u4e2d\u6587\u5185\u5bb9\uff0c\u7528\u6765\u9a8c\u8bc1\u6587\u6863\u8bed\u8a00\u63a8\u65ad\u3002',
      },
    ],
  };
  assert.ok(engine.assembleHtml(zhModel).includes('<html lang="zh-CN">'));
});

check('includes structured provenance and capture manifest', () => {
  assert.equal(debugJson.schemaVersion, '1.0');
  assert.equal(debugJson.exporter.version, engine.VERSION);
  assert.equal(debugJson.capture.sourceUrl, sampleModel.sourceUrl);
  assert.equal(debugJson.capture.publishedAt, '2026-06-24T09:30:00.000Z');
  assert.equal(debugJson.capture.documentLang, 'en');
  assert.ok(debugJson.capture.images >= 2);
  assert.equal(debugJson.capture.videos, 5);
  assert.equal(debugJson.capture.videosPreservedOffline, 2);
  assert.equal(debugJson.capture.videoPostersCaptured, 2);
  assert.equal(debugJson.capture.incompleteMedia, 3);
  assert.equal(debugJson.capture.hashedMedia, 4);
  assert.equal(debugJson.capture.duplicateMedia, 1);
  assert.equal(debugJson.diagnostics.networkCapture.mode, 'not-installed');
  assert.equal(debugJson.diagnostics.networkCapture.bufferedCandidates, 0);
  assert.equal(debugJson.media.length, 8);
  assert.deepEqual(debugJson.duplicates[0].mediaIds, ['image-001', 'image-008']);
  assert.ok(html.includes('<details class="xa-capture">'));
  assert.ok(html.includes('<time datetime="2026-06-24T09:30:00.000Z">'));
  assert.ok(html.includes('<time datetime="2026-06-25T10:00:00.000Z">'));
  assert.ok(html.includes('Archive provenance'));
});

check('renders clean LLM Markdown from the archive model', () => {
  assert.ok(markdown.startsWith('# How we built a self-contained exporter'));
  assert.ok(markdown.includes(`Exporter: SourceCapsule v${engine.VERSION}`));
  assert.ok(markdown.includes('## Capture Summary'));
  assert.ok(markdown.includes('- Embedded posts: 4 total'));
  assert.ok(markdown.includes('  - Direct embedded posts: 3'));
  assert.ok(markdown.includes('  - Nested quoted posts: 1'));
  assert.ok(markdown.includes('- Videos found: 5'));
  assert.ok(markdown.includes('- Videos preserved offline: 2'));
  assert.ok(markdown.includes('- Video posters captured: 2'));
  assert.ok(markdown.includes('- Incomplete media: 3'));
  assert.ok(
    markdown.includes(
      'Video video-004 bytes are embedded in the companion file sample-export.html; this markdown holds only metadata (no video bytes, transcript, or visual description).'
    )
  );
  assert.ok(
    markdown.includes('Video video-003 was detected, but the video file was not preserved offline.')
  );
  assert.ok(markdown.includes('## Main Article'));
  assert.ok(
    markdown.includes('Timeline reference: Embedded Post 1 - https://x.com/charles/status/42')
  );
  assert.ok(
    markdown.includes(
      '2026-06-24 timeline after cards: Embedded Post 1 - https://x.com/charles/status/42'
    )
  );
  assert.ok(
    markdown.includes(
      '2026-06-25 source-only timeline: Source link - https://x.com/ada/status/1234567890'
    )
  );
  assert.ok(markdown.includes('[Embedded Post 1 appears here. Full text below.]'));
  assert.ok(markdown.includes('### Embedded Post 1'));
  assert.ok(markdown.includes('Text status: possibly truncated'));
  assert.ok(markdown.includes('#### Nested Quoted Post 1.1'));
  assert.ok(markdown.includes('## Duplicate Media'));
  assert.ok(
    markdown.includes('image-001 and image-008 share SHA-256: sha256:duplicate-media-hash')
  );
  assert.ok(markdown.includes('## Media References'));
  assert.ok(markdown.includes('### Image image-001'));
  assert.ok(markdown.includes('### Video video-004'));
  assert.ok(markdown.includes('- Transcript: unavailable'));
  assert.ok(markdown.includes('- Keyframe description: unavailable'));
  assert.ok(markdown.includes('## Missing / Incomplete Content'));
  assert.ok(
    markdown.includes(
      'video-003: video file not preserved offline; poster captured; source link preserved.'
    )
  );
  assert.ok(markdown.includes('quoted-post: 7'));
  assert.ok(markdown.includes('## Source Links'));
  assert.ok(markdown.includes('https://example.com'));
});

check('Markdown labels normal posts, threads, and Articles correctly', () => {
  const base = {
    title: 'Heading contract',
    author: { name: 'A', handle: '@a' },
    sourceUrl: 'https://x.com/a/status/1',
    exportedAt: '2026-07-06T00:00:00Z',
    blocks: [{ kind: 'paragraph', html: 'Body' }],
  };
  assert.match(engine.renderLlmMarkdown({ ...base, type: 'post' }), /## Main Post/);
  assert.doesNotMatch(engine.renderLlmMarkdown({ ...base, type: 'post' }), /## Main Article/);
  assert.match(engine.renderLlmMarkdown({ ...base, type: 'article' }), /## Main Article/);
  assert.match(
    engine.renderLlmMarkdown({
      ...base,
      type: 'post',
      thread: { capturedPosts: 2, completeness: 'best-effort' },
    }),
    /## Full Thread/
  );
});

check('embedded posts without a recoverable permalink are explicitly incomplete', () => {
  const model = {
    type: 'post',
    title: 'Missing embedded source',
    author: { name: 'A', handle: '@a' },
    sourceUrl: 'https://x.com/a/status/1',
    exportedAt: '2026-07-06T00:00:00Z',
    blocks: [
      { kind: 'paragraph', html: 'Body' },
      {
        kind: 'quote',
        author: { name: 'Context', handle: '@context' },
        sourceUrl: '',
        blocks: [{ kind: 'paragraph', html: 'Context body' }],
      },
    ],
  };
  const md = engine.renderLlmMarkdown(model);
  const html = engine.assembleHtml(model);
  // A quote without a permalink still gets a working link (author profile), not a
  // dead "Source URL unavailable" notice. The markdown records both the missing
  // permalink AND the fallback profile so the LLM/reader knows what happened.
  assert.match(
    md,
    /URL: unavailable \(exact permalink not exposed\); Author profile: https:\/\/x\.com\/context/
  );
  assert.match(md, /author profile \(https:\/\/x\.com\/context\) is linked instead/i);
  assert.doesNotMatch(html, /xa-quote-source-missing/);
  assert.doesNotMatch(html, /Source URL unavailable/);
  assert.match(
    html,
    /<a class="xa-quote-link" href="https:\/\/x\.com\/context"[^>]*>View @context on X/
  );
  assert.match(html, /data-xa-source-fallback="author-profile"/);
});

check('quote without any recoverable handle still renders cleanly (no dead notice)', () => {
  const model = {
    type: 'post',
    title: 'Anonymous quote',
    author: { name: 'A', handle: '@a' },
    sourceUrl: 'https://x.com/a/status/1',
    exportedAt: '2026-07-06T00:00:00Z',
    blocks: [
      { kind: 'paragraph', html: 'Body' },
      {
        kind: 'quote',
        author: { name: 'Unknown', handle: '' },
        sourceUrl: '',
        blocks: [{ kind: 'paragraph', html: 'Anonymous body' }],
      },
    ],
  };
  const html = engine.assembleHtml(model);
  assert.doesNotMatch(html, /Source URL unavailable/);
  assert.doesNotMatch(html, /xa-quote-source-missing/);
});

check('llm.md is honest about what it does and does not contain', () => {
  // The reader (an agent/LLM) must know up front that this file is text + metadata only.
  assert.ok(markdown.includes('## What This File Is'));
  assert.ok(
    markdown.includes(
      'This file does NOT contain the media itself: no image pixels, no video or audio bytes, no transcripts, and no visual descriptions.'
    )
  );
  // "both" export: the companion is named with the real filename, never the fictional archive.html.
  assert.ok(
    markdown.includes(
      'The media bytes are embedded (base64) inside the companion file sample-export.html, downloaded alongside this markdown.'
    )
  );
  assert.ok(!markdown.includes('archive.html'), 'must not reference a nonexistent archive.html');
  assert.ok(
    markdownZipPair.includes('packaged together with this markdown inside sample-export.zip')
  );
  assert.ok(!markdownZipPair.includes('downloaded alongside this markdown'));
  assert.ok(
    markdown.includes(
      'Bytes location: embedded in companion file sample-export.html (not in this markdown)'
    )
  );
  assert.ok(
    markdown.includes(
      'Pixels location: embedded in companion file sample-export.html (not in this markdown)'
    )
  );

  // Markdown-only export: there is no companion on disk, so the file must not claim one.
  assert.ok(!markdownMdOnly.includes('archive.html'));
  assert.ok(!markdownMdOnly.includes('companion file'));
  assert.ok(
    markdownMdOnly.includes(
      'This was a Markdown-only export, so the media bytes were not saved to any file.'
    )
  );
  assert.ok(
    markdownMdOnly.includes(
      'Video video-004 bytes were captured but not saved in this Markdown-only export; only metadata is available here (no playable file, transcript, or visual description).'
    )
  );
  assert.ok(
    markdownMdOnly.includes(
      'Bytes location: captured but not saved (Markdown-only export); metadata only'
    )
  );
});

check('store-only ZIP writer produces a structurally valid archive', () => {
  // CRC32("hello") is a well-known constant; locks the implementation.
  assert.equal(engine.crc32(new TextEncoder().encode('hello')), 0x3610a686);
  const zip = engine.buildZip([
    { name: 'a.txt', bytes: new TextEncoder().encode('hi') },
    { name: 'media/b.bin', bytes: new Uint8Array([1, 2, 3]) },
  ]);
  assert.ok(zip instanceof Uint8Array && zip.length > 0);
  // Local file header signature PK\x03\x04 at the start.
  assert.deepEqual(Array.from(zip.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  // End-of-central-directory signature PK\x05\x06 at the end.
  assert.deepEqual(Array.from(zip.slice(-22, -18)), [0x50, 0x4b, 0x05, 0x06]);
  const text = new TextDecoder('latin1').decode(zip);
  assert.ok(text.includes('a.txt') && text.includes('media/b.bin'));
});

check(
  'collectBundleMediaFiles yields image + poster files, skips missing, excludes video bytes',
  () => {
    const ids = bundle.files.map((f) => f.name).sort();
    assert.deepEqual(ids, [
      'media/image-001.png',
      'media/image-008.png',
      'media/video-003.poster.png',
      'media/video-004.poster.png',
    ]);
    bundle.files.forEach((f) => assert.ok(f.bytes instanceof Uint8Array && f.bytes.length > 0));
    // Missing image (image-002) is skipped; videos contribute posters only (no raw .mp4 bytes).
    assert.ok(!bundle.pathById.has('image-002'));
    assert.equal(bundle.pathById.get('video-004'), 'media/video-004.poster.png');
    assert.ok(!bundle.files.some((f) => f.name.endsWith('.mp4')));
  }
);

check('bundlePaths honors the date vs flat layout preference', () => {
  const byDate = engine.bundlePaths(sampleModel, { layout: 'date' }, '2026-06-28');
  assert.deepEqual(byDate.segments, ['2026-06-28', 'ada-12345']);
  assert.equal(byDate.postFolder, 'ada-12345');
  const flat = engine.bundlePaths(sampleModel, { layout: 'flat' }, '2026-06-28');
  assert.deepEqual(flat.segments, ['2026-06-28_ada-12345']);
});

check('AI readable link is packed into library HTML, Markdown, and AI_LINK.txt', () => {
  const linked = structuredClone(sampleModel);
  const paths = engine.bundlePaths(linked, { layout: 'date' }, '2026-07-09');
  const share = {
    viewUrl: 'https://sourcecapsule-share.example/c/abc',
    markdownUrl: 'https://sourcecapsule-share.example/c/abc.md',
    createdAt: '2026-07-09T01:00:00.000Z',
    expiresAt: '2026-07-16T01:00:00.000Z',
  };
  const { entries, markdown } = engine.buildLibraryEntries(
    linked,
    '',
    { contents: 'full' },
    paths,
    share
  );
  const htmlEntry = entries.find((entry) => entry.name.endsWith('.html'));
  const mdEntry = entries.find((entry) => entry.name.endsWith('.llm.md'));
  const linkEntry = entries.find((entry) => entry.name === 'AI_LINK.txt');
  assert.ok(htmlEntry, 'HTML entry should be present');
  assert.ok(mdEntry, 'Markdown entry should be present');
  assert.ok(linkEntry, 'AI_LINK.txt should be packed into the library bundle');
  assert.match(htmlEntry.text, /class="xa-ai-link"/);
  assert.match(htmlEntry.text, /AI readable link/);
  assert.match(htmlEntry.text, /https:\/\/sourcecapsule-share\.example\/c\/abc/);
  assert.match(mdEntry.text, /AI readable link: https:\/\/sourcecapsule-share\.example\/c\/abc/);
  assert.match(
    markdown,
    /AI readable Markdown link: https:\/\/sourcecapsule-share\.example\/c\/abc\.md/
  );
  assert.match(linkEntry.text, /Markdown link: https:\/\/sourcecapsule-share\.example\/c\/abc\.md/);
});

check('capture metadata normalizes tags and appears in the local library index', () => {
  const modelWithContext = structuredClone(sampleModel);
  engine.applyCaptureMetadata(modelWithContext, {
    note: 'Compare this with our Malaysia pricing research',
    tags: ' FinTech, #Malaysia, fintech, pricing strategy ',
  });
  assert.equal(modelWithContext.userNote, 'Compare this with our Malaysia pricing research');
  assert.deepEqual(modelWithContext.tags, ['FinTech', 'Malaysia', 'pricing-strategy']);
  const paths = engine.bundlePaths(modelWithContext, { layout: 'date' }, '2026-07-02');
  const entry = engine.libraryIndexEntry(modelWithContext, paths, {
    images: 2,
    videos: 1,
    incompleteMedia: 1,
    missingMedia: 0,
  });
  const first = engine.updateLibraryIndexText('', entry);
  assert.ok(first.includes('# SourceCapsule Library Index'));
  assert.ok(first.includes('Saved because: Compare this with our Malaysia pricing research'));
  assert.ok(first.includes('Tags: FinTech, Malaysia, pricing-strategy'));
  const updated = engine.updateLibraryIndexText(first, { ...entry, note: 'Updated reason' });
  assert.equal((updated.match(/<!-- sourcecapsule:item:/g) || []).length, 1);
  assert.ok(updated.includes('Saved because: Updated reason'));
});

check('capture note, tags, and thread metadata render in HTML, Markdown, and manifest', () => {
  const contextual = structuredClone(sampleModel);
  contextual.type = 'post';
  contextual.thread = {
    capturedPosts: 2,
    sourcePostIds: ['12345', '12346'],
    completeness: 'best-effort',
  };
  contextual.userNote = 'Use this in the launch memo';
  contextual.tags = ['launch', 'research'];
  contextual.blocks.unshift({
    kind: 'thread-marker',
    index: 1,
    total: 2,
    sourceUrl: contextual.sourceUrl,
    publishedAt: contextual.publishedAt,
  });
  const html = engine.assembleHtml(contextual);
  const md = engine.renderLlmMarkdown(contextual);
  const manifest = JSON.parse(engine.renderArchiveManifestJson(contextual));
  assert.ok(html.includes('X Thread'));
  assert.ok(html.includes('Saved because'));
  assert.ok(md.includes('## Full Thread'));
  assert.ok(md.includes('Saved because: Use this in the launch memo'));
  assert.equal(manifest.capture.threadPosts, 2);
  assert.deepEqual(manifest.capture.tags, ['launch', 'research']);
});

check('bundle markdown references real media/ files and excludes full video', () => {
  assert.ok(markdownBundle.includes('media/image-001.png'));
  assert.ok(markdownBundle.includes('![') && markdownBundle.includes('](media/'));
  assert.ok(markdownBundle.includes('![Poster of video-004](media/video-004.poster.png)'));
  assert.ok(
    markdownBundle.includes(
      'The images and video poster frames are included as separate files in the media/ folder'
    )
  );
  assert.ok(markdownBundle.includes('File: media/image-001.png'));
  assert.ok(markdownBundle.includes('Poster frame: media/video-004.poster.png'));
  assert.ok(
    markdownBundle.includes(
      'Full video: not included in this bundle (an LLM cannot watch video); see source link'
    )
  );
  assert.ok(!markdownBundle.includes('archive.html'));
});

check('handleFromSourceUrl derives @handle from post/article URLs, skips reserved paths', () => {
  assert.equal(
    engine.handleFromSourceUrl('https://x.com/dingyi/status/2070029723673981185'),
    '@dingyi'
  );
  assert.equal(
    engine.handleFromSourceUrl('https://twitter.com/Ada_Lovelace/article/55'),
    '@Ada_Lovelace'
  );
  assert.equal(engine.handleFromSourceUrl('https://x.com/i/article/123'), ''); // reserved /i/
  assert.equal(engine.handleFromSourceUrl('https://x.com/home'), '');
  assert.equal(engine.handleFromSourceUrl(''), '');
});

check('llm.md falls back to the URL @handle when author metadata is missing', () => {
  const md = engine.renderLlmMarkdown({
    type: 'article',
    title: 'No author here',
    sourceUrl: 'https://x.com/dingyi/status/2070029723673981185',
    exportedAt: new Date('2026-06-28T08:25:15Z').toISOString(),
    blocks: [{ kind: 'paragraph', html: 'Body text.' }],
  });
  assert.ok(
    md.includes('Author: @dingyi (handle derived from the source URL; display name not captured)')
  );
});

check('self-numbered list items are not double-numbered (no "1. 2.")', () => {
  const model = {
    type: 'article',
    title: 'List numbering',
    sourceUrl: 'https://x.com/ada/article/9',
    exportedAt: new Date('2026-06-28T00:00:00Z').toISOString(),
    blocks: [
      // X split a manually-numbered list around an embedded post: a single-item ordered list
      // whose text already carries the author's "2.", here wrapped in <strong>.
      { kind: 'list', ordered: true, items: ['<strong>2. Optimus</strong> details'] },
      // A genuine ordered list with no author numbering must still auto-number.
      { kind: 'list', ordered: true, items: ['apple', 'banana'] },
    ],
  };
  const md = engine.renderLlmMarkdown(model);
  assert.ok(md.includes('2. Optimus details'));
  assert.ok(!md.includes('1. 2. Optimus'), 'must not double-number the author item');
  assert.ok(md.includes('1. apple') && md.includes('2. banana'), 'plain list still auto-numbers');

  const html = engine.assembleHtml(model);
  assert.ok(
    html.includes('<ol style="list-style:none;padding-inline-start:0"><li><strong>2. Optimus'),
    'self-numbered <ol> suppresses its marker'
  );
  assert.ok(html.includes('<ol><li>apple</li><li>banana</li></ol>'), 'plain <ol> unchanged');
});

check('timeline source references resolve to the correct embedded post (no mis-mapping)', () => {
  // Two embedded posts + timeline references to each, plus a reference to a non-embedded
  // URL. This locks the resolver: each href must map to its OWN post number, never another,
  // and an unknown URL must fall back to "Source link" rather than be mislabelled as a post.
  const ZH = '&#21407;&#25512;'; // 原推 ("original post")
  const md = engine.renderLlmMarkdown({
    type: 'article',
    title: 'Timeline mapping fixture',
    heading: 'Timeline mapping fixture',
    author: { name: 'Ada', handle: '@ada' },
    sourceUrl: 'https://x.com/ada/article/timeline',
    exportedAt: new Date('2026-06-25T10:00:00Z').toISOString(),
    blocks: [
      {
        kind: 'quote',
        author: { name: 'Alice', handle: '@alice' },
        sourceUrl: 'https://x.com/alice/status/11',
        blocks: [{ kind: 'paragraph', html: 'first embedded post' }],
      },
      {
        kind: 'quote',
        author: { name: 'Bob', handle: '@bob' },
        sourceUrl: 'https://x.com/bob/status/22',
        blocks: [{ kind: 'paragraph', html: 'second embedded post' }],
      },
      {
        kind: 'list',
        ordered: true,
        items: [
          `ref to first: <a href="https://x.com/alice/status/11">${ZH}</a>`,
          `ref to second: <a href="https://x.com/bob/status/22">${ZH}</a>`,
          `ref to non-embedded: <a href="https://x.com/carol/status/99">${ZH}</a>`,
        ],
      },
    ],
  });
  // Correct mapping: each url resolves to its own post.
  assert.ok(md.includes('Embedded Post 1 - https://x.com/alice/status/11'), 'alice -> Post 1');
  assert.ok(md.includes('Embedded Post 2 - https://x.com/bob/status/22'), 'bob -> Post 2');
  // Unknown url falls back to a source link, never an embedded post.
  assert.ok(md.includes('Source link - https://x.com/carol/status/99'), 'carol -> Source link');
  // No mis-mapping: a url must never be tagged with another post's number.
  assert.ok(!md.includes('Embedded Post 2 - https://x.com/alice/status/11'), 'alice not Post 2');
  assert.ok(!md.includes('Embedded Post 1 - https://x.com/bob/status/22'), 'bob not Post 1');
  assert.ok(
    !/Embedded Post \d+ - https:\/\/x\.com\/carol\/status\/99/.test(md),
    'carol must not be an Embedded Post'
  );
});

check('LLM Markdown flags obvious embedded-post preview truncation shapes', () => {
  const truncationMarkdown = engine.renderLlmMarkdown({
    type: 'article',
    title: 'Truncation fixture',
    heading: 'Truncation fixture',
    author: { name: 'Ada', handle: '@ada' },
    sourceUrl: 'https://x.com/ada/article/truncation',
    exportedAt: new Date('2026-06-25T10:00:00Z').toISOString(),
    blocks: [
      {
        kind: 'quote',
        sourceUrl: 'https://x.com/ada/status/12',
        blocks: [
          {
            kind: 'paragraph',
            html: 'NOK certainty is high because the company is expanding indium phosphide capacity and recent supply-chain notes say the first buildout lands in 20',
          },
        ],
      },
      {
        kind: 'quote',
        sourceUrl: 'https://x.com/ada/status/15',
        blocks: [
          {
            kind: 'paragraph',
            html: 'The storage rally was violent because several buyers reacted to three connected things. 1. Anthropic will connect to a very large compute resource and cloud vendors want to fund supply expansion. 2. Anthropic',
          },
        ],
      },
    ],
  });
  assert.ok(truncationMarkdown.includes('Embedded Post 1 text may be truncated'));
  assert.ok(truncationMarkdown.includes('Embedded Post 2 text may be truncated'));
  assert.equal((truncationMarkdown.match(/Text status: possibly truncated/g) || []).length, 2);
});

check('LLM Markdown contains no embedded assets, CSS, or executable HTML', () => {
  assert.ok(!markdown.includes('base64,'), 'markdown should not contain base64 payloads');
  assert.ok(!/<style/i.test(markdown), 'markdown should not contain CSS style tags');
  assert.ok(!/<script/i.test(markdown), 'markdown should not contain script tags');
  assert.ok(!/data:image/i.test(markdown), 'markdown should not contain data image URLs');
  assert.ok(!/data:video/i.test(markdown), 'markdown should not contain data video URLs');
});

check('normalizes every external link with target and rel safety', () => {
  const unsafeExternalLinks = html.match(
    /<a\b(?=[^>]*href="https?:\/\/)(?!(?=[^>]*target="_blank")(?=[^>]*rel="[^"]*\bnoopener\b[^"]*\bnoreferrer\b))[^>]*>/g
  );
  assert.equal(unsafeExternalLinks, null, `unsafe external links: ${unsafeExternalLinks}`);
  assert.ok(html.includes('href="https://example.com" target="_blank" rel="noopener noreferrer"'));
  assert.ok(
    html.includes('href="https://example.org/path" target="_blank" rel="noopener noreferrer"')
  );
});

check('post puts tweet text in the body, not in a giant <h1>', () => {
  const postModel = {
    type: 'post',
    title: 'Vega Hao (@Vegahao) on X',
    heading: '', // posts intentionally omit the big heading
    author: { name: 'Vega Hao', handle: '@Vegahao', avatarDataUri: PNG },
    sourceUrl: 'https://x.com/Vegahao/status/123',
    exportedAt: new Date('2026-06-26T00:00:00Z').toISOString(),
    blocks: [{ kind: 'paragraph', html: 'the actual tweet text goes here' }],
  };
  const postHtml = engine.assembleHtml(postModel);
  assert.ok(!/<h1 class="xa-title">/.test(postHtml), 'post should NOT render a big h1');
  assert.ok(
    /<article class="xa-body">[\s\S]*the actual tweet text goes here/.test(postHtml),
    'tweet text must appear in the body'
  );
  assert.ok(postHtml.includes('<title>Vega Hao (@Vegahao) on X</title>'), 'clean tab title');
});

check('renders obvious Chinese heading paragraphs as headings as a safety net', () => {
  const chapterOne =
    '\u7b2c\u4e00\u7ae0\uff1aCodex \u684c\u9762\u7aef\u5230\u5e95\u662f\u4ec0\u4e48';
  const enumerated =
    '\u4e00\u3001\u5ddd\u6c90\u7684\u4e3b\u7ebf\u662f\u600e\u4e48\u8fc1\u79fb\u7684\uff1f';
  const fallbackModel = {
    type: 'article',
    title: 'Heading fallback',
    heading: '',
    author: {},
    sourceUrl: 'https://x.com/example/status/1',
    exportedAt: new Date('2026-06-26T00:00:00Z').toISOString(),
    blocks: [
      { kind: 'paragraph', html: chapterOne },
      { kind: 'paragraph', html: enumerated },
    ],
  };
  const fallbackHtml = engine.assembleHtml(fallbackModel);
  assert.ok(fallbackHtml.includes(`<h2>${chapterOne}</h2>`));
  assert.ok(fallbackHtml.includes(`<h2>${enumerated}</h2>`));
});

check('renders encoding-safe Chinese headings, rich headings, and short dividers', () => {
  const chapterOne =
    '\u7b2c\u4e00\u7ae0\uff1a Codex \u684c\u9762\u7aef\u5230\u5e95\u662f\u4ec0\u4e48';
  const chapterFour = '\u7b2c\u56db\u7ae0\uff1a \u628a Codex \u7528\u5f97\u66f4\u987a\u624b';
  const laterChapters = [
    '\u7b2c\u4e8c\u7ae0\uff1a\u5b89\u88c5\u4e0e\u4e0a\u624b',
    '\u7b2c\u4e03\u7ae0\uff1a\u51fa\u95e8\u5728\u5916\uff0c\u624b\u673a\u8fdc\u7a0b\u63a7\u5236',
    '\u7b2c\u516b\u7ae0\uff1a\u8fdb\u9636\u73a9\u6cd5\u548c\u9690\u85cf\u529f\u80fd',
  ];
  const enumerated =
    '\u4e00\u3001\u5ddd\u6c90\u7684\u4e3b\u7ebf\u662f\u600e\u4e48\u8fc1\u79fb\u7684\uff1f';
  const numeric = '1.4 \u4e3a\u4ec0\u4e48\u8981\u7528\u684c\u9762\u7aef';
  const robustModel = {
    type: 'article',
    title: 'Robust heading fallback',
    heading: '',
    author: {},
    sourceUrl: 'https://x.com/example/status/1',
    exportedAt: new Date('2026-06-26T00:00:00Z').toISOString(),
    blocks: [
      { kind: 'paragraph', html: chapterOne },
      { kind: 'paragraph', html: `<strong>${chapterFour}</strong>` },
      ...laterChapters.map((text) => ({ kind: 'paragraph', html: text })),
      { kind: 'paragraph', html: enumerated },
      { kind: 'paragraph', html: numeric },
      { kind: 'paragraph', html: '\u2014\u2014' },
    ],
  };
  const robustHtml = engine.assembleHtml(robustModel);
  assert.ok(robustHtml.includes(`<h2>${chapterOne}</h2>`));
  assert.ok(robustHtml.includes(`<h2>${chapterFour}</h2>`));
  laterChapters.forEach((text) => assert.ok(robustHtml.includes(`<h2>${text}</h2>`)));
  assert.ok(robustHtml.includes(`<h2>${enumerated}</h2>`));
  assert.ok(robustHtml.includes(`<h3>${numeric}</h3>`));
  assert.ok(robustHtml.includes('<hr class="xa-divider">'));
});

check('does not promote ambiguous short Chinese text without visual structure', () => {
  const shortQuestion = '\u600e\u4e48\u9009';
  const cautiousHtml = engine.assembleHtml({
    type: 'article',
    title: 'Cautious short line',
    heading: '',
    author: {},
    sourceUrl: 'https://x.com/example/status/1',
    exportedAt: new Date('2026-06-26T00:00:00Z').toISOString(),
    blocks: [{ kind: 'paragraph', html: shortQuestion }],
  });
  assert.ok(cautiousHtml.includes(`<p>${shortQuestion}</p>`));
  assert.ok(!cautiousHtml.includes(`<h3>${shortQuestion}</h3>`));
});

check('does not promote version-like article sentences as headings', () => {
  const versionSentence =
    '2.1 Pro \u5728\u8fd9\u65b9\u9762\u8fdb\u6b65\u5f88\u5927\u3002\u5e03\u5c40\u3001\u989c\u8272\u3001\u95f4\u8ddd\u3001\u52a8\u6548\uff0c\u5b83\u4e0d\u53ea\u662f\u62fc\u51fa\u6765\uff0c\u662f\u5728\u300c\u505a\u300d\u3002';
  const introSentence = '\u6240\u4ee5\u6211\u5bf9 2.1 Pro \u7684\u5224\u65ad\u662f\uff1a';
  const cautiousHtml = engine.assembleHtml({
    type: 'article',
    title: 'Version-like sentence',
    heading: '',
    author: {},
    sourceUrl: 'https://x.com/example/status/1',
    exportedAt: new Date('2026-06-26T00:00:00Z').toISOString(),
    blocks: [
      { kind: 'paragraph', html: versionSentence },
      { kind: 'paragraph', html: introSentence },
    ],
  });
  assert.ok(cautiousHtml.includes(`<p>${versionSentence}</p>`));
  assert.ok(cautiousHtml.includes(`<p>${introSentence}</p>`));
  assert.ok(!cautiousHtml.includes(`<h3>${versionSentence}</h3>`));
  assert.ok(!cautiousHtml.includes(`<h3>${introSentence}</h3>`));
});

check('rebuilds the quoted post as a styled card (not a screenshot)', () => {
  assert.ok(html.includes('class="xa-tweet-card xa-quote"'));
  assert.ok(html.includes('Charles Babbage'));
  assert.ok(html.includes('A quoted post with its own image.'));
  assert.ok(html.includes('class="xa-missing xa-quote-missing"'));
});

check('renders adjacent images as a zoomable gallery (no data: links)', () => {
  assert.ok(html.includes('xa-gallery-wrap xa-gallery-count-2'));
  assert.ok(html.includes('<div class="xa-image-link"><img class="xa-zoomable"'));
  // Chrome blocks navigating to data: URLs, so images must NOT be <a href="data:">.
  assert.ok(!/href="data:/.test(html), 'images must not link to data: URLs');
  assert.ok(html.includes('id="xa-lightbox"'), 'click-to-zoom lightbox must be present');
  assert.ok(html.includes('role="dialog"'), 'lightbox should be an accessible dialog');
  assert.ok(html.includes('data-xa-media-id="image-001"'), 'images should get stable ids');
  assert.ok(html.includes('data-xa-sha256="sha256:duplicate-media-hash"'));
  assert.ok(html.includes('data-xa-mime="image/png"'));
  assert.ok(html.includes('data-xa-size="68"'));
  assert.ok(html.includes('width="1200"'), 'known image width should be preserved');
  assert.ok(html.includes('decoding="async"'), 'images should decode asynchronously');
  assert.ok(!html.includes('<figcaption>A diagram</figcaption>'));
  assert.ok(!html.includes('alt="Image"'), 'generic image alt text should be replaced');
  assert.ok(
    html.includes('alt="Image attached to main X article by @ada, archive media image-001"'),
    'main image fallback alt should be contextual'
  );
  assert.ok(
    html.includes('alt="Image attached to quoted X post by @charles"'),
    'quoted image fallback alt should be contextual'
  );
});

check('shows poster + Watch-on-X fallback for non-inlined video', () => {
  assert.ok(html.includes('Watch video on X'));
  assert.ok(html.includes('https://x.com/ada/status/999'));
  assert.ok(html.includes('data-xa-sha256="sha256:video-poster-hash"'));
  assert.ok(html.includes('video file not preserved offline; poster/source link fallback'));
});

check('renders inline video duration and records actual video metadata', () => {
  assert.ok(html.includes('Embedded video &middot; 14:45 &middot; preserved offline'));
  assert.ok(html.includes('data-xa-media-id="video-004"'));
  assert.ok(html.includes('data-xa-width="438"'));
  assert.ok(html.includes('data-xa-height="270"'));
  assert.ok(html.includes('data-xa-duration="884.79"'));
  const videoRecord = debugJson.media.find((item) => item.sha256 === 'sha256:video-hash');
  assert.ok(videoRecord, 'inline video record missing');
  assert.equal(videoRecord.type, 'video');
  assert.equal(videoRecord.mime, 'video/mp4');
  assert.equal(videoRecord.width, 438);
  assert.equal(videoRecord.height, 270);
  assert.equal(videoRecord.durationSeconds, 884.79);
  assert.equal(videoRecord.posterCaptured, true);
  assert.equal(videoRecord.mode, 'offline-video');
  assert.equal(videoRecord.status, 'preserved offline');
  assert.equal(videoRecord.offlinePlayable, true);
  assert.equal(videoRecord.videoFileMime, 'video/mp4');
  assert.equal(videoRecord.videoFileSize, 456);
  assert.equal(videoRecord.videoFileSha256, 'sha256:video-hash');
  assert.equal(videoRecord.sourcePostId, '1000');
  const posterRecord = debugJson.media.find((item) => item.sourcePostId === '999');
  assert.equal(posterRecord.sha256, '', 'poster fallback should not be reported as video hash');
  assert.equal(posterRecord.posterCaptured, true);
  assert.equal(posterRecord.status, 'not preserved offline');
  assert.equal(posterRecord.mode, 'poster-only');
  assert.equal(posterRecord.offlinePlayable, false);
  assert.equal(posterRecord.failureReason, 'video_url_discovery_failed');
  const failedPosterRecord = debugJson.media.find(
    (item) => item.sha256 === 'sha256:video-without-poster-hash'
  );
  assert.equal(failedPosterRecord.posterCaptured, false);
  assert.equal(failedPosterRecord.width, 640);
  assert.equal(failedPosterRecord.height, 360);
});

check('renders avatars as decorative but metadata-bearing images', () => {
  assert.ok(html.includes('class="xa-avatar"'));
  assert.ok(html.includes('alt="" aria-hidden="true" width="40" height="40"'));
  assert.ok(html.includes('data-xa-sha256="sha256:avatar-hash"'));
});

check('escapes HTML in untrusted text fields (no raw injection)', () => {
  // heading.text and title are untrusted -> must be escaped at render time.
  assert.ok(html.includes('&amp;'), 'ampersand not escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'heading text not escaped');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag leaked through');
});

check('truncated long-form quote is flagged in HTML and Markdown', () => {
  const model = {
    type: 'post',
    title: 't',
    heading: '',
    author: { name: 'X', handle: '@x' },
    sourceUrl: 'https://x.com/x/status/1',
    exportedAt: new Date('2026-06-26T00:00:00Z').toISOString(),
    blocks: [
      {
        kind: 'quote',
        truncated: true,
        author: { name: 'Serenity', handle: '@aleabitoreddit' },
        sourceUrl: 'https://x.com/aleabitoreddit/status/2066180704661356593',
        publishedAt: new Date('2026-06-13T10:38:17Z').toISOString(),
        blocks: [{ kind: 'paragraph', html: 'This is gonna upset a lot of people' }],
      },
    ],
  };
  const h = engine.assembleHtml(model);
  assert.ok(h.includes('class="xa-truncated"'), 'HTML should show a truncation marker');
  assert.ok(h.includes('Read the full post on X'), 'truncation marker should link to X');
  const md = engine.renderLlmMarkdown(model);
  assert.ok(
    md.includes('Text status: truncated (long-form post)'),
    'Markdown should flag truncation'
  );
});

check('safeUrl blocks dangerous link schemes from the exported file', () => {
  assert.equal(engine.safeUrl('https://x.com/a'), 'https://x.com/a');
  assert.equal(engine.safeUrl('http://example.com'), 'http://example.com');
  assert.equal(engine.safeUrl('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(engine.safeUrl('javascript:alert(1)'), '');
  assert.equal(engine.safeUrl('  javascript:alert(1)'), '');
  assert.equal(engine.safeUrl('JavaScript:alert(1)'), '');
  assert.equal(engine.safeUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(engine.safeUrl('vbscript:msgbox(1)'), '');
  assert.equal(engine.safeUrl(''), '');
  // A model whose sourceUrl carries a javascript: scheme must never become a live href.
  const evilHtml = engine.assembleHtml({
    type: 'post',
    title: 'evil',
    heading: '',
    author: { name: 'X', handle: '@x' },
    sourceUrl: 'javascript:alert(1)',
    exportedAt: new Date('2026-06-26T00:00:00Z').toISOString(),
    blocks: [{ kind: 'paragraph', html: 'hi' }],
  });
  assert.ok(!evilHtml.includes('href="javascript:'), 'javascript: href leaked into export');
});

check('handles failed media with a visible placeholder', () => {
  assert.ok(html.includes('Image unavailable'));
  assert.ok(html.includes('Video unavailable'));
  assert.ok(html.includes('data-xa-missing-type="image"'));
  assert.ok(html.includes('data-xa-missing-type="video"'));
  assert.ok(html.includes('Quoted post unavailable'));
  assert.ok(html.includes('data-xa-missing-type="quoted-post"'));
  assert.equal(debugJson.capture.missingMedia, 6);
  assert.equal(debugJson.capture.incompleteMedia, 3);
  assert.equal(debugJson.missing.length, 6);
  assert.equal(debugJson.incomplete.length, 3);
  assert.deepEqual(
    debugJson.missing.map((item) => item.type),
    ['image', 'video', 'video-poster', 'video', 'quoted-post', 'quoted-post']
  );
  assert.ok(debugJson.warnings.includes('Image image-002 was unavailable at export time.'));
  assert.ok(debugJson.warnings.includes('Video video-005 was unavailable at export time.'));
  assert.ok(
    debugJson.warnings.some((warning) =>
      warning.includes(
        'Video video-003 was detected, but the video file was not preserved offline.'
      )
    )
  );
  assert.ok(
    debugJson.warnings.includes('Video poster for video-006 was unavailable at export time.')
  );
  assert.ok(debugJson.warnings.includes('Video video-007 was unavailable at export time.'));
  assert.ok(debugJson.warnings.includes('Quoted post 7 was unavailable at export time.'));
  assert.ok(debugJson.warnings.includes('Quoted post 8 was unavailable at export time.'));
  assert.ok(debugJson.warnings.includes('6 item(s) were unavailable at export time.'));
  const unsupportedRecord = debugJson.media.find((item) => item.unsupportedType === 'hls');
  assert.equal(unsupportedRecord.unsupported, true);
  assert.equal(unsupportedRecord.missing, true);
  const unsupportedMissing = debugJson.missing.find((item) => item.mediaId === 'video-007');
  assert.equal(unsupportedMissing.reason, 'unsupported_media');
});

check('HTML v1 regression checklist stays true for generated archive', () => {
  assert.ok(html.includes('<details class="xa-capture">'), 'capture summary missing');
  assert.ok(html.includes('Archive provenance'), 'provenance footer missing');
  assert.ok(html.includes('This archive preserves content visible'), 'capture disclaimer missing');
  assert.ok(!html.includes('alt="Image"'), 'generic image alt leaked');
  assert.ok(!/src="https?:\/\//.test(html), 'external asset src leaked');

  const capturedImages = debugJson.media.filter((item) => item.type === 'image' && item.embedded);
  assert.ok(capturedImages.length > 0, 'fixture should include captured images');
  capturedImages.forEach((item) => {
    assert.ok(item.width > 0, `captured image missing width: ${item.id}`);
    assert.ok(item.height > 0, `captured image missing height: ${item.id}`);
    assert.ok(item.sha256, `captured image missing hash: ${item.id}`);
    assert.notEqual(item.alt, 'Image', `captured image has generic alt: ${item.id}`);
  });

  const capturedVideos = debugJson.media.filter((item) => item.type === 'video' && item.sha256);
  assert.ok(capturedVideos.length > 0, 'fixture should include captured videos');
  capturedVideos.forEach((item) => {
    assert.ok(html.includes(`data-xa-media-id="${item.id}"`), `video attr missing id: ${item.id}`);
    assert.ok(
      html.includes(`data-xa-width="${item.width}"`),
      `video attr missing width: ${item.id}`
    );
    assert.ok(
      html.includes(`data-xa-height="${item.height}"`),
      `video attr missing height: ${item.id}`
    );
    assert.ok(
      html.includes(`data-xa-duration="${item.durationSeconds}"`),
      `video attr missing duration: ${item.id}`
    );
  });
});

check('manifest image alt text matches exported DOM alt text', () => {
  const mainImageRecord = debugJson.media.find((item) => item.id === 'image-001');
  assert.equal(mainImageRecord.originalAlt, 'Image');
  assert.equal(
    mainImageRecord.exportAlt,
    'Image attached to main X article by @ada, archive media image-001'
  );
  assert.equal(mainImageRecord.alt, mainImageRecord.exportAlt);
  const quoteImageRecord = debugJson.media.find((item) => item.id === 'image-008');
  assert.equal(quoteImageRecord.originalAlt, 'Image');
  assert.equal(quoteImageRecord.exportAlt, 'Image attached to quoted X post by @charles');
  assert.equal(quoteImageRecord.alt, quoteImageRecord.exportAlt);
});

check('warns when main author metadata is absent', () => {
  const noAuthorHtml = engine.assembleHtml({
    type: 'article',
    title: 'No author',
    heading: 'No author',
    author: {},
    sourceUrl: 'https://x.com/example/article/no-author',
    exportedAt: new Date('2026-06-26T00:00:00Z').toISOString(),
    blocks: [{ kind: 'paragraph', html: 'Text exists.' }],
  });
  const manifest = JSON.parse(
    noAuthorHtml.match(
      /<script id="sourcecapsule-debug" type="application\/json">([\s\S]*?)<\/script>/
    )[1]
  );
  assert.ok(manifest.warnings.includes('Main author metadata was not found.'));
});

check('warns when the main avatar fetch failed', () => {
  const failedAvatarHtml = engine.assembleHtml({
    type: 'post',
    title: 'Avatar failed',
    heading: '',
    author: { name: 'Ada Lovelace', handle: '@ada', avatarFailed: true },
    sourceUrl: 'https://x.com/ada/status/avatar-failed',
    exportedAt: new Date('2026-06-26T00:00:00Z').toISOString(),
    blocks: [{ kind: 'paragraph', html: 'Text exists.' }],
  });
  const manifest = JSON.parse(
    failedAvatarHtml.match(
      /<script id="sourcecapsule-debug" type="application\/json">([\s\S]*?)<\/script>/
    )[1]
  );
  assert.ok(manifest.warnings.includes('Main author avatar was unavailable at export time.'));
  assert.deepEqual(manifest.missing, [{ type: 'avatar', reason: 'download_failed' }]);
});

check('slugify produces a safe filename', () => {
  const slug = engine.slugify(sampleModel.title);
  assert.ok(/^[a-z0-9-]+$/.test(slug), `unsafe slug: ${slug}`);
  assert.ok(slug.length <= 80);
});

check('highResImageUrl upgrades pbs.twimg.com images to original', () => {
  const out = engine.highResImageUrl('https://pbs.twimg.com/media/abc?format=jpg&name=small');
  assert.ok(out.includes('name=orig'), `not upgraded: ${out}`);
});

check('imageFetchCandidates retries lower-resolution X image variants', () => {
  const candidates = engine.imageFetchCandidates(
    'https://pbs.twimg.com/media/abc?format=jpg&name=orig'
  );
  assert.ok(candidates.some((url) => url.includes('name=orig')));
  assert.ok(candidates.some((url) => url.includes('name=large')));
  assert.ok(candidates.some((url) => url.includes('name=small')));
});

check('imageFetchCandidates covers video poster thumbnails, original URL first', () => {
  const poster = 'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/abc.jpg';
  const candidates = engine.imageFetchCandidates(poster);
  assert.equal(candidates[0], poster, 'exact poster URL must be tried first');
  assert.ok(candidates.length > 1, 'size variants added as fallbacks');
  assert.ok(candidates.some((url) => url.includes('name=large')));
});

check('MP4 validation rejects tiny X video fragments', () => {
  const tinyInit = new Uint8Array(905);
  'ftyp'.split('').forEach((char, index) => {
    tinyInit[4 + index] = char.charCodeAt(0);
  });
  assert.throws(
    () =>
      engine.validateMp4Download({
        bytes: tinyInit,
        size: tinyInit.length,
        mime: 'video/mp4',
        url: 'https://video.twimg.com/amplify_video/example/vid/avc1/0/0/1280x720/test.mp4',
      }),
    /too small/
  );

  const plausible = new Uint8Array(40 * 1024);
  'mdat'.split('').forEach((char, index) => {
    plausible[100 + index] = char.charCodeAt(0);
  });
  assert.doesNotThrow(() =>
    engine.validateMp4Download({
      bytes: plausible,
      size: plausible.length,
      mime: 'video/mp4',
      url: 'https://video.twimg.com/amplify_video/example/vid/avc1/1280x720/test.mp4',
    })
  );
});

check('image validation rejects HTTP-200 error pages and accepts real image signatures', () => {
  const html = new TextEncoder().encode('<!doctype html><html><body>rate limited</body></html>');
  assert.throws(
    () =>
      engine.validateImageDownload({
        bytes: html,
        size: html.length,
        mime: 'text/html',
      }),
    /error document/
  );
  const jpeg = new Uint8Array(32);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
  assert.equal(
    engine.validateImageDownload({
      bytes: jpeg,
      size: jpeg.length,
      mime: 'application/octet-stream',
    }),
    'image/jpeg'
  );
});

check('network capture extracts bitrate-ranked GraphQL video variants', () => {
  const payload = {
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
                        legacy: {
                          extended_entities: {
                            media: [
                              {
                                type: 'video',
                                preview_image: {
                                  original_img_url:
                                    'https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg',
                                  original_img_width: 1280,
                                  original_img_height: 720,
                                },
                                video_info: {
                                  variants: [
                                    {
                                      content_type: 'application/x-mpegURL',
                                      url: 'https://video.twimg.com/amplify_video/1/pl/playlist.m3u8',
                                    },
                                    {
                                      bitrate: 256000,
                                      content_type: 'video/mp4',
                                      url: 'https://video.twimg.com/amplify_video/1/vid/avc1/320x180/low.mp4',
                                    },
                                    {
                                      bitrate: 2176000,
                                      content_type: 'video/mp4',
                                      url: 'https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/high.mp4',
                                    },
                                  ],
                                },
                              },
                            ],
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
  };
  const candidates = engine.videoCandidatesFromCapturedBody(
    JSON.stringify(payload),
    'network:fetch'
  );
  assert.equal(
    candidates[0].url,
    'https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/high.mp4'
  );
  assert.equal(candidates[0].bitrate, 2176000);
  assert.equal(
    candidates[0].posterUrl,
    'https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg'
  );
  assert.equal(candidates[0].mediaKey, '1');
  assert.equal(
    engine.videoCandidateMatchesBlock(candidates[0], {
      kind: 'video',
      posterUrl: 'https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg',
    }),
    true
  );
  assert.ok(candidates.some((candidate) => candidate.kind === 'hls'));
});

check('keyless video fallback refuses ambiguous cross-post candidates', () => {
  const sameVideoVariants = [
    {
      url: 'https://video.twimg.com/ext_tw_video/777/pu/vid/640x360/low.mp4',
      kind: 'mp4',
      bitrate: 256000,
    },
    {
      url: 'https://video.twimg.com/ext_tw_video/777/pu/vid/1280x720/high.mp4',
      kind: 'mp4',
      bitrate: 2176000,
    },
  ];
  assert.equal(
    engine.unambiguousVideoFallbackCandidate(sameVideoVariants, 1).bitrate,
    2176000,
    'multiple encodes of one media id are safe; pick the best'
  );
  assert.equal(engine.unambiguousVideoFallbackCandidate(sameVideoVariants, 2), null);
  assert.equal(
    engine.unambiguousVideoFallbackCandidate(
      [
        sameVideoVariants[1],
        {
          url: 'https://video.twimg.com/ext_tw_video/888/pu/vid/1280x720/other.mp4',
          kind: 'mp4',
          bitrate: 3000000,
        },
      ],
      1
    ),
    null,
    'two logical videos must never be assigned by bitrate/index order'
  );
});

// Write a previewable sample so humans (and the README) can see the output style.
const outDir = join(here, '..', 'examples');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'sample-export.html');
const markdownOutFile = join(outDir, 'sample-export.llm.md');
writeFileSync(outFile, html, 'utf8');
writeFileSync(markdownOutFile, markdown, 'utf8');
console.log(`\nWrote preview: ${outFile} (${(html.length / 1024).toFixed(1)} KB)`);
console.log(`Wrote LLM preview: ${markdownOutFile} (${(markdown.length / 1024).toFixed(1)} KB)`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
