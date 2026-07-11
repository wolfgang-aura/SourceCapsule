// ==UserScript==
// @name         SourceCapsule - Save X/Twitter Threads & Articles as Markdown for LLMs + Offline HTML
// @namespace    https://github.com/wolfgang-aura/SourceCapsule
// @version      1.4.0
// @description  One click saves an X (Twitter) thread, Article, or post as clean Markdown for LLM context (Claude, ChatGPT) plus a self-contained offline HTML archive - images, video, and quoted posts embedded, with honest completeness reporting. Local-first, with optional expiring AI readable links.
// @author       wolfgang-aura
// @license      MIT
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.x.com/*
// @match        https://mobile.twitter.com/*
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @connect      abs.twimg.com
// @connect      cdn.syndication.twimg.com
// @connect      x.com
// @connect      twitter.com
// @connect      127.0.0.1
// @connect      localhost
// @connect      sourcecapsule-share.wolfgang-aura.workers.dev
// @run-at       document-start
// @noframes
// @downloadURL  https://raw.githubusercontent.com/wolfgang-aura/SourceCapsule/main/sourcecapsule.user.js
// @updateURL    https://raw.githubusercontent.com/wolfgang-aura/SourceCapsule/main/sourcecapsule.user.js
// ==/UserScript==

/*
 * SourceCapsule
 * -------------
 * Saves an X (Twitter) Article or single post as ONE self-contained .html file
 * that opens fully offline: every image and short video is base64-inlined, and
 * quoted tweets are rebuilt as real, styled, selectable HTML (not screenshots).
 *
 * ARCHITECTURE (read this before editing)
 * =======================================
 * The code is split into two layers with a deliberate seam between them:
 *
 *   1. FRAGILE LAYER  - anything that reads X's DOM. X reshuffles its markup
 *      often, so ALL of its selectors live in the CONFIG block below, and the
 *      extraction functions produce a plain-object "model". When X breaks the
 *      tool, the fix is almost always here, and almost always just a selector.
 *
 *   2. STABLE LAYER   - the durable engine: privileged fetch -> base64 ->
 *      assemble HTML -> download. It only ever touches the model, never X's DOM,
 *      so it rarely needs to change.
 *
 * The model is the contract between the two. See buildModel* (producers) and
 * assembleHtml (consumer).
 *
 * WHY A USERSCRIPT? CORS. Reading the raw bytes of pbs.twimg.com /
 * video.twimg.com media to base64-encode them is blocked from a normal page
 * context. GM_xmlhttpRequest (with the @connect grants above) is the privileged
 * fetch that makes inlining possible. That single constraint is why this is a
 * userscript and not a plain content script.
 */

(function () {
  'use strict';

  // ===========================================================================
  // CONFIG  -  *** EDIT HERE WHEN X CHANGES ***
  // ---------------------------------------------------------------------------
  // If the tool stops finding part of the page, a selector below is almost
  // certainly stale. Update it here; the rest of the code should not need to
  // change. Each selector lists fallbacks (tried in order).
  // ===========================================================================
  const CONFIG = {
    selectors: {
      // The main content column of a status / article page.
      primaryColumn: ['div[data-testid="primaryColumn"]', 'main[role="main"]'],
      // A single tweet block (the primary post and any quoted/embedded tweets).
      tweet: ['article[data-testid="tweet"]', 'article[role="article"]'],
      // The rich text of a tweet. `div[lang]` is a fallback: X wraps tweet text
      // in a div carrying a `lang` attribute even if the testid changes.
      tweetText: ['div[data-testid="tweetText"]', 'div[lang]'],
      // Author name/handle block within a tweet.
      userName: ['div[data-testid="User-Name"]'],
      // Avatar image within a tweet.
      avatar: ['div[data-testid="Tweet-User-Avatar"] img', 'img[src*="profile_images"]'],
      // Photos within a tweet.
      tweetPhoto: [
        'div[data-testid="tweetPhoto"] img',
        'a[href*="/photo/"] img',
        'img[src*="pbs.twimg.com/media/"]',
      ],
      // Video container within a tweet.
      videoPlayer: ['div[data-testid="videoPlayer"]', 'div[data-testid="videoComponent"]'],
      // External link-preview card within a tweet (the payload of a link post).
      card: ['div[data-testid="card.wrapper"]', 'a[data-testid="card.wrapper"]'],
      // Clickable quoted-post wrapper. X has periodically added/removed the
      // tabindex attribute without changing the card semantics.
      quoteCard: ['div[role="link"][tabindex="0"]', 'div[role="link"]'],
      // "Show more" link X renders on long-form (note) posts in timeline views;
      // its presence means the visible text is only a preview.
      showMore: ['[data-testid="tweet-text-show-more-link"]'],
      // X's inline dead-end box for a quoted post that is itself gone on X
      // (deleted, banned/suspended, or restricted account): "This Post is
      // unavailable." etc. Nothing is capturable, but the archive must say so.
      quoteTombstone: ['[data-testid="tombstone"]'],
      // Poll containers and observed fields. Results may be hidden until the poll closes;
      // extraction records only text/ARIA values X actually rendered.
      poll: [
        'div[data-testid="cardPoll"]',
        'div[role="radiogroup"]',
        '[data-testid*="poll" i]',
        '[aria-label*="poll" i]',
      ],
      pollChoice: [
        '[role="radio"]',
        '[role="progressbar"]',
        '[data-testid*="pollOption" i]',
        '[data-testid*="choice" i][aria-label]',
        '[aria-label*="%"]',
      ],
      pollQuestion: ['[data-testid="pollQuestion"]', '[role="heading"]'],
      pollMeta: ['[data-testid="pollMetadata"]', '[aria-label*="vote" i]'],
      // Time element (carries the canonical permalink).
      timeLink: ['a[href*="/status/"] time'],
      // Section headings X inserts between a conversation and recommendation feeds
      // such as "Discover more". These are thread boundaries, never continuations.
      threadBoundaryHeading: ['[role="heading"]', 'h1', 'h2', 'h3'],
      // Long-form Article rich-text root.
      articleRoot: [
        'div[data-testid="twitterArticleReadView"]',
        'div[data-testid="twitterArticleRichTextView"]',
        'div[data-testid="twitterArticleReader"]',
      ],
      articleTextRoot: ['div[data-testid="longformRichTextComponent"]'],
      // Long-form Article title.
      articleTitle: [
        'div[data-testid="twitter-article-title"]',
        'div[data-testid="twitterArticleTitle"]',
        'h1[role="heading"]',
        'h1',
      ],
    },

    video: {
      inlineEnabled: true,
      inlineCapBytes: Infinity, // Fetch any discovered MP4; fallback only after preservation fails.
      minPlayableBytes: 32 * 1024,
      // TweetDetail bodies for media-heavy threads can exceed 2 MB. Keep a
      // bounded but roomier window so quote refs near the end survive; any
      // remaining truncation is surfaced in diagnostics instead of hidden.
      networkCaptureMaxChars: 6_000_000,
    },

    image: {
      preferOriginal: true, // request the full-resolution pbs.twimg.com variant
    },

    fetchTimeoutMs: 30000,
    buttonId: 'sourcecapsule-btn',
    // Per-post Export buttons attached to each post on status/article pages, so the
    // user picks exactly which post to export instead of relying on one page-level
    // button (avoids accidentally exporting the wrong tweet). Set false to disable.
    perPostButtons: true,
    postControlClass: 'sourcecapsule-post-ctl',
    postControlFlag: 'data-sourcecapsule-ctl',
    toastId: 'sourcecapsule-toast',
    styleId: 'sourcecapsule-style',
    debug: true,
    debugEmbed: true,
    // Scroll the page top-to-bottom before extracting so X's lazy/virtualized
    // media loads into the DOM. The #1 suspected cause of missing tweet images.
    forceLoad: true,
    forceLoadMaxMs: 45000,
    forceLoadSettleMs: 2500,
    mediaFetchRetries: 4,
    mediaFetchRetryBaseMs: 650,
    // Parallel media downloads during the main inline pass. Small on purpose:
    // enough to cut big-thread export time ~3x, low enough to stay under X's
    // rate limits. The rescue/repair passes stay sequential - they are retrying
    // failures, and gentler pacing is what lets those succeed.
    mediaFetchConcurrency: 3,
    // Backoff multiplier applied when a fetch is rate-limited (HTTP 429): those
    // need substantially more room than transient socket errors to clear.
    rateLimitBackoffFactor: 4,
    // Retries for cdn.syndication.twimg.com fetches. Every quote-recovery layer
    // rides on this endpoint, so a single transient failure must not silently
    // degrade a quote card to its (possibly empty) DOM scrape.
    syndicationFetchRetries: 3,
    syndicationFetchRetryBaseMs: 700,
    // Pause before the strict-gate auto-repair round retries remaining blockers,
    // giving transient conditions (rate limits, dropped connections) time to clear.
    repairPauseMs: 1500,
    videoNudgeTimeoutMs: 700,
    // Fetch each embedded/quoted tweet by id from X's public syndication endpoint
    // to get its authoritative text + media, instead of scraping the fragile,
    // virtualized article DOM. This is what makes quote media reliably correct.
    useSyndication: true,
    share: {
      // Hosted share service (Cloudflare Worker + R2). Point this at a local
      // `npm run dev:share` (http://127.0.0.1:8787) through the userscript-manager
      // menu when developing; new hosts also need an @connect grant above.
      defaultApiBase: 'https://sourcecapsule-share.wolfgang-aura.workers.dev',
      maxBytes: 25 * 1024 * 1024,
      expiryDays: [1, 7, 30],
      defaultExpiryDays: 7,
    },
    installUrl: 'https://github.com/wolfgang-aura/SourceCapsule#installation',
  };

  const APP = 'SourceCapsule';
  const VERSION = '1.4.0';

  // ===========================================================================
  // Small utilities
  // ===========================================================================
  const log = (...a) => CONFIG.debug && console.log(`[${APP}]`, ...a);
  const warn = (...a) => console.warn(`[${APP}]`, ...a);
  const errlog = (...a) => console.error(`[${APP}]`, ...a);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Run `worker(item)` over `items` with at most `limit` in flight. Each item is
   *  awaited exactly once; worker must handle its own errors (a throw aborts the run). */
  async function runWithConcurrency(items, limit, worker) {
    const queue = (items || []).slice();
    const width = Math.max(1, Math.min(Number(limit) || 1, queue.length));
    const runners = [];
    for (let i = 0; i < width; i++) {
      runners.push(
        (async () => {
          while (queue.length) {
            await worker(queue.shift());
          }
        })()
      );
    }
    await Promise.all(runners);
  }
  const withTimeout = (promise, ms) =>
    Promise.race([
      Promise.resolve(promise).catch((error) => ({ error })),
      sleep(ms).then(() => ({ timedOut: true })),
    ]);

  /** Return the first element matching any selector in the list, or null. */
  function pick(root, selectorList, { quiet = false } = {}) {
    const list = Array.isArray(selectorList) ? selectorList : [selectorList];
    for (const sel of list) {
      const el = (root || document).querySelector(sel);
      if (el) return el;
    }
    if (!quiet) warn('selector miss (none matched):', list.join('  ||  '));
    return null;
  }

  /** Return all elements matching the FIRST selector in the list that hits. */
  function pickAll(root, selectorList) {
    const list = Array.isArray(selectorList) ? selectorList : [selectorList];
    for (const sel of list) {
      const els = (root || document).querySelectorAll(sel);
      if (els.length) return Array.from(els);
    }
    return [];
  }

  /** Return matches for all selectors, including root, without stopping early. */
  function pickAllMatchesIncludingRoot(root, selectorList) {
    const list = Array.isArray(selectorList) ? selectorList : [selectorList];
    const seen = new Set();
    const els = [];
    const add = (el) => {
      if (el && !seen.has(el)) {
        seen.add(el);
        els.push(el);
      }
    };
    for (const sel of list) {
      if (root && root.matches && root.matches(sel)) add(root);
      (root || document).querySelectorAll(sel).forEach(add);
    }
    return els;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeJsonScript(s) {
    return escapeJsonForHtml(s);
  }

  function slugify(s) {
    const base = String(s || '')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80)
      .replace(/^-+|-+$/g, '');
    return base || 'x-export';
  }

  function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  function humanBytes(n) {
    if (!n && n !== 0) return '?';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  function formatDuration(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return '';
    const total = Math.round(n);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // Only http(s)/mailto URLs may become an href in the EXPORTED file, which opens in a
  // file:// context. This neutralizes javascript:/data:/vbscript: schemes that would
  // otherwise survive escaping and execute when a reader clicks a link in the archive.
  // Returns '' for anything not on the scheme allowlist; callers must drop the link then.
  function safeUrl(u) {
    const s = String(u == null ? '' : u).trim();
    if (!s) return '';
    return /^(?:https?:|mailto:)/i.test(s) ? s : '';
  }

  // https://x.com/<handle> from a stored "@handle" or "handle". Empty when the handle
  // isn't a valid X username. Used as a last-resort link when a quoted post's exact
  // permalink couldn't be recovered - a working profile link is always preferable to
  // a dead-end "source unavailable" notice.
  function authorProfileUrl(handle) {
    const raw = String(handle || '')
      .trim()
      .replace(/^@/, '');
    return /^[A-Za-z0-9_]{1,15}$/.test(raw) ? `https://x.com/${raw}` : '';
  }

  // X's syndication API returns tweet text with &, <, > already HTML-encoded (the classic
  // Twitter behaviour). Decode those back to plain text before our own escaping, so we don't
  // double-encode and render a literal "&amp;" in the archive. Decode &amp; last so an
  // encoded "&lt;" doesn't get turned into a real "<".
  function decodeBasicEntities(s) {
    return String(s == null ? '' : s)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function countBlocks(blocks, predicate) {
    let count = 0;
    const walk = (items) => {
      (items || []).forEach((b) => {
        if (predicate(b)) count += 1;
        if (b.kind === 'quote' || b.kind === 'blockquote') walk(b.blocks);
      });
    };
    walk(blocks);
    return count;
  }

  function normalizeExternalLinks(html) {
    return String(html || '').replace(
      /<a\b([^>]*\bhref="(https?:\/\/[^"]+)"[^>]*)>/gi,
      (tag, attrs) => {
        let next = attrs;
        if (/\btarget\s*=/.test(next)) {
          next = next.replace(/\btarget\s*=\s*"[^"]*"/i, 'target="_blank"');
        } else {
          next += ' target="_blank"';
        }
        if (/\brel\s*=/.test(next)) {
          next = next.replace(/\brel\s*=\s*"([^"]*)"/i, (relTag, relValue) => {
            const rels = new Set(
              String(relValue || '')
                .split(/\s+/)
                .filter(Boolean)
            );
            rels.add('noopener');
            rels.add('noreferrer');
            return `rel="${Array.from(rels).join(' ')}"`;
          });
        } else {
          next += ' rel="noopener noreferrer"';
        }
        return `<a${next}>`;
      }
    );
  }

  function videoDimensionsFromUrl(url) {
    const match = String(url || '').match(/\/(\d{2,5})x(\d{2,5})(?:\/|[._-])/);
    if (!match) return {};
    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : {};
  }

  function applyVideoDimensions(block, dimensions) {
    const width = Number(dimensions && dimensions.width);
    const height = Number(dimensions && dimensions.height);
    if (Number.isFinite(width) && width > 0) block.width = Math.round(width);
    if (Number.isFinite(height) && height > 0) block.height = Math.round(height);
  }

  function escapeJsonForHtml(s) {
    return String(s)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/[\s\S]/g, (c) => {
        const code = c.charCodeAt(0);
        if (code <= 0x7f) return c;
        return `\\u${code.toString(16).padStart(4, '0')}`;
      });
  }

  function safeIsoTime(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  function readableUtcTime(value) {
    const iso = safeIsoTime(value);
    if (!iso) return 'Unknown time';
    return iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  }

  function decodeHtmlCodePoint(match, code, radix = 10) {
    const n = parseInt(code, radix);
    try {
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    } catch {
      return match;
    }
  }

  function textFromHtml(html) {
    return String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (match, code) => decodeHtmlCodePoint(match, code))
      .replace(/&#x([0-9a-f]+);/gi, (match, code) => decodeHtmlCodePoint(match, code, 16))
      .replace(/\s+/g, ' ')
      .trim();
  }

  function blockTextForLanguage(block) {
    if (!block) return '';
    if (block.kind === 'heading') return block.text || '';
    if (block.kind === 'paragraph') return textFromHtml(block.html);
    if (block.kind === 'code') return block.text || '';
    if (block.kind === 'list') return (block.items || []).map(textFromHtml).join(' ');
    if (block.kind === 'quote' || block.kind === 'blockquote')
      return (block.blocks || []).map(blockTextForLanguage).join(' ');
    return '';
  }

  function inferDocumentLang(model) {
    const text = [model.title, model.heading, ...(model.blocks || []).map(blockTextForLanguage)]
      .join(' ')
      .slice(0, 12000);
    const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    if (cjk >= 12 && cjk >= latin * 0.25) return 'zh-CN';
    return 'en';
  }

  function statusIdFromSourceUrl(url) {
    const id = statusIdFromUrl(url);
    if (id) return id;
    const article = String(url || '').match(/\/article\/(\d+)/);
    return article ? article[1] : '';
  }

  // Reserved first-path segments on x.com/twitter.com that are NOT user handles.
  const NON_HANDLE_SEGMENTS = new Set([
    'i',
    'home',
    'search',
    'explore',
    'notifications',
    'messages',
    'settings',
    'compose',
    'hashtag',
    'intent',
    'share',
    'login',
    'signup',
    'about',
    'tos',
    'privacy',
  ]);

  /**
   * Best-effort author handle from a post/article URL (e.g. https://x.com/dingyi/status/123 ->
   * "@dingyi"). Used only as a fallback when the DOM author metadata is missing. Returns '' for
   * reserved paths (/i/, /home, ...) or anything that does not look like a handle.
   */
  function handleFromSourceUrl(url) {
    const m = String(url || '').match(
      /^https?:\/\/(?:[\w-]+\.)*(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i
    );
    if (!m) return '';
    if (NON_HANDLE_SEGMENTS.has(m[1].toLowerCase())) return '';
    return `@${m[1]}`;
  }

  function publishedAtFromElement(root, expectedStatusId = '') {
    const times = Array.from(
      (root || document).querySelectorAll
        ? (root || document).querySelectorAll('time[datetime]')
        : []
    );
    if (!times.length) return '';
    const normalizedExpected = String(expectedStatusId || '');
    const matching = normalizedExpected
      ? times.find((time) => {
          const anchor = time.closest && time.closest('a[href*="/status/"]');
          return anchor && statusIdFromUrl(anchor.href) === normalizedExpected;
        })
      : null;
    const time = matching || times[0];
    return safeIsoTime(time.getAttribute('datetime') || '');
  }

  function normalizeVideoUrl(url) {
    if (!url) return '';
    let value = String(url).trim();
    if (!value || value.startsWith('blob:') || value.startsWith('data:')) return '';
    value = value
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&');
    try {
      return new URL(value, typeof location !== 'undefined' ? location.href : undefined).toString();
    } catch {
      return /^https?:\/\//.test(value) ? value : '';
    }
  }

  function videoUrlKind(url) {
    const lower = String(url || '').toLowerCase();
    if (lower.includes('.mp4')) return 'mp4';
    if (lower.includes('.m3u8')) return 'hls';
    return '';
  }

  function isInterestingVideoUrl(url) {
    const lower = String(url || '').toLowerCase();
    return (
      lower.includes('video.twimg.com') ||
      lower.includes('.mp4') ||
      lower.includes('.m3u8') ||
      lower.includes('amplify_video') ||
      lower.includes('ext_tw_video') ||
      lower.includes('tweet_video')
    );
  }

  function videoCandidate(url, source = 'unknown', extra = {}) {
    const normalized = normalizeVideoUrl(url);
    if (!normalized || !isInterestingVideoUrl(normalized)) return null;
    return {
      url: normalized,
      kind: videoUrlKind(normalized),
      source,
      bitrate: Number(extra.bitrate) > 0 ? Number(extra.bitrate) : undefined,
      ...videoDimensionsFromUrl(normalized),
      ...extra,
    };
  }

  function addVideoCandidate(out, seen, candidate) {
    if (!candidate || !candidate.url || seen.has(candidate.url)) return;
    seen.add(candidate.url);
    out.push(candidate);
  }

  function videoCandidatesFromText(text, source = 'text') {
    const out = [];
    const seen = new Set();
    const raw = String(text || '');
    const patterns = [
      /https?:\\\/\\\/video\.twimg\.com\\\/[^"'<>\\\s]+/g,
      /https?:\/\/video\.twimg\.com\/[^"' <>\s]+/g,
    ];
    patterns.forEach((pattern) => {
      raw.replace(pattern, (url) => {
        addVideoCandidate(out, seen, videoCandidate(url, source));
        return url;
      });
    });
    return out;
  }

  function xVideoMediaKey(url) {
    const value = String(url || '');
    const match = value.match(
      /(?:amplify_video_thumb|amplify_video|ext_tw_video_thumb|ext_tw_video|tweet_video_thumb|tweet_video)\/(\d+)/i
    );
    return match ? match[1] : '';
  }

  function structuredPosterUrl(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return '';
    return (
      value.original_img_url ||
      value.url ||
      value.media_url_https ||
      value.media_url ||
      value.preview_image_url ||
      value.thumbnail_url ||
      ''
    );
  }

  function sortVideoCandidates(candidates) {
    return (candidates || []).slice().sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'mp4' ? -1 : 1;
      const bitrateDelta = (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
      if (bitrateDelta) return bitrateDelta;
      const pixelsB = (Number(b.width) || 0) * (Number(b.height) || 0);
      const pixelsA = (Number(a.width) || 0) * (Number(a.height) || 0);
      return pixelsB - pixelsA;
    });
  }

  function videoCandidatesFromStructuredData(value, source = 'json') {
    const out = [];
    const seen = new Set();
    const add = (url, candidateSource, extra) =>
      addVideoCandidate(out, seen, videoCandidate(url, candidateSource, extra));
    const walk = (item, itemSource) => {
      if (!item) return;
      if (typeof item === 'string') {
        videoCandidatesFromText(item, itemSource).forEach((candidate) =>
          addVideoCandidate(out, seen, candidate)
        );
        return;
      }
      if (Array.isArray(item)) {
        item.forEach((child) => walk(child, itemSource));
        return;
      }
      if (typeof item !== 'object') return;

      const variants =
        item.video_info && Array.isArray(item.video_info.variants)
          ? item.video_info.variants
          : Array.isArray(item.variants)
            ? item.variants
            : [];
      const posterUrl =
        structuredPosterUrl(item.media_url_https) ||
        structuredPosterUrl(item.media_url) ||
        structuredPosterUrl(item.preview_image_url) ||
        structuredPosterUrl(item.preview_image) ||
        structuredPosterUrl(item.thumbnail_url);
      const mediaKey = item.media_key || item.id_str || item.id || xVideoMediaKey(posterUrl);
      variants.forEach((variant) => {
        if (!variant || !variant.url) return;
        add(variant.url, `${itemSource}:variant`, {
          bitrate: variant.bitrate,
          contentType: variant.content_type || variant.contentType || '',
          posterUrl,
          mediaKey,
        });
      });

      if (
        item.url &&
        (item.content_type === 'video/mp4' ||
          item.contentType === 'video/mp4' ||
          String(item.url).includes('.mp4') ||
          String(item.url).includes('.m3u8'))
      ) {
        add(item.url, itemSource, {
          bitrate: item.bitrate,
          contentType: item.content_type || item.contentType || '',
          posterUrl,
          mediaKey,
        });
      }
      Object.keys(item).forEach((key) => walk(item[key], itemSource));
    };
    walk(value, source);
    return sortVideoCandidates(out);
  }

  function videoCandidatesFromJsonText(text, source = 'json') {
    const raw = String(text || '').trim();
    if (!raw || (raw[0] !== '{' && raw[0] !== '[')) return [];
    try {
      return videoCandidatesFromStructuredData(JSON.parse(raw), source);
    } catch {
      return [];
    }
  }

  // ===========================================================================
  // STABLE LAYER - privileged fetch + base64 inlining
  // ===========================================================================

  /** Hosts the privileged byte fetch is allowed to hit. All inlineable X media lives on
   *  *.twimg.com; restricting here (in addition to the @connect grants) bounds SSRF so a
   *  crafted media URL in a post cannot make the script fetch an arbitrary origin. */
  function isAllowedMediaHost(url) {
    try {
      const host = new URL(url, location.href).hostname.toLowerCase();
      return host === 'twimg.com' || host.endsWith('.twimg.com');
    } catch {
      return false;
    }
  }

  /** Fetch raw bytes through the userscript manager (bypasses page CORS). */
  function gmFetchBytesOnce(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest unavailable - is the userscript manager granting it?'));
        return;
      }
      if (!isAllowedMediaHost(url)) {
        reject(new Error(`Refusing to fetch non-twimg media host: ${url}`));
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8',
          'Cache-Control': 'no-cache',
        },
        referrer: 'https://x.com/',
        referrerPolicy: 'strict-origin-when-cross-origin',
        responseType: 'arraybuffer',
        timeout: CONFIG.fetchTimeoutMs,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300 && res.response) {
            const header = (res.responseHeaders || '').match(/content-type:\s*([^\r\n;]+)/i);
            const mime = (header && header[1] ? header[1] : guessMime(url)).trim();
            resolve({ bytes: new Uint8Array(res.response), mime });
          } else {
            const error = new Error(`HTTP ${res.status} for ${url}`);
            error.status = res.status;
            reject(error);
          }
        },
        onerror: (event) =>
          reject(
            new Error(`${(event && (event.error || event.message)) || 'Network error'} for ${url}`)
          ),
        ontimeout: () => reject(new Error(`Timeout (${CONFIG.fetchTimeoutMs}ms) for ${url}`)),
      });
    });
  }

  async function gmFetchBytes(url) {
    const attempts = Math.max(1, Number(CONFIG.mediaFetchRetries) || 1);
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await gmFetchBytesOnce(url);
        if (!result.bytes || !result.bytes.length) throw new Error(`Empty response for ${url}`);
        return result;
      } catch (error) {
        lastError = error;
        // 404 is authoritative for this exact URL - stop burning retries here so
        // the caller can move on to its next size-variant candidate immediately.
        if (error.status === 404) break;
        if (attempt < attempts) {
          const factor = error.status === 429 ? CONFIG.rateLimitBackoffFactor : 1;
          await sleep(CONFIG.mediaFetchRetryBaseMs * attempt * factor);
        }
      }
    }
    throw lastError || new Error(`Fetch failed for ${url}`);
  }

  function guessMime(url) {
    const u = url.split('?')[0].toLowerCase();
    if (u.endsWith('.png')) return 'image/png';
    if (u.endsWith('.gif')) return 'image/gif';
    if (u.endsWith('.webp')) return 'image/webp';
    if (u.endsWith('.mp4')) return 'video/mp4';
    if (u.endsWith('.svg')) return 'image/svg+xml';
    return 'image/jpeg';
  }

  /** ArrayBuffer/Uint8Array -> base64 (chunked to avoid call-stack limits). */
  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /** base64 string -> Uint8Array (inverse of bytesToBase64; atob exists in Node 18+). */
  function base64ToBytes(b64) {
    const binary = atob(String(b64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** "data:<mime>[;base64],<payload>" -> { bytes, mime }. */
  function dataUriToBytes(dataUri) {
    const s = String(dataUri || '');
    const comma = s.indexOf(',');
    if (comma === -1 || !s.startsWith('data:')) return { bytes: new Uint8Array(0), mime: '' };
    const header = s.slice(5, comma);
    const mime = header.split(';')[0] || '';
    const payload = s.slice(comma + 1);
    const bytes = /;base64/i.test(header)
      ? base64ToBytes(payload)
      : new TextEncoder().encode(decodeURIComponent(payload));
    return { bytes, mime };
  }

  /** MIME -> a sensible file extension for sidecar media files. */
  function mimeToExt(mime) {
    switch (String(mime || '').toLowerCase()) {
      case 'image/jpeg':
      case 'image/jpg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/gif':
        return 'gif';
      case 'image/webp':
        return 'webp';
      case 'image/svg+xml':
        return 'svg';
      case 'video/mp4':
        return 'mp4';
      default:
        return 'bin';
    }
  }

  /**
   * PURE: decide the on-disk folder names for one export, given the user's layout pref.
   * `date` is a pre-formatted "YYYY-MM-DD" string (caller supplies the local date). Returns the
   * directory segments from the chosen root down to the per-post folder. The post-folder name is
   * stable (handle + status id) so re-exporting the same post overwrites instead of duplicating.
   */
  function bundlePaths(model, prefs, date) {
    const layout = prefs && prefs.layout === 'flat' ? 'flat' : 'date';
    const handle = String((model.author && model.author.handle) || '').replace(/^@/, '');
    const statusId = statusIdFromSourceUrl(model.sourceUrl || '');
    let postName;
    if (handle && statusId) postName = `${slugify(handle)}-${statusId}`;
    else if (statusId) postName = `post-${statusId}`;
    else postName = slugify(model.title || model.heading || 'x-export');
    const dateFolder = String(date || '');
    if (layout === 'flat') {
      const folder = dateFolder ? `${dateFolder}_${postName}` : postName;
      return { layout, dateFolder, postName, postFolder: folder, segments: [folder] };
    }
    return {
      layout,
      dateFolder,
      postName,
      postFolder: postName,
      segments: dateFolder ? [dateFolder, postName] : [postName],
    };
  }

  /** Local "YYYY-MM-DD" for date-grouped folders (the user's day, not UTC). */
  function localDateStamp(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function normalizeTags(value) {
    const input = Array.isArray(value) ? value : String(value || '').split(',');
    const seen = new Set();
    return input
      .map((tag) =>
        String(tag || '')
          .trim()
          .replace(/^#+/, '')
          .replace(/\s+/g, '-')
      )
      .filter((tag) => {
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20);
  }

  function applyCaptureMetadata(model, metadata = {}) {
    model.userNote = String(metadata.note || '')
      .trim()
      .slice(0, 2000);
    model.tags = normalizeTags(metadata.tags);
    return model;
  }

  function libraryIndexEntry(model, paths, stats) {
    const id = statusIdFromSourceUrl(model.sourceUrl) || slugify(model.title || 'capture');
    const relativePath = [...paths.segments, `${paths.postName}.llm.md`].join('/');
    return {
      id,
      title: markdownLineText(model.heading || model.title || 'X capture'),
      author: markdownLineText(
        [model.author && model.author.name, model.author && model.author.handle]
          .filter(Boolean)
          .join(' ')
      ),
      type: model.thread ? `thread (${model.thread.capturedPosts} posts)` : model.type || 'post',
      sourceUrl: model.sourceUrl || '',
      savedAt: safeIsoTime(model.exportedAt),
      path: relativePath,
      note: markdownLineText(model.userNote || ''),
      tags: normalizeTags(model.tags),
      capture: `${stats.images} image(s), ${stats.videos} video(s), ${stats.incompleteMedia} incomplete, ${stats.missingMedia} missing`,
    };
  }

  function renderLibraryIndexItem(entry) {
    const lines = [
      `<!-- sourcecapsule:item:${entry.id} -->`,
      `## ${entry.title || 'X capture'}`,
      '',
      `- ID: ${entry.id}`,
      `- Type: ${entry.type}`,
      `- Author: ${entry.author || 'Unknown'}`,
      `- Source: ${entry.sourceUrl}`,
      `- Saved: ${entry.savedAt}`,
      `- File: ${entry.path}`,
      `- Capture: ${entry.capture}`,
    ];
    if (entry.tags && entry.tags.length) lines.push(`- Tags: ${entry.tags.join(', ')}`);
    if (entry.note) lines.push(`- Saved because: ${entry.note}`);
    lines.push('', `<!-- /sourcecapsule:item:${entry.id} -->`);
    return lines.join('\n');
  }

  function updateLibraryIndexText(existing, entry) {
    const header = '# SourceCapsule Library Index\n\n<!-- sourcecapsule:index:v1 -->\n';
    const current = String(existing || '').trim() || header.trim();
    const escapedId = String(entry.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `<!-- sourcecapsule:item:${escapedId} -->[\\s\\S]*?<!-- /sourcecapsule:item:${escapedId} -->`,
      'g'
    );
    const item = renderLibraryIndexItem(entry);
    if (pattern.test(current)) return `${current.replace(pattern, item).trim()}\n`;
    return `${current.trim()}\n\n${item}\n`;
  }

  // ---------------------------------------------------------------------------
  // Store-only ZIP writer (no dependency). Used only as the fallback delivery on
  // browsers without the File System Access API. Media is already compressed, so
  // we store (method 0) rather than deflate - simpler and effectively the same size.
  // ---------------------------------------------------------------------------
  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Build a store-only ZIP from `[{ name, bytes }]` -> Uint8Array. Names use forward slashes
   * (e.g. "media/image-001.jpg") and must be ASCII. No timestamps (set to 0).
   */
  function buildZip(entries) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
    const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

    for (const entry of entries) {
      const nameBytes = enc.encode(entry.name);
      const data = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
      const crc = crc32(data);
      const local = [
        ...u32(0x04034b50), // local file header signature
        ...u16(20), // version needed
        ...u16(0), // flags
        ...u16(0), // method: store
        ...u16(0), // mod time
        ...u16(0), // mod date
        ...u32(crc),
        ...u32(data.length), // compressed size
        ...u32(data.length), // uncompressed size
        ...u16(nameBytes.length),
        ...u16(0), // extra length
      ];
      chunks.push(new Uint8Array(local), nameBytes, data);
      central.push({ nameBytes, crc, size: data.length, offset });
      offset += local.length + nameBytes.length + data.length;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) {
      const header = [
        ...u32(0x02014b50), // central directory header signature
        ...u16(20), // version made by
        ...u16(20), // version needed
        ...u16(0), // flags
        ...u16(0), // method: store
        ...u16(0), // mod time
        ...u16(0), // mod date
        ...u32(c.crc),
        ...u32(c.size),
        ...u32(c.size),
        ...u16(c.nameBytes.length),
        ...u16(0), // extra length
        ...u16(0), // comment length
        ...u16(0), // disk number start
        ...u16(0), // internal attrs
        ...u32(0), // external attrs
        ...u32(c.offset),
      ];
      chunks.push(new Uint8Array(header), c.nameBytes);
      centralSize += header.length + c.nameBytes.length;
    }

    const end = [
      ...u32(0x06054b50), // end of central directory signature
      ...u16(0), // disk number
      ...u16(0), // disk with central dir
      ...u16(central.length),
      ...u16(central.length),
      ...u32(centralSize),
      ...u32(centralStart),
      ...u16(0), // comment length
    ];
    chunks.push(new Uint8Array(end));

    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  async function sha256Hex(bytes) {
    if (typeof crypto === 'undefined' || !crypto.subtle) return '';
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /** Fetch a URL and return it as a data: URI (plus size for the cap check). */
  async function fetchAsDataUri(url) {
    const { bytes, mime } = await gmFetchBytes(url);
    const sha256 = await sha256Hex(bytes);
    return {
      dataUri: `data:${mime};base64,${bytesToBase64(bytes)}`,
      bytes,
      size: bytes.length,
      mime,
      sha256: sha256 ? `sha256:${sha256}` : '',
    };
  }

  function bytesAscii(bytes, offset, length) {
    if (!bytes || bytes.length < offset + length) return '';
    let out = '';
    for (let i = offset; i < offset + length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  function mp4HasBox(bytes, boxType) {
    if (!bytes || !boxType) return false;
    const needle = String(boxType);
    for (let i = 4; i <= bytes.length - 4; i++) {
      if (bytesAscii(bytes, i, 4) === needle) return true;
    }
    return false;
  }

  function validateMp4Download({ bytes, size, mime, url }) {
    const actualSize = Number(size || (bytes && bytes.length) || 0);
    const isVideo = /^video\//i.test(mime || '') || /octet-stream/i.test(mime || '');
    if (!isVideo) throw new Error(`unexpected content-type ${mime || 'unknown'}`);
    if (actualSize < CONFIG.video.minPlayableBytes) {
      throw new Error(`video response too small (${humanBytes(actualSize)})`);
    }
    if (
      String(url || '')
        .toLowerCase()
        .includes('.mp4') &&
      !mp4HasBox(bytes, 'mdat')
    ) {
      throw new Error('mp4 response has no media data box');
    }
  }

  function detectedImageMime(bytes) {
    if (!bytes || bytes.length < 12) return '';
    const starts = (...values) => values.every((value, index) => bytes[index] === value);
    if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
    const head = bytesAscii(bytes, 0, 12);
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
    if (head.startsWith('BM')) return 'image/bmp';
    if (bytesAscii(bytes, 4, 4) === 'ftyp') {
      const brand = bytesAscii(bytes, 8, 4).toLowerCase();
      if (['avif', 'avis'].includes(brand)) return 'image/avif';
      if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    }
    return '';
  }

  /** Reject HTTP-200 error pages masquerading as image downloads. */
  function validateImageDownload({ bytes, size, mime }) {
    const actualSize = Number(size || (bytes && bytes.length) || 0);
    if (actualSize < 12) throw new Error(`image response too small (${humanBytes(actualSize)})`);
    const declared = String(mime || '').toLowerCase();
    const detected = detectedImageMime(bytes);
    const prefix = bytesAscii(bytes, 0, Math.min(actualSize, 256)).trimStart().toLowerCase();
    if (/^(?:<!doctype\s+html|<html|<head|<body|\{\s*"(?:error|errors|message)")/.test(prefix)) {
      throw new Error('image response contained an HTML/JSON error document');
    }
    if (!detected && !/^image\//i.test(declared)) {
      throw new Error(`unexpected image content-type ${mime || 'unknown'}`);
    }
    return detected || declared;
  }

  function imageFetchCandidates(url) {
    const out = [];
    const add = (candidate) => {
      if (candidate && !out.includes(candidate)) out.push(candidate);
    };
    add(url);
    try {
      const u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      // Photo AND video-thumbnail paths accept the same `name=` size variants;
      // the original URL stays first, so extra candidates only run on failure.
      if (
        u.hostname === 'pbs.twimg.com' &&
        /^\/(media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//.test(u.pathname)
      ) {
        const originalName = u.searchParams.get('name');
        ['orig', '4096x4096', 'large', 'medium', 'small'].forEach((name) => {
          const next = new URL(u.toString());
          next.searchParams.set('name', name);
          add(next.toString());
        });
        if (originalName) {
          const next = new URL(u.toString());
          next.searchParams.set('name', originalName);
          add(next.toString());
        }
      }
    } catch {
      // Keep the original candidate only.
    }
    return out;
  }

  async function fetchImageAsDataUri(url) {
    let lastError = null;
    for (const candidate of imageFetchCandidates(url)) {
      try {
        const fetched = await fetchAsDataUri(candidate);
        const validatedMime = validateImageDownload(fetched);
        if (validatedMime && validatedMime !== fetched.mime) {
          fetched.mime = validatedMime;
          fetched.dataUri = `data:${validatedMime};base64,${bytesToBase64(fetched.bytes)}`;
        }
        return fetched;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error(`image fetch failed for ${url}`);
  }

  /** Rewrite a pbs.twimg.com image URL to its full-resolution variant. */
  function highResImageUrl(url) {
    try {
      const base = typeof location !== 'undefined' ? location.href : undefined;
      const u = new URL(url, base);
      if (u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/')) {
        if (CONFIG.image.preferOriginal) {
          const fmt = u.searchParams.get('format') || 'jpg';
          u.searchParams.set('format', fmt);
          u.searchParams.set('name', 'orig');
        }
        return u.toString();
      }
      // Bump avatar size where the URL uses the _normal/_bigger suffix convention.
      if (
        u.hostname === 'pbs.twimg.com' &&
        /_(normal|bigger|mini|x96|200x200)\./.test(u.pathname)
      ) {
        return u.toString().replace(/_(normal|bigger|mini|x96|200x200)\./, '_400x400.');
      }
      return url;
    } catch {
      return url;
    }
  }

  // ===========================================================================
  // FRAGILE LAYER - read X's DOM, produce the normalized model
  // ---------------------------------------------------------------------------
  // MODEL SHAPE
  // {
  //   type: 'article' | 'post',
  //   title, sourceUrl, exportedAt,
  //   author: { name, handle, avatarUrl, avatarDataUri? },
  //   blocks: Block[]
  // }
  // Block:
  //   { kind: 'heading', level, text }
  //   { kind: 'paragraph', html }              // sanitized inline html
  //   { kind: 'list', ordered, items: html[] }
  //   { kind: 'divider' }
  //   { kind: 'code', text }
  //   { kind: 'blockquote', blocks }
  //   { kind: 'image', url, alt, dataUri? }
  //   { kind: 'video', posterUrl, mp4Url?, sourceUrl, mode?, dataUri?, posterDataUri? }
  //   { kind: 'quote', author, blocks, sourceUrl } // a rebuilt quoted tweet
  // ===========================================================================

  function detectPageType() {
    const p = location.pathname;
    if (/\/i\/article\//.test(p) || /\/article\//.test(p)) return 'article';
    if (pick(document, CONFIG.selectors.articleTextRoot, { quiet: true })) return 'article';
    if (pick(document, CONFIG.selectors.articleRoot, { quiet: true })) return 'article';
    if (/\/status\/\d+/.test(p)) return 'post';
    return null;
  }

  function statusIdFromUrl(url) {
    const match = String(url || '').match(/\/status\/(\d+)/);
    return match ? match[1] : '';
  }

  function normalizeStatusUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url, location.origin);
      const match = u.pathname.match(/^(.*\/status\/\d+)/);
      return match ? `${u.origin}${match[1]}` : u.href.split('?')[0];
    } catch {
      return String(url).split('?')[0];
    }
  }

  function currentStatusId() {
    return statusIdFromUrl(location.pathname);
  }

  function canonicalUrl(root = document, expectedStatusId = currentStatusId()) {
    // Prefer the matching permalink carried by a <time> element in this context.
    const timeLinks = pickAll(root, CONFIG.selectors.timeLink)
      .map((t) => t.closest('a'))
      .filter((a) => a && a.href);
    const matchingTimeLink =
      expectedStatusId && timeLinks.find((a) => statusIdFromUrl(a.href) === expectedStatusId);
    const firstTimeLink = matchingTimeLink || timeLinks[0];
    if (firstTimeLink) return normalizeStatusUrl(firstTimeLink.href);
    return location.href.split('?')[0];
  }

  function findTweetForCurrentStatus(column) {
    const id = currentStatusId();
    const tweets = topLevelTweetEls(column);
    if (!id) return tweets[0] || null;
    return (
      tweets.find((tweet) => {
        const timeLinks = pickAll(tweet, CONFIG.selectors.timeLink);
        return timeLinks.some((t) => {
          const a = t.closest('a');
          return a && statusIdFromUrl(a.href) === id;
        });
      }) ||
      tweets.find((tweet) =>
        Array.from(tweet.querySelectorAll('a[href*="/status/"]')).some(
          (a) => statusIdFromUrl(a.href) === id
        )
      ) ||
      tweets[0] ||
      null
    );
  }

  function closestAny(el, selectors) {
    if (!el) return null;
    for (const selector of selectors) {
      const found = el.closest(selector);
      if (found) return found;
    }
    return null;
  }

  function topLevelTweetEls(root) {
    return pickAll(root, CONFIG.selectors.tweet).filter(
      (tweet) => !closestAny(tweet.parentElement, CONFIG.selectors.tweet)
    );
  }

  function compareDocumentOrder(a, b) {
    if (a === b) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  function tweetStatusId(tweetEl) {
    // A quoted card carries its own permalink inside the outer tweet. Taking the
    // first <time> therefore returns the quote id, which also breaks chronological
    // thread validation. Exclude quote cards and nested tweet articles first.
    const quoteEls = findQuotedTweetEls(tweetEl);
    const belongsToOuterTweet = (el) => {
      if (quoteEls.some((quote) => quote.contains(el))) return false;
      return closestAny(el, CONFIG.selectors.tweet) === tweetEl;
    };
    const timeLink = pickAll(tweetEl, CONFIG.selectors.timeLink).find(belongsToOuterTweet);
    const timeAnchor = timeLink && timeLink.closest('a');
    if (timeAnchor && timeAnchor.href) return statusIdFromUrl(timeAnchor.href);
    const statusAnchor = Array.from(tweetEl.querySelectorAll('a[href*="/status/"]')).find(
      belongsToOuterTweet
    );
    return statusAnchor ? statusIdFromUrl(statusAnchor.href) : '';
  }

  function elementTextPreview(el, max = 500) {
    return ((el && (el.innerText || el.textContent)) || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function elementHtmlPreview(el, max = 30000) {
    return ((el && el.outerHTML) || '').slice(0, max);
  }

  function elementBox(el) {
    const r = el.getBoundingClientRect && el.getBoundingClientRect();
    if (!r) return null;
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  function imageDimensions(img) {
    const width = Math.round(img.naturalWidth || img.width || 0);
    const height = Math.round(img.naturalHeight || img.height || 0);
    return {
      width: width > 0 ? width : undefined,
      height: height > 0 ? height : undefined,
    };
  }

  function findTweetImageEls(root) {
    return pickAllMatchesIncludingRoot(root, CONFIG.selectors.tweetPhoto).filter((img) => {
      const src = img.src || '';
      return src.includes('pbs.twimg.com/media/');
    });
  }

  function summarizeTweetEl(tweetEl, index) {
    const author = extractAuthor(tweetEl);
    const statusId = tweetStatusId(tweetEl);
    return {
      index,
      statusId,
      sourceUrl: canonicalUrl(tweetEl, statusId),
      author,
      textPreview: elementTextPreview(tweetEl),
      imageCandidateCount: findTweetImageEls(tweetEl).length,
      videoCandidateCount: pickAll(tweetEl, CONFIG.selectors.videoPlayer).length,
      quoteCandidateCount: findQuotedTweetEls(tweetEl).length,
      box: elementBox(tweetEl),
    };
  }

  function collectMediaDebug(tweetEl, quoteEls) {
    const quoteIndexFor = (el) => quoteEls.findIndex((quoteEl) => quoteEl.contains(el));
    const ownerStatusIdFor = (el) => {
      const ownerTweet = closestAny(el, CONFIG.selectors.tweet);
      return ownerTweet ? tweetStatusId(ownerTweet) : '';
    };
    return {
      images: findTweetImageEls(tweetEl).map((img, index) => ({
        index,
        src: img.src || '',
        highResUrl: img.src ? highResImageUrl(img.src) : '',
        alt: img.alt || '',
        quoteIndex: quoteIndexFor(img),
        ownerStatusId: ownerStatusIdFor(img),
        textPreview: elementTextPreview(img.closest('div, article') || img, 200),
        box: elementBox(img),
      })),
      videos: pickAll(tweetEl, CONFIG.selectors.videoPlayer).map((vp, index) => {
        const videoEl = vp.querySelector('video');
        const candidates = videoCandidatesFromPlayer(vp);
        return {
          index,
          posterUrl:
            (videoEl && videoEl.poster) ||
            (vp.querySelector('img') && vp.querySelector('img').src) ||
            '',
          mp4Url: (candidates.find((candidate) => candidate.kind === 'mp4') || {}).url || '',
          candidates,
          quoteIndex: quoteIndexFor(vp),
          ownerStatusId: ownerStatusIdFor(vp),
          textPreview: elementTextPreview(vp.closest('div, article') || vp, 200),
          box: elementBox(vp),
        };
      }),
    };
  }

  function collectPostDebug(column, focusedTweet, tweetEls, model) {
    const topTweets = topLevelTweetEls(column);
    return {
      app: APP,
      version: VERSION,
      pageUrl: location.href,
      currentStatusId: currentStatusId(),
      modelSummary: {
        title: model.title,
        sourceUrl: model.sourceUrl,
        blockKinds: model.blocks.map((b) => b.kind),
        paragraphCount: model.blocks.filter((b) => b.kind === 'paragraph').length,
        imageCount: model.blocks.filter((b) => b.kind === 'image').length,
        videoCount: model.blocks.filter((b) => b.kind === 'video').length,
        quoteCount: model.blocks.filter((b) => b.kind === 'quote').length,
      },
      focusedTweet: summarizeTweetEl(focusedTweet, topTweets.indexOf(focusedTweet)),
      selectedSequence: tweetEls.map((tweetEl) =>
        summarizeTweetEl(tweetEl, topTweets.indexOf(tweetEl))
      ),
      topLevelTweets: topTweets.map((tweetEl, index) => summarizeTweetEl(tweetEl, index)),
      selectedTweetDiagnostics: tweetEls.map((tweetEl, index) => {
        const quoteEls = findQuotedTweetEls(tweetEl);
        return {
          sequenceIndex: index,
          tweet: summarizeTweetEl(tweetEl, topTweets.indexOf(tweetEl)),
          quotes: quoteEls.map((quoteEl, quoteIndex) => ({
            quoteIndex,
            sourceUrl: normalizeStatusUrl(
              (quoteEl.querySelector('a[href*="/status/"]') || {}).href || ''
            ),
            author: extractAuthor(quoteEl),
            textPreview: elementTextPreview(quoteEl),
            media: collectMediaDebug(quoteEl, []),
            htmlPreview: elementHtmlPreview(quoteEl, 15000),
          })),
          media: collectMediaDebug(tweetEl, quoteEls),
          htmlPreview: elementHtmlPreview(tweetEl, 50000),
        };
      }),
    };
  }

  /**
   * Capture EVERY <img> and CSS background-image under a node, unfiltered by
   * host. The normal media path only accepts `pbs.twimg.com/media/` <img>s, so
   * this reveals whether embedded-tweet media is (a) absent from the DOM
   * entirely (lazy-load) or (b) present but in a shape the selector misses.
   */
  function rawImageSignals(node) {
    const imgs = Array.from(node.querySelectorAll('img')).map((im) => ({
      src: (im.currentSrc || im.src || im.getAttribute('src') || '').slice(0, 180),
      dataSrc: (im.getAttribute('data-src') || im.getAttribute('data-image-url') || '').slice(
        0,
        180
      ),
      alt: (im.alt || '').slice(0, 60),
      naturalWidth: im.naturalWidth || 0,
      complete: !!im.complete,
      isMedia: (im.currentSrc || im.src || '').includes('pbs.twimg.com/media/'),
    }));
    const backgrounds = [];
    node.querySelectorAll('[style*="background-image"]').forEach((el) => {
      const m = (el.getAttribute('style') || '').match(
        /background-image:\s*url\(["']?([^"')]+)["']?\)/i
      );
      if (m) backgrounds.push(m[1].slice(0, 180));
    });
    return { imgs, backgrounds };
  }

  function collectArticleDebug(root, quoteEls, model) {
    const richRoot = pick(root, CONFIG.selectors.articleTextRoot, { quiet: true });
    const rootSig = rawImageSignals(root);
    return {
      app: APP,
      version: VERSION,
      pageUrl: location.href,
      articleRootTag: root.tagName ? root.tagName.toLowerCase() : '',
      richRootFound: !!richRoot,
      modelSummary: {
        title: model.title,
        blockKinds: model.blocks.map((b) => b.kind),
        imageCount: model.blocks.filter((b) => b.kind === 'image').length,
        videoCount: model.blocks.filter((b) => b.kind === 'video').length,
        quoteCount: model.blocks.filter((b) => b.kind === 'quote').length,
      },
      rootSignals: {
        totalImgs: rootSig.imgs.length,
        mediaImgs: rootSig.imgs.filter((i) => i.isMedia).length,
        backgroundImages: rootSig.backgrounds.length,
        embeddedTweetCount: quoteEls.length,
        harvestedMediaCount: harvestedMedia.size,
        capturedImageCount: capturedImageUrls.size,
      },
      embeddedTweets: quoteEls.map((q, index) => {
        const sig = rawImageSignals(q);
        return {
          index,
          statusId: tweetStatusId(q),
          textPreview: elementTextPreview(q, 140),
          imgCandidatesMediaFilter: findTweetImageEls(q).length, // what extraction would use
          allImgCount: sig.imgs.length, // every <img> under the quote
          imgs: sig.imgs.slice(0, 10),
          backgroundImages: sig.backgrounds.slice(0, 10),
          videoCount: pickAll(q, CONFIG.selectors.videoPlayer).length,
          box: elementBox(q),
          outerHtmlPreview: elementHtmlPreview(q, 1200),
        };
      }),
    };
  }

  function threadTweetCandidates(column) {
    const byId = new Map();
    topLevelTweetEls(column).forEach((tweet) => {
      const id = tweetStatusId(tweet);
      if (id) byId.set(id, { tweet, y: absY(tweet) });
    });
    harvestedTweets.forEach((snapshot, id) => {
      if (!byId.has(id)) byId.set(id, snapshot);
    });
    return Array.from(byId.values())
      .sort((a, b) => a.y - b.y)
      .map((item) => item.tweet);
  }

  const THREAD_BOUNDARY_FLAG = 'data-sourcecapsule-thread-boundary-before';
  const THREAD_BOUNDARY_TEXT =
    /\b(?:discover more|more posts|recommended|you might like)\b|发现更多|探索更多|更多帖子|更多貼文|さらに見つける|더 찾아보기|temui lebih banyak/i;

  /**
   * True when X placed a non-conversation section between this post and the
   * previous top-level post. Prefer semantic headings so this survives localized
   * UI text; keep a small text fallback because X sometimes renders the heading
   * as an unlabelled div. Harvested clones carry the result as a data attribute.
   */
  function hasThreadBoundaryBefore(tweet, column) {
    if (!tweet) return false;
    if (tweet.getAttribute && tweet.getAttribute(THREAD_BOUNDARY_FLAG) === '1') return true;
    if (!tweet.isConnected || !column || !document.createRange) return false;
    const tweets = topLevelTweetEls(column).sort(compareDocumentOrder);
    const index = tweets.indexOf(tweet);
    if (index <= 0) return false;
    try {
      const range = document.createRange();
      range.setStartAfter(tweets[index - 1]);
      range.setEndBefore(tweet);
      const between = range.cloneContents();
      const headingSelector = CONFIG.selectors.threadBoundaryHeading.join(',');
      if (
        Array.from(between.querySelectorAll(headingSelector)).some((heading) =>
          String(heading.textContent || '').trim()
        )
      ) {
        return true;
      }
      return THREAD_BOUNDARY_TEXT.test(String(between.textContent || '').replace(/\s+/g, ' '));
    } catch {
      return false;
    }
  }

  /** Twitter status IDs are time-ordered snowflakes; thread replies must be newer. */
  function statusIdIsAfter(candidateId, previousId) {
    const candidate = String(candidateId || '').replace(/^0+/, '');
    const previous = String(previousId || '').replace(/^0+/, '');
    if (!candidate || !previous || !/^\d+$/.test(candidate) || !/^\d+$/.test(previous)) return true;
    if (candidate.length !== previous.length) return candidate.length > previous.length;
    return candidate > previous;
  }

  function buildTweetSequence(column, focusedTweet) {
    const tweets = threadTweetCandidates(column);
    const focusedId = tweetStatusId(focusedTweet);
    const startIndex = tweets.findIndex(
      (tweet) => tweet === focusedTweet || (focusedId && tweetStatusId(tweet) === focusedId)
    );
    if (startIndex < 0) return [focusedTweet];

    const focusedAuthor = extractAuthor(focusedTweet);
    const focusedHandle = focusedAuthor.handle;
    const seenIds = new Set();
    const sequence = [];

    for (const tweet of tweets.slice(startIndex)) {
      const id = tweetStatusId(tweet);
      if (id && seenIds.has(id)) continue;

      const author = extractAuthor(tweet);
      const sameAuthor = focusedHandle && author.handle === focusedHandle;
      if (sequence.length > 0 && !sameAuthor) break;
      if (sequence.length > 0) {
        const previous = sequence[sequence.length - 1];
        if (
          hasThreadBoundaryBefore(tweet, column) ||
          !statusIdIsAfter(id, tweetStatusId(previous))
        ) {
          break;
        }
      }

      sequence.push(tweet);
      if (id) seenIds.add(id);
    }

    return sequence.length ? sequence : [focusedTweet];
  }

  /** Convert a text node tree into sanitized inline HTML (links/emoji). */
  function inlineHtmlFromNode(textEl, excludeEls = [], { preserveFormatting = false } = {}) {
    if (!textEl) return '';
    const excludes = Array.isArray(excludeEls) ? excludeEls : excludeEls ? [excludeEls] : [];
    const isExcluded = (el) =>
      excludes.some((excludeEl) => el === excludeEl || excludeEl.contains(el));
    const isUiElement = (el) => {
      const href = el.href || '';
      const aria = el.getAttribute('aria-label') || '';
      return Boolean(
        isExcluded(el) ||
        el.matches(
          [
            'div[data-testid="User-Name"]',
            'div[data-testid="Tweet-User-Avatar"]',
            'div[role="group"]',
            'time',
          ].join(',')
        ) ||
        el.closest('div[role="group"]') ||
        (el.tagName.toLowerCase() === 'a' && el.querySelector('time')) ||
        /\/analytics(?:$|[/?#])/.test(href) ||
        /\/photo\/\d+(?:$|[/?#])/.test(href) ||
        /\b(repl|repost|like|view|bookmark|share)\b/i.test(aria)
      );
    };
    const isBoldElement = (el) => {
      const style = (el.getAttribute('style') || '').toLowerCase();
      const weight = style.match(/font-weight:\s*([0-9]+)/);
      return (
        el.tagName.toLowerCase() === 'strong' ||
        el.tagName.toLowerCase() === 'b' ||
        /font-weight:\s*(bold|[6-9]00)/.test(style) ||
        (weight && Number(weight[1]) >= 600)
      );
    };
    const isItalicElement = (el) => {
      const style = (el.getAttribute('style') || '').toLowerCase();
      const tag = el.tagName.toLowerCase();
      return tag === 'em' || tag === 'i' || /font-style:\s*italic/.test(style);
    };
    const walk = (node) => {
      let out = '';
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.textContent.trim() !== 'Show more') out += escapeHtml(child.textContent);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (isUiElement(child)) return;
          const tag = child.tagName.toLowerCase();
          if (tag === 'img' && child.alt) {
            out += escapeHtml(child.alt); // X renders emoji as <img alt=":)">
          } else if (tag === 'a') {
            const href = safeUrl(child.href || '');
            const inner = walk(child) || escapeHtml(child.textContent);
            out += href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
          } else if (tag === 'br') {
            out += '<br>';
          } else if (preserveFormatting && (tag === 'code' || tag === 'kbd')) {
            const inner = walk(child);
            if (inner) out += `<code>${inner}</code>`;
          } else if (preserveFormatting && isBoldElement(child)) {
            const inner = walk(child);
            if (inner) out += `<strong>${inner}</strong>`;
          } else if (preserveFormatting && isItalicElement(child)) {
            const inner = walk(child);
            if (inner) out += `<em>${inner}</em>`;
          } else {
            out += walk(child);
          }
        }
      });
      return out;
    };
    const out = walk(textEl);
    return out.trim();
  }

  /** Convert a tweet's text node tree into sanitized inline HTML (links/emoji). */
  function inlineHtmlFromTweetText(textEl, excludeEls = []) {
    return inlineHtmlFromNode(textEl, excludeEls);
  }

  function inlineHtmlFromArticleBlock(el) {
    return inlineHtmlFromNode(el, [], { preserveFormatting: true });
  }

  function articleDividerText(text) {
    const t = String(text || '').trim();
    const compact = t.replace(/\s+/g, '');
    return /^[-_]{3,}$/.test(compact) || /^[\u2013\u2014\u2500\u2501]{2,}$/.test(compact);
  }

  function pxNumber(value) {
    const n = Number.parseFloat(String(value || '').replace('px', ''));
    return Number.isFinite(n) ? n : 0;
  }

  function articleDividerElement(el) {
    if (!el) return false;
    const text = normalizeArticleStructureText(el.innerText || el.textContent || '');
    if (articleDividerText(text)) return true;
    if (text) return false;

    const nodes = [el, ...Array.from(el.querySelectorAll ? el.querySelectorAll('*') : [])];
    return nodes.some((node) => {
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (tag === 'hr') return true;
      const attrs = [
        node.getAttribute && node.getAttribute('role'),
        node.getAttribute && node.getAttribute('class'),
        node.getAttribute && node.getAttribute('data-testid'),
        node.getAttribute && node.getAttribute('data-type'),
        node.getAttribute && node.getAttribute('aria-label'),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (/\b(separator|divider|horizontal-rule|horizontalrule|hr)\b/.test(attrs)) return true;

      const style = String((node.getAttribute && node.getAttribute('style')) || '').toLowerCase();
      if (/border-(top|bottom)\s*:/.test(style) && !/border-left\s*:/.test(style)) return true;
      if (/height\s*:\s*[12]px/.test(style) && /background/.test(style)) return true;

      if (typeof getComputedStyle === 'function' && node.nodeType === 1) {
        try {
          const cs = getComputedStyle(node);
          const hasRule = pxNumber(cs.borderTopWidth) >= 1 || pxNumber(cs.borderBottomWidth) >= 1;
          const box = node.getBoundingClientRect && node.getBoundingClientRect();
          const lineLike = box && box.width >= 40 && box.height <= 10;
          if (hasRule && lineLike) return true;
        } catch {
          // Best effort only; inline styles/attrs still cover static tests.
        }
      }
      return false;
    });
  }

  function articleShortTitleLikeText(text) {
    const t = normalizeArticleStructureText(text);
    if (!/[\u4e00-\u9fff]/.test(t)) return false;
    if (t.length < 2 || t.length > 24) return false;
    if (/[\u3002\uff0c,\u3001\uff1b;\uff01!]/.test(t)) return false;
    return /^[\u4e00-\u9fffA-Za-z0-9\s"'`/()\uff08\uff09-]+[\uff1f?]?$/.test(t);
  }

  function fontWeightValue(value) {
    const s = String(value || '').toLowerCase();
    if (s === 'bold' || s === 'bolder') return 700;
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : 400;
  }

  function articleHeadingVisualElement(el) {
    if (!el) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (/^h[1-6]$/.test(tag)) return true;

    const attrs = [
      el.getAttribute && el.getAttribute('role'),
      el.getAttribute && el.getAttribute('class'),
      el.getAttribute && el.getAttribute('data-testid'),
      el.getAttribute && el.getAttribute('data-type'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (/\b(heading|title|subtitle|headline)\b/.test(attrs)) return true;

    const text = normalizeArticleStructureText(el.innerText || el.textContent || '');
    if (!articleShortTitleLikeText(text)) return false;

    const style = String((el.getAttribute && el.getAttribute('style')) || '').toLowerCase();
    if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) return true;
    if (/font-size\s*:\s*(?:1[9-9]|[2-9][0-9])px/.test(style)) return true;

    const strongText = Array.from(el.querySelectorAll ? el.querySelectorAll('strong,b') : [])
      .map((node) => normalizeArticleStructureText(node.innerText || node.textContent || ''))
      .join(' ');
    if (strongText && normalizeArticleStructureText(strongText) === text) return true;

    if (typeof getComputedStyle === 'function' && el.nodeType === 1) {
      try {
        const cs = getComputedStyle(el);
        if (fontWeightValue(cs.fontWeight) >= 600 || pxNumber(cs.fontSize) >= 19) return true;
      } catch {
        // Best effort only; attributes/inline styles/strong tags cover static tests.
      }
    }
    return false;
  }

  function normalizeArticleStructureText(text) {
    return String(text || '')
      .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function articleHeadingBlock(text) {
    const t = normalizeArticleStructureText(text);
    const compact = t.replace(/\s*([:\uff1a\u3001.-])\s*/g, '$1');
    if (!t) return null;
    const markdown = t.match(/^(#{1,6})\s+(.+)$/);
    if (markdown) {
      return {
        level: Math.min(4, markdown[1].length + 1),
        text: markdown[2].trim(),
      };
    }
    if (
      /^\u7b2c\s*[\u4e00-\u9fff0-9]+\s*[\u7ae0\u8282\u7bc7\u90e8\u8bb2\u8bfe][\s:\uff1a\u3001.-]*/.test(
        compact
      )
    ) {
      return { level: 2, text: t };
    }
    if (
      /^[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07]+\u3001\S/.test(
        compact
      )
    ) {
      return { level: 2, text: t };
    }
    if (
      /^[(\uff08][\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07]+[)\uff09]\S/.test(
        compact
      )
    ) {
      return { level: 3, text: t };
    }
    const section = compact.match(/^(\d+(?:\.\d+)+)\S/);
    if (section && !/[\u3002\uff0c,\uff1b;\uff01\uff1f!?]/.test(t)) {
      return { level: Math.min(4, section[1].split('.').length + 1), text: t };
    }
    if (
      /^\d+[.)\uff09]\S.{0,58}$/.test(compact) &&
      !/[\u3002\uff0c,\uff1b;\uff01\uff1f!?]/.test(t)
    ) {
      return { level: 3, text: t };
    }
    if (
      /[\u4e00-\u9fff]/.test(t) &&
      /^[^\u3002\uff0c,\u3001\uff1b;\uff01\uff1f!?]{2,60}[\uff1a:]$/.test(t) &&
      !/[\u662f\u4e3a][\uff1a:]$/.test(t)
    ) {
      return { level: 3, text: t };
    }
    if (/[\u4e00-\u9fff]/.test(t) && /^[^\u3002\uff0c,\u3001\uff1b;!]{4,28}[\uff1f?]$/.test(t)) {
      return { level: 3, text: t };
    }
    return null;
  }

  function articleCodeText(text) {
    const t = String(text || '').trim();
    return /^[A-Za-z_$][\w$.-]*\s*=\s*["'`][^"'`]+["'`]\s*;?$/.test(t) ? t : '';
  }

  function articleTextLines(el) {
    return (el.innerText || el.textContent || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function articleListMarkerType(text) {
    const t = String(text || '').trim();
    if (/^(?:[-*]|\u2022)\s+\S/.test(t)) return 'unordered';
    if (/^\d+[.)\u3001]\s+\S/.test(t)) return 'ordered';
    return '';
  }

  function stripArticleListMarker(html) {
    return String(html || '')
      .replace(/^\s*(?:[-*]|\u2022)\s+/, '')
      .replace(/^\s*\d+[.)\u3001]\s+/, '');
  }

  // True when a list item already begins with its own ordinal - e.g. "2. ..." or, when the number
  // is bolded, "<strong>2. ..." / "**2. ...". X fragments manually-numbered article lists around
  // embedded posts, so each piece becomes a single-item <ol> that the renderer would re-number
  // "1.", doubling the author's number ("1. 2. ..."). When an item is self-numbered the renderers
  // keep the author's number and omit their own marker.
  function itemHasLeadingOrdinal(s) {
    return /^\s*(?:<(?:strong|em|b|i)>\s*|\*{1,2}|_{1,2})?\s*\d+[.)\u3001]\s+/.test(
      String(s || '')
    );
  }

  function articleListType(el) {
    if (!el) return '';
    const listEl = el.closest && el.closest('li,[role="listitem"],[data-list],[data-list-type]');
    const source = listEl || el;
    const attrs = [
      source.getAttribute && source.getAttribute('data-list'),
      source.getAttribute && source.getAttribute('data-list-type'),
      source.getAttribute && source.getAttribute('aria-label'),
      source.getAttribute && source.getAttribute('class'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    // Check unordered FIRST, and anchor "ordered" on a word boundary: the substring "ordered"
    // lives inside "unordered", so a naive /ordered/ test mis-classifies every bulleted list
    // (class/aria like "unordered-list" / "Bulleted list") as numbered. \bordered does not match
    // the internal "ordered" in "unordered" (no boundary after the preceding "n").
    if (/\b(?:unordered|bullet|disc)/.test(attrs)) return 'unordered';
    if (/\b(?:ordered|decimal|number)/.test(attrs)) return 'ordered';
    if (source.tagName && source.tagName.toLowerCase() === 'li') {
      const parent = source.parentElement && source.parentElement.tagName.toLowerCase();
      if (parent === 'ol') return 'ordered';
      if (parent === 'ul') return 'unordered';
    }
    const lines = articleTextLines(el);
    if (lines.length > 1) {
      const lineTypes = lines.map(articleListMarkerType);
      const first = lineTypes[0];
      if (first && lineTypes.every((type) => type === first)) return first;
    }
    if (lines.length === 1) return articleListMarkerType(lines[0]);
    return '';
  }

  function articleListItemsFromElement(el) {
    const lines = articleTextLines(el);
    if (lines.length > 1 && lines.every((line) => articleListMarkerType(line))) {
      return lines.map((line) => escapeHtml(line.replace(/^(?:[-*]|\u2022|\d+[.)\u3001])\s+/, '')));
    }
    return [stripArticleListMarker(inlineHtmlFromArticleBlock(el))].filter(Boolean);
  }

  function articleBlockquoteElement(el) {
    let node = el;
    while (node && node !== document.body) {
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      const attrs = [
        tag,
        node.getAttribute && node.getAttribute('role'),
        node.getAttribute && node.getAttribute('class'),
        node.getAttribute && node.getAttribute('data-testid'),
        node.getAttribute && node.getAttribute('data-type'),
        node.getAttribute && node.getAttribute('style'),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (
        tag === 'blockquote' ||
        /\b(blockquote|pullquote|quote-block)\b/.test(attrs) ||
        /border-left/.test(attrs)
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function articleBlockquoteInnerBlocks(el) {
    const lines = articleTextLines(el);
    const blocks = [];
    if (lines.length > 1) {
      const firstListAt = lines.findIndex((line) => articleListMarkerType(line));
      if (
        firstListAt > 0 &&
        lines.slice(firstListAt).every((line) => articleListMarkerType(line))
      ) {
        lines.slice(0, firstListAt).forEach((line) => {
          blocks.push({ kind: 'paragraph', html: escapeHtml(line) });
        });
        const ordered = articleListMarkerType(lines[firstListAt]) === 'ordered';
        blocks.push({
          kind: 'list',
          ordered,
          items: lines
            .slice(firstListAt)
            .map((line) => escapeHtml(line.replace(/^(?:[-*]|\u2022|\d+[.)\u3001])\s+/, ''))),
        });
        return blocks;
      }
    }
    const listType = articleListType(el);
    if (listType) {
      blocks.push({
        kind: 'list',
        ordered: listType === 'ordered',
        items: articleListItemsFromElement(el),
      });
    } else {
      const html = inlineHtmlFromArticleBlock(el);
      if (html) blocks.push({ kind: 'paragraph', html });
    }
    return blocks;
  }

  /** Find quoted/embedded tweets inside a tweet element, if present. */
  function findQuotedTweetEls(tweetEl) {
    // Quoted tweets are rendered as nested, clickable blocks that contain their
    // own author block + text/media. Capture all top-level quote cards; nested
    // cards are handled when each quote is processed recursively.
    const candidates = pickAllMatchesIncludingRoot(tweetEl, CONFIG.selectors.quoteCard).filter(
      (candidate) => candidate !== tweetEl
    );
    const quotes = [];
    for (const c of candidates) {
      if (quotes.some((q) => q.contains(c))) continue;
      const hasUser = pick(c, CONFIG.selectors.userName, { quiet: true });
      const hasText = pick(c, CONFIG.selectors.tweetText, { quiet: true });
      if (hasUser || hasText) quotes.push(c);
    }
    return quotes;
  }

  function quoteSourceUrlFromElement(quoteEl, author = {}) {
    if (!quoteEl) return '';
    const nestedQuotes = findQuotedTweetEls(quoteEl);
    const belongsToQuote = (el) => !nestedQuotes.some((nested) => nested.contains(el));
    const directAnchor = Array.from(quoteEl.querySelectorAll('a[href*="/status/"]')).find(
      belongsToQuote
    );
    if (directAnchor && directAnchor.href) return normalizeStatusUrl(directAnchor.href);

    const handle = String(author.handle || '').replace(/^@/, '');
    const elements = [quoteEl, ...quoteEl.querySelectorAll('*')].filter(belongsToQuote);
    for (const element of elements) {
      for (const attr of Array.from(element.attributes || [])) {
        const value = decodeBasicEntities(String(attr.value || '')).replace(/\\\//g, '/');
        const absolute = value.match(
          /https?:\/\/(?:mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/i
        );
        if (absolute) return `https://x.com/${absolute[1]}/status/${absolute[2]}`;
        const relative = value.match(/\/([A-Za-z0-9_]+)\/status\/(\d+)/);
        if (relative) return `https://x.com/${relative[1]}/status/${relative[2]}`;
        const statusOnly = value.match(/(?:status(?:Id)?[=:"'\s]+)(\d{10,})/i);
        if (statusOnly && handle) return `https://x.com/${handle}/status/${statusOnly[1]}`;
      }
    }
    return '';
  }

  function isTweetLikeBlock(el) {
    if (!el) return false;
    const hasActionGroup = Array.from(el.querySelectorAll('div[role="group"][aria-label]')).some(
      (group) =>
        /\b(repl|repost|like|view|bookmark|share)\b/i.test(group.getAttribute('aria-label') || '')
    );
    return Boolean(
      pick(el, CONFIG.selectors.userName, { quiet: true }) ||
      el.querySelector('div[data-testid="tweetText"]') ||
      pick(el, CONFIG.selectors.timeLink, { quiet: true }) ||
      hasActionGroup
    );
  }

  function findArticleEmbeddedTweetEls(root) {
    const quotes = [];
    const addQuote = (quote) => {
      if (!quote) return;
      if (quotes.some((existing) => existing.contains(quote))) return;
      for (let i = quotes.length - 1; i >= 0; i--) {
        if (quote.contains(quotes[i])) quotes.splice(i, 1);
      }
      quotes.push(quote);
    };
    findQuotedTweetEls(root).forEach(addQuote);
    const richRoot = pick(root, CONFIG.selectors.articleTextRoot, { quiet: true });
    if (richRoot) {
      richRoot.querySelectorAll('[data-block="true"]').forEach((block) => {
        if (!isTweetLikeBlock(block)) return;
        addQuote(block);
      });
    }
    return quotes.sort(compareDocumentOrder);
  }

  /** Parse {name, handle} from a single User-Name block's text. */
  function authorFromNameBlock(nameBlock) {
    const out = { name: '', handle: '' };
    if (!nameBlock) return out;
    const text = nameBlock.innerText || nameBlock.textContent || '';
    const handleMatch = text.match(/@[A-Za-z0-9_]+/);
    out.handle = handleMatch ? handleMatch[0] : '';
    // The display name is usually the first line before the @handle.
    out.name =
      text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)[0] || '';
    return out;
  }

  /** Extract author {name, handle, avatarUrl} from a tweet element. */
  function extractAuthor(tweetEl) {
    const nameBlock = pick(tweetEl, CONFIG.selectors.userName, { quiet: true });
    const author = { ...authorFromNameBlock(nameBlock), avatarUrl: '' };
    const avatar = pick(tweetEl, CONFIG.selectors.avatar, { quiet: true });
    if (avatar && avatar.src) author.avatarUrl = highResImageUrl(avatar.src);
    return author;
  }

  /**
   * Resolve the author of an ARTICLE. X renders the article author header OUTSIDE the
   * read-view body, while embedded/quoted tweets live INSIDE it - so the first in-body
   * User-Name block belongs to a QUOTE, not the author (the cause of the misattribution
   * bug). The canonical page URL (x.com/<author>/status/<id>) is the authoritative
   * source for the handle; we trust it and use the DOM only to recover the matching
   * display name + avatar. Worst case is an honest @handle with no name, never a quote's
   * author. `quoteEls` are the embedded-tweet containers to skip.
   */
  function resolveArticleAuthor(scope, sourceUrl, quoteEls) {
    const urlHandle = handleFromSourceUrl(sourceUrl);
    const norm = (h) =>
      String(h || '')
        .replace(/^@/, '')
        .toLowerCase();
    const inQuote = (el) => quoteEls.some((q) => q.contains(el));
    const nameBlocks = pickAll(scope, CONFIG.selectors.userName).filter((b) => !inQuote(b));
    let block = null;
    if (urlHandle)
      block =
        nameBlocks.find((b) => norm(authorFromNameBlock(b).handle) === norm(urlHandle)) || null;
    if (!block) block = nameBlocks[0] || null; // no URL handle (reserved path) -> best-effort header
    const author = { ...authorFromNameBlock(block), avatarUrl: '' };
    if (urlHandle) author.handle = urlHandle; // the URL is authoritative for the handle
    const avatar =
      pickAll(scope, CONFIG.selectors.avatar).filter((img) => !inQuote(img))[0] || null;
    if (avatar && avatar.src) author.avatarUrl = highResImageUrl(avatar.src);
    return author;
  }

  /** Extract image/video blocks from a tweet element (excluding nested quotes). */
  function extractMediaBlocks(tweetEl, excludeEls, sourceUrl) {
    const blocks = [];
    const excludes = Array.isArray(excludeEls) ? excludeEls : excludeEls ? [excludeEls] : [];
    const isNestedTweetBleed = (el) => {
      const ownerTweet = closestAny(el, CONFIG.selectors.tweet);
      return ownerTweet && ownerTweet !== tweetEl && tweetEl.contains(ownerTweet);
    };
    const inExcluded = (el) =>
      !tweetEl.contains(el) ||
      excludes.some((excludeEl) => excludeEl.contains(el)) ||
      isNestedTweetBleed(el);

    const seenImageUrls = new Set();
    findTweetImageEls(tweetEl).forEach((img) => {
      if (inExcluded(img) || !img.src) return;
      const url = highResImageUrl(img.src);
      if (seenImageUrls.has(url)) return;
      seenImageUrls.add(url);
      markImageCaptured(url);
      blocks.push({
        kind: 'image',
        url,
        alt: img.alt || '',
        ...imageDimensions(img),
        sourceUrl,
      });
    });

    pickAll(tweetEl, CONFIG.selectors.videoPlayer).forEach((vp) => {
      if (inExcluded(vp)) return;
      blocks.push(videoBlockFromPlayer(vp, sourceUrl));
    });

    return blocks;
  }

  function videoCandidatesFromPlayer(vp) {
    const out = [];
    const seen = new Set();
    const add = (url, source, extra) =>
      addVideoCandidate(out, seen, videoCandidate(url, source, extra));
    const videoEl = vp && vp.querySelector ? vp.querySelector('video') : null;
    if (videoEl) {
      add(videoEl.currentSrc, 'dom:video.currentSrc');
      add(videoEl.src, 'dom:video.src');
      Array.from(videoEl.querySelectorAll('source[src]')).forEach((sourceEl) => {
        add(sourceEl.src || sourceEl.getAttribute('src'), 'dom:source', {
          contentType: sourceEl.type || '',
        });
      });
      ['src', 'data-src', 'data-url', 'data-mp4', 'data-hls'].forEach((attr) =>
        add(videoEl.getAttribute(attr), `dom:video[${attr}]`)
      );
    }
    if (vp && vp.querySelectorAll) {
      vp.querySelectorAll('[src],[data-src],[data-url],[data-mp4],[data-hls]').forEach((el) => {
        ['src', 'data-src', 'data-url', 'data-mp4', 'data-hls'].forEach((attr) =>
          add(el.getAttribute(attr), `dom:${attr}`)
        );
      });
      videoCandidatesFromText(vp.outerHTML || '', 'dom:player-html').forEach((candidate) =>
        addVideoCandidate(out, seen, candidate)
      );
    }
    return sortVideoCandidates(out);
  }

  function videoBlockFromPlayer(vp, sourceUrl) {
    const videoEl = vp.querySelector('video');
    const posterUrl =
      (videoEl && videoEl.poster) || (vp.querySelector('img') && vp.querySelector('img').src) || '';
    const candidates = videoCandidatesFromPlayer(vp);
    const mp4Url = (candidates.find((candidate) => candidate.kind === 'mp4') || {}).url || '';
    const block = {
      kind: 'video',
      posterUrl: posterUrl ? highResImageUrl(posterUrl) : '',
      mp4Url,
      videoCandidates: candidates,
      discoverySources: candidates.map((candidate) => candidate.source).filter(Boolean),
      width: videoEl && videoEl.videoWidth ? videoEl.videoWidth : undefined,
      height: videoEl && videoEl.videoHeight ? videoEl.videoHeight : undefined,
      duration: videoEl && Number.isFinite(videoEl.duration) ? videoEl.duration : undefined,
      sourceUrl,
    };
    if ((!block.width || !block.height) && mp4Url)
      applyVideoDimensions(block, videoDimensionsFromUrl(mp4Url));
    return block;
  }

  /** Build a partial model (author + content blocks) from one tweet element. */
  /**
   * Extract a link-preview card (X's rendering of an external link). For a link
   * post the card IS the payload - X strips the URL from the visible text, so
   * dropping the card loses the very link the post exists to share. The href is
   * often the t.co short form here; syndication enrichment upgrades it to the
   * expanded URL when available.
   */
  function extractLinkCard(tweetEl, quoteEls, sourceUrl) {
    const cardEl = pickAllMatchesIncludingRoot(tweetEl, CONFIG.selectors.card).find(
      (el) => !quoteEls.some((quoteEl) => quoteEl.contains(el))
    );
    if (!cardEl) return null;
    const anchor = cardEl.matches('a[href]') ? cardEl : cardEl.querySelector('a[href]');
    const url = anchor ? safeUrl(anchor.href) : '';
    if (!url) return null;
    // Leaf-element texts (innerText line splitting is unreliable across DOMs).
    const lines = Array.from(cardEl.querySelectorAll('span,div'))
      .filter((el) => !el.children.length)
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);
    const domainLine = lines.find((line) => /^from\s+\S/i.test(line)) || '';
    const title =
      lines.filter((line) => line !== domainLine).sort((a, b) => b.length - a.length)[0] || '';
    // Card preview image (X proxies these through pbs.twimg.com/card_img/...).
    // Decorative: a fetch failure never counts missing and never gates the export.
    const imageEl = Array.from(cardEl.querySelectorAll('img')).find((el) =>
      /twimg\.com/.test(el.src || '')
    );
    return {
      kind: 'link-card',
      url,
      title,
      domain: domainLine.replace(/^from\s+/i, ''),
      imageUrl: imageEl ? imageEl.src : '',
      sourceUrl,
    };
  }

  function observedPollText(el) {
    let value = el && el.innerText;
    if (!value && el && el.querySelectorAll) {
      const leaves = Array.from(el.querySelectorAll('*'))
        .filter((child) => !child.children.length)
        .map((child) => child.textContent || '')
        .filter((text) => text.trim());
      if (leaves.length) value = leaves.join(' ');
    }
    return String(value || (el && el.textContent) || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function postVotePollRowFromPercent(percentEl, tweetEl) {
    let current = percentEl && percentEl.parentElement;
    while (current && current !== tweetEl) {
      const text = observedPollText(current);
      const withoutResult = text.replace(/\d{1,3}(?:[.,]\d+)?\s*%/g, '').trim();
      if (
        /\d{1,3}(?:[.,]\d+)?\s*%/.test(text) &&
        /[A-Za-z\p{L}]/u.test(withoutResult) &&
        !/\b(?:votes?|poll\s+closed|days?|hours?|minutes?|seconds?)\b/i.test(withoutResult) &&
        text.length < 300
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function observedPollChoiceEls(root, tweetEl = root) {
    const choices = pickAllMatchesIncludingRoot(root, CONFIG.selectors.pollChoice);
    root.querySelectorAll('span,div').forEach((element) => {
      if (element.children.length) return;
      if (!/^\s*\d{1,3}(?:[.,]\d+)?\s*%\s*$/.test(observedPollText(element))) return;
      const row = postVotePollRowFromPercent(element, tweetEl);
      if (row) choices.push(row);
    });
    return Array.from(new Set(choices)).filter(
      (choice, index, all) =>
        !all.some(
          (other, otherIndex) => otherIndex < index && other !== choice && other.contains(choice)
        )
    );
  }

  function inferredPostVotePollRoot(tweetEl, excludes) {
    const resultRows = observedPollChoiceEls(tweetEl, tweetEl).filter((row) => {
      if (excludes.some((quoteEl) => quoteEl.contains(row))) return false;
      const text = `${observedPollText(row)} ${row.getAttribute('aria-label') || ''}`;
      return /\d{1,3}(?:[.,]\d+)?\s*%/.test(text);
    });
    if (resultRows.length < 2) return null;
    let ancestor = resultRows[0].parentElement;
    while (ancestor && ancestor !== tweetEl) {
      if (
        resultRows.every((row) => ancestor.contains(row)) &&
        /\b(?:votes?|poll\s+closed|\d+\s+(?:days?|hours?|minutes?|seconds?)\s+left)\b/i.test(
          observedPollText(ancestor)
        )
      ) {
        return ancestor;
      }
      ancestor = ancestor.parentElement;
    }
    return null;
  }

  function extractPollBlock(tweetEl, quoteEls, sourceUrl) {
    const excludes = Array.isArray(quoteEls) ? quoteEls : [];
    const pollRoots = pickAllMatchesIncludingRoot(tweetEl, CONFIG.selectors.poll).filter(
      (candidate) => {
        if (excludes.some((quoteEl) => quoteEl.contains(candidate))) return false;
        const ownerTweet = closestAny(candidate, CONFIG.selectors.tweet);
        const tweetElIsArticle = closestAny(tweetEl, CONFIG.selectors.tweet) === tweetEl;
        return !ownerTweet || ownerTweet === tweetEl || !tweetElIsArticle;
      }
    );
    const inferred = inferredPostVotePollRoot(tweetEl, excludes);
    if (inferred && !pollRoots.includes(inferred)) pollRoots.push(inferred);
    const pollEl = pollRoots.find(
      (candidate) => observedPollChoiceEls(candidate, tweetEl).length >= 2
    );
    if (!pollEl) return null;

    const choiceEls = observedPollChoiceEls(pollEl, tweetEl);
    const choices = choiceEls
      .map((choice) => {
        const visible = observedPollText(choice);
        const aria = observedPollText({ textContent: choice.getAttribute('aria-label') || '' });
        const combined = [visible, aria].filter(Boolean).join(' ');
        const percentageMatch = combined.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
        const votesMatch = combined.match(
          /([\d,.]+)\s+votes?(?=\s|poll|\d+\s+(?:days?|hours?|minutes?|seconds?)|$)/i
        );
        const label =
          visible
            .replace(/\d{1,3}(?:[.,]\d+)?\s*%/g, '')
            .replace(/[\d,.]+\s+votes?(?=\s|poll|\d+\s+(?:days?|hours?|minutes?|seconds?)|$)/gi, '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find(
              (line) =>
                line && !/^\d{1,3}(?:[.,]\d+)?\s*%$/.test(line) && !/^[\d,.]+\s+votes?$/i.test(line)
            ) ||
          combined
            .replace(/\b\d{1,3}(?:[.,]\d+)?\s*%\b/g, '')
            .replace(
              /\b[\d,.]+\s+votes?(?=\s|poll|\d+\s+(?:days?|hours?|minutes?|seconds?)|$)/gi,
              ''
            )
            .replace(/[,:\-\s]+$/g, '')
            .trim();
        if (!label) return null;
        return {
          label,
          ...(percentageMatch ? { percentage: `${percentageMatch[1].replace(',', '.')}%` } : {}),
          ...(votesMatch ? { votes: votesMatch[1] } : {}),
        };
      })
      .filter(Boolean);
    if (!choices.length) return null;

    const fullText = observedPollText(pollEl);
    const questionEl = pick(pollEl, CONFIG.selectors.pollQuestion, { quiet: true });
    const question = observedPollText(questionEl);
    const totalMatch = fullText.match(
      /([\d,.]+)\s+votes?(?=\s|poll|\d+\s+(?:days?|hours?|minutes?|seconds?)|$)/i
    );
    const statusMatch = fullText.match(
      /(?:poll\s+closed|final results?|\d+\s+(?:days?|hours?|minutes?|seconds?)\s+left)\b/i
    );
    const resultsUnavailable = !choices.some((choice) => choice.percentage || choice.votes);
    return {
      kind: 'poll',
      ...(question && !choices.some((choice) => choice.label === question) ? { question } : {}),
      choices,
      ...(totalMatch ? { totalVotes: totalMatch[1] } : {}),
      ...(statusMatch ? { status: statusMatch[0] } : {}),
      sourcePostId: statusIdFromUrl(sourceUrl),
      sourceUrl,
      resultsUnavailable,
    };
  }

  function buildTweetBlocks(tweetEl, { quoteDepth = 2 } = {}) {
    const quoteEls = quoteDepth > 0 ? findQuotedTweetEls(tweetEl) : [];
    const blocks = [];
    const sourceUrl = canonicalUrl(tweetEl, tweetStatusId(tweetEl));

    const textEl = (() => {
      // The primary tweet's text is the tweetText NOT inside quoted blocks.
      const all = pickAllMatchesIncludingRoot(tweetEl, CONFIG.selectors.tweetText);
      return all.find((t) => !quoteEls.some((quoteEl) => quoteEl.contains(t))) || null;
    })();

    const html = inlineHtmlFromTweetText(textEl, quoteEls);
    if (html) blocks.push({ kind: 'paragraph', html });

    extractMediaBlocks(tweetEl, quoteEls, sourceUrl).forEach((b) => blocks.push(b));
    // Merge media that lazy-loaded for THIS tweet during the scroll harvest but
    // was virtualized out of the DOM by extraction time.
    harvestedImagesForStatus(tweetStatusId(tweetEl)).forEach((b) => blocks.push(b));

    const card = extractLinkCard(tweetEl, quoteEls, sourceUrl);
    if (card) blocks.push(card);

    const poll = extractPollBlock(tweetEl, quoteEls, sourceUrl);
    if (poll) blocks.push(poll);

    // A "Show more" link on the post's own text means X is only showing a
    // long-form preview; the export must say so rather than pass it off as full.
    const textTruncated = pickAllMatchesIncludingRoot(tweetEl, CONFIG.selectors.showMore).some(
      (el) => !quoteEls.some((quoteEl) => quoteEl.contains(el))
    );

    quoteEls.forEach((quoteEl) => {
      const qAuthor = extractAuthor(quoteEl);
      const qBlocks = buildTweetBlocks(quoteEl, { quoteDepth: quoteDepth - 1 }).blocks;
      const quoteSourceUrl = quoteSourceUrlFromElement(quoteEl, qAuthor);
      blocks.push({
        kind: 'quote',
        author: qAuthor,
        blocks: qBlocks,
        sourceUrl: quoteSourceUrl,
        publishedAt: publishedAtFromElement(quoteEl, statusIdFromUrl(quoteSourceUrl)),
      });
    });

    // A tombstone where the quote card would be means the quoted post is gone
    // on X itself (deleted, banned, or restricted account). There is nothing to
    // capture - but the archive must SAY that instead of silently omitting the
    // reference the post text points at. Never a strict-gate blocker.
    pickAllMatchesIncludingRoot(tweetEl, CONFIG.selectors.quoteTombstone)
      .filter((el) => !quoteEls.some((quoteEl) => quoteEl.contains(el)))
      .forEach((el) => {
        blocks.push({
          kind: 'quote-tombstone',
          notice: elementTextPreview(el, 200),
          sourceUrl,
        });
      });

    return { author: extractAuthor(tweetEl), blocks, textTruncated };
  }

  /** Build the model for a single post page. */
  function collectQuoteImageUrls(blocks, set) {
    for (const b of blocks) {
      if (b.kind === 'image' && b.url) set.add(b.url);
      else if (b.kind === 'quote') collectQuoteImageUrls(b.blocks, set);
    }
  }

  /**
   * X sometimes renders the same embedded tweet in more than one nearby DOM spot,
   * so the same quote gets detected twice and its images are split across the two
   * cards. Collapse only near quote repeats; the same tweet can be intentionally
   * embedded twice in different article sections, and those positions must be kept.
   * Then drop any top-level image that is already shown inside a quote card.
   */
  function dedupeQuoteCards(blocks) {
    const nearDuplicateWindow = 3;
    const out = [];
    for (const b of blocks) {
      if (b.kind === 'quote' && b.sourceUrl) {
        let existing = null;
        for (let i = out.length - 1; i >= 0 && out.length - i <= nearDuplicateWindow; i--) {
          if (out[i].kind === 'quote' && out[i].sourceUrl === b.sourceUrl) {
            existing = out[i];
            break;
          }
        }
        if (existing) {
          const have = new Set();
          collectQuoteImageUrls(existing.blocks, have);
          for (const inner of b.blocks) {
            if (inner.kind === 'image' && inner.url && !have.has(inner.url)) {
              have.add(inner.url);
              existing.blocks.push(inner);
            }
          }
          continue; // drop the duplicate card
        }
      }
      out.push(b);
    }
    const quoteImgUrls = new Set();
    for (const b of out) if (b.kind === 'quote') collectQuoteImageUrls(b.blocks, quoteImgUrls);
    return out.filter((b) => !(b.kind === 'image' && quoteImgUrls.has(b.url)));
  }

  // `targetTweetEl` lets a per-post Export button export exactly the post it sits on
  // (and that post's own nested quotes) instead of the page's focused status. Without it,
  // behavior is unchanged: find the focused status and include its same-author thread run.
  function buildModelForPost(targetTweetEl = null, { includeThread = !targetTweetEl } = {}) {
    capturedImageUrls = new Set();
    const column = pick(document, CONFIG.selectors.primaryColumn) || document.body;
    const targetStatusId = targetTweetEl ? tweetStatusId(targetTweetEl) : currentStatusId();
    const candidates = includeThread ? threadTweetCandidates(column) : [];
    const tweetEl =
      (targetStatusId && candidates.find((tweet) => tweetStatusId(tweet) === targetStatusId)) ||
      targetTweetEl ||
      findTweetForCurrentStatus(column);
    if (!tweetEl) {
      throw new Error('Could not find the post on this page (selector miss).');
    }
    const tweetEls = includeThread ? buildTweetSequence(column, tweetEl) : [tweetEl];
    const tweetParts = tweetEls.map((t) => buildTweetBlocks(t, { quoteDepth: 2 }));
    const author = tweetParts[0].author;
    const threadPosts = tweetEls.map((tweet, index) => {
      const statusId = tweetStatusId(tweet);
      return {
        index: index + 1,
        statusId,
        sourceUrl: canonicalUrl(tweet, statusId),
        publishedAt: publishedAtFromElement(tweet, statusId),
      };
    });
    const combinedBlocks = [];
    tweetParts.forEach((part, index) => {
      if (tweetParts.length > 1) {
        combinedBlocks.push({
          kind: 'thread-marker',
          ...threadPosts[index],
          total: tweetParts.length,
        });
      }
      combinedBlocks.push(...part.blocks);
      if (part.textTruncated) {
        combinedBlocks.push({
          kind: 'truncation-notice',
          sourceUrl: threadPosts[index].sourceUrl,
        });
      }
    });
    const blocks = dedupeQuoteCards(combinedBlocks);
    if (!blocks.some((b) => b.kind === 'paragraph')) {
      warn('post has no text paragraph - tweetText selector may be stale');
    }
    // For a post there is no document title; build a clean one for the browser
    // tab / filename from the author. The tweet text stays in the body, not the
    // heading. `heading` is left empty so assembleHtml omits the big <h1> and the
    // author block acts as the header.
    const namePart = author.name || 'X post';
    const handlePart = author.handle ? ` (${author.handle})` : '';

    const model = {
      type: 'post',
      title: `${namePart}${handlePart} on X`.trim(),
      heading: '',
      author,
      sourceUrl: canonicalUrl(tweetEl),
      publishedAt: publishedAtFromElement(tweetEl, statusIdFromSourceUrl(canonicalUrl(tweetEl))),
      exportedAt: new Date().toISOString(),
      blocks,
    };
    if (threadPosts.length > 1) {
      model.thread = {
        capturedPosts: threadPosts.length,
        sourcePostIds: threadPosts.map((post) => post.statusId).filter(Boolean),
        completeness: 'best-effort',
      };
    }
    if (CONFIG.debugEmbed) {
      model._debug = collectPostDebug(column, tweetEl, tweetEls, model);
    }
    return model;
  }

  /**
   * Build the model for a long-form Article. X Articles are rich documents; we
   * walk the rich-text root and map known elements to model blocks. This is the
   * most DOM-fragile path - every branch logs on a miss instead of throwing.
   */
  function buildModelForArticle() {
    capturedImageUrls = new Set();
    const root = pick(document, CONFIG.selectors.articleRoot);
    if (!root) {
      throw new Error('Could not find the article body on this page (selector miss).');
    }
    const articleTweetEl = closestAny(root, CONFIG.selectors.tweet) || root;

    const titleEl = pick(root, CONFIG.selectors.articleTitle, { quiet: true });
    const title = titleEl
      ? (titleEl.innerText || titleEl.textContent || '').trim()
      : document.title.replace(/ \/ X.*$/, '');

    const blocks = [];
    const seenImg = new Set();
    const seenVideo = new Set();
    const seenText = new Set();
    const richRoot = pick(root, CONFIG.selectors.articleTextRoot, { quiet: true });
    const quoteEls = findArticleEmbeddedTweetEls(root);
    const insideQuote = (el) => quoteEls.some((quoteEl) => quoteEl !== el && quoteEl.contains(el));
    // Author: trust the canonical page URL for the handle; the article header lives
    // outside the read-view body, so the first in-body User-Name is a quoted tweet's,
    // not the author's. Recover display name + avatar from the matching DOM block.
    const author = resolveArticleAuthor(articleTweetEl, location.href.split('?')[0], quoteEls);

    const pushTextBlock = (el) => {
      const html = inlineHtmlFromArticleBlock(el);
      const key = html.replace(/\s+/g, ' ').trim();
      if (!key || seenText.has(key)) return;
      seenText.add(key);
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (articleDividerText(text)) blocks.push({ kind: 'divider' });
      else {
        const heading =
          articleHeadingBlock(text) ||
          (articleHeadingVisualElement(el)
            ? { level: 3, text: normalizeArticleStructureText(text) }
            : null);
        const code = articleCodeText(text);
        if (heading) blocks.push({ kind: 'heading', level: heading.level, text: heading.text });
        else if (code) blocks.push({ kind: 'code', text: code });
        else blocks.push({ kind: 'paragraph', html });
      }
    };

    const pushListBlock = (items, ordered) => {
      const cleanItems = items
        .flatMap((el) => articleListItemsFromElement(el))
        .map((html) => html.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const key = `${ordered ? 'ol' : 'ul'}:${cleanItems.join('|')}`;
      if (cleanItems.length && !seenText.has(key)) {
        cleanItems.forEach((item) => seenText.add(item));
        seenText.add(key);
        blocks.push({ kind: 'list', ordered, items: cleanItems });
      }
    };

    const pushBlockquoteBlock = (el) => {
      const innerBlocks = articleBlockquoteInnerBlocks(el);
      const key = `blockquote:${innerBlocks
        .map((b) => b.text || b.html || (b.items || []).join('|'))
        .join('|')
        .replace(/\s+/g, ' ')
        .trim()}`;
      if (innerBlocks.length && !seenText.has(key)) {
        seenText.add(key);
        blocks.push({ kind: 'blockquote', blocks: innerBlocks });
      }
    };

    const pushDividerBlock = () => {
      blocks.push({ kind: 'divider' });
    };

    const candidates = [];
    const seenCandidateNodes = new Set();
    const addCandidate = (kind, node) => {
      if (!node || seenCandidateNodes.has(node)) return;
      seenCandidateNodes.add(node);
      candidates.push({ kind, node, y: absY(node) });
    };
    if (richRoot) {
      richRoot.querySelectorAll('[data-block="true"]').forEach((node) => {
        if (
          !isTweetLikeBlock(node) &&
          !pick(node, CONFIG.selectors.tweetPhoto, { quiet: true }) &&
          !pick(node, CONFIG.selectors.videoPlayer, { quiet: true })
        ) {
          const blockquote = articleBlockquoteElement(node);
          if (articleDividerElement(node)) addCandidate('divider', node);
          else if (blockquote && richRoot.contains(blockquote))
            addCandidate('blockquote', blockquote);
          else addCandidate('text', node);
        }
      });
    }
    findTweetImageEls(root).forEach((node) => addCandidate('image', node));
    pickAll(root, CONFIG.selectors.videoPlayer).forEach((node) => addCandidate('video', node));
    quoteEls.forEach((node) => addCandidate('quote', node));
    // Article body images do not belong to a tweet id. X can virtualize those
    // images away after forceLoadMedia observed them, so merge the ownerless
    // progressive harvest back into the document at its approximate page
    // position. A currently-mounted copy is harmless: seenImg deduplicates it.
    for (const item of harvestedMedia.values()) {
      if (!item.ownerStatusId) {
        candidates.push({ kind: 'harvested-image', node: null, item, y: item.y });
      }
    }

    candidates.sort((a, b) => {
      const yDelta = (Number(a.y) || 0) - (Number(b.y) || 0);
      if (yDelta) return yDelta;
      if (a.node && b.node) return compareDocumentOrder(a.node, b.node);
      return a.node ? -1 : b.node ? 1 : 0;
    });
    for (let i = 0; i < candidates.length; i++) {
      const { kind, node, item } = candidates[i];
      if (kind !== 'quote' && node && insideQuote(node)) continue;

      if (kind === 'text') {
        const listType = articleListType(node);
        if (listType) {
          const items = [node];
          while (
            candidates[i + 1] &&
            candidates[i + 1].kind === 'text' &&
            !insideQuote(candidates[i + 1].node) &&
            articleListType(candidates[i + 1].node) === listType
          ) {
            items.push(candidates[i + 1].node);
            i++;
          }
          pushListBlock(items, listType === 'ordered');
        } else {
          pushTextBlock(node);
        }
      } else if (kind === 'divider') {
        pushDividerBlock();
      } else if (kind === 'blockquote') {
        pushBlockquoteBlock(node);
      } else if (kind === 'image') {
        const url = node.src ? highResImageUrl(node.src) : '';
        if (url && !seenImg.has(url)) {
          seenImg.add(url);
          blocks.push({
            kind: 'image',
            url,
            alt: node.alt || '',
            ...imageDimensions(node),
            sourceUrl: location.href.split('?')[0],
          });
        }
      } else if (kind === 'harvested-image') {
        if (item.url && !seenImg.has(item.url)) {
          seenImg.add(item.url);
          blocks.push({
            kind: 'image',
            url: item.url,
            alt: item.alt || '',
            width: item.width,
            height: item.height,
            sourceUrl: location.href.split('?')[0],
          });
        }
      } else if (kind === 'video') {
        const block = videoBlockFromPlayer(node, location.href.split('?')[0]);
        const key = block.posterUrl || block.mp4Url || elementTextPreview(node);
        if (!seenVideo.has(key)) {
          seenVideo.add(key);
          blocks.push(block);
        }
      } else if (kind === 'quote') {
        const qAuthor = extractAuthor(node);
        const qBlocks = buildTweetBlocks(node, { quoteDepth: 2 }).blocks;
        const quoteSourceUrl = quoteSourceUrlFromElement(node, qAuthor);
        blocks.push({
          kind: 'quote',
          author: qAuthor,
          blocks: qBlocks,
          sourceUrl: quoteSourceUrl,
          publishedAt: publishedAtFromElement(node, statusIdFromUrl(quoteSourceUrl)),
        });
      }
    }

    const dedupedBlocks = dedupeQuoteCards(blocks);
    if (!dedupedBlocks.length)
      warn('article extraction produced no blocks - selectors likely stale');

    const resolvedTitle = title || 'X Article';
    const model = {
      type: 'article',
      title: resolvedTitle,
      heading: resolvedTitle, // articles get a real <h1>; posts do not
      author,
      sourceUrl: location.href.split('?')[0],
      publishedAt: publishedAtFromElement(articleTweetEl, currentStatusId()),
      exportedAt: new Date().toISOString(),
      blocks: dedupedBlocks,
    };
    if (CONFIG.debugEmbed) {
      model._debug = collectArticleDebug(root, quoteEls, model);
    }
    return model;
  }

  // ===========================================================================
  // STABLE LAYER - walk the model, inline all media in place
  // ===========================================================================

  /** Replace every media URL in the model with a data: URI. Reports progress. */
  async function inlineMedia(model, onProgress) {
    // Gather every media-bearing block (including those inside quotes).
    const tasks = [];
    const authors = new Set();
    const addAuthor = (author) => {
      if (author && author.avatarUrl && !authors.has(author)) {
        authors.add(author);
        tasks.push({ kind: 'avatar', _author: author });
      }
    };
    const collect = (blocks) => {
      for (const b of blocks) {
        if (b.kind === 'image') tasks.push(b);
        else if (b.kind === 'video') tasks.push(b);
        else if (b.kind === 'link-card') {
          if (b.imageUrl) tasks.push(b);
        } else if (b.kind === 'quote') {
          addAuthor(b.author);
          collect(b.blocks);
        } else if (b.kind === 'blockquote') collect(b.blocks);
      }
    };
    addAuthor(model.author);
    collect(model.blocks);

    let done = 0;
    const total = tasks.length;
    onProgress && onProgress(0, total);

    await runWithConcurrency(tasks, CONFIG.mediaFetchConcurrency, async (t) => {
      try {
        if (t.kind === 'avatar') {
          const { dataUri, size, mime, sha256 } = await fetchImageAsDataUri(t._author.avatarUrl);
          t._author.avatarDataUri = dataUri;
          t._author.avatarSize = size;
          t._author.avatarMime = mime;
          t._author.avatarSha256 = sha256;
        } else if (t.kind === 'image') {
          const { dataUri, size, mime, sha256 } = await fetchImageAsDataUri(t.url);
          t.dataUri = dataUri;
          t.size = size;
          t.mime = mime;
          t.sha256 = sha256;
        } else if (t.kind === 'link-card') {
          const { dataUri } = await fetchImageAsDataUri(t.imageUrl);
          t.imageDataUri = dataUri;
        } else if (t.kind === 'video') {
          await inlineVideoBlock(t);
        }
      } catch (e) {
        warn('media inline failed, skipping:', e.message);
        if (t.kind === 'avatar') t._author.avatarFailed = true;
        if (t.kind === 'image') t.failed = true;
        if (t.kind === 'link-card') t.imageFailed = true;
        if (t.kind === 'video') t.failed = true;
      }
      done++;
      onProgress && onProgress(done, total);
    });
    return model;
  }

  function collectMediaRescueTasks(model) {
    const tasks = [];
    const authors = new Set();
    // Any author whose avatar bytes are missing gets a retry - whether the first
    // attempt failed or the quote was rebuilt AFTER inlineMedia already ran (the
    // strict-gate repair round adds fresh quote blocks whose avatars were never
    // attempted, so requiring avatarFailed here would skip them).
    const addAuthor = (author) => {
      if (author && author.avatarUrl && !author.avatarDataUri && !authors.has(author)) {
        authors.add(author);
        tasks.push({ kind: 'avatar', _author: author });
      }
    };
    const collect = (blocks) => {
      for (const b of blocks || []) {
        if (b.kind === 'image' && !b.dataUri && b.url) tasks.push(b);
        else if (b.kind === 'link-card' && b.imageUrl && !b.imageDataUri) tasks.push(b);
        else if (
          b.kind === 'video' &&
          ((!b.dataUri && (b.mp4Url || (b.videoCandidates || []).some((c) => c.kind === 'mp4'))) ||
            (b.posterUrl && !b.posterDataUri))
        ) {
          tasks.push(b);
        } else if (b.kind === 'quote') {
          addAuthor(b.author);
          collect(b.blocks);
        } else if (b.kind === 'blockquote') collect(b.blocks);
      }
    };
    addAuthor(model.author);
    collect(model.blocks);
    return tasks;
  }

  async function rescueMissingMedia(model, onProgress) {
    const tasks = collectMediaRescueTasks(model);
    let done = 0;
    const total = tasks.length;
    if (!total) return { attempted: 0, recovered: 0 };
    onProgress && onProgress(0, total);
    let recovered = 0;
    for (const t of tasks) {
      try {
        if (t.kind === 'avatar') {
          const { dataUri, size, mime, sha256 } = await fetchImageAsDataUri(t._author.avatarUrl);
          t._author.avatarDataUri = dataUri;
          t._author.avatarSize = size;
          t._author.avatarMime = mime;
          t._author.avatarSha256 = sha256;
          t._author.avatarFailed = false;
          recovered += 1;
        } else if (t.kind === 'image') {
          const { dataUri, size, mime, sha256 } = await fetchImageAsDataUri(t.url);
          t.dataUri = dataUri;
          t.size = size;
          t.mime = mime;
          t.sha256 = sha256;
          t.failed = false;
          recovered += 1;
        } else if (t.kind === 'link-card') {
          const { dataUri } = await fetchImageAsDataUri(t.imageUrl);
          t.imageDataUri = dataUri;
          t.imageFailed = false;
          recovered += 1;
        } else if (t.kind === 'video') {
          const hadVideo = !!t.dataUri;
          const hadPoster = !!t.posterDataUri;
          await inlineVideoBlock(t);
          t.failed = !t.dataUri && !t.posterDataUri;
          if ((!hadVideo && t.dataUri) || (!hadPoster && t.posterDataUri)) recovered += 1;
        }
      } catch (e) {
        warn('media rescue failed:', e.message);
      }
      done++;
      onProgress && onProgress(done, total);
    }
    return { attempted: total, recovered };
  }

  function recoverableMediaFailures(stats) {
    const missing = (stats.missing || []).filter(
      (item) =>
        ['image', 'avatar', 'video-poster'].includes(item.type) && item.reason === 'download_failed'
    );
    const incomplete = (stats.incomplete || []).filter(
      (item) => item.type === 'video' && item.reason === 'video_download_failed'
    );
    return [...missing, ...incomplete];
  }

  function probeVideoMetadata(dataUri) {
    if (typeof document === 'undefined' || !dataUri) return Promise.resolve({});
    return new Promise((resolve) => {
      const video = document.createElement('video');
      let settled = false;
      const done = (metadata) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeAttribute('src');
        video.load();
        resolve(metadata || {});
      };
      const timer = setTimeout(() => done({}), 2500);
      video.preload = 'metadata';
      video.muted = true;
      video.addEventListener(
        'loadedmetadata',
        () =>
          done({
            width: video.videoWidth,
            height: video.videoHeight,
            duration: Number.isFinite(video.duration) ? video.duration : undefined,
          }),
        { once: true }
      );
      video.addEventListener('error', () => done({}), { once: true });
      video.src = dataUri;
    });
  }

  /** Decide inline-video vs poster fallback based on the size cap. */
  async function inlineVideoBlock(block) {
    addVideoCandidatesToBlock(block, [
      videoCandidate(block.mp4Url, 'model:mp4Url'),
      videoCandidate(block.hlsUrl, 'model:hlsUrl'),
    ]);
    if (block.mp4Url) applyVideoDimensions(block, videoDimensionsFromUrl(block.mp4Url));
    block.videoDownloadAttempts = [];
    // Always try to inline the poster image so there's something to show.
    if (block.posterUrl) {
      try {
        const { dataUri, size, mime, sha256 } = await fetchImageAsDataUri(block.posterUrl);
        block.posterDataUri = dataUri;
        block.posterSize = size;
        block.posterMime = mime;
        block.posterSha256 = sha256;
      } catch (e) {
        warn('poster inline failed:', e.message);
      }
    }

    const candidates = sortVideoCandidates(block.videoCandidates || []).filter(
      (candidate) => candidate.kind === 'mp4'
    );
    if (CONFIG.video.inlineEnabled && candidates.length) {
      for (const candidate of candidates) {
        try {
          const fetched = await fetchAsDataUri(candidate.url);
          const { dataUri, bytes, size, mime, sha256 } = fetched;
          validateMp4Download({ bytes, size, mime, url: candidate.url });
          if (size > CONFIG.video.inlineCapBytes) {
            throw new Error(
              `video ${humanBytes(size)} exceeds cap ${humanBytes(CONFIG.video.inlineCapBytes)}`
            );
          }
          block.mode = 'offline-video';
          block.dataUri = dataUri;
          block.size = size;
          block.mime = mime || 'video/mp4';
          block.sha256 = sha256;
          block.mp4Url = candidate.url;
          block.selectedVideoUrl = candidate.url;
          block.videoFileCaptured = true;
          block.videoDownloadAttempts.push({
            url: candidate.url,
            source: candidate.source,
            ok: true,
            status: 'embedded',
            size,
            mime: block.mime,
            sha256,
          });
          const metadata = await probeVideoMetadata(dataUri);
          applyVideoDimensions(block, metadata);
          if (Number(metadata.duration) > 0) block.duration = metadata.duration;
          return;
        } catch (e) {
          block.videoDownloadAttempts.push({
            url: candidate.url,
            source: candidate.source,
            ok: false,
            error: e.message,
          });
          warn('video inline failed:', e.message);
        }
      }
    }
    if ((block.videoCandidates || []).some((candidate) => candidate.kind === 'hls')) {
      block.hlsUrl =
        block.hlsUrl ||
        (block.videoCandidates || []).find((candidate) => candidate.kind === 'hls').url;
    }
    block.mode = block.posterDataUri
      ? 'poster-only'
      : candidates.length
        ? 'download-failed'
        : 'discovery-failed';
    block.videoFileCaptured = false;
    block.videoFailureReason = candidates.length
      ? 'video_download_failed'
      : block.hlsUrl
        ? 'hls_only'
        : 'video_url_discovery_failed';
  }

  // ===========================================================================
  // STABLE LAYER - assemble the self-contained HTML document
  // ===========================================================================

  function renderAuthorLine(author) {
    author = author || {};
    const avatarAttrs = renderAttrs({
      'data-xa-sha256': author.avatarSha256,
      'data-xa-mime': author.avatarMime,
      'data-xa-size': author.avatarSize,
    });
    const avatar = author.avatarDataUri
      ? `<img class="xa-avatar" src="${author.avatarDataUri}" alt="" aria-hidden="true" width="40" height="40" decoding="async"${
          avatarAttrs ? ` ${avatarAttrs}` : ''
        }>`
      : '';
    const name = author.name ? `<span class="xa-name">${escapeHtml(author.name)}</span>` : '';
    const handle = author.handle
      ? `<span class="xa-handle">${escapeHtml(author.handle)}</span>`
      : '';
    if (!avatar && !name && !handle) return '';
    return `<div class="xa-author">${avatar}${name}${handle}</div>`;
  }

  function renderAttrs(attrs) {
    return Object.entries(attrs)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
      .join(' ');
  }

  function createRenderContext(model) {
    return {
      model,
      counter: { media: 0, images: 0 },
      totalImages: countBlocks(model.blocks, (b) => b.kind === 'image'),
      sourceUrl: model.sourceUrl || '',
      sourcePostId: statusIdFromSourceUrl(model.sourceUrl),
      sourceAuthor: model.author || {},
      quoteDepth: 0,
    };
  }

  function childRenderContext(ctx, block) {
    const sourceUrl = block.sourceUrl || ctx.sourceUrl || '';
    return {
      ...ctx,
      sourceUrl,
      sourcePostId: statusIdFromSourceUrl(sourceUrl) || ctx.sourcePostId,
      sourceAuthor: block.author || ctx.sourceAuthor,
      quoteDepth: ctx.quoteDepth + 1,
    };
  }

  function nextMediaId(ctx, type) {
    ctx.counter.media += 1;
    return `${type}-${String(ctx.counter.media).padStart(3, '0')}`;
  }

  function assignArchiveMediaIds(model) {
    let media = 0;
    const walk = (blocks) => {
      (blocks || []).forEach((b) => {
        if (b.kind === 'image' || b.kind === 'video') {
          media += 1;
          b._xaMediaId = `${b.kind}-${String(media).padStart(3, '0')}`;
        } else if (b.kind === 'quote' || b.kind === 'blockquote') {
          walk(b.blocks);
        }
      });
    };
    walk(model.blocks);
  }

  function assignArchiveImageAlts(model) {
    const ctx = createRenderContext(model);
    const walk = (blocks, currentCtx) => {
      (blocks || []).forEach((b) => {
        if (b.kind === 'image') {
          currentCtx.counter.images += 1;
          b._xaExportAlt = fallbackImageAlt(b, currentCtx, currentCtx.counter.images);
        } else if (b.kind === 'quote') {
          walk(b.blocks, childRenderContext(currentCtx, b));
        } else if (b.kind === 'blockquote') {
          walk(b.blocks, currentCtx);
        }
      });
    };
    walk(model.blocks, ctx);
  }

  function prepareArchiveModel(model) {
    assignArchiveMediaIds(model);
    assignArchiveImageAlts(model);
  }

  function mediaRecord(block, type) {
    const sourceUrl = block.sourceUrl || '';
    const sourcePostId = statusIdFromSourceUrl(sourceUrl);
    const sha256 = block.sha256 || '';
    const mime = block.mime || '';
    const size = block.size || '';
    const record = {
      id: block._xaMediaId || '',
      type,
      sourceUrl,
      sourcePostId,
      originalUrl: type === 'image' ? block.url || '' : block.mp4Url || '',
      width: Number(block.width) > 0 ? Math.round(Number(block.width)) : undefined,
      height: Number(block.height) > 0 ? Math.round(Number(block.height)) : undefined,
      mime,
      size,
      sha256,
      embedded: type === 'image' ? !!block.dataUri : !!block.dataUri,
      missing: type === 'image' ? !block.dataUri : !block.dataUri && !block.posterDataUri,
    };
    if (type === 'image') {
      record.originalAlt = String(block.alt || '');
      record.exportAlt = String(block._xaExportAlt || block.alt || '');
      record.alt = record.exportAlt;
    } else {
      const offlinePlayable = !!block.dataUri;
      const posterCaptured = !!block.posterDataUri;
      const rawMode = block.mode || '';
      const preservationMode = offlinePlayable
        ? 'offline-video'
        : rawMode === 'poster' || rawMode === 'video-inline'
          ? 'poster-only'
          : rawMode || (posterCaptured ? 'poster-only' : 'discovery-failed');
      record.mode = preservationMode;
      record.status = offlinePlayable ? 'preserved offline' : 'not preserved offline';
      record.offlinePlayable = offlinePlayable;
      record.posterUrl = block.posterUrl || '';
      record.posterCaptured = posterCaptured;
      record.sourceLinkPreserved = !!block.sourceUrl;
      record.posterMime = block.posterMime || '';
      record.posterSize = block.posterSize || '';
      record.posterSha256 = block.posterSha256 || '';
      record.durationSeconds = Number(block.duration) > 0 ? Number(block.duration) : undefined;
      record.videoFileMime = offlinePlayable ? mime : '';
      record.videoFileSize = offlinePlayable ? size : '';
      record.videoFileSha256 = offlinePlayable ? sha256 : '';
      record.failureReason = offlinePlayable
        ? ''
        : block.videoFailureReason ||
          (block.mp4Url ? 'video_download_failed' : 'video_url_discovery_failed');
      record.downloadAttempts = block.videoDownloadAttempts || [];
      record.discoveredVideoUrls = (block.videoCandidates || []).map((candidate) => ({
        url: candidate.url,
        kind: candidate.kind,
        source: candidate.source,
        bitrate: candidate.bitrate,
        posterUrl: candidate.posterUrl,
        mediaKey: candidate.mediaKey,
      }));
      record.hlsUrl = block.hlsUrl || '';
      record.unsupported = block.unsupported ? true : undefined;
      record.unsupportedType = block.unsupportedType || '';
    }
    Object.keys(record).forEach((key) => record[key] === undefined && delete record[key]);
    return record;
  }

  function missingReason(block, fallback = 'unavailable') {
    if (block && block.unsupported) return 'unsupported_media';
    if (block && block.failed) return 'download_failed';
    return fallback;
  }

  function missingRecord(type, attrs = {}) {
    const record = { type, ...attrs };
    Object.keys(record).forEach((key) => {
      if (record[key] === undefined || record[key] === null || record[key] === '')
        delete record[key];
    });
    return record;
  }

  function collectMediaManifest(model) {
    const media = [];
    const walk = (blocks) => {
      (blocks || []).forEach((b) => {
        if (b.kind === 'image') media.push(mediaRecord(b, 'image'));
        else if (b.kind === 'video') media.push(mediaRecord(b, 'video'));
        else if (b.kind === 'quote' || b.kind === 'blockquote') walk(b.blocks);
      });
    };
    walk(model.blocks);
    return media;
  }

  /**
   * For the "Save to library" bundle: turn captured media into standalone files. Images become
   * `media/<id>.<ext>`; videos contribute only their poster still as `media/<id>.poster.<ext>`
   * (raw video bytes are intentionally never bundled). Missing/failed media is skipped (it stays
   * listed as missing in the markdown). Requires the model to be prepared (media ids assigned).
   */
  function collectBundleMediaFiles(model) {
    const files = [];
    const pathById = new Map();
    const add = (id, dataUri, suffix) => {
      if (!id || !dataUri) return;
      const { bytes, mime } = dataUriToBytes(dataUri);
      if (!bytes.length) return;
      const name = `media/${id}${suffix}.${mimeToExt(mime)}`;
      files.push({ name, bytes, mime });
      pathById.set(id, name);
    };
    const walk = (blocks) => {
      (blocks || []).forEach((b) => {
        if (b.kind === 'image') add(b._xaMediaId, b.dataUri, '');
        else if (b.kind === 'video') add(b._xaMediaId, b.posterDataUri, '.poster');
        else if (b.kind === 'quote' || b.kind === 'blockquote') walk(b.blocks);
      });
    };
    walk(model.blocks);
    return { files, pathById };
  }

  function duplicateMediaReport(media) {
    const byHash = new Map();
    media.forEach((item) => {
      if (!item.sha256) return;
      if (!byHash.has(item.sha256)) byHash.set(item.sha256, []);
      byHash.get(item.sha256).push(item.id);
    });
    return Array.from(byHash.entries())
      .filter(([, ids]) => ids.length > 1)
      .map(([sha256, mediaIds]) => ({ sha256, count: mediaIds.length, mediaIds }));
  }

  function isGenericImageAlt(value) {
    return /^(image|photo|picture)$/i.test(String(value || '').trim());
  }

  function fallbackImageAlt(block, ctx, imageNumber) {
    const raw = String(block.alt || '').trim();
    if (raw && !isGenericImageAlt(raw)) return raw;
    const handle = ctx.sourceAuthor && ctx.sourceAuthor.handle;
    if (ctx.quoteDepth > 0 && handle) return `Image attached to quoted X post by ${handle}`;
    if (ctx.quoteDepth > 0) return 'Image attached to quoted X post';
    const mediaId = block._xaMediaId ? `, archive media ${block._xaMediaId}` : '';
    if (ctx.model.type === 'article' && handle)
      return `Image attached to main X article by ${handle}${mediaId}`;
    if (ctx.model.type === 'article') return `Image attached to main X article${mediaId}`;
    if (handle) return `Image attached to X post by ${handle}${mediaId}`;
    if (imageNumber && !mediaId) return `Image attached to X post, image ${imageNumber}`;
    return `Image attached to X post${mediaId}`;
  }

  function mediaAttrs(block, ctx, type) {
    const sourceUrl = block.sourceUrl || ctx.sourceUrl || '';
    const width = Number(block.width) > 0 ? Math.round(Number(block.width)) : '';
    const height = Number(block.height) > 0 ? Math.round(Number(block.height)) : '';
    const sha256 = block.sha256 || (type === 'video' ? block.posterSha256 : '') || '';
    const mime = block.mime || (type === 'video' ? block.posterMime : '') || '';
    const size = block.size || (type === 'video' ? block.posterSize : '') || '';
    return renderAttrs({
      'data-xa-media-id': block._xaMediaId || nextMediaId(ctx, type),
      'data-xa-source-post-id': statusIdFromSourceUrl(sourceUrl) || ctx.sourcePostId,
      'data-xa-source-url': sourceUrl,
      'data-xa-sha256': sha256,
      'data-xa-mime': mime,
      'data-xa-size': size,
      width,
      height,
    });
  }

  function videoElementAttrs(block) {
    return renderAttrs({
      'data-xa-media-id': block._xaMediaId || '',
      'data-xa-sha256': block.sha256 || '',
      'data-xa-width': Number(block.width) > 0 ? Math.round(Number(block.width)) : '',
      'data-xa-height': Number(block.height) > 0 ? Math.round(Number(block.height)) : '',
      'data-xa-duration': Number(block.duration) > 0 ? Number(block.duration) : '',
    });
  }

  function renderImageBlock(b, ctx, { galleryItem = false } = {}) {
    const attrs = mediaAttrs(b, ctx, 'image');
    ctx.counter.images += 1;
    const imageNumber = ctx.counter.images;
    b._xaExportAlt = fallbackImageAlt(b, ctx, imageNumber);
    if (!b.dataUri) {
      const source = safeUrl(b.sourceUrl || ctx.sourceUrl || '');
      const sourceLine = source
        ? `<a href="${escapeAttr(source)}" target="_blank" rel="noopener noreferrer">Open source on X</a>`
        : '<span>Source unavailable</span>';
      return galleryItem
        ? `<div class="xa-gallery-missing xa-missing-compact" ${attrs} data-xa-missing-type="image"><span>Image unavailable</span></div>`
        : `<figure class="xa-missing" ${attrs} data-xa-missing-type="image"><strong>Image unavailable at export time</strong><span>${sourceLine}</span></figure>`;
    }
    // NB: do NOT wrap in <a href="data:..."> - Chrome blocks top-level
    // navigation to data: URLs, so clicking would open a blank tab. Instead the
    // image is click-to-zoom via the inline lightbox script in assembleHtml.
    const img = `<img class="xa-zoomable" src="${b.dataUri}" alt="${escapeAttr(
      b._xaExportAlt
    )}" loading="lazy" decoding="async" ${attrs}>`;
    if (galleryItem) return `<div class="xa-image-link">${img}</div>`;
    return `<figure class="xa-media xa-media-single">${img}</figure>`;
  }

  function renderImageGroup(images, ctx) {
    if (images.length === 1) return renderImageBlock(images[0], ctx);
    const countClass = images.length > 4 ? 'xa-gallery-many' : `xa-gallery-count-${images.length}`;
    return `<figure class="xa-media xa-gallery-wrap ${countClass}"><div class="xa-gallery">${images
      .map((image) => renderImageBlock(image, ctx, { galleryItem: true }))
      .join('')}</div></figure>`;
  }

  function renderBlocks(
    blocks,
    ctx = createRenderContext({ type: 'post', sourceUrl: '', author: {} })
  ) {
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.kind === 'image') {
        const images = [block];
        while (blocks[i + 1] && blocks[i + 1].kind === 'image') {
          images.push(blocks[i + 1]);
          i++;
        }
        out.push(renderImageGroup(images, ctx));
      } else {
        out.push(renderBlock(block, ctx));
      }
    }
    return out.join('\n');
  }

  function renderBlock(b, ctx = createRenderContext({ type: 'post', sourceUrl: '', author: {} })) {
    switch (b.kind) {
      case 'heading':
        return `<h${b.level}>${escapeHtml(b.text)}</h${b.level}>`;
      case 'paragraph': {
        const visibleText = textFromHtml(b.html);
        if (articleDividerText(visibleText)) return '<hr class="xa-divider">';
        const heading = articleHeadingBlock(visibleText);
        if (heading) return `<h${heading.level}>${escapeHtml(heading.text)}</h${heading.level}>`;
        return `<p>${b.html}</p>`;
      }
      case 'divider':
        return '<hr class="xa-divider">';
      case 'thread-marker': {
        const source = safeUrl(b.sourceUrl || '');
        const label = `Post ${b.index || '?'} of ${b.total || '?'}`;
        const published = safeIsoTime(b.publishedAt)
          ? `<time datetime="${escapeAttr(safeIsoTime(b.publishedAt))}">${escapeHtml(
              readableUtcTime(b.publishedAt)
            )}</time>`
          : '';
        return `<div class="xa-thread-marker"><strong>${escapeHtml(label)}</strong>${
          source
            ? `<a href="${escapeAttr(source)}" target="_blank" rel="noopener noreferrer">Open on X</a>`
            : ''
        }${published}</div>`;
      }
      case 'link-card': {
        const cardUrl = safeUrl(b.url);
        if (!cardUrl) return '';
        const domain = b.domain || urlHostname(cardUrl);
        const title = b.title && b.title !== domain ? b.title : '';
        // Thumbnail is decorative: rendered only when its bytes actually landed,
        // silently absent otherwise (never a placeholder, never a blocker).
        const thumb = b.imageDataUri
          ? `<img class="xa-card-img" src="${b.imageDataUri}" alt="" aria-hidden="true" loading="lazy" decoding="async">`
          : '';
        return `<a class="xa-card-link" href="${escapeAttr(cardUrl)}" target="_blank" rel="noopener noreferrer">${thumb}<span class="xa-card-title">${escapeHtml(
          title || domain || cardUrl
        )}</span><span class="xa-card-domain">${escapeHtml(domain || cardUrl)} &rarr;</span></a>`;
      }
      case 'poll': {
        const choices = (b.choices || [])
          .map((choice) => {
            const observed = [choice.percentage, choice.votes && `${choice.votes} votes`]
              .filter(Boolean)
              .join(' / ');
            return `<li><span>${escapeHtml(choice.label)}</span>${
              observed ? `<strong>${escapeHtml(observed)}</strong>` : '<em>Result unavailable</em>'
            }</li>`;
          })
          .join('');
        return `<section class="xa-poll" aria-label="Poll" ${renderAttrs({
          'data-xa-source-post-id': b.sourcePostId,
          'data-xa-source-url': b.sourceUrl,
          'data-xa-results-unavailable': b.resultsUnavailable ? 'true' : 'false',
        })}>${b.question ? `<h3>${escapeHtml(b.question)}</h3>` : ''}<ol>${choices}</ol><p>${[
          b.totalVotes && `${b.totalVotes} total votes`,
          b.status,
          b.resultsUnavailable && 'Results were unavailable at capture time',
        ]
          .filter(Boolean)
          .map(escapeHtml)
          .join(' / ')}</p></section>`;
      }
      case 'truncation-notice':
        return `<p class="xa-truncated" data-xa-truncated="1">&#9888; Long-form post &mdash; only the preview above was available at export; X did not expose the full text.${
          safeUrl(b.sourceUrl)
            ? ` <a href="${escapeHtml(safeUrl(b.sourceUrl))}" target="_blank" rel="noopener noreferrer">Read the full post on X &rarr;</a>`
            : ''
        }</p>`;
      case 'note-recovered':
        return `<p class="xa-note-recovered" data-xa-note-recovered="1">&#10003; Long-form post &mdash; the full text above was recovered from data X delivered to this browser while the page was open.</p>`;
      case 'quote-tombstone': {
        const label = b.replyContext
          ? 'Replied-to post unavailable on X'
          : 'Quoted post unavailable on X';
        const detail = b.replyContext
          ? escapeHtml(b.notice || 'The post being replied to is no longer available on X.')
          : `X showed: &ldquo;${escapeHtml(b.notice || 'This Post is unavailable.')}&rdquo;`;
        return `<article class="xa-missing xa-quote-missing" ${renderAttrs({
          'data-xa-missing-type': 'quoted-post-tombstone',
          'data-xa-reply-context': b.replyContext ? '1' : '',
        })}><strong>${label}</strong><span>${detail}</span><span>The post was already gone on X at capture time (deleted, suspended, or restricted account) &mdash; there was nothing to capture.</span></article>`;
      }
      case 'code':
        return `<pre class="xa-code"><code>${escapeHtml(b.text)}</code></pre>`;
      case 'blockquote':
        return `<blockquote class="xa-prose-quote xa-blockquote">${
          b.blocks ? renderBlocks(b.blocks, ctx) : ''
        }</blockquote>`;
      case 'list': {
        const items = b.items.map((i) => `<li>${i}</li>`).join('');
        if (!b.ordered) return `<ul>${items}</ul>`;
        // If the author already numbered the items (kept as text, e.g. a list X split around an
        // embedded post), suppress the <ol> marker so we don't render "1." on top of their "2.".
        const selfNumbered = b.items.length > 0 && itemHasLeadingOrdinal(b.items[0]);
        return selfNumbered
          ? `<ol style="list-style:none;padding-inline-start:0">${items}</ol>`
          : `<ol>${items}</ol>`;
      }
      case 'image':
        return renderImageBlock(b, ctx);
      case 'video': {
        const duration = formatDuration(b.duration);
        const durationText = duration ? ` &middot; ${duration}` : '';
        const videoCaption = `Embedded video${durationText} &middot; preserved offline`;
        const fallbackCaption = `Embedded video${durationText} &middot; video file not preserved offline; poster/source link fallback`;
        if ((b.mode === 'offline-video' || b.mode === 'inline') && b.dataUri) {
          const poster = b.posterDataUri ? ` poster="${b.posterDataUri}"` : '';
          return `<figure class="xa-video" ${mediaAttrs(b, ctx, 'video')}><video controls playsinline preload="metadata" ${videoElementAttrs(b)}${poster}><source src="${b.dataUri}" type="${escapeAttr(b.mime || 'video/mp4')}"></video><figcaption>${videoCaption}</figcaption></figure>`;
        }
        return `<figure class="xa-video-fallback" ${mediaAttrs(
          b,
          ctx,
          'video'
        )} data-xa-missing-type="${b.posterDataUri ? 'video-inline' : 'video'}">${
          b.posterDataUri
            ? `<img src="${b.posterDataUri}" alt="" aria-hidden="true" loading="lazy" decoding="async">`
            : '<div class="xa-missing xa-missing-compact" data-xa-missing-type="video"><strong>Video unavailable</strong><span>This video was unavailable at export time.</span></div>'
        }${
          safeUrl(b.sourceUrl)
            ? `<a class="xa-watch" href="${escapeHtml(safeUrl(b.sourceUrl))}" target="_blank" rel="noopener noreferrer">&#9654; Watch video on X</a>`
            : ''
        }<figcaption>${fallbackCaption}</figcaption></figure>`;
      }
      case 'quote': {
        const qctx = childRenderContext(ctx, b);
        const sourcePostId = statusIdFromSourceUrl(b.sourceUrl);
        const quoteSourceHref = safeUrl(b.sourceUrl);
        const authorHref = authorProfileUrl(b.author && b.author.handle);
        // A quoted post always deserves a working link. Prefer the exact permalink; fall
        // back to the author's profile so the reader never sees a dead-end card.
        const quoteLinkHref = quoteSourceHref || authorHref;
        const quoteLinkLabel = quoteSourceHref
          ? 'View on X &rarr;'
          : b.author && b.author.handle
            ? `View ${escapeHtml(b.author.handle)} on X &rarr;`
            : '';
        if (!b.blocks || !b.blocks.length) {
          return `<article class="xa-missing xa-quote-missing" ${renderAttrs({
            'data-xa-missing-type': 'quoted-post',
            'data-xa-source-post-id': sourcePostId,
            'data-xa-source-url': b.sourceUrl,
          })}><strong>Quoted post unavailable</strong><span>This quoted post was private, deleted, or failed to load at export time.</span>${
            quoteLinkHref
              ? `<a href="${escapeHtml(quoteLinkHref)}" target="_blank" rel="noopener noreferrer">${
                  quoteSourceHref ? 'Open source on X' : 'Open author on X'
                }</a>`
              : ''
          }</article>`;
        }
        const className =
          (qctx.quoteDepth > 1
            ? 'xa-tweet-card xa-nested-tweet-card xa-quote'
            : 'xa-tweet-card xa-quote') + (b.replyContext ? ' xa-reply-context' : '');
        // Reply context reads top-down: label the card so the reader knows the
        // exported post ANSWERS this one (not the usual embedded-quote relation).
        const replyLabel = b.replyContext ? '<p class="xa-reply-label">In reply to</p>' : '';
        return `${replyLabel}<article class="${className}" ${renderAttrs({
          'data-xa-post-id': sourcePostId,
          'data-xa-source-url': b.sourceUrl,
          'data-xa-source-fallback': quoteSourceHref ? '' : authorHref ? 'author-profile' : '',
          'data-xa-published-at': safeIsoTime(b.publishedAt),
          'data-xa-reply-context': b.replyContext ? '1' : '',
        })}>${renderAuthorLine(b.author)}<div class="xa-quote-body">${
          b.blocks ? renderBlocks(b.blocks, qctx) : ''
        }</div>${
          b.truncated
            ? `<p class="xa-truncated" data-xa-truncated="1">&#9888; Long-form post &mdash; only the preview above was available at export; X did not expose the full text.${
                quoteLinkHref
                  ? ` <a href="${escapeHtml(quoteLinkHref)}" target="_blank" rel="noopener noreferrer">${
                      quoteSourceHref ? 'Read the full post on X &rarr;' : 'Open author on X &rarr;'
                    }</a>`
                  : ''
              }</p>`
            : b.noteRecovered
              ? `<p class="xa-note-recovered" data-xa-note-recovered="1">&#10003; Long-form post &mdash; full text recovered from data X delivered to this browser.</p>`
              : ''
        }${
          safeIsoTime(b.publishedAt)
            ? `<time class="xa-quote-time" datetime="${escapeAttr(safeIsoTime(b.publishedAt))}">${escapeHtml(
                readableUtcTime(b.publishedAt)
              )}</time>`
            : ''
        }${
          quoteLinkHref
            ? `<a class="xa-quote-link" href="${escapeHtml(quoteLinkHref)}" target="_blank" rel="noopener">${quoteLinkLabel}</a>`
            : ''
        }</article>`;
      }
      default:
        return '';
    }
  }

  function hrefsFromHtml(html) {
    const hrefs = [];
    String(html || '').replace(/\shref="([^"]+)"/g, (match, href) => {
      hrefs.push(href);
      return match;
    });
    return hrefs;
  }

  function archiveStats(model, media = collectMediaManifest(model)) {
    const duplicateMedia = duplicateMediaReport(media);
    const stats = {
      mainTextCaptured: false,
      headings: 0,
      paragraphs: 0,
      lists: 0,
      polls: 0,
      pollBlocks: [],
      recoveredNotes: 0,
      quoteCards: 0,
      quoteTombstones: 0,
      renderedTweetCards: 0,
      images: 0,
      videos: 0,
      videosPreservedOffline: 0,
      videoPostersCaptured: 0,
      videoSourceLinksPreserved: 0,
      incompleteMedia: 0,
      missingMedia: 0,
      media,
      hashedMedia: media.filter((item) => !!item.sha256).length,
      duplicateMedia,
      sourceLinks: new Set(model.sourceUrl ? [model.sourceUrl] : []),
      mediaUrls: new Map(),
      warnings: [],
      missing: [],
      incomplete: [],
    };
    const addMissing = (record, warning) => {
      stats.missing.push(missingRecord(record.type, record));
      if (warning) stats.warnings.push(warning);
    };
    const markMediaUrl = (url) => {
      if (!url) return;
      stats.mediaUrls.set(url, (stats.mediaUrls.get(url) || 0) + 1);
    };
    const walk = (blocks) => {
      (blocks || []).forEach((b) => {
        if (b.kind === 'heading') {
          stats.headings += 1;
          stats.mainTextCaptured = stats.mainTextCaptured || !!String(b.text || '').trim();
        } else if (b.kind === 'thread-marker') {
          if (b.sourceUrl) stats.sourceLinks.add(b.sourceUrl);
        } else if (b.kind === 'paragraph') {
          stats.paragraphs += 1;
          stats.mainTextCaptured = stats.mainTextCaptured || !!textFromHtml(b.html);
          hrefsFromHtml(b.html).forEach((href) => stats.sourceLinks.add(href));
        } else if (b.kind === 'list') {
          stats.lists += 1;
          stats.mainTextCaptured =
            stats.mainTextCaptured || (b.items || []).some((item) => !!textFromHtml(item));
          (b.items || []).forEach((item) =>
            hrefsFromHtml(item).forEach((href) => stats.sourceLinks.add(href))
          );
        } else if (b.kind === 'poll') {
          stats.polls += 1;
          stats.pollBlocks.push({
            question: b.question || '',
            choices: (b.choices || []).map((choice) => ({ ...choice })),
            ...(b.totalVotes ? { totalVotes: b.totalVotes } : {}),
            ...(b.status ? { status: b.status } : {}),
            sourcePostId: b.sourcePostId || statusIdFromSourceUrl(b.sourceUrl),
            sourceUrl: b.sourceUrl || '',
            resultsUnavailable: b.resultsUnavailable === true,
          });
          if (b.sourceUrl) stats.sourceLinks.add(b.sourceUrl);
        } else if (b.kind === 'note-recovered') {
          stats.recoveredNotes += 1;
        } else if (b.kind === 'quote-tombstone') {
          // Informational, never missing/incomplete: the quoted post was gone on
          // X itself, so "complete" stays true - but the reader is told why.
          stats.quoteTombstones += 1;
          stats.warnings.push(
            b.replyContext
              ? 'The post this reply answers was already unavailable on X at capture time. Nothing was capturable.'
              : `A quoted post was already unavailable on X at capture time (${
                  b.notice || 'This Post is unavailable.'
                }). Nothing was capturable.`
          );
        } else if (b.kind === 'image') {
          stats.images += 1;
          markMediaUrl(b.url);
          if (!b.dataUri) {
            addMissing(
              {
                type: 'image',
                mediaId: b._xaMediaId,
                sourcePostId: statusIdFromSourceUrl(b.sourceUrl) || undefined,
                sourceUrl: b.sourceUrl || undefined,
                originalUrl: b.url || undefined,
                reason: missingReason(b, 'download_failed'),
              },
              `Image ${b._xaMediaId || ''} was unavailable at export time.`.trim()
            );
          }
          if (b.sourceUrl) stats.sourceLinks.add(b.sourceUrl);
        } else if (b.kind === 'video') {
          stats.videos += 1;
          if (b.dataUri) stats.videosPreservedOffline += 1;
          if (b.posterDataUri) stats.videoPostersCaptured += 1;
          if (b.sourceUrl) stats.videoSourceLinksPreserved += 1;
          markMediaUrl(b.mp4Url || b.posterUrl || b.sourceUrl);
          if (!b.dataUri) {
            stats.incomplete.push(
              missingRecord('video', {
                mediaId: b._xaMediaId,
                sourcePostId: statusIdFromSourceUrl(b.sourceUrl) || undefined,
                sourceUrl: b.sourceUrl || undefined,
                originalUrl: b.mp4Url || b.hlsUrl || undefined,
                reason: b.videoFailureReason || 'video_file_not_captured',
                mode:
                  b.mode === 'poster' || b.mode === 'video-inline'
                    ? 'poster-only'
                    : b.mode || (b.posterDataUri ? 'poster-only' : 'discovery-failed'),
                posterCaptured: !!b.posterDataUri,
                sourceLinkPreserved: !!b.sourceUrl,
              })
            );
            stats.warnings.push(
              `Video ${b._xaMediaId || ''} was detected, but the video file was not preserved offline. ${
                b.posterDataUri ? 'Only the poster' : 'No poster'
              } and ${b.sourceUrl ? 'source link were' : 'no source link was'} preserved.`.trim()
            );
          }
          if (!b.dataUri && !b.posterDataUri) {
            addMissing(
              {
                type: 'video',
                mediaId: b._xaMediaId,
                sourcePostId: statusIdFromSourceUrl(b.sourceUrl) || undefined,
                sourceUrl: b.sourceUrl || undefined,
                originalUrl: b.mp4Url || b.posterUrl || undefined,
                reason: missingReason(b, b.unsupported ? 'unsupported_media' : 'download_failed'),
              },
              `Video ${b._xaMediaId || ''} was unavailable at export time.`.trim()
            );
          } else if (b.posterUrl && !b.posterDataUri) {
            addMissing(
              {
                type: 'video-poster',
                mediaId: b._xaMediaId,
                sourcePostId: statusIdFromSourceUrl(b.sourceUrl) || undefined,
                sourceUrl: b.sourceUrl || undefined,
                originalUrl: b.posterUrl,
                reason: 'download_failed',
              },
              `Video poster for ${b._xaMediaId || 'a video'} was unavailable at export time.`
            );
          }
          if (b.sourceUrl) stats.sourceLinks.add(b.sourceUrl);
        } else if (b.kind === 'quote') {
          stats.quoteCards += 1;
          stats.renderedTweetCards += 1;
          if (b.noteRecovered) stats.recoveredNotes += 1;
          if (b.sourceUrl) stats.sourceLinks.add(b.sourceUrl);
          else if (b.blocks && b.blocks.length) {
            const profileHref = authorProfileUrl(b.author && b.author.handle);
            stats.warnings.push(
              profileHref
                ? `An embedded post was captured without a canonical source URL; the author profile (${profileHref}) is linked instead.`
                : 'An embedded post was captured, but X did not expose its canonical source URL.'
            );
          }
          if (!b.blocks || !b.blocks.length) {
            const postId = statusIdFromSourceUrl(b.sourceUrl);
            addMissing(
              {
                type: 'quoted-post',
                sourcePostId: postId || undefined,
                sourceUrl: b.sourceUrl || undefined,
                reason: 'private_or_deleted',
              },
              `Quoted post ${postId || b.sourceUrl || ''} was unavailable at export time.`.trim()
            );
          }
          walk(b.blocks);
        } else if (b.kind === 'blockquote') {
          walk(b.blocks);
        }
      });
    };
    walk(model.blocks);
    if (
      !(
        model.author &&
        (String(model.author.name || '').trim() ||
          String(model.author.handle || '').trim() ||
          model.author.avatarUrl ||
          model.author.avatarDataUri)
      )
    ) {
      stats.warnings.push('Main author metadata was not found.');
    }
    if (model.author && model.author.avatarFailed) {
      addMissing(
        {
          type: 'avatar',
          sourceUrl: model.author.avatarUrl || undefined,
          reason: 'download_failed',
        },
        'Main author avatar was unavailable at export time.'
      );
    }
    if (!stats.mainTextCaptured) stats.warnings.push('No main text content was captured.');
    stats.missingMedia = stats.missing.length;
    stats.incompleteMedia = stats.incomplete.length;
    if (stats.missingMedia)
      stats.warnings.push(`${stats.missingMedia} item(s) were unavailable at export time.`);
    if (media.some((item) => item.embedded && !item.sha256))
      stats.warnings.push('Some embedded media could not be content-hashed in this browser.');
    if (duplicateMedia.length)
      stats.warnings.push(`${duplicateMedia.length} duplicate media hash group(s) were detected.`);
    return {
      ...stats,
      sourceLinks: stats.sourceLinks.size,
    };
  }

  /**
   * "Ship-blocker" gate for strict export mode. Walks the FULLY-recovered model and
   * returns a structured report of anything the export would silently render as a
   * dead-end (a "Source URL unavailable" card, a "Media unavailable" placeholder, or
   * a quoted post whose content couldn't be fetched). Pure - no DOM, no side effects.
   *
   * Verdict logic:
   *   - 'clean'      : nothing to warn the user about; ship without prompting.
   *   - 'incomplete' : one or more ship-blockers; strict mode should confirm.
   *
   * What is a ship-blocker (visible dead-end for the reader):
   *   - Quote card without a resolvable /status/ permalink (all recovery layers failed)
   *   - Quote card whose content couldn't be captured (private / deleted / fetch failed)
   *   - Image that was DETECTED but couldn't be inlined (renders as "Image unavailable")
   *   - Video with neither MP4 bytes nor a poster still (renders as "Video unavailable")
   *
   * Deliberately NOT ship-blockers (documented best-effort per AGENTS.md):
   *   - HLS-only videos with a poster (unsupported_media - can't fix without HLS reassembly)
   *   - Long-form posts that stayed truncated (X did not deliver the full text to the browser)
   *   - Quotes whose author-profile fallback link is in use (still a working link)
   */
  function assessExportCompleteness(model) {
    const blockers = [];
    const walk = (blocks) => {
      (blocks || []).forEach((b) => {
        if (b.kind === 'quote') {
          const hasBlocks = b.blocks && b.blocks.length > 0;
          const hasCanonicalUrl = !!statusIdFromUrl(b.sourceUrl);
          if (!hasBlocks) {
            blockers.push({
              kind: 'quote-content-missing',
              handle: (b.author && b.author.handle) || '',
              sourceUrl: b.sourceUrl || '',
              summary: `Embedded post ${
                (b.author && b.author.handle) || 'from an unknown author'
              } could not be captured (private, deleted, or fetch failed).`,
            });
          } else if (!hasCanonicalUrl) {
            blockers.push({
              kind: 'quote-permalink-missing',
              handle: (b.author && b.author.handle) || '',
              summary: `Embedded post ${
                (b.author && b.author.handle) || 'from an unknown author'
              } has no canonical permalink; only the author profile link is available.`,
            });
          }
          walk(b.blocks);
        } else if (b.kind === 'blockquote') {
          walk(b.blocks);
        } else if (b.kind === 'image') {
          const isDetected = !!(b.url || b.dataUri);
          if (isDetected && !b.dataUri) {
            blockers.push({
              kind: 'image-fetch-failed',
              mediaId: b._xaMediaId || '',
              url: b.url || '',
              sourceUrl: b.sourceUrl || '',
              summary: `Image ${b._xaMediaId || b.url || ''} was detected but its bytes couldn't be fetched.`,
            });
          }
        } else if (b.kind === 'video') {
          // Nothing at all captured (no MP4, no poster) is a hard failure regardless of
          // whether the format was unsupported - the reader sees a "Video unavailable" card.
          if (!b.dataUri && !b.posterDataUri) {
            blockers.push({
              kind: 'video-nothing-captured',
              mediaId: b._xaMediaId || '',
              sourceUrl: b.sourceUrl || '',
              unsupported: !!b.unsupported,
              summary:
                `Video ${b._xaMediaId || ''} has neither video bytes nor a poster still captured.`.trim(),
            });
          }
        }
      });
    };
    walk(model.blocks);
    // Deduplicate by (kind + key identifiers) to avoid a wall of duplicate rows when the
    // same quote or media appears in multiple thread posts. Keeps counts honest.
    const seen = new Set();
    const deduped = [];
    for (const b of blockers) {
      const key = `${b.kind}|${b.handle || ''}|${b.mediaId || ''}|${b.sourceUrl || ''}|${b.url || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(b);
    }
    const counts = {
      quotePermalinkMissing: deduped.filter((b) => b.kind === 'quote-permalink-missing').length,
      quoteContentMissing: deduped.filter((b) => b.kind === 'quote-content-missing').length,
      imageFetchFailed: deduped.filter((b) => b.kind === 'image-fetch-failed').length,
      videoNothingCaptured: deduped.filter((b) => b.kind === 'video-nothing-captured').length,
    };
    return {
      verdict: deduped.length ? 'incomplete' : 'clean',
      blockers: deduped,
      counts,
    };
  }

  /**
   * Compact, paste-able diagnostic bundle for when strict mode blocks an export.
   * Contains the metadata needed to reproduce (URL, version, capture diagnostics,
   * verdict, and a lightweight model skeleton) but NEVER media bytes - so it fits
   * in a chat message. The skeleton preserves block kinds and identifying fields
   * but strips `dataUri`, `posterDataUri`, and the debug JSON.
   */
  function buildDiagnosticBundle(model, assessment, extra = {}) {
    const stripBytes = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(stripBytes);
      const out = {};
      for (const key of Object.keys(obj)) {
        if (key === 'dataUri' || key === 'posterDataUri' || key === 'avatarDataUri') {
          out[key] = obj[key] ? `[stripped: ${String(obj[key]).length} bytes]` : '';
          continue;
        }
        if (key === '_debug') continue;
        out[key] = stripBytes(obj[key]);
      }
      return out;
    };
    const bundle = {
      generator: `${APP} v${VERSION}`,
      capturedAt: new Date().toISOString(),
      pageUrl:
        (typeof location !== 'undefined' && location && location.href) || model.sourceUrl || '',
      modelSourceUrl: model.sourceUrl || '',
      modelType: model.type || '',
      isThread: !!model.thread,
      threadPosts:
        model.thread && Number.isFinite(model.thread.capturedPosts)
          ? model.thread.capturedPosts
          : undefined,
      verdict: assessment.verdict,
      counts: assessment.counts,
      blockers: assessment.blockers,
      networkCapture:
        typeof networkCaptureDiagnostics === 'object'
          ? {
              mode: networkCaptureDiagnostics.mode,
              installed: networkCaptureDiagnostics.installed,
              responsesSeen: networkCaptureDiagnostics.responsesSeen,
              interestingResponses: networkCaptureDiagnostics.interestingResponses,
              noteTweets: networkCaptureDiagnostics.noteTweets,
              quotedRefs: networkCaptureDiagnostics.quotedRefs,
              truncatedResponses: networkCaptureDiagnostics.truncatedResponses,
              lastTruncatedUrl: networkCaptureDiagnostics.lastTruncatedUrl,
              errors: (networkCaptureDiagnostics.errors || []).slice(-3),
            }
          : undefined,
      modelSkeleton: stripBytes({
        title: model.title,
        heading: model.heading,
        author: model.author,
        publishedAt: model.publishedAt,
        thread: model.thread,
        blocks: model.blocks,
      }),
      ...extra,
    };
    return JSON.stringify(bundle, null, 2);
  }

  /** Quotes the strict gate flagged as dead BUT that still carry a canonical
   *  permalink - the one case a syndication re-fetch can actually fix. */
  function collectRepairableQuotes(blocks, out = []) {
    for (const b of blocks || []) {
      if (b.kind === 'quote') {
        if ((!b.blocks || !b.blocks.length) && statusIdFromUrl(b.sourceUrl)) out.push(b);
        collectRepairableQuotes(b.blocks, out);
      } else if (b.kind === 'blockquote') {
        collectRepairableQuotes(b.blocks, out);
      }
    }
    return out;
  }

  /**
   * One automatic repair round that runs BEFORE the strict-mode gate surfaces
   * anything to the user. Nearly every blocker the gate detects is transient
   * (rate limit, dropped connection, capture that arrived late), so each is
   * retried through the layer that owns it after a short pause:
   *   - quote permalinks: re-check the passive GraphQL capture (free - new refs
   *     may have arrived while media was downloading),
   *   - dead quote cards with a permalink: re-fetch from syndication and rebuild,
   *   - failed media (plus any media a quote rebuild just added): one more
   *     rescue pass.
   * Returns a fresh assessment; the modal only appears if this still comes back
   * incomplete.
   */
  async function repairExportBlockers(
    model,
    assessment,
    onProgress,
    {
      fetchTweet = fetchTweetSyndication,
      rescue = rescueMissingMedia,
      pauseMs = CONFIG.repairPauseMs,
    } = {}
  ) {
    if (!assessment || assessment.verdict === 'clean') return assessment;
    if (pauseMs) await sleep(pauseMs);
    recoverMissingQuoteSourcesFromCapture(model);
    // Permalink-missing quotes: retry the pool-based syndication matcher too -
    // the main pass may have lost it to a transient fetch failure.
    if (directQuotes(model.blocks).some((q) => !statusIdFromUrl(q.sourceUrl))) {
      await recoverMissingQuoteSourcesViaSyndication(model, null, fetchTweet);
    }
    for (const quote of collectRepairableQuotes(model.blocks)) {
      const id = statusIdFromUrl(quote.sourceUrl);
      try {
        const data = await fetchTweet(id);
        if (data && data.user && (data.__typename === 'Tweet' || data.text != null)) {
          const fresh = mergeQuoteAfterSyndication(quote, syndicationToQuoteBlock(data));
          quote.author = fresh.author;
          quote.blocks = fresh.blocks;
          // Keep the permalink we already verified unless the rebuild produced
          // an equally canonical one (payloads missing id_str yield a dead URL).
          if (statusIdFromUrl(fresh.sourceUrl)) quote.sourceUrl = fresh.sourceUrl;
          quote.truncated = fresh.truncated;
          if (quote.truncated) recoverQuoteNoteText(quote, getCapturedNoteTweet(id));
        }
      } catch (e) {
        warn('strict-gate quote repair failed for', id, '-', e.message);
      }
    }
    await rescue(model, onProgress);
    return assessExportCompleteness(model);
  }

  function buildArchiveManifest(model, rawDebug, stats, documentLang) {
    let diagnostics;
    if (rawDebug) {
      try {
        diagnostics = typeof rawDebug === 'string' ? JSON.parse(rawDebug) : rawDebug;
      } catch {
        diagnostics = { raw: String(rawDebug) };
      }
    }
    diagnostics = diagnostics || {};
    diagnostics.networkCapture = {
      ...networkCaptureDiagnostics,
      bufferedCandidates: capturedNetworkVideoCandidates.length,
    };
    const manifest = {
      schemaVersion: '1.0',
      exporter: { name: APP, version: VERSION },
      capture: {
        sourceUrl: model.sourceUrl || '',
        publishedAt: safeIsoTime(model.publishedAt),
        exportedAt: safeIsoTime(model.exportedAt),
        documentLang,
        mainTextCaptured: stats.mainTextCaptured,
        headings: stats.headings,
        paragraphs: stats.paragraphs,
        lists: stats.lists,
        polls: stats.polls,
        recoveredLongFormNotes: stats.recoveredNotes,
        quoteCards: stats.quoteCards,
        renderedTweetCards: stats.renderedTweetCards,
        images: stats.images,
        videos: stats.videos,
        videosPreservedOffline: stats.videosPreservedOffline,
        videoPostersCaptured: stats.videoPostersCaptured,
        videoSourceLinksPreserved: stats.videoSourceLinksPreserved,
        incompleteMedia: stats.incompleteMedia,
        missingMedia: stats.missingMedia,
        hashedMedia: stats.hashedMedia,
        duplicateMedia: stats.duplicateMedia.length,
        sourceLinks: stats.sourceLinks,
        threadPosts: model.thread ? model.thread.capturedPosts : 1,
        threadCompleteness: model.thread ? model.thread.completeness : 'single-post',
        note: String(model.userNote || ''),
        tags: Array.isArray(model.tags) ? model.tags : [],
      },
      media: stats.media,
      missing: stats.missing,
      incomplete: stats.incomplete,
      duplicates: stats.duplicateMedia,
      polls: stats.pollBlocks,
      warnings: stats.warnings,
    };
    manifest.diagnostics = diagnostics;
    return manifest;
  }

  function renderCaptureSummary(stats) {
    const row = (label, value) =>
      `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
    return `<details class="xa-capture"><summary>Capture summary</summary><dl>${[
      row('Main text', stats.mainTextCaptured ? 'Captured' : 'Not detected'),
      row('Embedded posts', stats.quoteCards),
      ...(stats.quoteTombstones ? [row('Quoted posts gone on X', stats.quoteTombstones)] : []),
      row('Polls', stats.polls),
      row('Images', stats.images),
      row('Videos found', stats.videos),
      row('Videos preserved offline', stats.videosPreservedOffline),
      row('Video posters captured', stats.videoPostersCaptured),
      row('Incomplete media', stats.incompleteMedia),
      row('Hashed media', `${stats.hashedMedia}/${stats.media.length}`),
      row('Duplicate groups', stats.duplicateMedia.length),
      row('Missing media', stats.missingMedia),
      row('Source links', stats.sourceLinks),
    ].join('')}</dl></details>`;
  }

  function markdownLineText(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim()
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function markdownPlainText(value) {
    return markdownLineText(value).replace(/\n{3,}/g, '\n\n');
  }

  function markdownHeading(level, text) {
    const clean = markdownLineText(text).replace(/\n+/g, ' ');
    if (!clean) return '';
    const depth = Math.min(Math.max(Number(level) || 2, 1), 6);
    return `${'#'.repeat(depth)} ${clean}`;
  }

  function markdownFence(text, language) {
    const body = String(text || '').replace(/\r\n?/g, '\n');
    const fence = body.includes('```') ? '~~~~' : '```';
    return `${fence}${language || ''}\n${body}\n${fence}`;
  }

  function markdownQuote(text) {
    const clean = markdownPlainText(text);
    if (!clean) return '> [No text captured]';
    return clean
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n');
  }

  function assignLlmQuoteNumbers(model) {
    let rootCounter = 0;
    const childCounters = new Map();
    const nextNumber = (prefix) => {
      if (!prefix) {
        rootCounter += 1;
        return String(rootCounter);
      }
      const next = (childCounters.get(prefix) || 0) + 1;
      childCounters.set(prefix, next);
      return `${prefix}.${next}`;
    };
    const walk = (blocks, prefix = '') => {
      (blocks || []).forEach((b) => {
        if (b.kind === 'quote') {
          b._xaLlmNumber = nextNumber(prefix);
          walk(b.blocks, b._xaLlmNumber);
        } else if (b.kind === 'blockquote') {
          walk(b.blocks, prefix);
        }
      });
    };
    walk(model.blocks);
  }

  function quoteLabel(block) {
    const number = block && block._xaLlmNumber ? block._xaLlmNumber : '?';
    if (number.includes('.')) return `Nested Quoted Post ${number}`;
    if (block && block.replyContext) return `Reply Context Post ${number}`;
    return `Embedded Post ${number}`;
  }

  function directQuotes(blocks) {
    const quotes = [];
    const walk = (items) => {
      (items || []).forEach((b) => {
        if (b.kind === 'quote') quotes.push(b);
        else if (b.kind === 'blockquote') walk(b.blocks);
      });
    };
    walk(blocks);
    return quotes;
  }

  function allLlmQuotes(blocks) {
    const quotes = [];
    const walk = (items) => {
      (items || []).forEach((b) => {
        if (b.kind === 'quote') {
          quotes.push(b);
          walk(b.blocks);
        } else if (b.kind === 'blockquote') {
          walk(b.blocks);
        }
      });
    };
    walk(blocks);
    return quotes;
  }

  function topLevelLlmQuotes(model) {
    return directQuotes(model.blocks).filter((q) => !String(q._xaLlmNumber || '').includes('.'));
  }

  function llmQuoteCounts(model) {
    const total = allLlmQuotes(model.blocks).length;
    const direct = topLevelLlmQuotes(model).length;
    return { total, direct, nested: total - direct };
  }

  function collectLlmSourceLinks(model) {
    const links = new Set();
    const add = (url) => {
      if (url && !String(url).startsWith('data:')) links.add(String(url));
    };
    add(model.sourceUrl);
    const walk = (blocks) => {
      (blocks || []).forEach((b) => {
        if (b.kind === 'thread-marker') {
          add(b.sourceUrl);
        } else if (b.kind === 'link-card') {
          add(b.url);
        } else if (b.kind === 'paragraph') {
          hrefsFromHtml(b.html).forEach(add);
        } else if (b.kind === 'list') {
          (b.items || []).forEach((item) => hrefsFromHtml(item).forEach(add));
        } else if (b.kind === 'image') {
          add(b.sourceUrl);
        } else if (b.kind === 'video') {
          add(b.sourceUrl);
        } else if (b.kind === 'quote') {
          add(b.sourceUrl);
          walk(b.blocks);
        } else if (b.kind === 'blockquote') {
          walk(b.blocks);
        }
      });
    };
    walk(model.blocks);
    return Array.from(links);
  }

  function collectLlmMediaAttachments(model) {
    const attachments = new Map();
    const walk = (blocks, attachedTo) => {
      (blocks || []).forEach((b) => {
        if ((b.kind === 'image' || b.kind === 'video') && b._xaMediaId) {
          attachments.set(b._xaMediaId, attachedTo);
        } else if (b.kind === 'quote') {
          walk(b.blocks, quoteLabel(b).toLowerCase());
        } else if (b.kind === 'blockquote') {
          walk(b.blocks, attachedTo);
        }
      });
    };
    const rootLabel = model.type === 'article' ? 'main article' : 'main post';
    walk(model.blocks, rootLabel);
    return attachments;
  }

  function normalizedStatusKey(url) {
    const id = statusIdFromUrl(url);
    if (id) return `status:${id}`;
    return String(url || '').split(/[?#]/)[0];
  }

  function linksWithTextFromHtml(html) {
    const links = [];
    String(html || '').replace(
      /<a\b[^>]*\shref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      (match, href, inner) => {
        links.push({ href, text: textFromHtml(inner) });
        return match;
      }
    );
    return links;
  }

  function originalPostLinksFromHtml(html) {
    return linksWithTextFromHtml(html)
      .filter((link) => /\u539f\u63a8/.test(link.text))
      .map((link) => link.href)
      .filter(Boolean);
  }

  function firstIsoDate(value) {
    const match = String(value || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    return match ? match[1] : '';
  }

  function createOriginalPostResolver(model) {
    const quotes = topLevelLlmQuotes(model);
    const byStatus = new Map();
    const byDate = new Map();
    quotes.forEach((quote) => {
      const key = normalizedStatusKey(quote.sourceUrl);
      if (key) byStatus.set(key, quote);
      const date = safeIsoTime(quote.publishedAt).slice(0, 10);
      if (date) {
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push(quote);
      }
    });
    let fallbackIndex = 0;
    const usedByDate = new Set();
    const describeQuote = (quote) =>
      quote && quote.sourceUrl
        ? `${quoteLabel(quote)} - ${quote.sourceUrl}`
        : quote
          ? `${quoteLabel(quote)} - source URL unavailable`
          : '';
    return {
      resolve(text, html) {
        const sourceUrls = originalPostLinksFromHtml(html);
        for (const sourceUrl of sourceUrls) {
          const quote = byStatus.get(normalizedStatusKey(sourceUrl));
          if (quote) return describeQuote(quote);
          return `Source link - ${sourceUrl}`;
        }

        const date = firstIsoDate(text);
        if (date && byDate.has(date)) {
          const quote = byDate.get(date).find((candidate) => !usedByDate.has(candidate));
          if (quote) {
            usedByDate.add(quote);
            return describeQuote(quote);
          }
        }

        const quote = quotes[fallbackIndex++];
        return describeQuote(quote) || 'original post source unavailable';
      },
    };
  }

  function replaceOriginalPostLabels(text, html, resolver) {
    return markdownPlainText(text).replace(/\u539f\u63a8/g, () => {
      if (!resolver || !resolver.resolve) return 'original post source unavailable';
      return resolver.resolve(text, html);
    });
  }

  function llmPostText(block) {
    return renderLlmBlocks(block.blocks, {
      includeMedia: false,
      includeQuoteRefs: false,
      linkOriginalPostLabels: false,
    });
  }

  function isTerminalPunctuation(value) {
    return /[.!?\u3002\uff01\uff1f\u2026\u300d\u300f\uff09)\]"']$/.test(String(value || '').trim());
  }

  function isPossiblyTruncatedPost(block) {
    if (!block || !block.blocks || !block.blocks.length) return false;
    const text = markdownPlainText(llmPostText(block));
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length < 80) return false;
    if (/[0-9]+[.)\u3001]$/.test(compact)) return true;
    if (/[0-9]$/.test(compact) && compact.length >= 60) return true;
    if (/(?:^|\s)[1-9][0-9]*[.)]\s*[$@#A-Za-z\u3400-\u9fff][\w$@#\u3400-\u9fff-]*$/.test(compact))
      return true;
    if ((compact.match(/[(\uff08]/g) || []).length > (compact.match(/[)\uff09]/g) || []).length)
      return true;
    if (/\.\.\.|\u2026/.test(compact) && !isTerminalPunctuation(compact)) return true;
    if (compact.length >= 240 && !isTerminalPunctuation(compact)) return true;
    if (/[$@#A-Za-z\u3400-\u9fff]$/.test(compact) && compact.length >= 120) return true;
    return false;
  }

  function llmVideoWarnings(videoMedia) {
    const warnings = [];
    videoMedia.forEach((item) => {
      if (item.offlinePlayable) {
        const posterPath = llmMediaFiles && llmMediaFiles.get(item.id);
        warnings.push(
          llmMediaFiles
            ? `Video ${item.id} full video is NOT included in this bundle (an LLM cannot watch video); ${posterPath ? `its poster frame is ${posterPath}` : 'no poster frame was captured'} and the source link is provided (no transcript or visual description).`
            : llmCompanionHtml
              ? `Video ${item.id} bytes are embedded in the companion file ${llmCompanionHtml}; this markdown holds only metadata (no video bytes, transcript, or visual description).`
              : `Video ${item.id} bytes were captured but not saved in this Markdown-only export; only metadata is available here (no playable file, transcript, or visual description).`
        );
      } else {
        warnings.push(
          `Video ${item.id} was detected, but the video file was not preserved offline. ${
            item.posterCaptured ? 'Only the poster' : 'No poster'
          } and ${item.sourceLinkPreserved ? 'source link were' : 'no source link was'} preserved.`
        );
        warnings.push(`Video ${item.id} has no transcript or visual description in llm.md.`);
      }
    });
    return warnings;
  }

  function llmTruncationWarnings(model) {
    return allLlmQuotes(model.blocks)
      .filter(
        (quote) => quote.truncated || (!quote.noteRecovered && isPossiblyTruncatedPost(quote))
      )
      .map((quote) =>
        quote.truncated
          ? `${quoteLabel(quote)} is a long-form post; only its preview text was available at export (full text not included).`
          : `${quoteLabel(quote)} text may be truncated because only preview text may have been available at export time.`
      );
  }

  function renderDuplicateMediaSummary(duplicates) {
    if (!duplicates || !duplicates.length) return '- None';
    return duplicates
      .map((group) => {
        const ids = group.mediaIds || [];
        const joined =
          ids.length > 1
            ? `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`
            : ids[0] || 'Unknown media';
        return `- ${joined} share SHA-256: ${group.sha256}`;
      })
      .join('\n');
  }

  function llmMediaDescription(block, type) {
    const id = block._xaMediaId || `${type}-unknown`;
    const bundlePath = llmMediaFiles ? llmMediaFiles.get(id) : '';
    if (type === 'image') {
      const alt = markdownLineText(block._xaExportAlt || block.alt || 'Image');
      if (!block.dataUri) return `[Missing image: ${id}${alt ? ` - ${alt}` : ''}]`;
      // Bundle: emit a real relative embed so markdown-aware readers render the actual file.
      if (bundlePath) return `![${alt} (${id})](${bundlePath})`;
      return `[Image: ${id}${alt ? ` - ${alt}` : ''}]`;
    }
    const pieces = [];
    const duration = formatDuration(block.duration);
    if (duration) pieces.push(duration);
    if (Number(block.width) > 0 && Number(block.height) > 0) {
      pieces.push(`${Math.round(Number(block.width))}x${Math.round(Number(block.height))}`);
    }
    if (llmMediaFiles) {
      // Bundle: raw video bytes are never included; the poster still is the visual the LLM gets.
      pieces.push('full video not included in this bundle');
      pieces.push(bundlePath ? `poster frame ${bundlePath}` : 'poster unavailable');
      pieces.push(block.sourceUrl ? 'source link preserved' : 'source link unavailable');
      const tag = `[Video: ${id} - ${pieces.join(', ')}]`;
      return bundlePath ? `![Poster of ${id}](${bundlePath})\n${tag}` : tag;
    }
    if (block.dataUri)
      pieces.push(
        llmCompanionHtml
          ? `bytes embedded in companion file ${llmCompanionHtml}, not in this markdown`
          : 'bytes captured but not saved in this Markdown-only export; metadata only'
      );
    else {
      pieces.push(
        `video file not preserved offline; ${block.posterDataUri ? 'poster captured' : 'poster unavailable'}; ${
          block.sourceUrl ? 'source link preserved' : 'source link unavailable'
        }`
      );
    }
    const missing = !block.dataUri && !block.posterDataUri ? 'Missing video' : 'Video';
    return `[${missing}: ${id} - ${pieces.join(', ')}]`;
  }

  function renderLlmBlocks(blocks, options = {}) {
    const includeMedia = options.includeMedia !== false;
    const includeQuoteRefs = options.includeQuoteRefs !== false;
    const linkOriginalPostLabels = options.linkOriginalPostLabels === true;
    const originalPostResolver = options.originalPostResolver;
    const lines = [];
    (blocks || []).forEach((b) => {
      if (b.kind === 'heading') {
        lines.push(markdownHeading(b.level, b.text));
      } else if (b.kind === 'paragraph') {
        const text = textFromHtml(b.html);
        if (!text) return;
        if (articleDividerText(text)) lines.push('---');
        else {
          const heading = articleHeadingBlock(text);
          lines.push(
            heading
              ? markdownHeading(heading.level, heading.text)
              : linkOriginalPostLabels
                ? replaceOriginalPostLabels(text, b.html, originalPostResolver)
                : markdownPlainText(text)
          );
        }
      } else if (b.kind === 'divider') {
        lines.push('---');
      } else if (b.kind === 'thread-marker') {
        lines.push(markdownHeading(3, `Post ${b.index || '?'} of ${b.total || '?'}`));
        if (b.sourceUrl) lines.push(`Source: ${b.sourceUrl}`);
        if (safeIsoTime(b.publishedAt))
          lines.push(`Published at: ${readableUtcTime(b.publishedAt)}`);
      } else if (b.kind === 'code') {
        lines.push(markdownFence(b.text, b.language));
      } else if (b.kind === 'list') {
        const items = (b.items || [])
          .map((item) => {
            const text = textFromHtml(item);
            return linkOriginalPostLabels
              ? replaceOriginalPostLabels(text, item, originalPostResolver)
              : markdownPlainText(text);
          })
          .filter(Boolean);
        // Keep the author's own numbering when items are already numbered (X split a numbered list
        // around an embedded post), so we don't emit "1." on top of their "2.".
        const selfNumbered = items.length > 0 && itemHasLeadingOrdinal(items[0]);
        lines.push(
          items
            .map((item, index) => {
              if (!b.ordered) return `- ${item}`;
              return selfNumbered ? item : `${index + 1}. ${item}`;
            })
            .join('\n')
        );
      } else if (b.kind === 'link-card') {
        const label = b.title || b.domain || b.url;
        lines.push(`[Link card] ${markdownLineText(label)}: ${b.url}`);
      } else if (b.kind === 'poll') {
        const pollLines = [];
        if (b.question) pollLines.push(`**Poll: ${markdownLineText(b.question)}**`);
        else pollLines.push('**Poll**');
        (b.choices || []).forEach((choice) => {
          const result = [choice.percentage, choice.votes && `${choice.votes} votes`]
            .filter(Boolean)
            .join(', ');
          pollLines.push(
            `- ${markdownLineText(choice.label)}${result ? ` - ${result}` : ' - result unavailable'}`
          );
        });
        if (b.totalVotes) pollLines.push(`- Total votes: ${markdownLineText(b.totalVotes)}`);
        if (b.status) pollLines.push(`- Status: ${markdownLineText(b.status)}`);
        if (b.resultsUnavailable)
          pollLines.push('- Results were unavailable at capture time; no values were inferred.');
        if (b.sourceUrl) pollLines.push(`- Source: ${b.sourceUrl}`);
        lines.push(pollLines.join('\n'));
      } else if (b.kind === 'quote-tombstone') {
        lines.push(
          b.replyContext
            ? `Note: This post is a reply, and the post it replied to was ALREADY unavailable on X at capture time (deleted, suspended, or restricted account). ${markdownLineText(
                b.notice || ''
              )} No content exists to include; this is not a capture failure.`.replace(
                /\s{2,}/g,
                ' '
              )
            : `Note: This post embeds a quoted post that was ALREADY unavailable on X at capture time (deleted, suspended, or restricted account). X showed: "${markdownLineText(
                b.notice || 'This Post is unavailable.'
              )}" No quoted content exists to include; this is not a capture failure.`
        );
      } else if (b.kind === 'truncation-notice') {
        lines.push(
          'Warning: This is a long-form post and only its preview text was available at export time. The full text is NOT included; open the post source URL above to read it in full.'
        );
      } else if (b.kind === 'note-recovered') {
        lines.push(
          'Note: This is a long-form post; its full text above was recovered from data X delivered to the browser while the page was open.'
        );
      } else if (b.kind === 'blockquote') {
        const inner = renderLlmBlocks(b.blocks, options);
        if (inner) lines.push(markdownQuote(inner));
      } else if (b.kind === 'image' && includeMedia) {
        lines.push(llmMediaDescription(b, 'image'));
      } else if (b.kind === 'video' && includeMedia) {
        lines.push(llmMediaDescription(b, 'video'));
      } else if (b.kind === 'quote' && includeQuoteRefs) {
        lines.push(`[${quoteLabel(b)} appears here. Full text below.]`);
      }
    });
    return lines.filter(Boolean).join('\n\n');
  }

  function directPostMedia(blocks) {
    const media = [];
    const walk = (items) => {
      (items || []).forEach((b) => {
        if (b.kind === 'image' || b.kind === 'video') media.push(b);
        else if (b.kind === 'blockquote') walk(b.blocks);
      });
    };
    walk(blocks);
    return media;
  }

  function renderLlmPost(block, level = 3) {
    const lines = [markdownHeading(level, quoteLabel(block))];
    if (block.replyContext) {
      lines.push('', 'This is the post the exported post was replying to (conversation context).');
    }
    const postId = statusIdFromSourceUrl(block.sourceUrl);
    const author = block.author || {};
    if (author.name) lines.push(`Author: ${markdownLineText(author.name)}`);
    if (author.handle) lines.push(`Handle: ${markdownLineText(author.handle)}`);
    if (postId) lines.push(`Post ID: ${postId}`);
    if (block.sourceUrl) lines.push(`URL: ${block.sourceUrl}`);
    else {
      const profileHref = authorProfileUrl(author.handle);
      lines.push(
        profileHref
          ? `URL: unavailable (exact permalink not exposed); Author profile: ${profileHref}`
          : 'URL: unavailable (X did not expose a canonical permalink at capture time)'
      );
    }
    if (safeIsoTime(block.publishedAt))
      lines.push(`Timestamp: ${readableUtcTime(block.publishedAt)}`);
    if (block.truncated) {
      // Definitive: X flagged this as a long-form (note) post whose full text the export
      // could not retrieve - only the preview below is present.
      lines.push(
        'Text status: truncated (long-form post)',
        'Warning: This is a long-form post and only its preview text was available at export time. The full text is NOT included; open the URL above to read it in full.'
      );
    } else if (block.noteRecovered) {
      lines.push(
        'Text status: full (long-form text recovered from data X delivered to the browser)'
      );
    } else if (isPossiblyTruncatedPost(block)) {
      lines.push(
        'Text status: possibly truncated',
        'Warning: This embedded post text may be truncated because only preview text was available at export time.'
      );
    }

    lines.push('', 'Text:', '');
    if (!block.blocks || !block.blocks.length) {
      lines.push('> [Quoted post unavailable]');
    } else {
      lines.push(markdownQuote(llmPostText(block) || '[No text captured]'));
    }

    const media = directPostMedia(block.blocks);
    if (media.length) {
      lines.push('', 'Media:');
      media.forEach((item) => {
        lines.push(`- ${llmMediaDescription(item, item.kind).replace(/^\[|\]$/g, '')}`);
      });
    }

    directQuotes(block.blocks).forEach((nested) => {
      lines.push('', renderLlmPost(nested, Math.min(level + 1, 6)));
    });
    return lines.join('\n');
  }

  function renderLlmMediaReference(item, attachments) {
    const title = `${item.type === 'video' ? 'Video' : 'Image'} ${item.id || 'unknown'}`;
    const lines = [`### ${title}`];
    const row = (label, value) => {
      if (value !== undefined && value !== null && value !== '') lines.push(`- ${label}: ${value}`);
    };
    row('Attached to', attachments.get(item.id) || 'unknown');
    if (item.type === 'image') row('Alt', item.alt || item.exportAlt || item.originalAlt);
    row('Width', item.width);
    row('Height', item.height);
    if (item.type === 'video') {
      const offlinePlayable = !!item.offlinePlayable;
      row('Status', offlinePlayable ? 'preserved offline' : 'not preserved offline');
      row('Mode', item.mode || (offlinePlayable ? 'offline-video' : 'discovery-failed'));
      row('Offline playable', offlinePlayable ? 'yes' : 'no');
      row('Duration', Number(item.durationSeconds) > 0 ? formatDuration(item.durationSeconds) : '');
      if (offlinePlayable) row('MIME', item.mime);
      row('Poster captured', item.posterCaptured ? 'yes' : item.posterUrl ? 'no' : '');
      row('Source link preserved', item.sourceLinkPreserved ? 'yes' : 'no');
      if (llmMediaFiles) {
        // Bundle: the raw video is never included; the poster still is the visual the LLM gets.
        row(
          'Full video',
          'not included in this bundle (an LLM cannot watch video); see source link'
        );
        row(
          'Poster frame',
          llmMediaFiles.get(item.id) || (item.posterCaptured ? 'captured (no file)' : 'unavailable')
        );
        if (!offlinePlayable) {
          row('Original video URL', item.originalUrl || 'unavailable');
          row('Failure reason', item.failureReason || 'video_file_not_captured');
        }
      } else if (offlinePlayable) {
        row(
          'Bytes location',
          llmCompanionHtml
            ? `embedded in companion file ${llmCompanionHtml} (not in this markdown)`
            : 'captured but not saved (Markdown-only export); metadata only'
        );
      } else {
        row('Video file MIME', 'unavailable');
        row('Video file byte size', 'unavailable');
        row('Video file SHA-256', 'unavailable');
        row('Original video URL', item.originalUrl || 'unavailable');
        row('Failure reason', item.failureReason || 'video_file_not_captured');
      }
      row('Transcript', 'unavailable');
      row('Keyframe description', 'unavailable');
    } else {
      row('MIME', item.mime);
      if (!item.missing) {
        if (llmMediaFiles) row('File', llmMediaFiles.get(item.id) || 'unavailable');
        else
          row(
            'Pixels location',
            llmCompanionHtml
              ? `embedded in companion file ${llmCompanionHtml} (not in this markdown)`
              : 'captured but not saved (Markdown-only export); metadata only'
          );
      }
    }
    if (item.type !== 'video' || item.offlinePlayable) {
      row('Byte size', item.size);
      row('SHA-256', item.sha256);
    }
    row('Source post ID', item.sourcePostId);
    row('Source URL', item.sourceUrl);
    if (item.type !== 'video' || item.offlinePlayable) row('Original URL', item.originalUrl);
    if (item.missing) row('Missing', 'yes');
    return lines.join('\n');
  }

  // Set per render by renderLlmMarkdown. '' means a Markdown-only export: the media bytes were
  // captured in memory but never written to any file the reader keeps, so the markdown must say so
  // honestly instead of pointing at a companion that does not exist.
  let llmCompanionHtml = '';
  let llmCompanionArchive = '';
  // Set per render for the "Save to library" bundle: Map<mediaId, "media/...">. When present, the
  // markdown references the real sidecar files. Precedence: mediaFiles > companionHtmlFilename > md.
  let llmMediaFiles = null;

  function renderLlmMarkdown(model, debugJson = '', options = {}) {
    llmCompanionHtml = options.companionHtmlFilename || '';
    llmCompanionArchive = options.companionArchiveFilename || '';
    llmMediaFiles = options.mediaFiles instanceof Map ? options.mediaFiles : null;
    prepareArchiveModel(model);
    assignLlmQuoteNumbers(model);
    const documentLang = inferDocumentLang(model);
    const media = collectMediaManifest(model);
    const stats = archiveStats(model, media);
    const manifest = buildArchiveManifest(model, debugJson, stats, documentLang);
    const links = collectLlmSourceLinks(model);
    const share = options.share || null;
    const attachments = collectLlmMediaAttachments(model);
    const title = markdownLineText(model.heading || model.title || 'X Export');
    const imageMedia = media.filter((item) => item.type === 'image');
    const videoMedia = media.filter((item) => item.type === 'video');
    const quoteCounts = llmQuoteCounts(model);
    const llmWarnings = [
      ...stats.warnings,
      ...llmVideoWarnings(videoMedia),
      ...llmTruncationWarnings(model),
    ];
    const lines = [
      markdownHeading(1, title),
      '',
      `Source: ${model.sourceUrl || ''}`,
      `Exported at: ${readableUtcTime(model.exportedAt)}`,
      `Exporter: ${APP} v${VERSION}`,
      `Language: ${documentLang}`,
    ];
    if (safeIsoTime(model.publishedAt))
      lines.push(`Published at: ${readableUtcTime(model.publishedAt)}`);
    if (model.author && (model.author.name || model.author.handle)) {
      lines.push(
        `Author: ${[model.author.name, model.author.handle].filter(Boolean).map(markdownLineText).join(' ')}`
      );
    } else {
      // Author metadata was not captured from the DOM; fall back to the @handle in the source URL
      // so the reader at least knows who posted it. Flagged as derived to stay honest.
      const derived = handleFromSourceUrl(model.sourceUrl);
      if (derived)
        lines.push(
          `Author: ${derived} (handle derived from the source URL; display name not captured)`
        );
    }
    if (model.userNote) lines.push(`Saved because: ${markdownLineText(model.userNote)}`);
    if (Array.isArray(model.tags) && model.tags.length)
      lines.push(`Tags: ${model.tags.map(markdownLineText).join(', ')}`);
    if (share && share.viewUrl) {
      lines.push(`AI readable link: ${share.viewUrl}`);
      if (share.markdownUrl) lines.push(`AI readable Markdown link: ${share.markdownUrl}`);
      if (share.expiresAt)
        lines.push(`AI readable link expires: ${readableUtcTime(share.expiresAt)}`);
    }
    const companionNote = options.sharedLink
      ? 'The images and video poster frames are hosted at the absolute media URLs referenced below. Full videos are NOT uploaded; each video provides its poster frame and original source link instead.'
      : llmMediaFiles
        ? 'The images and video poster frames are included as separate files in the media/ folder next to this markdown. Attach them to your LLM together with this file. Full videos are NOT included (an LLM cannot watch them); each video provides its poster frame and source link instead.'
        : llmCompanionHtml
          ? llmCompanionArchive
            ? `The media bytes are embedded (base64) inside the companion file ${llmCompanionHtml}, packaged together with this markdown inside ${llmCompanionArchive}. Extract both files before moving or sharing them so the pair stays together.`
            : `The media bytes are embedded (base64) inside the companion file ${llmCompanionHtml}, downloaded alongside this markdown. If you also have that file, the media is available there; if you only have this markdown, it is not.`
          : 'This was a Markdown-only export, so the media bytes were not saved to any file. Only the metadata and the original source URLs below remain; use those URLs to retrieve the media from the source.';
    lines.push(
      'Capture note: This file preserves content visible to the logged-in user at export time. It may not include unavailable, private, deleted, failed, or unloaded content.',
      '',
      '## What This File Is',
      '',
      'This is the text + metadata companion (a .llm.md file). Reading only this file, an agent or LLM has access to:',
      '- The full article/post text and embedded-post text (in the sections below).',
      '- A metadata-only inventory of every image and video: type, dimensions, duration, original source URL, byte size, and SHA-256.',
      '',
      'This file does NOT contain the media itself: no image pixels, no video or audio bytes, no transcripts, and no visual descriptions. From this file alone you cannot view the images or play/transcribe the videos.',
      companionNote,
      '',
      '## Capture Summary',
      '',
      `- Main text: ${stats.mainTextCaptured ? 'captured' : 'not detected'}`,
      `- Embedded posts: ${quoteCounts.total} total`,
      `  - Direct embedded posts: ${quoteCounts.direct}`,
      `  - Nested quoted posts: ${quoteCounts.nested}`,
      `- Polls: ${stats.polls}`,
      `- Images: ${imageMedia.filter((item) => item.embedded).length} captured, ${
        imageMedia.filter((item) => item.missing).length
      } missing`,
      `- Videos found: ${videoMedia.length}`,
      `- Videos preserved offline: ${videoMedia.filter((item) => item.offlinePlayable).length}`,
      `- Video posters captured: ${videoMedia.filter((item) => item.posterCaptured).length}`,
      `- Video source links preserved: ${
        videoMedia.filter((item) => item.sourceLinkPreserved).length
      }`,
      `- Incomplete media: ${stats.incompleteMedia}`,
      `- Source links: ${links.length}`,
      `- Duplicate media groups: ${stats.duplicateMedia.length}`,
      '- Warnings:'
    );
    if (llmWarnings.length) {
      llmWarnings.forEach((warning) => lines.push(`  - ${markdownLineText(warning)}`));
    } else {
      lines.push('  - None');
    }

    const mainContentHeading = model.thread
      ? '## Full Thread'
      : model.type === 'article'
        ? '## Main Article'
        : '## Main Post';
    lines.push('', '---', '', mainContentHeading, '');
    lines.push(
      renderLlmBlocks(model.blocks, {
        includeMedia: true,
        includeQuoteRefs: true,
        linkOriginalPostLabels: true,
        originalPostResolver: createOriginalPostResolver(model),
      })
    );

    lines.push('', '---', '', '## Embedded / Quoted Posts', '');
    const quotes = topLevelLlmQuotes(model);
    if (quotes.length) quotes.forEach((quote) => lines.push(renderLlmPost(quote), ''));
    else lines.push('- None');

    lines.push('', '---', '', '## Duplicate Media', '');
    lines.push(renderDuplicateMediaSummary(stats.duplicateMedia));

    lines.push('', '---', '', '## Media References', '');
    if (media.length)
      media.forEach((item) => lines.push(renderLlmMediaReference(item, attachments), ''));
    else lines.push('- None');

    lines.push('', '---', '', '## Missing / Incomplete Content', '');
    if (manifest.missing.length || (manifest.incomplete || []).length) {
      manifest.missing.forEach((item) => {
        const label = item.mediaId || item.sourcePostId || item.sourceUrl || item.type;
        lines.push(`- ${item.type}: ${label}`);
        if (item.reason) lines.push(`  Reason: ${item.reason}`);
        if (item.sourcePostId) lines.push(`  Source post ID: ${item.sourcePostId}`);
        if (item.sourceUrl) lines.push(`  Source URL: ${item.sourceUrl}`);
      });
      (manifest.incomplete || []).forEach((item) => {
        const label = item.mediaId || item.sourcePostId || item.sourceUrl || item.type;
        if (item.type === 'video') {
          lines.push(
            `- ${label}: video file not preserved offline; ${
              item.posterCaptured ? 'poster captured' : 'poster unavailable'
            }; ${item.sourceLinkPreserved ? 'source link preserved' : 'source link unavailable'}.`
          );
        } else {
          lines.push(`- ${item.type}: ${label}`);
        }
        if (item.reason) lines.push(`  Reason: ${item.reason}`);
        if (item.sourcePostId) lines.push(`  Source post ID: ${item.sourcePostId}`);
        if (item.sourceUrl) lines.push(`  Source URL: ${item.sourceUrl}`);
      });
    } else {
      lines.push('- None');
    }

    lines.push('', '---', '', '## Source Links', '');
    if (links.length) links.forEach((link, index) => lines.push(`${index + 1}. ${link}`));
    else lines.push('- None');

    return `${lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()}\n`;
  }

  function assembleHtml(model, debugJson = '', options = {}) {
    prepareArchiveModel(model);
    const share = options.share || null;
    const ctx = createRenderContext(model);
    const body = renderBlocks(model.blocks, ctx);
    const documentLang = inferDocumentLang(model);
    const exportedIso = safeIsoTime(model.exportedAt);
    const exportedReadable = readableUtcTime(model.exportedAt);
    const stats = archiveStats(model);
    const manifest = buildArchiveManifest(model, debugJson, stats, documentLang);
    const debugScript = `<script id="sourcecapsule-debug" type="application/json">${escapeJsonScript(
      JSON.stringify(manifest, null, 2)
    )}</script>`;
    const installFooter =
      options.distribution === 'shared'
        ? `    <aside class="xa-install-cta"><strong>Captured with SourceCapsule</strong><span>Preserve complete X threads for AI and offline reading.</span><a href="${escapeAttr(CONFIG.installUrl)}" target="_blank" rel="noopener noreferrer">Install SourceCapsule</a></aside>`
        : '';
    const savedContextHtml =
      model.userNote || (Array.isArray(model.tags) && model.tags.length)
        ? `<div class="xa-saved-context">${
            model.userNote
              ? `<div><strong>Saved because</strong><p>${escapeHtml(model.userNote)}</p></div>`
              : ''
          }${
            Array.isArray(model.tags) && model.tags.length
              ? `<div><strong>Tags</strong><p>${model.tags.map(escapeHtml).join(', ')}</p></div>`
              : ''
          }</div>`
        : '';
    const shareContextHtml =
      share && share.viewUrl
        ? `<aside class="xa-ai-link" aria-label="AI readable link"><strong>AI readable link</strong><p><a href="${escapeAttr(
            safeUrl(share.viewUrl)
          )}" target="_blank" rel="noopener noreferrer">${escapeHtml(share.viewUrl)}</a>${
            share.markdownUrl
              ? `<br><a href="${escapeAttr(safeUrl(share.markdownUrl))}" target="_blank" rel="noopener noreferrer">Markdown endpoint</a>`
              : ''
          }${
            share.expiresAt ? `<br>Expires ${escapeHtml(readableUtcTime(share.expiresAt))}` : ''
          }</p></aside>`
        : '';

    const html = `<!doctype html>
<html lang="${documentLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${APP} v${VERSION}">
<title>${escapeHtml(model.title)}</title>
<style>
${READER_CSS}
</style>
</head>
<body>
<main class="xa-doc">
  <header class="xa-header">
    <div class="xa-kicker">${
      model.type === 'article' ? 'X Article' : model.thread ? 'X Thread' : 'X Post'
    }</div>
    ${model.heading ? `<h1 class="xa-title">${escapeHtml(model.heading)}</h1>` : ''}
    ${renderAuthorLine(model.author)}
    <div class="xa-meta">
      ${(() => {
        const srcHref = safeUrl(model.sourceUrl);
        if (srcHref) {
          return `<a href="${escapeHtml(srcHref)}" target="_blank" rel="noopener">View original on X &#8599;</a>`;
        }
        const authorHref = authorProfileUrl(model.author && model.author.handle);
        return authorHref
          ? `<a href="${escapeHtml(authorHref)}" target="_blank" rel="noopener">View ${escapeHtml(model.author.handle)} on X &#8599;</a>`
          : '';
      })()}
      ${
        safeIsoTime(model.publishedAt)
          ? `<span>&middot; Published <time datetime="${escapeAttr(safeIsoTime(model.publishedAt))}">${escapeHtml(
              readableUtcTime(model.publishedAt)
            )}</time></span>`
          : ''
      }
      <span>&middot; Exported <time datetime="${escapeAttr(exportedIso)}">${escapeHtml(
        exportedReadable
      )}</time></span>
    </div>
${savedContextHtml ? `\n${savedContextHtml}` : ''}${shareContextHtml ? `\n${shareContextHtml}` : ''}
  </header>
  ${renderCaptureSummary(stats)}
  <article class="xa-body">
${body}
  </article>
  <footer class="xa-footer">
    <h2>Archive provenance</h2>
    <dl>
      <div><dt>Archived from</dt><dd>X</dd></div>
      <div><dt>Original URL</dt><dd>${
        safeUrl(model.sourceUrl)
          ? `<a href="${escapeHtml(safeUrl(model.sourceUrl))}" target="_blank" rel="noopener">${escapeHtml(model.sourceUrl)}</a>`
          : escapeHtml(model.sourceUrl || 'unavailable')
      }</dd></div>
      ${
        safeIsoTime(model.publishedAt)
          ? `<div><dt>Published at</dt><dd><time datetime="${escapeAttr(safeIsoTime(model.publishedAt))}">${escapeHtml(
              readableUtcTime(model.publishedAt)
            )}</time></dd></div>`
          : ''
      }
      <div><dt>Exported at</dt><dd><time datetime="${escapeAttr(exportedIso)}">${escapeHtml(
        exportedReadable
      )}</time></dd></div>
      <div><dt>Exporter</dt><dd>${APP} v${VERSION}</dd></div>
    </dl>
    <p class="xa-disclaimer">This archive preserves content visible to the logged-in user at export time. It may not include content that was unavailable, private, deleted, or failed to load during capture.</p>
${installFooter}
  </footer>
</main>
<div class="xa-lightbox" id="xa-lightbox" role="dialog" aria-modal="true" aria-label="Image preview" tabindex="-1"><button class="xa-lightbox-close" type="button" aria-label="Close image preview">&times;</button><img alt="" aria-hidden="true"></div>
<script>
(function () {
  var lb = document.getElementById('xa-lightbox');
  if (!lb) return;
  var big = lb.querySelector('img');
  var close = lb.querySelector('.xa-lightbox-close');
  var lastFocus = null;
  function hide() {
    lb.classList.remove('show');
    big.removeAttribute('src');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    big.alt = '';
    big.setAttribute('aria-hidden', 'true');
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('xa-zoomable')) {
      lastFocus = t;
      big.src = t.src;
      big.alt = t.alt || '';
      big.setAttribute('aria-hidden', 'false');
      lb.classList.add('show');
      lb.focus();
    } else if (t === lb || t === close) {
      hide();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && lb.classList.contains('show')) hide();
  });
})();
</script>
${debugScript}
</body>
</html>`;
    return normalizeExternalLinks(html);
  }

  // Embedded reader stylesheet (neutral, light/dark via prefers-color-scheme).
  const READER_CSS = `
:root{--bg:#fff;--fg:#0f1419;--muted:#536471;--line:#eff3f4;--card:#f7f9f9;--accent:#1d9bf0;--quoteline:#cfd9de}
@media (prefers-color-scheme: dark){:root{--bg:#15202b;--fg:#f7f9f9;--muted:#8b98a5;--line:#22303c;--card:#1c2732;--accent:#1d9bf0;--quoteline:#38444d}}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--fg)}
body{font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.xa-doc{max-width:680px;margin:0 auto;padding:32px 20px 80px}
.xa-header{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:28px}
.xa-kicker{text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:700;color:var(--accent);margin-bottom:8px}
.xa-title{font-size:30px;line-height:1.25;margin:0 0 16px;font-weight:800}
.xa-author{display:flex;align-items:center;gap:10px;font-size:15px;margin-bottom:6px}
.xa-avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:none}
.xa-name{font-weight:700}
.xa-handle{color:var(--muted);margin-left:6px}
.xa-meta{font-size:14px;color:var(--muted);display:flex;gap:8px;flex-wrap:wrap}
.xa-meta a{color:var(--accent);text-decoration:none}
.xa-capture{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:10px 14px;margin:0 0 28px;font-size:14px;color:var(--muted)}
.xa-capture summary{cursor:pointer;font-weight:700;color:var(--fg)}
.xa-capture dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px;margin:12px 0 2px}
.xa-capture dl div,.xa-footer dl div{min-width:0}
.xa-capture dt,.xa-footer dt{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.xa-capture dd,.xa-footer dd{margin:0;color:var(--fg);word-break:break-word}
.xa-body{font-size:18px}
.xa-body h1,.xa-body h2,.xa-body h3,.xa-body h4{line-height:1.3;margin:1.6em 0 .5em;font-weight:800}
.xa-body h2{font-size:24px}.xa-body h3{font-size:20px}.xa-body h4{font-size:18px}
.xa-body p{margin:0 0 1.1em;white-space:pre-wrap}
.xa-body a{color:var(--accent);text-decoration:none}
.xa-body a:hover{text-decoration:underline}
.xa-body ul,.xa-body ol{margin:0 0 1.1em 1.2em;padding:0}
.xa-body li{margin:.3em 0}
.xa-divider{border:0;border-top:1px solid var(--quoteline);margin:2em 0}
.xa-code{margin:1.1em 0;padding:.85em 1em;border-left:3px solid var(--quoteline);background:var(--card);overflow:auto}
.xa-code code{font:14px/1.55 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace}
.xa-blockquote{margin:1.1em 0;padding:.05em 0 .05em 1.2em;border-left:3px solid var(--quoteline);color:var(--fg)}
.xa-blockquote p:last-child,.xa-blockquote ul:last-child,.xa-blockquote ol:last-child{margin-bottom:0}
.xa-poll{margin:1.2em 0;padding:14px 16px;border:1px solid var(--quoteline);border-radius:14px;background:var(--card)}
.xa-poll h3{margin:0 0 10px;font-size:17px}.xa-poll ol{list-style:none;margin:0;padding:0}
.xa-poll li{display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-top:1px solid var(--line)}
.xa-poll li:first-child{border-top:0}.xa-poll li strong,.xa-poll li em{white-space:nowrap;font-size:14px;color:var(--muted)}
.xa-poll p{margin:8px 0 0;font-size:13px;color:var(--muted)}
figure{margin:1.4em 0}
figure video{display:block;width:100%;height:auto;border-radius:14px;border:1px solid var(--line)}
.xa-media{margin:1.1em 0}
.xa-image-link{display:block;line-height:0;text-decoration:none;cursor:zoom-in}
.xa-zoomable{cursor:zoom-in}
.xa-lightbox{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.9);cursor:zoom-out}
.xa-lightbox.show{display:flex}
.xa-lightbox:focus{outline:0}
.xa-lightbox img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;background:var(--card)}
.xa-lightbox-close{position:fixed;top:14px;right:14px;width:42px;height:42px;border:0;border-radius:999px;background:rgba(255,255,255,.16);color:#fff;font-size:30px;line-height:1;cursor:pointer}
.xa-lightbox-close:focus{outline:2px solid #fff;outline-offset:2px}
.xa-media-single img{display:block;width:100%;height:auto;border-radius:14px;border:1px solid var(--line);background:var(--card)}
.xa-gallery{display:grid;gap:2px;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--line)}
.xa-gallery .xa-image-link,.xa-gallery-missing{min-width:0;min-height:0;aspect-ratio:1/1;background:var(--card)}
.xa-gallery img{display:block;width:100%;height:100%;object-fit:cover;border:0;border-radius:0;background:var(--card)}
.xa-gallery-missing{display:flex;align-items:center;justify-content:center;color:var(--muted)}
.xa-gallery-count-2 .xa-gallery,.xa-gallery-count-4 .xa-gallery,.xa-gallery-many .xa-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}
.xa-gallery-count-3 .xa-gallery{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr))}
.xa-gallery-count-3 .xa-gallery>.xa-image-link:first-child,.xa-gallery-count-3 .xa-gallery>.xa-gallery-missing:first-child{grid-row:1 / span 2;aspect-ratio:auto}
.xa-missing{display:flex;flex-direction:column;gap:6px;background:var(--card);border:1px dashed var(--quoteline);border-radius:14px;padding:24px;text-align:center;color:var(--muted)}
.xa-missing strong{color:var(--fg)}
.xa-missing a{color:var(--accent);text-decoration:none}
.xa-video-fallback{position:relative}
.xa-video-fallback img{filter:brightness(.7)}
.xa-watch{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;text-decoration:none;font-size:18px}
.xa-video figcaption,.xa-video-fallback figcaption{font-size:13px;color:var(--muted);margin-top:6px}
.xa-quote{border:1px solid var(--quoteline);border-radius:16px;padding:14px 16px;background:var(--card);margin:1.4em 0}
.xa-nested-tweet-card{margin-left:12px}
.xa-quote .xa-author{font-size:14px}
.xa-quote .xa-avatar{width:24px;height:24px}
.xa-quote-body{font-size:16px}
.xa-quote-body .xa-media{margin:.85em 0}
.xa-quote-body .xa-media-single img,.xa-quote-body .xa-gallery{border-radius:12px}
.xa-quote-body figure video{border-radius:12px}
.xa-quote-link{display:inline-block;margin-top:6px;font-size:14px;color:var(--accent);text-decoration:none}
.xa-truncated{margin:8px 0 0;padding:8px 10px;border-radius:8px;font-size:13px;line-height:1.4;
  background:rgba(255,180,0,.12);border:1px solid rgba(255,180,0,.35);color:var(--fg)}
.xa-truncated a{color:var(--accent);text-decoration:none}
.xa-note-recovered{margin:8px 0 0;padding:8px 10px;border-radius:8px;font-size:13px;line-height:1.4;
  background:rgba(0,186,124,.10);border:1px solid rgba(0,186,124,.35);color:var(--fg)}
.xa-quote-time{display:block;margin-top:8px;font-size:13px;color:var(--muted)}
.xa-card-link{display:flex;flex-direction:column;gap:2px;margin:10px 0;padding:10px 14px;
  border:1px solid var(--quoteline);border-radius:12px;background:var(--card);text-decoration:none;color:var(--fg)}
.xa-card-link:hover{border-color:var(--accent)}
.xa-card-title{font-weight:600;font-size:14px;word-break:break-word}
.xa-card-domain{font-size:13px;color:var(--accent)}
.xa-card-img{width:100%;max-height:280px;object-fit:cover;border-radius:8px;margin-bottom:6px}
.xa-reply-label{margin:10px 0 -4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.xa-thread-marker{display:flex;align-items:center;gap:12px;margin:28px 0 12px;padding-top:18px;
  border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
.xa-thread-marker:first-child{margin-top:8px;border-top:0;padding-top:0}
.xa-thread-marker a{color:var(--accent);text-decoration:none}.xa-thread-marker time{margin-left:auto}
.xa-saved-context{display:grid;gap:8px;margin-top:16px;padding:12px 14px;border:1px solid var(--line);
  border-radius:12px;background:var(--card);font-size:14px}.xa-saved-context p{margin:3px 0 0;color:var(--muted)}
.xa-ai-link{margin-top:16px;padding:14px 16px;border:1px solid var(--accent);border-left-width:4px;
  border-radius:12px;background:color-mix(in srgb,var(--accent) 10%,var(--bg));font-size:14px}
.xa-ai-link strong{display:block;font-size:15px}.xa-ai-link p{margin:5px 0 0;color:var(--muted)}
.xa-ai-link a{color:var(--accent);font-weight:700;word-break:break-all}
.xa-footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
.xa-footer h2{font-size:15px;line-height:1.3;margin:0 0 10px;color:var(--fg)}
.xa-footer dl{display:grid;gap:8px;margin:0 0 14px}
.xa-footer a{color:var(--accent);text-decoration:none;word-break:break-all}
.xa-disclaimer{font-size:12px;opacity:.85}
.xa-install-cta{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin-top:18px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.xa-install-cta strong{color:var(--fg)}.xa-install-cta a{margin-top:4px;font-weight:700}
@media (max-width:520px){.xa-doc{padding:24px 14px 64px}.xa-capture dl{grid-template-columns:1fr}.xa-body{font-size:17px}.xa-title{font-size:26px}}
@media print{
  :root{--bg:#fff;--fg:#000;--muted:#444;--line:#bbb;--card:#fff;--accent:#000;--quoteline:#999}
  body{background:#fff;color:#000}
  .xa-doc{max-width:none;padding:0}
  .xa-lightbox{display:none!important}
  .xa-capture{break-inside:avoid}
  .xa-quote,.xa-media,figure{break-inside:avoid}
  a[href]::after{content:" (" attr(href) ")";font-size:.9em;color:#444}
  img{max-width:100%!important}
}
`;

  // ===========================================================================
  // STABLE LAYER - download
  // ===========================================================================

  function downloadHtml(filename, html) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    downloadBlob(filename, blob);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        warn('navigator clipboard unavailable; trying selection fallback:', error.message);
      }
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('Clipboard access was denied.');
  }

  function renderArchiveManifestJson(model, debugJson = '') {
    prepareArchiveModel(model);
    const documentLang = inferDocumentLang(model);
    const stats = archiveStats(model);
    return `${JSON.stringify(buildArchiveManifest(model, debugJson, stats, documentLang), null, 2)}\n`;
  }

  function gmHttp({ method = 'GET', url, headers = {}, body = null, timeoutMs = 30000 }) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('Privileged request API unavailable.'));
        return;
      }
      const data =
        body instanceof Uint8Array
          ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
          : body;
      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data,
        responseType: 'text',
        timeout: timeoutMs,
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText || '');
          } else {
            reject(new Error(`Share service returned HTTP ${response.status}.`));
          }
        },
        onerror: (event) =>
          reject(new Error((event && event.error) || 'Share service network error.')),
        ontimeout: () => reject(new Error(`Share service timed out after ${timeoutMs}ms.`)),
      });
    });
  }

  function encodeSharePath(path) {
    return String(path)
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
  }

  function applySharedMediaUrls(model, urlById) {
    const walk = (blocks) => {
      (blocks || []).forEach((block) => {
        const url = block._xaMediaId && urlById.get(block._xaMediaId);
        if (block.kind === 'image') {
          block.dataUri = url || '';
        } else if (block.kind === 'video') {
          block.dataUri = '';
          block.videoFileCaptured = false;
          block.mode = url ? 'poster-only' : block.mode;
          block.posterDataUri = url || '';
        } else if (block.kind === 'quote' || block.kind === 'blockquote') {
          walk(block.blocks);
        }
      });
    };
    walk(model.blocks);
    return model;
  }

  async function createShareLink(model, debugJson, expiryDays, onProgress) {
    const apiBase = getPrefs().shareApiBase.replace(/\/$/, '');
    // Share can be invoked from the receipt after a long/lazy Article capture. Do one
    // last owner-aware recovery pass here instead of assuming the earlier inline pass
    // saw every image. This is especially important for "Create AI readable link":
    // the user may never have created a local bundle, but the in-memory bytes still
    // need to be present before we can upload them to R2.
    let bundle = collectBundleMediaFiles(model);
    const expectedImages = countBlocks(
      model.blocks,
      (block) => block.kind === 'image' && block.url
    );
    const missingImages =
      expectedImages - bundle.files.filter((file) => file.mime.startsWith('image/')).length;
    if (missingImages > 0) {
      onProgress && onProgress(`Recovering ${missingImages} image(s) before upload...`, 0, 0);
      await rescueMissingMedia(model, (done, total) => {
        onProgress && onProgress('Recovering media downloads...', done, total);
      });
      bundle = collectBundleMediaFiles(model);
    }
    const { files, pathById } = bundle;
    const mediaBytes = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    if (mediaBytes > CONFIG.share.maxBytes) {
      throw new Error(
        `Share media is ${humanBytes(mediaBytes)}; the current limit is ${humanBytes(CONFIG.share.maxBytes)}. Use the local archive for this capture.`
      );
    }
    onProgress && onProgress('Creating private upload session...', 0, files.length + 3);
    const created = JSON.parse(
      await gmHttp({
        method: 'POST',
        url: `${apiBase}/api/capsules`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiryDays }),
      })
    );
    if (!created.uploadUrl || !created.uploadToken || !created.viewUrl) {
      throw new Error('Share service returned an invalid upload session.');
    }
    const publicMedia = new Map();
    pathById.forEach((path, mediaId) => {
      publicMedia.set(mediaId, `${created.viewUrl}/${path}`);
    });
    applySharedMediaUrls(model, publicMedia);
    const markdown = renderLlmMarkdown(model, debugJson, {
      mediaFiles: publicMedia,
      sharedLink: true,
    });
    const html = assembleHtml(model, debugJson, { distribution: 'shared' });
    const manifest = renderArchiveManifestJson(model, debugJson);
    const uploads = [
      { name: 'content.html', data: html, type: 'text/html;charset=utf-8' },
      { name: 'content.md', data: markdown, type: 'text/markdown;charset=utf-8' },
      { name: 'manifest.json', data: manifest, type: 'application/json;charset=utf-8' },
      ...files.map((file) => ({
        name: file.name,
        data: file.bytes,
        type: file.mime || 'application/octet-stream',
      })),
    ];
    const totalBytes = uploads.reduce(
      (sum, upload) =>
        sum +
        (upload.data instanceof Uint8Array
          ? upload.data.byteLength
          : new TextEncoder().encode(upload.data).byteLength),
      0
    );
    if (totalBytes > CONFIG.share.maxBytes) {
      throw new Error(
        `Share package is ${humanBytes(totalBytes)}; the current limit is ${humanBytes(CONFIG.share.maxBytes)}.`
      );
    }
    let done = 0;
    for (const upload of uploads) {
      onProgress && onProgress(`Uploading ${upload.name}...`, done, uploads.length);
      await gmHttp({
        method: 'PUT',
        url: `${created.uploadUrl}/${encodeSharePath(upload.name)}`,
        headers: {
          Authorization: `Bearer ${created.uploadToken}`,
          'Content-Type': upload.type,
        },
        body: upload.data,
        timeoutMs: 60000,
      });
      done += 1;
    }
    onProgress && onProgress('Publishing link...', done, uploads.length);
    await gmHttp({
      method: 'POST',
      url: `${created.finalizeUrl}`,
      headers: { Authorization: `Bearer ${created.uploadToken}` },
    });
    created.mediaFilesUploaded = files.length;
    created.mediaBytesUploaded = mediaBytes;
    return created;
  }

  // ===========================================================================
  // Library settings + persistent root folder (browser-only)
  // ---------------------------------------------------------------------------
  // "Save to library" writes each export into a folder the user picks once. The
  // folder handle is persisted in IndexedDB (handles are structured-clonable;
  // localStorage cannot hold them). Two small prefs (layout, contents) live in
  // localStorage and are toggled from the userscript-manager menu - no in-app UI.
  // ===========================================================================
  const PREFS_KEY = 'sourcecapsule.prefs';
  const SHARES_KEY = 'sourcecapsule.shares';
  const IDB_NAME = 'sourcecapsule';
  const IDB_STORE = 'handles';
  const ROOT_HANDLE_KEY = 'rootDir';
  const FOLDER_PICKER_SOURCE = `${APP}:folder-picker`;
  const FOLDER_PICKER_REQUEST_EVENT = 'sourcecapsule:pick-directory';
  let lastFolderPickerError = '';
  let extensionFolderPickerSupport = null;

  function getPrefs() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      return {
        layout: parsed.layout === 'flat' ? 'flat' : 'date',
        contents: parsed.contents === 'lean' ? 'lean' : 'full',
        // The page-level draggable floating button is OFF by default; the inline per-post /
        // article-header Export buttons are the primary entry point.
        floatingButton: parsed.floatingButton === true,
        shareApiBase: String(parsed.shareApiBase || CONFIG.share.defaultApiBase).replace(/\/$/, ''),
        // Strict export is ON by default: if the finished model still has any dead-end
        // quote cards or failed media after all recovery layers, block the download and
        // prompt for explicit confirmation instead of silently shipping a broken export.
        // Explicit `false` disables; anything else (including missing / true) enables.
        strictExport: parsed.strictExport !== false,
        // Reply context is ON by default: a reply archived without the post it
        // answers often loses its meaning. Explicit `false` disables.
        replyContext: parsed.replyContext !== false,
      };
    } catch {
      return {
        layout: 'date',
        contents: 'full',
        floatingButton: false,
        shareApiBase: CONFIG.share.defaultApiBase,
        strictExport: true,
        replyContext: true,
      };
    }
  }

  function setPrefs(patch) {
    const next = { ...getPrefs(), ...patch };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch (e) {
      errlog(e);
    }
    return next;
  }

  function extensionControllerMessage(message) {
    if (
      !message ||
      typeof message !== 'object' ||
      message.type !== 'sourcecapsule:controller' ||
      message.version !== 1
    ) {
      return { ok: false, error: 'Invalid SourceCapsule extension message.' };
    }
    if (message.action === 'get-state') {
      return {
        ok: true,
        version: VERSION,
        prefs: getPrefs(),
        pageUrl: location.href,
        pageType: detectPageType() || 'x',
        recoveryReady: networkCaptureDiagnostics.installed,
        folderPickerSupported: folderPickerAvailable(),
        libraryDelivery: folderPickerAvailable() ? 'folder' : 'zip',
      };
    }
    if (message.action === 'set-preference') {
      const value = message.value || {};
      const valid =
        (value.key === 'layout' && ['date', 'flat'].includes(value.value)) ||
        (value.key === 'contents' && ['full', 'lean'].includes(value.value)) ||
        (value.key === 'floatingButton' && typeof value.value === 'boolean') ||
        (value.key === 'strictExport' && typeof value.value === 'boolean') ||
        (value.key === 'replyContext' && typeof value.value === 'boolean');
      if (!valid) return { ok: false, error: 'That preference value is not supported.' };
      const prefs = setPrefs({ [value.key]: value.value });
      registerSettingsMenu();
      ensureButton();
      return { ok: true, prefs };
    }
    if (message.action === 'pick-folder') {
      showFolderPickerPrompt();
      return { ok: true, requiresPageAction: true };
    }
    return { ok: false, error: 'Unknown SourceCapsule extension action.' };
  }

  let extensionControllerRegistered = false;
  function registerExtensionController() {
    if (
      extensionControllerRegistered ||
      globalThis.__SOURCECAPSULE_EXTENSION__ !== true ||
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      !chrome.runtime.onMessage
    )
      return;
    extensionControllerRegistered = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      sendResponse(extensionControllerMessage(message));
      return false;
    });
  }

  function getShareLinks() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SHARES_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function setShareLinks(records) {
    try {
      localStorage.setItem(SHARES_KEY, JSON.stringify((records || []).slice(0, 50)));
    } catch (e) {
      errlog(e);
    }
  }

  function shareLinkExpired(record, now = Date.now()) {
    const expires = Date.parse(record && record.expiresAt);
    return Number.isFinite(expires) && expires <= now;
  }

  function rememberShareLink(created, model) {
    const record = {
      id: created.id,
      viewUrl: created.viewUrl,
      markdownUrl: created.markdownUrl,
      deleteUrl: created.deleteUrl,
      deleteToken: created.deleteToken || created.uploadToken,
      createdAt: created.createdAt || new Date().toISOString(),
      expiresAt: created.expiresAt,
      title: model.heading || model.title || 'X capture',
      sourceUrl: model.sourceUrl || '',
    };
    setShareLinks([record, ...getShareLinks().filter((item) => item.id !== record.id)]);
    return record;
  }

  function forgetShareLink(id) {
    setShareLinks(getShareLinks().filter((item) => item.id !== id));
  }

  async function deleteSharedCapsule(record) {
    if (!record || !record.deleteUrl || !record.deleteToken) {
      forgetShareLink(record && record.id);
      return { remoteDeleted: false };
    }
    await gmHttp({
      method: 'DELETE',
      url: record.deleteUrl,
      headers: { Authorization: `Bearer ${record.deleteToken}` },
    });
    forgetShareLink(record.id);
    return { remoteDeleted: true };
  }

  function aiLinkReceiptText(created, model) {
    const stats = archiveStats(model);
    const lines = [
      `${APP} AI readable link`,
      '',
      `Title: ${model.heading || model.title || 'X capture'}`,
      `Source: ${model.sourceUrl || 'unavailable'}`,
      `AI readable link: ${created.viewUrl || ''}`,
      `Markdown link: ${created.markdownUrl || ''}`,
      `Created at: ${readableUtcTime(created.createdAt || new Date().toISOString())}`,
      `Expires at: ${readableUtcTime(created.expiresAt)}`,
      '',
      'Privacy:',
      '- Anyone with the AI readable link can view this capsule until it expires or is deleted.',
      '- Full video files are not uploaded; images and video poster frames may be included.',
      '',
      'Capture status:',
      `- Missing media: ${stats.missingMedia}`,
      `- Incomplete media: ${stats.incompleteMedia}`,
    ];
    if (stats.missingMedia || stats.incompleteMedia) {
      lines.push('- Re-export from X if you need a complete media capture.');
    }
    return `${lines.join('\n')}\n`;
  }

  function shareMetadataFromCreated(created) {
    if (!created) return null;
    return {
      viewUrl: created.viewUrl || '',
      markdownUrl: created.markdownUrl || '',
      createdAt: created.createdAt || new Date().toISOString(),
      expiresAt: created.expiresAt || '',
    };
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbRun(mode, fn) {
    return idbOpen().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, mode);
          const store = tx.objectStore(IDB_STORE);
          const req = fn(store);
          tx.oncomplete = () => resolve(req && req.result);
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  const idbGet = (key) => idbRun('readonly', (s) => s.get(key));
  const idbSet = (key, val) => idbRun('readwrite', (s) => s.put(val, key));

  // showDirectoryPicker may live on the sandbox window, the page window (unsafeWindow), or
  // globalThis depending on the userscript manager. Firefox/Safari expose it nowhere (-> zip).
  function fsaWindow() {
    const candidates = [
      typeof window !== 'undefined' ? window : null,
      typeof unsafeWindow !== 'undefined' ? unsafeWindow : null,
      typeof globalThis !== 'undefined' ? globalThis : null,
    ];
    for (const c of candidates) {
      if (c && typeof c.showDirectoryPicker === 'function') return c;
    }
    return null;
  }

  function extensionFolderPickerAvailable() {
    return (
      globalThis.__SOURCECAPSULE_EXTENSION__ === true && extensionFolderPickerSupport !== false
    );
  }

  function folderPickerAvailable() {
    return !!fsaWindow() || extensionFolderPickerAvailable();
  }

  function pickDirectoryViaExtensionBridge({ timeoutMs = 65000 } = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
      let timer;
      const finish = (callback, value) => {
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        callback(value);
      };
      const onMessage = (event) => {
        if (!event || event.source !== window) return;
        if (event.origin && event.origin !== location.origin) return;
        const data = event.data;
        if (
          !data ||
          typeof data !== 'object' ||
          data.source !== FOLDER_PICKER_SOURCE ||
          data.contractVersion !== 1 ||
          data.type !== 'result' ||
          data.requestId !== requestId
        )
          return;
        if (data.ok && data.handle && data.handle.kind === 'directory') {
          finish(resolve, data.handle);
          return;
        }
        const error = new Error(String(data.error || 'Folder selection failed.'));
        error.name = String(data.errorName || 'Error');
        if (error.name === 'NotSupportedError') extensionFolderPickerSupport = false;
        finish(reject, error);
      };
      window.addEventListener('message', onMessage);
      timer = setTimeout(
        () => finish(reject, new Error('Folder picker did not respond. Refresh X and try again.')),
        timeoutMs
      );
      window.dispatchEvent(
        new window.CustomEvent(FOLDER_PICKER_REQUEST_EVENT, {
          detail: { source: FOLDER_PICKER_SOURCE, contractVersion: 1, requestId },
        })
      );
    });
  }

  async function verifyPermission(handle) {
    if (!handle || typeof handle.queryPermission !== 'function') return true;
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    return false;
  }

  /**
   * Resolve the root export directory handle. Reuses the persisted one (re-confirming write
   * permission, which the browser may prompt for ~once per session) unless `forcePick`. Returns
   * null when the File System Access API is unavailable (caller falls back to a zip) or the user
   * cancels the picker.
   */
  async function getRootDir({ forcePick = false } = {}) {
    const win = fsaWindow();
    lastFolderPickerError = '';
    if (!forcePick) {
      try {
        const saved = await idbGet(ROOT_HANDLE_KEY);
        if (saved && (await verifyPermission(saved))) return saved;
      } catch (e) {
        errlog(e);
      }
    }
    let handle;
    try {
      if (win) {
        handle = await win.showDirectoryPicker({ id: 'sourcecapsule', mode: 'readwrite' });
      } else if (extensionFolderPickerAvailable()) {
        handle = await pickDirectoryViaExtensionBridge();
      } else {
        return null;
      }
    } catch (error) {
      lastFolderPickerError =
        error && error.name === 'AbortError'
          ? 'Folder selection was cancelled.'
          : `Could not open the folder picker: ${error.message || error}`;
      return null; // user cancelled the picker
    }
    if (!(await verifyPermission(handle))) return null;
    try {
      await idbSet(ROOT_HANDLE_KEY, handle);
    } catch (e) {
      errlog(e);
    }
    return handle;
  }

  let menuCommandIds = [];
  function registerSettingsMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (typeof GM_unregisterMenuCommand === 'function') {
      menuCommandIds.forEach((id) => {
        try {
          GM_unregisterMenuCommand(id);
        } catch {
          /* manager may not support re-labelling; harmless */
        }
      });
    }
    menuCommandIds = [];
    const prefs = getPrefs();
    const reg = (label, fn) => {
      const id = GM_registerMenuCommand(label, fn);
      if (id !== undefined && id !== null) menuCommandIds.push(id);
    };
    const layoutText = (p) => (p === 'flat' ? 'flat' : 'by date');
    const contentsText = (p) => (p === 'lean' ? 'lean (md + media)' : 'full (HTML + bundle)');
    reg(`${APP}: Layout - ${layoutText(prefs.layout)} (click to switch)`, () => {
      const next = setPrefs({ layout: prefs.layout === 'flat' ? 'date' : 'flat' });
      showToast(`Library layout: ${layoutText(next.layout)}`);
      registerSettingsMenu();
    });
    reg(`${APP}: Contents - ${contentsText(prefs.contents)} (click to switch)`, () => {
      const next = setPrefs({ contents: prefs.contents === 'lean' ? 'full' : 'lean' });
      showToast(`Library contents: ${contentsText(next.contents)}`);
      registerSettingsMenu();
    });
    reg(
      `${APP}: Floating button - ${prefs.floatingButton ? 'on' : 'off'} (click to switch)`,
      () => {
        const next = setPrefs({ floatingButton: !prefs.floatingButton });
        showToast(`Floating button: ${next.floatingButton ? 'on' : 'off'}`);
        registerSettingsMenu();
        ensureButton();
      }
    );
    reg(
      `${APP}: Strict export - ${prefs.strictExport ? 'on (block incomplete)' : 'off'} (click to switch)`,
      () => {
        const next = setPrefs({ strictExport: !prefs.strictExport });
        showToast(
          `Strict export: ${next.strictExport ? 'on - broken exports will be blocked' : 'off - exports ship regardless'}`
        );
        registerSettingsMenu();
      }
    );
    reg(
      `${APP}: Reply context - ${prefs.replyContext ? 'on (include replied-to post)' : 'off'} (click to switch)`,
      () => {
        const next = setPrefs({ replyContext: !prefs.replyContext });
        showToast(
          `Reply context: ${next.replyContext ? 'on - replies include the post they answer' : 'off'}`
        );
        registerSettingsMenu();
      }
    );
    reg(`${APP}: Change export folder...`, async () => {
      const handle = await getRootDir({ forcePick: true });
      showToast(handle ? `Export folder set: ${handle.name}` : 'Export folder unchanged');
    });
    reg(`${APP}: Recent AI readable links`, () => showRecentShareLinks());
    reg(`${APP}: Share service - ${prefs.shareApiBase} (click to change)`, () => {
      const value = window.prompt('SourceCapsule share service URL', prefs.shareApiBase);
      if (!value) return;
      try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol)) throw new Error('Use an http(s) URL.');
        const next = setPrefs({ shareApiBase: url.href.replace(/\/$/, '') });
        showToast(`Share service: ${next.shareApiBase}`);
        registerSettingsMenu();
      } catch (e) {
        showToast(`Invalid share service URL: ${e.message}`, { error: true });
      }
    });
  }

  // ===========================================================================
  // UI - floating button, progress toast, orchestration
  // ---------------------------------------------------------------------------
  // We use a floating button (not a toolbar-injected one) on purpose: it depends
  // only on the URL (very stable) rather than X's fragile action-bar markup.
  // ===========================================================================

  function ensureStyle() {
    if (document.getElementById(CONFIG.styleId)) return;
    const s = document.createElement('style');
    s.id = CONFIG.styleId;
    s.textContent = `
/* Default sits to the LEFT of X's bottom-right Grok/Messages cluster; the floating control
   is draggable and remembers where you put it. */
#${CONFIG.buttonId}{position:fixed;right:96px;bottom:20px;z-index:99999}
.xa-ctl{font:600 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.xa-ctl-trigger{display:inline-flex;align-items:center;gap:6px;padding:11px 16px;border:none;border-radius:9999px;
  background:#1d9bf0;color:#fff;font:inherit;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);
  user-select:none;transition:transform .08s ease,background .15s ease}
.xa-ctl-floating .xa-ctl-trigger{cursor:grab;touch-action:none}
.xa-ctl-floating .xa-ctl-trigger:active{cursor:grabbing}
.xa-ctl-trigger:hover{background:#1a8cd8}
.xa-ctl-trigger:active{transform:scale(.97)}
.xa-ctl-trigger[disabled]{opacity:.7;cursor:default}
.xa-ctl-options{margin-left:4px;padding:8px 9px;border:0;border-radius:999px;background:#1d9bf0;color:#fff;
  font:700 12px/1 inherit;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.xa-ctl-options:hover{background:#1a8cd8}.xa-ctl-options[disabled]{opacity:.7;cursor:default}
.xa-ctl-menu{position:fixed;display:flex;flex-direction:column;width:min(280px,calc(100vw - 24px));padding:8px;
  border:1px solid rgba(15,20,25,.12);border-radius:12px;background:#fff;box-shadow:0 14px 44px rgba(0,0,0,.34);z-index:2147483647}
.xa-ctl-menu[hidden]{display:none}
.xa-ctl-item{display:block;width:100%;min-height:36px;text-align:left;padding:9px 12px;border:none;border-radius:8px;
  background:transparent;color:#0f1419;font:600 13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;cursor:pointer;white-space:normal}
.xa-ctl-item:hover{background:#e8f5fd;color:#1d9bf0}
.xa-ctl-sep{height:1px;margin:6px 10px;background:rgba(15,20,25,.12)}
.xa-ctl-floating .xa-ctl-menu{right:auto;bottom:auto}
/* Per-post control. Primary placement is inline in the header, beside X's "..." menu /
   Subscribe; it falls back to an absolute overlay only when that header anchor isn't found. */
.${CONFIG.postControlClass} .xa-ctl-trigger{padding:4px 11px;font-size:12px;
  box-shadow:0 2px 8px rgba(0,0,0,.2);transition:opacity .12s ease}
.${CONFIG.postControlClass} .xa-ctl-menu{right:auto;top:auto}
/* Inline-in-header: full opacity and sized to match X's header buttons (Subscribe/More);
   sits left of the "..." menu. */
.${CONFIG.postControlClass}.xa-ctl-inline{position:static;display:inline-flex;align-items:center;margin-right:8px}
.${CONFIG.postControlClass}.xa-ctl-inline .xa-ctl-trigger{opacity:1;font-size:14px;padding:7px 16px}
.${CONFIG.postControlClass}.xa-ctl-inline .xa-ctl-options{padding:7px 8px}
/* Absolute fallback (no header caret found): visible overlay below the header row. */
.${CONFIG.postControlClass}:not(.xa-ctl-inline){position:absolute;top:52px;right:10px;z-index:50}
.${CONFIG.postControlClass}:not(.xa-ctl-inline) .xa-ctl-trigger{opacity:.96;pointer-events:auto}
article[data-testid="tweet"]:hover > .${CONFIG.postControlClass}:not(.xa-ctl-inline) .xa-ctl-trigger,
article[role="article"]:hover > .${CONFIG.postControlClass}:not(.xa-ctl-inline) .xa-ctl-trigger,
.${CONFIG.postControlClass}:not(.xa-ctl-inline) .xa-ctl-trigger[disabled]{opacity:1;pointer-events:auto}
@media (prefers-color-scheme:dark){
  .xa-ctl-menu{background:#0f1419;border-color:#2f3336}
  .xa-ctl-item{color:#e7e9ea}
  .xa-ctl-item:hover{background:#16202b;color:#1d9bf0}
  .xa-ctl-sep{background:rgba(231,233,234,.14)}
}
#${CONFIG.toastId}{position:fixed;right:20px;bottom:74px;z-index:99999;max-width:280px;
  padding:12px 14px;border-radius:12px;background:rgba(15,20,25,.95);color:#fff;
  font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 6px 24px rgba(0,0,0,.35);opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s}
#${CONFIG.toastId}.show{opacity:1;transform:none}
#${CONFIG.toastId}.error{background:#b00020}
.xa-modal-backdrop{position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;
  padding:20px;overflow:auto;background:rgba(0,0,0,.62);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.xa-modal{width:min(480px,100%);padding:20px;border-radius:16px;background:#fff;color:#0f1419;
  box-sizing:border-box;max-height:calc(100vh - 40px);overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;
  box-shadow:0 20px 70px rgba(0,0,0,.45)}.xa-modal h2{margin:0 0 8px;font-size:20px}
.xa-modal p{margin:0 0 14px;color:#536471}.xa-modal label{display:block;margin:12px 0 5px;font-weight:650}
.xa-modal input,.xa-modal textarea,.xa-modal select{box-sizing:border-box;width:100%;padding:10px 11px;
  border:1px solid #cfd9de;border-radius:9px;background:#fff;color:#0f1419;font:inherit}
.xa-modal textarea{min-height:82px;resize:vertical}.xa-modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}
.xa-modal button{padding:9px 14px;border:0;border-radius:999px;font:650 14px/1 inherit;cursor:pointer}
.xa-modal-cancel{background:#eff3f4;color:#0f1419}.xa-modal-submit,.xa-modal-open{background:#1d9bf0;color:#fff}
.xa-modal-open{display:inline-flex;align-items:center;padding:9px 14px;border-radius:999px;
  font:650 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-decoration:none}
.xa-share-url{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.xa-share-status{min-height:20px}
.xa-recent-links{display:flex;flex-direction:column;gap:10px;margin-top:12px}.xa-recent-link{padding:11px;border:1px solid #cfd9de;border-radius:8px}
.xa-recent-link.expired{opacity:.58}.xa-recent-link-title{font-weight:750;overflow-wrap:anywhere}.xa-recent-link-meta{margin-top:4px;color:#536471;font-size:12px;overflow-wrap:anywhere}
.xa-recent-link-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}.xa-recent-link-actions button,.xa-recent-link-actions a{padding:7px 10px;border:0;border-radius:999px;background:#eff3f4;color:#0f1419;font:650 12px/1 inherit;text-decoration:none;cursor:pointer}
.xa-recent-link-actions .danger{color:#b00020}
.xa-receipt-grid{display:grid;grid-template-columns:1fr auto;gap:6px 14px;margin:14px 0}.xa-receipt-grid dt{color:#536471}.xa-receipt-grid dd{margin:0;font-weight:700;text-align:right}
.xa-receipt-location{padding:9px;border-radius:8px;background:#eff3f4;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
.xa-receipt-status{font-weight:700}.xa-receipt-status.warning,.xa-receipt-action-status.error{color:#b00020}.xa-receipt-action-status.warning{color:#b00020}.xa-receipt-details{margin-top:10px}.xa-receipt-details[open]{max-height:min(42vh,360px);overflow:auto;overscroll-behavior:contain}.xa-receipt-actions{flex-wrap:wrap}
.xa-strict-summary{margin:8px 0;padding-left:20px}.xa-strict-summary li{margin:4px 0}
.xa-strict-detail-list{margin:6px 0;padding-left:20px;font-size:13px}.xa-strict-detail-list li{margin:3px 0}
.xa-strict-ship{background:#f4212e;color:#fff}
.xa-strict-copy{background:#eff3f4;color:#0f1419}
@media (prefers-color-scheme:dark){.xa-modal{background:#15202b;color:#e7e9ea}.xa-modal p{color:#8b98a5}
  .xa-modal input,.xa-modal textarea,.xa-modal select{background:#1f2733;color:#e7e9ea;border-color:#536471}
  .xa-modal-cancel{background:#273340;color:#e7e9ea}.xa-receipt-location{background:#273340}.xa-receipt-grid dt{color:#8b98a5}
  .xa-recent-link{border-color:#536471}.xa-recent-link-meta{color:#8b98a5}.xa-recent-link-actions button,.xa-recent-link-actions a{background:#273340;color:#e7e9ea}}
`;
    (document.head || document.documentElement).appendChild(s);
  }

  function showToast(msg, { error = false, sticky = false } = {}) {
    ensureStyle();
    let t = document.getElementById(CONFIG.toastId);
    if (!t) {
      t = document.createElement('div');
      t.id = CONFIG.toastId;
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      t.setAttribute('aria-atomic', 'true');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle('error', error);
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback) => setTimeout(callback, 0);
    raf(() => t.classList.add('show'));
    if (t._timer) clearTimeout(t._timer);
    if (!sticky) {
      t._timer = setTimeout(() => t.classList.remove('show'), error ? 6000 : 3500);
    }
  }

  function hideToast() {
    const toast = document.getElementById(CONFIG.toastId);
    if (!toast) return;
    if (toast._timer) clearTimeout(toast._timer);
    toast.classList.remove('show');
  }

  function showShareResult(created, { copied = false } = {}) {
    const viewUrl = safeUrl(created && created.viewUrl);
    if (!viewUrl) throw new Error('Share service returned an invalid public link.');
    ensureStyle();
    const receipt = document.querySelector('.xa-capture-receipt');
    if (receipt) {
      const status = receipt.querySelector('.xa-receipt-action-status');
      status.classList.remove('error');
      status.textContent = copied
        ? 'AI readable link created and copied.'
        : 'AI readable link created. Automatic copy was blocked; use the link below.';
      let link = receipt.querySelector('.xa-receipt-share-link');
      if (!link) {
        link = document.createElement('a');
        link.className = 'xa-receipt-share-link';
        link.target = '_blank';
        link.rel = 'noopener';
        receipt.querySelector('.xa-receipt-details').after(link);
      }
      link.href = viewUrl;
      link.textContent = viewUrl;
      return;
    }
    const existing = document.querySelector('.xa-share-result');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'xa-modal-backdrop xa-share-result';
    const modal = document.createElement('div');
    modal.className = 'xa-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'xa-share-title');
    const title = document.createElement('h2');
    title.id = 'xa-share-title';
    title.textContent = 'AI readable link ready';
    const status = document.createElement('p');
    status.className = 'xa-share-status';
    status.textContent = copied
      ? 'Copied to your clipboard.'
      : 'Chrome could not copy automatically. Use Copy link below.';
    const label = document.createElement('label');
    label.setAttribute('for', 'xa-share-url');
    label.textContent = 'AI readable link';
    const input = document.createElement('input');
    input.id = 'xa-share-url';
    input.className = 'xa-share-url';
    input.type = 'text';
    input.readOnly = true;
    input.value = viewUrl;
    const actions = document.createElement('div');
    actions.className = 'xa-modal-actions';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'xa-modal-cancel';
    closeButton.textContent = 'Close';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'xa-share-copy';
    copyButton.textContent = 'Copy link';
    const openLink = document.createElement('a');
    openLink.className = 'xa-modal-open';
    openLink.href = viewUrl;
    openLink.target = '_blank';
    openLink.rel = 'noopener';
    openLink.textContent = 'Open link';
    actions.append(closeButton, copyButton, openLink);
    modal.append(title, status, label, input, actions);
    backdrop.appendChild(modal);

    const close = () => backdrop.remove();
    closeButton.addEventListener('click', close);
    copyButton.addEventListener('click', async () => {
      try {
        await copyText(viewUrl);
        status.textContent = 'Copied to your clipboard.';
      } catch {
        input.focus();
        input.select();
        status.textContent = 'Copy was blocked. The link is selected; press Ctrl+C.';
      }
    });
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
    document.body.appendChild(backdrop);
    input.focus();
    input.select();
  }

  function showRecentShareLinks() {
    ensureStyle();
    const existing = document.querySelector('.xa-recent-links-modal');
    if (existing) existing.remove();
    const records = getShareLinks();
    const backdrop = document.createElement('div');
    backdrop.className = 'xa-modal-backdrop xa-recent-links-modal';
    const modal = document.createElement('section');
    modal.className = 'xa-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'xa-recent-links-title');
    const title = document.createElement('h2');
    title.id = 'xa-recent-links-title';
    title.textContent = 'Recent AI readable links';
    const intro = document.createElement('p');
    intro.textContent = records.length
      ? 'Links are stored on this browser profile. Expired links stay visible but are greyed out.'
      : 'No AI readable links have been created from this browser profile yet.';
    const list = document.createElement('div');
    list.className = 'xa-recent-links';

    const render = () => {
      list.textContent = '';
      const current = getShareLinks();
      if (!current.length) {
        const empty = document.createElement('p');
        empty.textContent =
          'Create an AI readable link from a SourceCapsule export to see it here.';
        list.appendChild(empty);
        return;
      }
      current.forEach((record) => {
        const expired = shareLinkExpired(record);
        const viewUrl = safeUrl(record.viewUrl);
        const markdownUrl = safeUrl(record.markdownUrl);
        const item = document.createElement('article');
        item.className = `xa-recent-link${expired ? ' expired' : ''}`;
        const itemTitle = document.createElement('div');
        itemTitle.className = 'xa-recent-link-title';
        itemTitle.textContent = record.title || 'X capture';
        const meta = document.createElement('div');
        meta.className = 'xa-recent-link-meta';
        const expires = record.expiresAt ? readableUtcTime(record.expiresAt) : 'unknown expiry';
        meta.textContent = `${expired ? 'Expired' : 'Expires'}: ${expires}${
          record.sourceUrl ? ` | Source: ${record.sourceUrl}` : ''
        }`;
        const actions = document.createElement('div');
        actions.className = 'xa-recent-link-actions';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy link';
        copy.addEventListener('click', async () => {
          try {
            await copyText(viewUrl);
            showToast('AI readable link copied.');
          } catch {
            showToast('Copy blocked. Open the link and copy from the address bar.', {
              error: true,
            });
          }
        });
        const open = document.createElement('a');
        open.href = viewUrl || '#';
        open.target = '_blank';
        open.rel = 'noopener';
        open.textContent = 'Open';
        const copyMd = document.createElement('button');
        copyMd.type = 'button';
        copyMd.textContent = 'Copy Markdown link';
        copyMd.disabled = !markdownUrl;
        copyMd.addEventListener('click', async () => {
          try {
            await copyText(markdownUrl);
            showToast('Markdown link copied.');
          } catch {
            showToast('Copy blocked.', { error: true });
          }
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'danger';
        del.textContent = 'Delete link';
        del.addEventListener('click', async () => {
          if (!window.confirm('Delete this AI readable link? This cannot be undone.')) return;
          del.disabled = true;
          try {
            await deleteSharedCapsule(record);
            showToast('AI readable link deleted.');
            render();
          } catch (error) {
            del.disabled = false;
            showToast(`Delete failed: ${error.message}`, { error: true });
          }
        });
        actions.append(copy, open, copyMd, del);
        item.append(itemTitle, meta, actions);
        list.appendChild(item);
      });
    };

    const actions = document.createElement('div');
    actions.className = 'xa-modal-actions';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'xa-modal-cancel';
    closeButton.textContent = 'Close';
    actions.appendChild(closeButton);
    modal.append(title, intro, list, actions);
    backdrop.appendChild(modal);
    const close = () => backdrop.remove();
    closeButton.addEventListener('click', close);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
    render();
    document.body.appendChild(backdrop);
    closeButton.focus();
  }

  function setReceiptActionStatus(message, { error = false } = {}) {
    const status = document.querySelector('.xa-capture-receipt .xa-receipt-action-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  /**
   * Ship-blocker modal: shown when strict export mode detects dead-ends in the
   * finished model. Blocks the download until the user either explicitly confirms
   * ("Ship it anyway") or cancels. Returns a Promise&lt;boolean&gt; - true = proceed,
   * false = cancel.
   *
   * The whole point of this modal is to make silent bad exports impossible. So it
   * lists exactly what would ship broken, in the categories the user actually
   * cares about (quotes + media), and offers a one-click "Copy diagnostic bundle"
   * button so users can paste a reproducible report when reporting the issue.
   */
  function confirmShipDespiteIncomplete({ model, assessment, debugJson = '', onRetry = null }) {
    if (typeof document === 'undefined') return Promise.resolve(true);
    ensureStyle();
    hideToast();
    document.querySelector('.xa-strict-gate')?.remove();
    const summaryRows = (a) => {
      const c = a.counts;
      const rows = [];
      if (c.quotePermalinkMissing)
        rows.push(
          `<li><strong>${c.quotePermalinkMissing}</strong> embedded post(s) with no canonical permalink (only the author profile link would be usable).</li>`
        );
      if (c.quoteContentMissing)
        rows.push(
          `<li><strong>${c.quoteContentMissing}</strong> embedded post(s) whose content couldn't be captured (private, deleted, or fetch failed).</li>`
        );
      if (c.imageFetchFailed)
        rows.push(
          `<li><strong>${c.imageFetchFailed}</strong> image(s) detected but not embedded (would render as "Image unavailable").</li>`
        );
      if (c.videoNothingCaptured)
        rows.push(
          `<li><strong>${c.videoNothingCaptured}</strong> video(s) with neither video bytes nor a poster still (would render as "Video unavailable").</li>`
        );
      return rows.join('');
    };
    const detailRows = (a) => {
      const details = a.blockers
        .slice(0, 20)
        .map((b) => `<li>${escapeHtml(b.summary)}</li>`)
        .join('');
      const moreCount = Math.max(0, a.blockers.length - 20);
      return details + (moreCount ? `<li>&hellip; and ${moreCount} more.</li>` : '');
    };
    const backdrop = document.createElement('div');
    backdrop.className = 'xa-modal-backdrop xa-strict-gate';
    backdrop.innerHTML = `<section class="xa-modal" role="dialog" aria-modal="true" aria-labelledby="xa-strict-title">
<h2 id="xa-strict-title">Export is incomplete</h2>
<p>Strict export mode detected dead-ends the reader would see in the exported file. Fix or accept before shipping.</p>
<ul class="xa-strict-summary">${summaryRows(assessment)}</ul>
<details class="xa-receipt-details" open><summary>What would ship broken (<span class="xa-strict-count">${assessment.blockers.length}</span>)</summary><ul class="xa-strict-detail-list">${detailRows(assessment)}</ul></details>
<p class="xa-receipt-action-status" aria-live="polite"></p>
<div class="xa-modal-actions">
  ${onRetry ? '<button type="button" class="xa-strict-retry">Retry recovery</button>' : ''}
  <button type="button" class="xa-strict-copy">Copy diagnostic bundle</button>
  <button type="button" class="xa-modal-cancel">Cancel export</button>
  <button type="button" class="xa-modal-submit xa-strict-ship">Ship it anyway</button>
</div>
</section>`;
    document.body.appendChild(backdrop);
    const status = backdrop.querySelector('.xa-receipt-action-status');
    const setStatus = (msg, isError) => {
      if (!status) return;
      status.textContent = msg;
      status.classList.toggle('warning', !!isError);
    };
    return new Promise((resolve) => {
      const close = (result) => {
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.remove();
        resolve(result);
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') close(false);
      };
      backdrop.querySelector('.xa-modal-cancel').addEventListener('click', () => close(false));
      backdrop.querySelector('.xa-strict-ship').addEventListener('click', () => close(true));
      backdrop.querySelector('.xa-strict-copy').addEventListener('click', async () => {
        try {
          const bundle = buildDiagnosticBundle(model, assessment, {
            debugJsonLength: debugJson ? debugJson.length : 0,
          });
          await copyText(bundle);
          setStatus('Diagnostic bundle copied to clipboard.');
        } catch (error) {
          setStatus(`Copy failed: ${error.message}`, true);
        }
      });
      const retryBtn = backdrop.querySelector('.xa-strict-retry');
      if (retryBtn && onRetry) {
        retryBtn.addEventListener('click', async () => {
          const buttons = Array.from(backdrop.querySelectorAll('button'));
          buttons.forEach((b) => (b.disabled = true));
          setStatus('Retrying incomplete items...');
          try {
            const fresh = await onRetry((done, total) =>
              setStatus(
                total
                  ? `Retrying failed downloads... ${done}/${total}`
                  : 'Retrying incomplete items...'
              )
            );
            if (fresh) assessment = fresh;
            if (assessment.verdict === 'clean') {
              // Everything recovered - proceed with the export as a clean ship.
              close(true);
              return;
            }
            backdrop.querySelector('.xa-strict-summary').innerHTML = summaryRows(assessment);
            backdrop.querySelector('.xa-strict-detail-list').innerHTML = detailRows(assessment);
            const count = backdrop.querySelector('.xa-strict-count');
            if (count) count.textContent = String(assessment.blockers.length);
            setStatus(
              `Still incomplete: ${assessment.blockers.length} item(s) could not be recovered.`,
              true
            );
          } catch (error) {
            setStatus(`Retry failed: ${error.message}`, true);
          } finally {
            buttons.forEach((b) => (b.disabled = false));
          }
        });
      }
      document.addEventListener('keydown', onKeyDown, true);
      backdrop.querySelector('.xa-modal-cancel').focus();
    });
  }

  function showCaptureReceipt({
    model,
    debugJson = '',
    savedLocation = '',
    markdown = '',
    videosPreservedOffline,
    onShare,
  }) {
    ensureStyle();
    hideToast();
    document.querySelector('.xa-capture-receipt')?.remove();
    const stats = archiveStats(model);
    const imageMedia = stats.media.filter((item) => item.type === 'image');
    const imagesCaptured = imageMedia.filter((item) => item.embedded).length;
    const imagesMissing = imageMedia.filter((item) => item.missing).length;
    const posts = model.thread ? model.thread.capturedPosts : 1;
    const savedOfflineVideos = Number.isFinite(videosPreservedOffline)
      ? videosPreservedOffline
      : stats.videosPreservedOffline;
    const complete = stats.missingMedia === 0 && stats.incompleteMedia === 0;
    const retainedMarkdown = markdown || renderLlmMarkdown(model, debugJson);
    const backdrop = document.createElement('div');
    backdrop.className = 'xa-modal-backdrop xa-capture-receipt';
    backdrop.innerHTML = `<section class="xa-modal" role="dialog" aria-modal="true" aria-labelledby="xa-receipt-title"><h2 id="xa-receipt-title">Capture saved</h2>${
      savedLocation
        ? `<p>Saved to</p><div class="xa-receipt-location">${escapeHtml(savedLocation)}</div>`
        : ''
    }<dl class="xa-receipt-grid"><dt>Posts captured</dt><dd>${escapeHtml(posts)}</dd><dt>Polls captured</dt><dd>${stats.polls}</dd><dt>Images</dt><dd>${imagesCaptured} captured · ${imagesMissing} missing</dd><dt>Videos preserved offline</dt><dd>${savedOfflineVideos}</dd><dt>Video posters captured</dt><dd>${stats.videoPostersCaptured}</dd><dt>Incomplete media</dt><dd>${stats.incompleteMedia}</dd><dt>Recovered long-form Notes</dt><dd>${stats.recoveredNotes}</dd>${
      stats.quoteTombstones
        ? `<dt>Quoted posts gone on X</dt><dd>${stats.quoteTombstones}</dd>`
        : ''
    }</dl><p class="xa-receipt-status ${complete ? '' : 'warning'}">${
      complete
        ? `Complete — no missing media detected${
            stats.quoteTombstones
              ? `; ${stats.quoteTombstones} quoted post(s) already gone on X`
              : ''
          }`
        : `${stats.missingMedia} missing and ${stats.incompleteMedia} incomplete item(s)`
    }</p><details class="xa-receipt-details" ${complete ? '' : 'open'}><summary>Capture details</summary><ul>${
      stats.warnings.length
        ? stats.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
        : '<li>No capture warnings.</li>'
    }</ul></details><p class="xa-receipt-action-status" aria-live="polite"></p><div class="xa-modal-actions xa-receipt-actions"><button type="button" class="xa-receipt-copy">Copy for AI</button>${
      typeof onShare === 'function'
        ? '<button type="button" class="xa-receipt-share">Create AI readable link</button>'
        : ''
    }<button type="button" class="xa-modal-cancel">Done</button></div></section>`;
    const done = backdrop.querySelector('.xa-modal-cancel');
    const close = () => {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close();
    };
    done.addEventListener('click', close);
    backdrop.querySelector('.xa-receipt-copy').addEventListener('click', async () => {
      try {
        await copyText(retainedMarkdown);
        setReceiptActionStatus('Clean Markdown copied for AI.');
      } catch (error) {
        setReceiptActionStatus(`Copy failed: ${error.message}`, { error: true });
      }
    });
    const shareButton = backdrop.querySelector('.xa-receipt-share');
    if (shareButton) {
      shareButton.addEventListener('click', async () => {
        shareButton.disabled = true;
        setReceiptActionStatus('Preparing AI readable link confirmation...');
        try {
          await onShare();
        } catch (error) {
          setReceiptActionStatus(`Local save is safe. AI readable link failed: ${error.message}`, {
            error: true,
          });
        } finally {
          shareButton.disabled = false;
        }
      });
    }
    document.addEventListener('keydown', onKeyDown, true);
    document.body.appendChild(backdrop);
    done.focus();
    return backdrop;
  }

  function promptCaptureOptions({ share = false, saveLocal = false } = {}) {
    ensureStyle();
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'xa-modal-backdrop';
      backdrop.innerHTML = `<form class="xa-modal" role="dialog" aria-modal="true" aria-labelledby="xa-modal-title">
        <h2 id="xa-modal-title">${
          share
            ? saveLocal
              ? 'Save + create AI readable link'
              : 'Create AI readable link'
            : 'Add context'
        }</h2>
        <p>${
          share
            ? `${saveLocal ? 'A local library copy is saved first. ' : ''}This creates an unlisted public AI-readable capsule. Anyone with the link can view it. Full video files are not uploaded.`
            : 'Optional: record why this source matters so you and your agents remember later.'
        }</p>
        <label for="xa-note">Why are you saving this?</label>
        <textarea id="xa-note" maxlength="2000" placeholder="Example: Compare this with our Malaysia pricing research"></textarea>
        <label for="xa-tags">Tags</label>
        <input id="xa-tags" maxlength="300" placeholder="fintech, malaysia, pricing">
        ${
          share
            ? `<label for="xa-expiry">Link expires after</label><select id="xa-expiry">${CONFIG.share.expiryDays
                .map(
                  (days) =>
                    `<option value="${days}" ${days === CONFIG.share.defaultExpiryDays ? 'selected' : ''}>${days} day${days === 1 ? '' : 's'}</option>`
                )
                .join('')}</select>`
            : ''
        }
        <div class="xa-modal-actions"><button type="button" class="xa-modal-cancel">Cancel</button><button type="submit" class="xa-modal-submit">${share ? (saveLocal ? 'Save + create link' : 'Create link') : 'Continue'}</button></div>
      </form>`;
      const form = backdrop.querySelector('form');
      const note = backdrop.querySelector('#xa-note');
      const tags = backdrop.querySelector('#xa-tags');
      const finish = (value) => {
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.remove();
        resolve(value);
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') finish(null);
      };
      backdrop.querySelector('.xa-modal-cancel').addEventListener('click', () => finish(null));
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) finish(null);
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const expiry = backdrop.querySelector('#xa-expiry');
        finish({
          note: note.value,
          tags: normalizeTags(tags.value),
          expiryDays: expiry ? Number(expiry.value) : undefined,
        });
      });
      document.addEventListener('keydown', onKeyDown, true);
      document.body.appendChild(backdrop);
      note.focus();
    });
  }

  function showFolderPickerPrompt() {
    ensureStyle();
    const old = document.querySelector('.xa-folder-picker-prompt');
    if (old) old.remove();
    const backdrop = document.createElement('div');
    backdrop.className = 'xa-modal-backdrop xa-folder-picker-prompt';
    backdrop.innerHTML = `<section class="xa-modal" role="dialog" aria-modal="true" aria-labelledby="xa-folder-title"><h2 id="xa-folder-title">Change export folder</h2><p>Chrome requires a click on this page before it can open the folder picker.</p><div class="xa-modal-actions"><button type="button" class="xa-modal-cancel">Cancel</button><button type="button" class="xa-modal-submit">Choose folder</button></div></section>`;
    const close = () => backdrop.remove();
    backdrop.querySelector('.xa-modal-cancel').addEventListener('click', close);
    backdrop.querySelector('.xa-modal-submit').addEventListener('click', async () => {
      const button = backdrop.querySelector('.xa-modal-submit');
      button.disabled = true;
      const handle = await getRootDir({ forcePick: true });
      close();
      showToast(
        handle
          ? `Export folder set: ${handle.name}`
          : lastFolderPickerError || 'Export folder unchanged',
        { error: !handle }
      );
    });
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector('.xa-modal-submit').focus();
  }

  // ===========================================================================
  // PROGRESSIVE MEDIA HARVEST
  // ---------------------------------------------------------------------------
  // X lazy-loads and VIRTUALIZES long content: at any instant only a window of
  // tweet media exists in the DOM, and scrolling past it dumps it again. So a
  // single extraction at the end misses most media. Instead we scroll through
  // and snapshot every `pbs.twimg.com/media/` image as it appears, keyed by the
  // owning tweet's status id, then merge that harvest back into the model.
  // ===========================================================================
  const harvestedMedia = new Map(); // url -> { url, ownerStatusId, alt, y }
  const harvestedTweets = new Map(); // status id -> { tweet: detached clone, y }
  const harvestedVideoCandidates = [];
  const harvestedVideoUrls = new Set();
  const capturedNetworkVideoCandidates = [];
  const capturedNetworkVideoUrls = new Set();
  // Full long-form ("note") text passively captured from GraphQL responses X's own web
  // app already fetched (TweetDetail etc.). Keyed by immutable status id, so unlike video
  // candidate URLs (which expire and are page-scoped) this survives SPA navigations.
  const capturedNoteTweets = new Map(); // status id -> { id, text, urls: [entity urls] }
  const CAPTURED_NOTE_TWEETS_MAX = 300;
  // Passive index of parent-post -> quoted-post refs harvested from the same GraphQL
  // payloads X's own web app already downloaded to render the thread. This is what
  // lets us recover a quoted tweet's canonical permalink even when both the DOM and
  // syndication drop the reference (a periodic X regression, see the "Alex Prompter"
  // thread export that produced 3 dead quote cards). Keyed by parent status id ->
  // { quotedId, quotedHandle }. Survives SPA navigations, capped like note tweets.
  const capturedQuotedRefs = new Map();
  const CAPTURED_QUOTED_REFS_MAX = 600;
  const networkCaptureDiagnostics = {
    installed: false,
    mode: 'not-installed',
    unsafeWindowAvailable: false,
    directInstalled: false,
    injectedInstalled: false,
    responsesSeen: 0,
    interestingResponses: 0,
    messages: 0,
    candidates: 0,
    noteTweets: 0,
    quotedRefs: 0,
    truncatedResponses: 0,
    lastTruncatedUrl: '',
    errors: [],
    lastUrls: [],
  };
  const networkCapturePayloadSignatures = new Set();
  let pageScriptVideoCandidatesScanned = false;
  let nudgedVideoPlayers = new WeakSet();
  let capturedImageUrls = new Set(); // urls already placed in the current model

  function resetMediaState() {
    harvestedMedia.clear();
    harvestedTweets.clear();
    harvestedVideoCandidates.length = 0;
    harvestedVideoUrls.clear();
    pageScriptVideoCandidatesScanned = false;
    nudgedVideoPlayers = new WeakSet();
    capturedImageUrls = new Set();
    // Per-export cache: a stale payload from a previous export must never leak
    // into this one (the same post can gain/lose media between exports).
    syndicationSuccessCache.clear();
    capturedNetworkVideoCandidates.forEach((candidate) => rememberVideoCandidate(candidate, 0));
  }

  function clearCapturedNetworkVideoCandidates() {
    capturedNetworkVideoCandidates.length = 0;
    capturedNetworkVideoUrls.clear();
    networkCaptureDiagnostics.responsesSeen = 0;
    networkCaptureDiagnostics.interestingResponses = 0;
    networkCaptureDiagnostics.messages = 0;
    networkCaptureDiagnostics.candidates = 0;
    networkCaptureDiagnostics.truncatedResponses = 0;
    networkCaptureDiagnostics.lastTruncatedUrl = '';
    networkCaptureDiagnostics.lastUrls = [];
    networkCapturePayloadSignatures.clear();
  }

  function rememberNetworkCaptureUrl(url) {
    if (!url) return;
    const value = String(url);
    const list = networkCaptureDiagnostics.lastUrls;
    if (list[list.length - 1] === value) return;
    list.push(value);
    if (list.length > 8) list.shift();
  }

  function recordNetworkCaptureError(error) {
    const message = error && error.message ? error.message : String(error || 'unknown error');
    networkCaptureDiagnostics.errors.push(message);
    if (networkCaptureDiagnostics.errors.length > 8) networkCaptureDiagnostics.errors.shift();
  }
  function markImageCaptured(url) {
    if (url) capturedImageUrls.add(url);
  }
  function absY(el) {
    const r = el.getBoundingClientRect && el.getBoundingClientRect();
    return r ? r.top + (window.scrollY || 0) : 0;
  }

  /** Snapshot all tweet-media images currently in the DOM into the harvest map. */
  /**
   * Decide which tweet (if any) an image's media belongs to. An image is a
   * tweet's own media ONLY if it is inside a tweetPhoto AND its nearest tweet is
   * either a genuine EMBEDDED tweet (wrapped in simpleTweet) or the page's
   * primary post. The Article's main wrapper is an article[data-testid="tweet"]
   * whose first status link is the FIRST embedded tweet's id, so attributing the
   * article's own infographics by nearest-tweet wrongly stuffs them into that
   * tweet's card. Returning '' keeps article images in the body instead.
   */
  function mediaOwnerStatusId(img) {
    if (!img.closest('div[data-testid="tweetPhoto"]')) return '';
    const ownerTweet = closestAny(img, CONFIG.selectors.tweet);
    if (!ownerTweet) return '';
    const sid = tweetStatusId(ownerTweet);
    if (!sid) return '';
    const isEmbedded = !!ownerTweet.closest('div[data-testid="simpleTweet"]');
    const isPrimaryPost = sid === currentStatusId();
    return isEmbedded || isPrimaryPost ? sid : '';
  }

  function harvestMediaNow() {
    const column = pick(document, CONFIG.selectors.primaryColumn, { quiet: true }) || document.body;
    topLevelTweetEls(document).forEach((tweet) => {
      const statusId = tweetStatusId(tweet);
      if (!statusId) return;
      const clone = tweet.cloneNode(true);
      if (hasThreadBoundaryBefore(tweet, column)) clone.setAttribute(THREAD_BOUNDARY_FLAG, '1');
      clone.querySelectorAll(`.${CONFIG.postControlClass}`).forEach((control) => control.remove());
      const y = absY(tweet);
      const existing = harvestedTweets.get(statusId);
      if (
        !existing ||
        elementTextPreview(clone).length >= elementTextPreview(existing.tweet).length
      ) {
        harvestedTweets.set(statusId, { tweet: clone, y: existing ? Math.min(existing.y, y) : y });
      }
    });
    document.querySelectorAll('img').forEach((img) => {
      const src = img.currentSrc || img.src || '';
      if (!src.includes('pbs.twimg.com/media/')) return;
      const url = highResImageUrl(src);
      const ownerStatusId = mediaOwnerStatusId(img);
      if (harvestedMedia.has(url)) {
        // Re-seen: backfill a better owner id if the first sighting (mid-load)
        // could not resolve one. Prevents images leaking out of their tweet.
        const existing = harvestedMedia.get(url);
        if (!existing.ownerStatusId && ownerStatusId) existing.ownerStatusId = ownerStatusId;
        return;
      }
      harvestedMedia.set(url, {
        url,
        ownerStatusId,
        alt: img.alt || '',
        y: absY(img),
        ...imageDimensions(img),
      });
    });
    harvestVideoCandidatesNow();
  }

  function rememberVideoCandidate(candidate, y = 0) {
    if (!candidate || !candidate.url || harvestedVideoUrls.has(candidate.url)) return;
    harvestedVideoUrls.add(candidate.url);
    harvestedVideoCandidates.push({ ...candidate, y: Math.round(Number(y) || 0) });
  }

  function rememberNetworkVideoCandidate(candidate, meta = {}) {
    if (!candidate || !candidate.url || capturedNetworkVideoUrls.has(candidate.url)) return;
    capturedNetworkVideoUrls.add(candidate.url);
    const record = {
      ...candidate,
      source: candidate.source || `network:${meta.transport || 'unknown'}`,
      captureUrl: meta.url || '',
      capturedAt: new Date().toISOString(),
    };
    capturedNetworkVideoCandidates.push(record);
    rememberVideoCandidate(record, 0);
  }

  /**
   * Pull full long-form ("note") tweet texts out of a captured GraphQL response body.
   * X's own web app receives the complete note text in TweetDetail/TweetResultByRestId
   * payloads (`result.note_tweet.note_tweet_results.result.text`) - data the browser
   * already downloaded for the user; we just stop throwing it away. Returns
   * [{ id, text, urls }] where `urls` are the note's t.co entity urls for linkification.
   */
  function noteTweetsFromCapturedBody(body) {
    const raw = String(body || '').trim();
    if (!raw || (raw[0] !== '{' && raw[0] !== '[') || !/note_tweet/.test(raw)) return [];
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
    const out = [];
    const seen = new Set();
    const walk = (item) => {
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item)) {
        item.forEach(walk);
        return;
      }
      if (item.note_tweet && typeof item.note_tweet === 'object') {
        // GraphQL shape; tolerate the note object carrying `text` directly too.
        const noteResult =
          (item.note_tweet.note_tweet_results && item.note_tweet.note_tweet_results.result) ||
          item.note_tweet;
        const id = String(item.rest_id || (item.legacy && item.legacy.id_str) || '');
        const text = noteResult && typeof noteResult.text === 'string' ? noteResult.text : '';
        if (id && text && !seen.has(id)) {
          seen.add(id);
          const urls =
            noteResult.entity_set && Array.isArray(noteResult.entity_set.urls)
              ? noteResult.entity_set.urls
              : [];
          out.push({ id, text, urls });
        }
      }
      Object.keys(item).forEach((key) => walk(item[key]));
    };
    walk(data);
    return out;
  }

  function rememberCapturedNoteTweet(note) {
    if (!note || !note.id || !note.text) return;
    const existing = capturedNoteTweets.get(note.id);
    if (existing && existing.text.length >= note.text.length) return;
    if (!existing && capturedNoteTweets.size >= CAPTURED_NOTE_TWEETS_MAX) {
      const oldest = capturedNoteTweets.keys().next().value;
      capturedNoteTweets.delete(oldest);
    }
    capturedNoteTweets.set(note.id, note);
    networkCaptureDiagnostics.noteTweets = capturedNoteTweets.size;
  }

  function getCapturedNoteTweet(statusId) {
    return capturedNoteTweets.get(String(statusId || '')) || null;
  }

  /**
   * Walk a captured GraphQL body (TweetDetail, TweetResultByRestId, etc.) and pull out
   * every parent -> quoted-tweet relation the payload exposes. X's web app receives the
   * full quoted_status_result for every rendered post; when the DOM later virtualizes
   * away the quote's status anchor, this passive capture still has the ids we need to
   * rebuild a permalink. Returns [{ parentId, quotedId, quotedHandle }] triples.
   *
   * Handles both legacy REST-ish shapes (`t.quoted_status_id_str` +
   * `t.quoted_status.user.screen_name`) and the GraphQL result shape
   * (`t.quoted_status_result.result.core.user_results.result.legacy.screen_name`).
   */
  function quotedRefsFromCapturedBody(body) {
    const raw = String(body || '').trim();
    if (!raw || (raw[0] !== '{' && raw[0] !== '[')) return [];
    if (!/quoted_status/.test(raw)) return [];
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
    const out = [];
    const seen = new Set();
    const record = (parentId, quotedId, quotedHandle) => {
      const pid = String(parentId || '');
      const qid = String(quotedId || '');
      if (!/^\d+$/.test(pid) || !/^\d+$/.test(qid)) return;
      const handle = String(quotedHandle || '').replace(/^@/, '');
      if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return;
      const key = `${pid}->${qid}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ parentId: pid, quotedId: qid, quotedHandle: handle });
    };
    const walk = (item) => {
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item)) {
        item.forEach(walk);
        return;
      }
      const legacy = item.legacy || item;
      const parentId =
        item.rest_id || legacy.id_str || (item.legacy && item.legacy.id_str) || item.id_str || '';
      // GraphQL shape: quoted_status_result.result carries its own rest_id + core.user_results.
      const gqResult =
        item.quoted_status_result &&
        item.quoted_status_result.result &&
        (item.quoted_status_result.result.tweet || item.quoted_status_result.result);
      if (gqResult) {
        const qLegacy = gqResult.legacy || {};
        const qId = gqResult.rest_id || qLegacy.id_str || '';
        const userLegacy =
          (gqResult.core &&
            gqResult.core.user_results &&
            gqResult.core.user_results.result &&
            gqResult.core.user_results.result.legacy) ||
          {};
        record(parentId, qId, userLegacy.screen_name);
      }
      // Legacy shape (syndication-ish): quoted_status_id_str + quoted_status.user.screen_name.
      if (legacy.quoted_status_id_str) {
        const qUser =
          (item.quoted_status && item.quoted_status.user) ||
          (item.quoted_status &&
            item.quoted_status.core &&
            item.quoted_status.core.user_results &&
            item.quoted_status.core.user_results.result &&
            item.quoted_status.core.user_results.result.legacy) ||
          {};
        record(parentId, legacy.quoted_status_id_str, qUser.screen_name);
      }
      Object.keys(item).forEach((key) => walk(item[key]));
    };
    walk(data);
    return out;
  }

  function rememberCapturedQuotedRef(ref) {
    if (!ref || !ref.parentId || !ref.quotedId) return;
    const existing = capturedQuotedRefs.get(ref.parentId);
    // First one wins per parent; parent posts only quote a single tweet, so a later
    // sighting from a different payload should carry the same data anyway.
    if (existing) return;
    if (capturedQuotedRefs.size >= CAPTURED_QUOTED_REFS_MAX) {
      const oldest = capturedQuotedRefs.keys().next().value;
      capturedQuotedRefs.delete(oldest);
    }
    capturedQuotedRefs.set(ref.parentId, {
      quotedId: ref.quotedId,
      quotedHandle: ref.quotedHandle || '',
    });
    networkCaptureDiagnostics.quotedRefs = capturedQuotedRefs.size;
  }

  function getCapturedQuotedRef(parentStatusId) {
    return capturedQuotedRefs.get(String(parentStatusId || '')) || null;
  }

  /** Full note text -> paragraph blocks (escaped, t.co urls linkified, \n-split). */
  function noteTweetParagraphBlocks(note) {
    let html = escapeHtml(decodeBasicEntities(String(note.text || '').trim()));
    (note.urls || []).forEach((u) => {
      if (!u || !u.url) return;
      const dest = safeUrl(u.expanded_url || u.url);
      const label = escapeHtml(u.display_url || u.expanded_url || u.url);
      const link = dest ? `<a href="${escapeHtml(dest)}">${label}</a>` : label;
      html = html.split(escapeHtml(u.url)).join(link);
    });
    return html
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ kind: 'paragraph', html: line }));
  }

  /**
   * Swap a truncated quote's preview paragraphs for the captured full note text.
   * Non-paragraph blocks (media, nested quotes, cards) are kept; the full text is
   * inserted where the preview text sat. Returns true when the quote was upgraded.
   */
  function recoverQuoteNoteText(quote, note) {
    if (!quote || !quote.truncated || !note || !note.text) return false;
    const kept = (quote.blocks || []).filter((b) => b.kind !== 'paragraph');
    quote.blocks = [...noteTweetParagraphBlocks(note), ...kept];
    quote.truncated = false;
    quote.noteRecovered = true;
    return true;
  }

  function videoCandidatesFromCapturedBody(body, source = 'network') {
    const out = [];
    const seen = new Set();
    videoCandidatesFromJsonText(body, source).forEach((candidate) =>
      addVideoCandidate(out, seen, candidate)
    );
    videoCandidatesFromText(body, `${source}:text`).forEach((candidate) =>
      addVideoCandidate(out, seen, candidate)
    );
    return sortVideoCandidates(out);
  }

  function validateNetworkCapturePayload(payload) {
    if (!payload || typeof payload !== 'object' || payload.source !== `${APP}:network-capture`)
      return false;
    if (payload.contractVersion !== undefined && payload.contractVersion !== 1) return false;
    if (!['installed', 'response'].includes(payload.type)) return false;
    if (typeof payload.transport !== 'string' || payload.transport.length > 100) return false;
    if (payload.type === 'installed') return true;
    if (
      typeof payload.body !== 'string' ||
      payload.body.length > CONFIG.video.networkCaptureMaxChars
    )
      return false;
    if (typeof payload.url !== 'string' || payload.url.length > 4096) return false;
    return true;
  }

  function networkCaptureSignature(payload) {
    const body = payload.body || '';
    // GraphQL envelopes often have identical prefixes/suffixes and similar
    // lengths while differing in the middle. Hash the full bounded body so a
    // distinct quote/media response is never mistaken for a duplicate.
    let hash = 0x811c9dc5;
    for (let i = 0; i < body.length; i++) {
      hash ^= body.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `${payload.url}|${body.length}|${(hash >>> 0).toString(16)}`;
  }

  function handleNetworkCapturePayload(payload) {
    if (!validateNetworkCapturePayload(payload)) return [];
    networkCaptureDiagnostics.messages += 1;
    if (payload.type === 'installed') {
      networkCaptureDiagnostics.installed = true;
      networkCaptureDiagnostics.injectedInstalled = true;
      const extensionBridge = payload.transport === 'extension-main';
      if (extensionBridge && typeof payload.folderPickerAvailable === 'boolean') {
        extensionFolderPickerSupport = payload.folderPickerAvailable;
      }
      networkCaptureDiagnostics.mode = extensionBridge
        ? 'extension-main'
        : networkCaptureDiagnostics.directInstalled
          ? 'unsafeWindow+injected'
          : 'injected';
      return [];
    }
    const signature = networkCaptureSignature(payload);
    if (networkCapturePayloadSignatures.has(signature)) return [];
    networkCapturePayloadSignatures.add(signature);
    if (networkCapturePayloadSignatures.size > 200) {
      networkCapturePayloadSignatures.delete(networkCapturePayloadSignatures.values().next().value);
    }
    if (payload.type !== 'response') return [];
    networkCaptureDiagnostics.responsesSeen += 1;
    rememberNetworkCaptureUrl(payload.url || '');
    if (payload.truncated === true) {
      networkCaptureDiagnostics.truncatedResponses += 1;
      networkCaptureDiagnostics.lastTruncatedUrl = payload.url || '';
    }
    const source = `network:${payload.transport || 'unknown'}`;
    const candidates = videoCandidatesFromCapturedBody(payload.body || '', source);
    if (candidates.length) {
      networkCaptureDiagnostics.interestingResponses += 1;
      networkCaptureDiagnostics.candidates += candidates.length;
    }
    candidates.forEach((candidate) =>
      rememberNetworkVideoCandidate(candidate, {
        url: payload.url || '',
        transport: payload.transport || '',
      })
    );
    if (candidates.length) {
      log('captured video candidates from network response:', candidates.length, payload.url || '');
    }
    const notes = noteTweetsFromCapturedBody(payload.body || '');
    if (notes.length) {
      notes.forEach(rememberCapturedNoteTweet);
      log('captured full long-form text for', notes.length, 'post(s) from', payload.url || '');
    }
    const quotedRefs = quotedRefsFromCapturedBody(payload.body || '');
    if (quotedRefs.length) {
      quotedRefs.forEach(rememberCapturedQuotedRef);
      log('captured quoted-post refs for', quotedRefs.length, 'parent(s) from', payload.url || '');
    }
    return candidates;
  }

  function onNetworkCaptureMessage(event) {
    // Only accept messages this page posted to itself (the injected bridge targets
    // location.origin), and only our tagged payloads - not arbitrary postMessage traffic.
    if (!event || event.source !== window) return;
    if (event.origin && event.origin !== location.origin) return;
    const data = event.data;
    if (!validateNetworkCapturePayload(data)) return;
    handleNetworkCapturePayload(data);
  }

  function harvestVideoCandidatesNow() {
    document.querySelectorAll(CONFIG.selectors.videoPlayer.join(',')).forEach((vp) => {
      videoCandidatesFromPlayer(vp).forEach((candidate) =>
        rememberVideoCandidate(candidate, absY(vp))
      );
    });
    if (typeof performance !== 'undefined' && performance.getEntriesByType) {
      performance.getEntriesByType('resource').forEach((entry) => {
        const url = entry && entry.name;
        if (!url || !isInterestingVideoUrl(url)) return;
        const candidate = videoCandidate(url, 'performance');
        rememberVideoCandidate(candidate, 0);
      });
    }
    harvestPageScriptVideoCandidatesOnce();
  }

  function harvestPageScriptVideoCandidatesOnce() {
    if (pageScriptVideoCandidatesScanned) return;
    pageScriptVideoCandidatesScanned = true;
    videoCandidatesFromPageScripts().forEach((candidate) => rememberVideoCandidate(candidate, 0));
  }

  function videoCandidatesFromPageScripts() {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('script').forEach((script, index) => {
      const text = script.textContent || '';
      if (!isInterestingVideoUrl(text)) return;
      videoCandidatesFromText(text, `script:${index}`).forEach((candidate) =>
        addVideoCandidate(out, seen, candidate)
      );
      videoCandidatesFromJsonText(text, `script-json:${index}`).forEach((candidate) =>
        addVideoCandidate(out, seen, candidate)
      );
    });
    return sortVideoCandidates(out);
  }

  function addVideoCandidatesToBlock(block, candidates) {
    const seen = new Set((block.videoCandidates || []).map((candidate) => candidate.url));
    block.videoCandidates = block.videoCandidates || [];
    (candidates || []).forEach((candidate) => {
      if (!candidate || !candidate.url || seen.has(candidate.url)) return;
      seen.add(candidate.url);
      block.videoCandidates.push(candidate);
    });
    block.videoCandidates = sortVideoCandidates(block.videoCandidates);
    const mp4 = block.videoCandidates.find((candidate) => candidate.kind === 'mp4');
    if (mp4) block.mp4Url = mp4.url;
    block.discoverySources = block.videoCandidates
      .map((candidate) => candidate.source)
      .filter(Boolean);
  }

  function videoCandidateMatchesBlock(candidate, block) {
    if (!candidate || !block) return false;
    const candidatePosterKey = xVideoMediaKey(candidate.posterUrl);
    const blockPosterKey = xVideoMediaKey(block.posterUrl);
    if (candidatePosterKey && blockPosterKey && candidatePosterKey === blockPosterKey) return true;
    const candidateMediaKey = candidate.mediaKey && String(candidate.mediaKey);
    if (candidateMediaKey && blockPosterKey && candidateMediaKey.includes(blockPosterKey)) {
      return true;
    }
    return false;
  }

  function unambiguousVideoFallbackCandidate(candidates, unresolvedBlockCount) {
    if (unresolvedBlockCount !== 1) return null;
    const mp4s = sortVideoCandidates(candidates || []).filter(
      (candidate) => candidate.kind === 'mp4'
    );
    if (!mp4s.length) return null;
    const identities = new Set(
      mp4s.map(
        (candidate) =>
          String(candidate.mediaKey || '') || xVideoMediaKey(candidate.url) || candidate.url
      )
    );
    return identities.size === 1 ? mp4s[0] : null;
  }

  function enrichVideoCandidates(model) {
    const videos = [];
    const walk = (blocks) => {
      (blocks || []).forEach((block) => {
        if (block.kind === 'video') videos.push(block);
        else if (block.kind === 'quote' || block.kind === 'blockquote') walk(block.blocks);
      });
    };
    walk(model.blocks);
    const ordered = sortVideoCandidates(harvestedVideoCandidates);
    const used = new Set();
    videos.forEach((block) => {
      addVideoCandidatesToBlock(block, block.videoCandidates || []);
      const matched = ordered.filter(
        (candidate) => !used.has(candidate.url) && videoCandidateMatchesBlock(candidate, block)
      );
      if (matched.length) {
        addVideoCandidatesToBlock(block, matched);
        matched.forEach((candidate) => used.add(candidate.url));
      } else {
        // Never pair multiple posts/videos by array index: candidates are
        // bitrate-sorted, not DOM-ownership sorted, so that can put another
        // post's MP4 into this block. A keyless fallback is safe only when one
        // unresolved block and one logical media id remain.
        const remaining = ordered.filter((candidate) => !used.has(candidate.url));
        const unresolved = videos.filter((candidateBlock) => !candidateBlock.mp4Url).length;
        const fallback = block.mp4Url
          ? null
          : unambiguousVideoFallbackCandidate(remaining, unresolved);
        if (fallback) {
          addVideoCandidatesToBlock(block, [fallback]);
          remaining
            .filter(
              (candidate) =>
                (candidate.mediaKey || xVideoMediaKey(candidate.url)) ===
                (fallback.mediaKey || xVideoMediaKey(fallback.url))
            )
            .forEach((candidate) => used.add(candidate.url));
        }
      }
      if (!block.mp4Url) {
        const hls = (block.videoCandidates || []).find((candidate) => candidate.kind === 'hls');
        if (hls) block.hlsUrl = hls.url;
      }
    });
  }

  /** Harvested images belonging to a given tweet, not already placed. */
  function harvestedImagesForStatus(statusId) {
    const out = [];
    if (!statusId) return out;
    for (const item of harvestedMedia.values()) {
      if (item.ownerStatusId !== statusId || capturedImageUrls.has(item.url)) continue;
      capturedImageUrls.add(item.url);
      out.push({
        kind: 'image',
        url: item.url,
        alt: item.alt,
        width: item.width,
        height: item.height,
        sourceUrl: `https://x.com/i/status/${statusId}`,
      });
    }
    return out;
  }

  /**
   * Scroll the content container top-to-bottom, harvesting media at each step so
   * virtualized/lazy images are captured before they're recycled. Bounded to the
   * content (article/column) so it does not drag into the replies/comments.
   * Best-effort; never throws.
   */
  async function forceLoadMedia(container, onTick, { fromTop = false } = {}) {
    try {
      const scroller = document.scrollingElement || document.documentElement;
      if (!scroller) return;
      const restoreY = scroller.scrollTop;
      const startY = fromTop && container ? Math.max(0, absY(container) - 80) : restoreY;
      const viewport = window.innerHeight || 800;
      const step = Math.max(viewport * 0.8, 400);
      const docMax = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const limit = () => {
        if (!container) return docMax();
        const bottomAbs = absY(container) + container.getBoundingClientRect().height;
        return Math.max(0, Math.min(docMax(), bottomAbs - viewport + 200));
      };
      let y = startY;
      let guard = 0;
      const deadline = Date.now() + CONFIG.forceLoadMaxMs;
      if (fromTop) {
        scroller.scrollTo(0, startY);
        await sleep(150);
      }
      harvestMediaNow();
      while (y < limit() && guard < 800 && Date.now() < deadline) {
        scroller.scrollTo(0, y);
        await sleep(110);
        await nudgeVisibleVideoPlayers();
        harvestMediaNow();
        y += step;
        guard++;
        if (onTick) onTick(Math.min(99, Math.round((y / (limit() || 1)) * 100)));
      }
      if (Date.now() >= deadline) {
        warn(`forceLoadMedia timed out after ${CONFIG.forceLoadMaxMs}ms; continuing export`);
      }
      scroller.scrollTo(0, limit());
      await sleep(300);
      await nudgeVisibleVideoPlayers();
      const remainingMs = Math.max(0, deadline - Date.now());
      await waitForImagesToSettle(Math.min(CONFIG.forceLoadSettleMs, remainingMs));
      harvestMediaNow();
      scroller.scrollTo(0, restoreY);
      await sleep(150);
      harvestMediaNow();
      log('harvested media urls:', harvestedMedia.size);
    } catch (e) {
      warn('forceLoadMedia failed (continuing anyway):', e.message);
    }
  }

  /**
   * Load a single visible post's media without scrolling the page away from it. A full-page
   * forceLoad scroll can unmount the clicked post under X's virtualization, so per-post
   * exports use this lighter, in-place pass: center the post, nudge its video, let images
   * settle, harvest - all while the target node stays mounted.
   */
  async function loadMediaInPlace(tweetEl) {
    try {
      if (tweetEl && typeof tweetEl.scrollIntoView === 'function') {
        tweetEl.scrollIntoView({ block: 'center' });
        await sleep(150);
      }
      harvestMediaNow();
      await nudgeVisibleVideoPlayers();
      await waitForImagesToSettle(CONFIG.forceLoadSettleMs);
      harvestMediaNow();
    } catch (e) {
      warn('loadMediaInPlace failed (continuing anyway):', e.message);
    }
  }

  /** Wait until tweet-media images have finished loading, or until maxMs. */
  async function waitForImagesToSettle(maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const media = Array.from(document.images || []).filter((im) =>
        (im.currentSrc || im.src || '').includes('pbs.twimg.com/media/')
      );
      const pending = media.filter((im) => !im.complete || im.naturalWidth === 0);
      if (media.length && !pending.length) return;
      await sleep(150);
    }
  }

  async function nudgeVisibleVideoPlayers() {
    const viewport = window.innerHeight || 800;
    const players = pickAll(document, CONFIG.selectors.videoPlayer).filter((vp) => {
      const box = vp.getBoundingClientRect && vp.getBoundingClientRect();
      return box && box.bottom >= 0 && box.top <= viewport && !nudgedVideoPlayers.has(vp);
    });
    for (const vp of players.slice(0, 4)) {
      try {
        nudgedVideoPlayers.add(vp);
        vp.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        const video = vp.querySelector('video');
        if (video) {
          video.preload = 'auto';
          video.muted = true;
          if (video.load) video.load();
          if (video.play) {
            try {
              const result = await withTimeout(video.play(), CONFIG.videoNudgeTimeoutMs);
              if (result && result.timedOut) {
                warn(`video player nudge timed out after ${CONFIG.videoNudgeTimeoutMs}ms`);
              }
              video.pause();
            } catch {
              // Browser autoplay policy may block this; discovery continues via DOM/performance.
            }
          }
        }
      } catch {
        // Best-effort only.
      }
    }
  }

  // ===========================================================================
  // SYNDICATION - authoritative per-tweet content for embedded/quoted tweets
  // ---------------------------------------------------------------------------
  // X's public syndication endpoint returns a tweet's real text, author, and
  // media by id. Using it for embedded tweets sidesteps the whole DOM problem
  // (virtualization, duplicate cards, image misattribution) - each quote card
  // gets exactly its own content. Pure transforms (syndicationToQuoteBlock,
  // syndicationToken) are unit-tested; the network call falls back to the
  // DOM-extracted quote on any failure.
  // ===========================================================================

  /** Token X expects on the tweet-result endpoint, derived from the id. */
  function syndicationToken(id) {
    return ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, '');
  }

  // Successful syndication payloads for the current export run. Several layers
  // ask for the same status id (pool recovery, quote/thread/focused enrichment,
  // reply context); one network fetch serves them all. Failures are NOT cached,
  // so the repair round and the modal retry always get a fresh attempt.
  const syndicationSuccessCache = new Map();

  function fetchTweetSyndicationOnce(id) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest unavailable'));
        return;
      }
      const url =
        'https://cdn.syndication.twimg.com/tweet-result?id=' +
        encodeURIComponent(id) +
        '&lang=en&token=' +
        encodeURIComponent(syndicationToken(id));
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'text',
        timeout: CONFIG.fetchTimeoutMs,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            try {
              resolve(JSON.parse(res.responseText));
            } catch {
              reject(new Error('syndication: bad JSON'));
            }
          } else {
            const error = new Error('syndication: HTTP ' + res.status);
            error.status = res.status;
            reject(error);
          }
        },
        onerror: () => reject(new Error('syndication: network error')),
        ontimeout: () => reject(new Error('syndication: timeout')),
      });
    });
  }

  /**
   * Retrying wrapper - EVERY quote-recovery and thread-media layer depends on
   * this endpoint, so a transient failure here used to silently degrade a quote
   * card to whatever the DOM scrape produced (often nothing). 404 is
   * authoritative (deleted/protected post): retrying cannot succeed, stop early.
   */
  async function fetchTweetSyndication(id) {
    const key = String(id);
    if (syndicationSuccessCache.has(key)) return syndicationSuccessCache.get(key);
    const attempts = Math.max(1, Number(CONFIG.syndicationFetchRetries) || 1);
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await fetchTweetSyndicationOnce(id);
        syndicationSuccessCache.set(key, result);
        return result;
      } catch (error) {
        lastError = error;
        if (error.status === 404) break;
        if (attempt < attempts) {
          const factor = error.status === 429 ? CONFIG.rateLimitBackoffFactor : 1;
          await sleep(CONFIG.syndicationFetchRetryBaseMs * attempt * factor);
        }
      }
    }
    throw lastError || new Error(`syndication fetch failed for ${id}`);
  }

  function syndicationAvatar(user) {
    const u = (user && user.profile_image_url_https) || '';
    return u ? highResImageUrl(u.replace(/_normal\./, '_400x400.')) : '';
  }

  /** Build a paragraph HTML string from syndication text + entities. */
  function syndicationTextHtml(t) {
    let text = t.text || '';
    const ents = t.entities || {};
    // Drop the trailing t.co links that just point at the tweet's own media.
    (ents.media || []).forEach((m) => {
      if (m.url) text = text.split(m.url).join('');
    });
    text = text.trim();
    let html = escapeHtml(decodeBasicEntities(text));
    // Linkify t.co urls to their human-readable expanded form.
    (ents.urls || []).forEach((u) => {
      if (!u.url) return;
      const dest = safeUrl(u.expanded_url || u.url);
      const label = escapeHtml(u.display_url || u.expanded_url || u.url);
      const link = dest ? `<a href="${escapeHtml(dest)}">${label}</a>` : label;
      html = html.split(escapeHtml(u.url)).join(link);
    });
    return html;
  }

  function syndicationMediaBlocks(t, sourceUrl) {
    const blocks = [];
    const details = t.mediaDetails || (t.photos || []).map((p) => ({ type: 'photo', ...p }));
    details.forEach((m) => {
      if (m.type === 'photo' && (m.media_url_https || m.url)) {
        blocks.push({
          kind: 'image',
          url: highResImageUrl(m.media_url_https || m.url),
          alt: m.ext_alt_text || '',
          width: (m.original_info && m.original_info.width) || m.width,
          height: (m.original_info && m.original_info.height) || m.height,
          sourceUrl,
        });
      } else if (m.type === 'video' || m.type === 'animated_gif') {
        const variants = ((m.video_info && m.video_info.variants) || []).filter(
          (v) => v.content_type === 'video/mp4' && v.url
        );
        // Highest bitrate first; fallback is allowed only after preservation attempts fail.
        variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        const mp4Url = variants.length ? variants[0].url : '';
        const encodedDimensions = videoDimensionsFromUrl(mp4Url);
        blocks.push({
          kind: 'video',
          posterUrl: m.media_url_https ? highResImageUrl(m.media_url_https) : '',
          mp4Url,
          videoCandidates: variants
            .map((variant) =>
              videoCandidate(variant.url, 'syndication:variant', {
                bitrate: variant.bitrate,
                contentType: variant.content_type,
              })
            )
            .filter(Boolean),
          discoverySources: ['syndication:variant'],
          width: encodedDimensions.width || (m.original_info && m.original_info.width) || m.width,
          height:
            encodedDimensions.height || (m.original_info && m.original_info.height) || m.height,
          duration:
            m.video_info && Number(m.video_info.duration_millis) > 0
              ? Number(m.video_info.duration_millis) / 1000
              : undefined,
          sourceUrl,
        });
      }
    });
    return blocks;
  }

  function syndicationLinkBlocks(t, sourceUrl) {
    const blocks = [];
    const seen = new Set();
    const urls = (t && t.entities && t.entities.urls) || [];
    urls.forEach((entity) => {
      const expanded = safeUrl(entity && (entity.expanded_url || entity.url));
      if (!expanded || isStatusPermalink(expanded) || seen.has(expanded)) return;
      seen.add(expanded);
      blocks.push({
        kind: 'link-card',
        url: expanded,
        shortUrl: safeUrl(entity.url),
        title: entity.display_url || '',
        domain: urlHostname(expanded),
        sourceUrl,
      });
    });
    return blocks;
  }

  /** Turn a syndication tweet object into a `quote` model block. */
  function syndicationToQuoteBlock(t) {
    const user = t.user || {};
    const sourceUrl = user.screen_name
      ? `https://x.com/${user.screen_name}/status/${t.id_str || ''}`
      : '';
    const blocks = [];
    const html = syndicationTextHtml(t);
    if (html) blocks.push({ kind: 'paragraph', html });
    syndicationMediaBlocks(t, sourceUrl).forEach((b) => blocks.push(b));
    syndicationLinkBlocks(t, sourceUrl).forEach((b) => blocks.push(b));
    if (t.quoted_tweet) blocks.push(syndicationToQuoteBlock(t.quoted_tweet));
    return {
      kind: 'quote',
      author: {
        name: user.name || '',
        handle: user.screen_name ? '@' + user.screen_name : '',
        avatarUrl: syndicationAvatar(user),
      },
      blocks,
      sourceUrl,
      publishedAt: safeIsoTime(t.created_at || t.createdAt || ''),
      // A `note_tweet` reference means this is a long-form post whose full text X's public
      // syndication endpoint does NOT return - we only have the preview in `text`. This is a
      // definitive truncation signal (not a guess), so mark it for honest reporting.
      truncated: !!t.note_tweet,
    };
  }

  /**
   * Syndication is authoritative for text/media but omits some UI-backed post
   * types (notably polls and rich card metadata). Keep those DOM blocks while
   * upgrading everything syndication did provide. Nested quote trees are
   * merged recursively so a poll inside a quote of a quote does not disappear.
   */
  function mergeQuoteAfterSyndication(existing, fresh) {
    if (!existing || !fresh) return fresh;
    const oldBlocks = existing.blocks || [];
    const nextBlocks = (fresh.blocks || []).slice();
    const extras = [];

    oldBlocks
      .filter((block) => block.kind === 'link-card')
      .forEach((oldCard) => {
        const match = nextBlocks.find(
          (block) => block.kind === 'link-card' && [block.url, block.shortUrl].includes(oldCard.url)
        );
        if (!match) {
          extras.push(oldCard);
          return;
        }
        // Keep the expanded syndication URL, but the DOM often has the richer
        // title and thumbnail that the public payload omits.
        if (oldCard.title) match.title = oldCard.title;
        if (oldCard.domain) match.domain = oldCard.domain;
        if (oldCard.imageUrl) match.imageUrl = oldCard.imageUrl;
        if (oldCard.imageDataUri) match.imageDataUri = oldCard.imageDataUri;
      });

    oldBlocks
      .filter((block) => block.kind === 'poll')
      .forEach((poll) => {
        if (!nextBlocks.some((block) => block.kind === 'poll')) extras.push(poll);
      });

    const oldQuotes = oldBlocks.filter((block) => block.kind === 'quote');
    const freshQuotes = nextBlocks.filter((block) => block.kind === 'quote');
    freshQuotes.forEach((freshQuote, index) => {
      const freshId = statusIdFromUrl(freshQuote.sourceUrl);
      const oldQuote =
        oldQuotes.find(
          (candidate) => freshId && statusIdFromUrl(candidate.sourceUrl) === freshId
        ) || oldQuotes[index];
      if (oldQuote) mergeQuoteAfterSyndication(oldQuote, freshQuote);
    });

    if (extras.length) {
      const nestedAt = nextBlocks.findIndex((block) => block.kind === 'quote');
      nextBlocks.splice(nestedAt < 0 ? nextBlocks.length : nestedAt, 0, ...extras);
    }
    fresh.blocks = nextBlocks;
    return fresh;
  }

  function normalizedPostText(value) {
    return decodeBasicEntities(String(value || ''))
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function quoteTextForMatching(quote) {
    const paragraphs = (quote.blocks || [])
      .filter((block) => block.kind === 'paragraph')
      .map((block) => textFromHtml(block.html));
    return normalizedPostText(paragraphs.join(' '));
  }

  function syndicationRelationCandidates(tweet) {
    const candidates = [];
    const legacy = (tweet && tweet.legacy) || tweet || {};
    const add = ({ id, handle, text, relation }) => {
      const statusId = String(id || '');
      if (!/^\d+$/.test(statusId)) return;
      candidates.push({
        id: statusId,
        handle: String(handle || '').replace(/^@/, ''),
        text: normalizedPostText(text),
        relation,
      });
    };
    const quoted = tweet && tweet.quoted_tweet;
    if (quoted) {
      add({
        id: quoted.id_str || quoted.rest_id || (quoted.legacy && quoted.legacy.id_str),
        handle:
          (quoted.user && quoted.user.screen_name) ||
          (quoted.core &&
            quoted.core.user_results &&
            quoted.core.user_results.result &&
            quoted.core.user_results.result.legacy &&
            quoted.core.user_results.result.legacy.screen_name),
        text: quoted.text || (quoted.legacy && quoted.legacy.full_text),
        relation: 'quote',
      });
    }
    add({
      id:
        legacy.in_reply_to_status_id_str ||
        legacy.in_reply_to_status_id ||
        (tweet && tweet.in_reply_to_status_id_str),
      handle: legacy.in_reply_to_screen_name || (tweet && tweet.in_reply_to_screen_name) || '',
      text: '',
      relation: 'reply',
    });
    return candidates;
  }

  function relationMatchesQuote(candidate, quote, candidateCount, missingQuoteCount) {
    const quoteHandle = String((quote.author && quote.author.handle) || '')
      .replace(/^@/, '')
      .toLowerCase();
    const candidateHandle = candidate.handle.toLowerCase();
    if (quoteHandle && candidateHandle) return quoteHandle === candidateHandle;
    const quoteText = quoteTextForMatching(quote);
    if (quoteText && candidate.text) {
      const sample = quoteText.slice(0, Math.min(120, quoteText.length));
      return (
        candidate.text.startsWith(sample) || quoteText.startsWith(candidate.text.slice(0, 120))
      );
    }
    return candidateCount === 1 && missingQuoteCount === 1;
  }

  /**
   * Free, offline recovery pass: for each thread post (or the main post), pair up
   * any embedded quote block whose sourceUrl went missing with the quoted-tweet ref
   * X's own web app already delivered to this browser (harvested passively into
   * `capturedQuotedRefs` from GraphQL responses).
   *
   * Runs BEFORE the syndication-based recovery so we skip network calls entirely
   * when the ids are already in hand. Returns the count of quotes patched, for
   * diagnostics/tests.
   *
   * `lookup` is DI'd for tests; production defaults to the module-scoped map.
   */
  function recoverMissingQuoteSourcesFromCapture(model, lookup = getCapturedQuotedRef) {
    if (!model || !Array.isArray(model.blocks)) return 0;
    // Group blocks by which parent post they belong to. In a thread export the
    // segments are delimited by 'thread-marker' entries; in a single-post export
    // everything belongs to the main post (model.sourceUrl).
    const segments = [];
    let currentParent = statusIdFromUrl(model.sourceUrl);
    let bucket = [];
    model.blocks.forEach((block) => {
      if (block.kind === 'thread-marker') {
        if (bucket.length) segments.push({ parentId: currentParent, blocks: bucket });
        currentParent = block.statusId || '';
        bucket = [];
        return;
      }
      bucket.push(block);
    });
    if (bucket.length) segments.push({ parentId: currentParent, blocks: bucket });

    let patched = 0;
    for (const segment of segments) {
      if (!segment.parentId) continue;
      const ref = lookup(segment.parentId);
      if (!ref || !ref.quotedId || !ref.quotedHandle) continue;
      // A post can only quote a single tweet, so at most one quote in the segment
      // is missing its source. If more than one is unresolved (unusual: nested
      // quotes rebuilt from syndication both losing anchors), only patch the one
      // whose author handle matches; otherwise fall back to the first.
      const missing = segment.blocks.filter(
        (b) => b.kind === 'quote' && !statusIdFromUrl(b.sourceUrl)
      );
      if (!missing.length) continue;
      const handleMatch = missing.find((b) => {
        const h = String((b.author && b.author.handle) || '')
          .replace(/^@/, '')
          .toLowerCase();
        return h && h === ref.quotedHandle.toLowerCase();
      });
      const target = handleMatch || (missing.length === 1 ? missing[0] : null);
      if (!target) continue;
      target.sourceUrl = `https://x.com/${ref.quotedHandle}/status/${ref.quotedId}`;
      patched += 1;
    }
    return patched;
  }

  async function recoverMissingQuoteSourcesViaSyndication(
    model,
    onProgress,
    fetchTweet = fetchTweetSyndication
  ) {
    const missingQuotes = directQuotes(model.blocks).filter(
      (quote) => !statusIdFromUrl(quote.sourceUrl)
    );
    if (!missingQuotes.length) return model;
    const statusIds = new Set([statusIdFromUrl(model.sourceUrl)]);
    (model.blocks || []).forEach((block) => {
      if (block.kind === 'thread-marker' && block.statusId) statusIds.add(block.statusId);
    });
    statusIds.delete('');
    const candidates = [];
    let done = 0;
    onProgress && onProgress(0, statusIds.size);
    for (const statusId of statusIds) {
      try {
        const data = await fetchTweet(statusId);
        syndicationRelationCandidates(data).forEach((candidate) => candidates.push(candidate));
      } catch (error) {
        warn('embedded-post source recovery failed for', statusId, '-', error.message);
      }
      done += 1;
      onProgress && onProgress(done, statusIds.size);
    }
    const unused = new Set(candidates);
    missingQuotes.forEach((quote) => {
      const matches = Array.from(unused).filter((candidate) =>
        relationMatchesQuote(candidate, quote, candidates.length, missingQuotes.length)
      );
      if (matches.length !== 1) return;
      const candidate = matches[0];
      const handle =
        candidate.handle || String((quote.author && quote.author.handle) || '').replace(/^@/, '');
      if (!handle) return;
      quote.sourceUrl = `https://x.com/${handle}/status/${candidate.id}`;
      quote.relation = candidate.relation;
      unused.delete(candidate);
    });
    return model;
  }

  /**
   * Replace each top-level quote block's content with authoritative syndication
   * data (by status id). On any failure the original DOM-extracted quote is kept.
   */
  async function enrichQuotesViaSyndication(model, onProgress) {
    const quotes = model.blocks.filter((b) => b.kind === 'quote' && b.sourceUrl);
    let done = 0;
    onProgress && onProgress(0, quotes.length);
    for (const q of quotes) {
      const id = statusIdFromUrl(q.sourceUrl);
      if (id) {
        try {
          const data = await fetchTweetSyndication(id);
          if (data && data.user && (data.__typename === 'Tweet' || data.text != null)) {
            const fresh = mergeQuoteAfterSyndication(q, syndicationToQuoteBlock(data));
            q.author = fresh.author;
            q.blocks = fresh.blocks;
            // Only adopt the rebuilt permalink when it is canonical; a payload
            // missing id_str yields "https://x.com/<user>/status/" (dead link).
            if (statusIdFromUrl(fresh.sourceUrl)) q.sourceUrl = fresh.sourceUrl;
            q.truncated = fresh.truncated;
            // Long-form quote: syndication only has the preview, but the network capture
            // may hold the full text X's web app already delivered to this browser.
            if (q.truncated) recoverQuoteNoteText(q, getCapturedNoteTweet(id));
          }
        } catch (e) {
          warn('syndication enrich failed for', id, '-', e.message);
        }
      }
      done++;
      onProgress && onProgress(done, quotes.length);
    }
    // Collapse any duplicates that now share the same canonical source url.
    model.blocks = dedupeQuoteCards(model.blocks);
    return model;
  }

  /** Canonical identity for an X media URL, tolerant of format/size/extension variants
   *  (DOM src `.../media/XXX?format=jpg&name=small` and syndication `.../media/XXX.jpg`
   *  are the same asset). */
  function mediaKeyFromUrl(url) {
    const value = String(url || '');
    let match = value.match(/\/media\/([A-Za-z0-9_-]+)/);
    if (match) return `media:${match[1]}`;
    match = value.match(/\/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/(\d+)\//);
    if (match) return `video:${match[1]}`;
    return '';
  }

  function blockMediaKey(block) {
    if (!block) return '';
    if (block.kind === 'image') return mediaKeyFromUrl(block.url);
    if (block.kind === 'video') return mediaKeyFromUrl(block.posterUrl || block.mp4Url);
    return '';
  }

  function urlHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  /** True for x.com / twitter.com status permalinks (post references, not external links). */
  function isStatusPermalink(url) {
    return /^https?:\/\/(?:mobile\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/i.test(
      String(url || '')
    );
  }

  /**
   * Apply one post's syndication payload to its slice of the model: the blocks
   * between `index` (the post's thread-marker, or -1 for a focused single post)
   * and `end`, exclusive. Shared by the thread pass and the focused-post pass.
   * Mutates model.blocks; returns { recovered, truncatedPost, recoveredNote }.
   */
  function applySyndicationDataToSegment(model, marker, index, end, data, lookupNote) {
    const segment = model.blocks.slice(index + 1, end);
    const additions = [];
    let recoveredNote = false;
    let truncatedPost = false;
    let recoveredQuote = false;

    // Position-based quote-source recovery: this post's own syndication response
    // is the definitive source for its (single) quoted-tweet id. If any quote in
    // the segment still has an empty sourceUrl at this point (both the capture
    // recovery and the pool-based syndication recovery missed it), fix it now
    // AND rebuild the card from the quoted_tweet payload we already have -
    // saves a per-quote syndication round-trip and closes the "dead source link"
    // path entirely.
    const qt = data && data.quoted_tweet;
    if (qt && qt.id_str && qt.user && qt.user.screen_name) {
      const qHandle = String(qt.user.screen_name).toLowerCase();
      const missingInSegment = segment.filter(
        (b) => b.kind === 'quote' && !statusIdFromUrl(b.sourceUrl)
      );
      const target =
        missingInSegment.find((b) => {
          const h = String((b.author && b.author.handle) || '')
            .replace(/^@/, '')
            .toLowerCase();
          return h && h === qHandle;
        }) || (missingInSegment.length === 1 ? missingInSegment[0] : null);
      if (target) {
        const fresh = mergeQuoteAfterSyndication(target, syndicationToQuoteBlock(qt));
        target.sourceUrl =
          fresh.sourceUrl || `https://x.com/${qt.user.screen_name}/status/${qt.id_str}`;
        if (fresh.blocks && fresh.blocks.length) {
          target.author = fresh.author;
          target.blocks = fresh.blocks;
          target.truncated = fresh.truncated;
          target.publishedAt = fresh.publishedAt || target.publishedAt;
          if (target.truncated) {
            recoverQuoteNoteText(target, lookupNote(qt.id_str));
          }
        }
      } else if (!segment.some((b) => b.kind === 'quote')) {
        // The quote card itself never mounted (lazy loading / virtualization),
        // so there is no DOM block for the strict gate to flag. The parent
        // payload is authoritative: rebuild the missing quote in full.
        const fresh = syndicationToQuoteBlock(qt);
        if (fresh.truncated) recoverQuoteNoteText(fresh, lookupNote(qt.id_str));
        additions.push(fresh);
        recoveredQuote = true;
      }
    }

    const have = new Set(segment.map(blockMediaKey));
    // A video block whose player was still booting at capture time has no
    // poster or mp4 yet - no media key. Heal that block with the syndication
    // data instead of adding a twin and shipping a dead "Video unavailable"
    // card next to the working one. Only safe when the target is unambiguous.
    const keylessVideos = segment.filter((b) => b.kind === 'video' && !blockMediaKey(b));
    let merged = 0;
    syndicationMediaBlocks(data, marker.sourceUrl).forEach((candidate) => {
      const key = blockMediaKey(candidate);
      if (!key || have.has(key)) return;
      if (candidate.kind === 'video' && keylessVideos.length === 1) {
        const target = keylessVideos.pop();
        target.posterUrl = target.posterUrl || candidate.posterUrl;
        target.mp4Url = target.mp4Url || candidate.mp4Url;
        addVideoCandidatesToBlock(target, candidate.videoCandidates || []);
        if (!target.width) target.width = candidate.width;
        if (!target.height) target.height = candidate.height;
        if (!target.duration) target.duration = candidate.duration;
        have.add(key);
        merged += 1;
        return;
      }
      additions.push(candidate);
    });
    const recovered =
      additions.filter((block) => ['image', 'video'].includes(block.kind)).length + merged;

    // External links: X strips a card's URL from the visible text, so a
    // lazily-lost card means the link exists ONLY in entities.urls.
    const segmentHrefs = new Set();
    segment.forEach((b) => {
      if (b.kind === 'paragraph') hrefsFromHtml(b.html).forEach((h) => segmentHrefs.add(h));
      else if (b.kind === 'link-card' && b.url) segmentHrefs.add(b.url);
    });
    (data.entities && data.entities.urls ? data.entities.urls : []).forEach((u) => {
      const expanded = safeUrl(u.expanded_url || u.url);
      if (!expanded || isStatusPermalink(expanded)) return;
      const card = segment.find(
        (b) => b.kind === 'link-card' && (b.url === u.url || b.url === expanded)
      );
      if (card) {
        // Upgrade a DOM-captured card that kept the opaque t.co form.
        card.url = expanded;
        if (!card.domain) card.domain = urlHostname(expanded);
        if (!card.title && u.display_url) card.title = u.display_url;
        return;
      }
      if (segmentHrefs.has(expanded) || (u.url && segmentHrefs.has(u.url))) return;
      additions.push({
        kind: 'link-card',
        url: expanded,
        title: u.display_url || '',
        domain: urlHostname(expanded),
        sourceUrl: marker.sourceUrl,
      });
    });

    // Long-form (note) post: syndication only ever has the preview text, but the
    // network capture may hold the full text X's own web app already downloaded.
    let segEnd = end;
    if (data.note_tweet) {
      const note = lookupNote(marker.statusId);
      const fullText = note && note.text ? note.text.trim() : '';
      const previewText = segment
        .filter((b) => b.kind === 'paragraph')
        .map((b) => textFromHtml(b.html))
        .join('\n')
        .trim();
      if (fullText && fullText.length > previewText.length) {
        // Swap the preview paragraphs (and any stale truncation notice) for the
        // full text; media/link-card blocks in the segment are kept as-is.
        for (let j = segEnd - 1; j > index; j--) {
          const kind = model.blocks[j].kind;
          if (kind === 'paragraph' || kind === 'truncation-notice') {
            model.blocks.splice(j, 1);
            segEnd--;
          }
        }
        const paragraphs = noteTweetParagraphBlocks(note);
        model.blocks.splice(index + 1, 0, ...paragraphs);
        segEnd += paragraphs.length;
        additions.push({ kind: 'note-recovered', sourceUrl: marker.sourceUrl });
        recoveredNote = true;
      } else if (fullText && previewText.length >= fullText.length) {
        // The DOM already showed the complete note text - nothing to warn about.
      } else if (!segment.some((b) => b.kind === 'truncation-notice')) {
        additions.push({ kind: 'truncation-notice', sourceUrl: marker.sourceUrl });
        truncatedPost = true;
      }
    }

    if (additions.length) {
      // Keep a DOM-detected truncation notice as the segment's last word.
      let insertAt = segEnd;
      while (insertAt > index + 1 && model.blocks[insertAt - 1].kind === 'truncation-notice') {
        insertAt--;
      }
      model.blocks.splice(insertAt, 0, ...additions);
    }
    return { recovered, recoveredQuote, truncatedPost, recoveredNote };
  }

  /**
   * Thread capture races X's lazy loading: a post cloned before its image ever
   * loaded has no media in the DOM at all, so the miss is invisible to the
   * accounting (a real 36-post thread silently lost 7 of 27 photos this way).
   * Recover by asking the syndication endpoint - the same authoritative source
   * quote cards use - for each captured post's: media the DOM missed, external
   * links (upgrading t.co card hrefs to their expanded URLs), and the note_tweet
   * long-form signal, which gets an honest truncation notice. Must run before
   * inlineMedia so recovered blocks are downloaded and counted like any other
   * media. Per-post failures keep the DOM capture as-is.
   */
  async function enrichThreadViaSyndication(
    model,
    onProgress,
    fetchTweet = fetchTweetSyndication,
    lookupNote = getCapturedNoteTweet
  ) {
    const markers = [];
    model.blocks.forEach((block, index) => {
      if (block.kind === 'thread-marker' && block.statusId) markers.push({ block, index });
    });
    if (!markers.length) return model;
    let done = 0;
    let recovered = 0;
    let truncatedPosts = 0;
    let recoveredNotes = 0;
    let recoveredQuotes = 0;
    onProgress && onProgress(0, markers.length);
    // Walk backwards so insertions never shift the indices of unprocessed segments.
    for (let i = markers.length - 1; i >= 0; i--) {
      const { block: marker, index } = markers[i];
      const end = i + 1 < markers.length ? markers[i + 1].index : model.blocks.length;
      try {
        const data = await fetchTweet(marker.statusId);
        if (data && (data.__typename === 'Tweet' || data.text != null)) {
          const applied = applySyndicationDataToSegment(
            model,
            marker,
            index,
            end,
            data,
            lookupNote
          );
          recovered += applied.recovered;
          if (applied.truncatedPost) truncatedPosts++;
          if (applied.recoveredNote) recoveredNotes++;
          if (applied.recoveredQuote) recoveredQuotes++;
        }
      } catch (e) {
        warn('thread syndication check failed for post', marker.statusId, '-', e.message);
      }
      done++;
      onProgress && onProgress(done, markers.length);
    }
    if (model.thread) {
      // Count DOM-detected notices too, not only the ones this pass added.
      const totalTruncated = model.blocks.filter((b) => b.kind === 'truncation-notice').length;
      if (recovered) model.thread.mediaRecovered = recovered;
      if (totalTruncated) model.thread.truncatedPosts = totalTruncated;
      if (recoveredNotes) model.thread.recoveredNotes = recoveredNotes;
      if (recoveredQuotes) model.thread.quotesRecovered = recoveredQuotes;
      if (recovered || recoveredQuotes || truncatedPosts || recoveredNotes) {
        log(
          `syndication pass: recovered ${recovered} media item(s), ${recoveredQuotes} quote card(s), full text for ${recoveredNotes} long-form post(s), flagged ${truncatedPosts} as preview-only`
        );
      }
    }
    return model;
  }

  /**
   * Single-post counterpart of enrichThreadViaSyndication. A focused post whose
   * image never lazy-loaded has NO media block in the model at all, so the miss
   * is invisible even to the strict export gate - this pass asks syndication for
   * the post's authoritative media/links/note signal and adds anything the DOM
   * missed, exactly like the per-post checks inside a thread export. Articles
   * are skipped (their body has no tweet syndication payload); failures keep
   * the DOM capture as-is.
   */
  async function enrichFocusedPostViaSyndication(
    model,
    onProgress,
    fetchTweet = fetchTweetSyndication,
    lookupNote = getCapturedNoteTweet
  ) {
    if (!model || model.thread || model.type !== 'post') return model;
    if ((model.blocks || []).some((b) => b.kind === 'thread-marker')) return model;
    const statusId = statusIdFromUrl(model.sourceUrl);
    if (!statusId) return model;
    onProgress && onProgress(0, 1);
    try {
      const data = await fetchTweet(statusId);
      if (data && (data.__typename === 'Tweet' || data.text != null)) {
        const applied = applySyndicationDataToSegment(
          model,
          { statusId, sourceUrl: model.sourceUrl },
          -1,
          model.blocks.length,
          data,
          lookupNote
        );
        if (applied.recovered || applied.recoveredQuote) {
          log(
            `post syndication pass: recovered ${applied.recovered} media/link item(s) and ${applied.recoveredQuote ? 1 : 0} quote card(s) the DOM missed`
          );
        }
      }
    } catch (e) {
      warn('post syndication check failed for', statusId, '-', e.message);
    }
    onProgress && onProgress(1, 1);
    return model;
  }

  /**
   * If the exported post is a reply, prepend the post it replies to as a
   * labelled "In reply to" context card - a reply archived alone often loses
   * its meaning. Applies to the model's ROOT post only (thread continuations
   * reply to their own previous posts, which the thread capture already holds).
   * A parent that is gone on X gets an honest reply-context tombstone note,
   * never a strict-gate blocker. Controlled by the `replyContext` pref
   * (default on); the root fetch is served from the per-export syndication
   * cache, so this usually costs one extra request (the parent) at most.
   */
  async function enrichReplyContextViaSyndication(
    model,
    onProgress,
    fetchTweet = fetchTweetSyndication
  ) {
    if (!model || model.type !== 'post' || !Array.isArray(model.blocks)) return model;
    if (
      model.blocks.some(
        (b) => (b.kind === 'quote' || b.kind === 'quote-tombstone') && b.replyContext
      )
    ) {
      return model;
    }
    const rootId = statusIdFromUrl(model.sourceUrl);
    if (!rootId) return model;
    onProgress && onProgress(0, 1);
    try {
      const data = await fetchTweet(rootId);
      const inlineParent = data && data.parent && data.parent.id_str ? data.parent : null;
      const parentId =
        (data && data.in_reply_to_status_id_str) || (inlineParent && inlineParent.id_str) || '';
      if (!parentId) return model;
      // A same-author thread export may already contain the parent as a
      // captured post - prepending it again would duplicate content.
      const capturedIds = new Set(
        model.blocks.filter((b) => b.kind === 'thread-marker').map((b) => b.statusId)
      );
      if (capturedIds.has(parentId)) return model;
      const parentHandle =
        (data && data.in_reply_to_screen_name) ||
        (inlineParent && inlineParent.user && inlineParent.user.screen_name) ||
        '';
      let parentData = null;
      try {
        // Full fetch first: the inline `parent` payload is a slimmer shape that
        // can lack media; fall back to it only when the id fetch fails.
        parentData = await fetchTweet(parentId);
      } catch (e) {
        warn('reply-context parent fetch failed for', parentId, '-', e.message);
        parentData = inlineParent;
      }
      if (
        parentData &&
        parentData.user &&
        (parentData.__typename === 'Tweet' || parentData.text != null)
      ) {
        const card = syndicationToQuoteBlock(parentData);
        card.replyContext = true;
        if (!statusIdFromUrl(card.sourceUrl) && parentHandle) {
          card.sourceUrl = `https://x.com/${parentHandle}/status/${parentId}`;
        }
        if (card.truncated) recoverQuoteNoteText(card, getCapturedNoteTweet(parentId));
        model.blocks.unshift(card);
        log('reply context: prepended parent post', parentId);
      } else {
        // We KNOW it is a reply (X said so), but the parent is gone on X.
        model.blocks.unshift({
          kind: 'quote-tombstone',
          replyContext: true,
          notice: parentHandle
            ? `This post replies to a post by @${parentHandle} that is no longer available on X.`
            : 'This post replies to a post that is no longer available on X.',
          sourceUrl: model.sourceUrl,
        });
      }
    } catch (e) {
      warn('reply-context check failed for', rootId, '-', e.message);
    }
    onProgress && onProgress(1, 1);
    return model;
  }

  // The export choices offered by every Export control, grouped: save variants,
  // then share/clipboard, then loose file downloads. The primary trigger button
  // already quick-saves, so the menu holds only the variants - and the single
  // "HTML + Markdown" download covers the removed HTML-only/Markdown-only modes
  // (the engine still supports the 'html' and 'md' keys).
  const EXPORT_TYPES = [
    { key: 'library', label: 'Save to library' },
    { key: 'library-note', label: 'Save with note / tags' },
    { divider: true },
    { key: 'copy', label: 'Copy clean Markdown' },
    { key: 'share', label: 'Create AI readable link' },
    { key: 'library-share', label: 'Save locally + create AI link' },
    { divider: true },
    { key: 'both', label: 'Download ZIP (HTML + Markdown)' },
  ];
  const POST_EXPORT_TYPES = [
    { key: 'library-note', label: 'Save with note / tags' },
    { divider: true },
    { key: 'copy', label: 'Copy Markdown' },
    { key: 'share', label: 'Create AI readable link' },
    { key: 'library-share', label: 'Save locally + create AI link' },
    { divider: true },
    { key: 'both', label: 'Download ZIP (HTML + Markdown)' },
  ];
  const THREAD_EXPORT_TYPES = [
    { key: 'library-thread', label: 'Save full thread' },
    { divider: true },
    ...POST_EXPORT_TYPES,
  ];

  function postExportRequest(exportType) {
    return {
      exportType: exportType === 'library-thread' ? 'library' : exportType,
      includeThread: exportType === 'library-thread',
    };
  }

  function hasOwnTweetText(tweetEl) {
    const quoteEls = findQuotedTweetEls(tweetEl);
    const textEls = pickAllMatchesIncludingRoot(tweetEl, CONFIG.selectors.tweetText);
    return textEls.some((textEl) => {
      if (quoteEls.some((quoteEl) => quoteEl.contains(textEl))) return false;
      return (
        String(textEl.textContent || '')
          .replace(/\s+/g, ' ')
          .trim().length > 0
      );
    });
  }

  function timelineArticlePreviewReason(tweetEl, { includeThread = false } = {}) {
    if (!tweetEl || detectPageType()) return '';
    if (includeThread) return 'Full-thread capture needs the opened post page.';
    if (
      pick(tweetEl, CONFIG.selectors.articleRoot, { quiet: true }) ||
      pick(tweetEl, CONFIG.selectors.articleTextRoot, { quiet: true }) ||
      pick(tweetEl, CONFIG.selectors.articleTitle, { quiet: true })
    ) {
      return 'This timeline card is an Article preview, not the full Article body.';
    }
    const articleLink = Array.from(tweetEl.querySelectorAll('a[href]')).some((a) =>
      /\/(?:i\/)?article\//.test(a.getAttribute('href') || '')
    );
    if (articleLink) return 'This timeline card links to an Article preview.';
    if (!hasOwnTweetText(tweetEl)) {
      return 'This timeline card does not expose the post text or Article body.';
    }
    return '';
  }

  function showOpenPostFirstNotice(tweetEl, reason) {
    const url = safeUrl(canonicalUrl(tweetEl, tweetStatusId(tweetEl)));
    const message = `${reason} Open the post first, then use SourceCapsule there so the export can capture the full article/thread content.`;
    showToast(message, { error: true, sticky: true });
    if (url && window.confirm(`${message}\n\nOpen the post now?`)) {
      location.href = url;
    }
  }

  function postControlCaptureMode(tweetEl, column) {
    const statusId = tweetStatusId(tweetEl);
    const isFocusedPost = !!statusId && statusId === currentStatusId();
    const isThread = isFocusedPost && buildTweetSequence(column || document, tweetEl).length > 1;
    const openFirstReason = timelineArticlePreviewReason(tweetEl, { includeThread: isThread });
    // Escape hatch: even when auto-detection returns isThread=false, ANY focused-post
    // page must expose "Save full thread" in the menu. X's virtualization or a false-
    // positive thread-boundary heading can hide follow-up posts at button-render time
    // (`buildTweetSequence` reads the DOM once, at that instant), so the user is left
    // with no way to force a thread capture even when they know it's one. Choosing
    // "Save full thread" flips runExport into full-column scroll mode which loads
    // every same-author reply BEFORE building the model - so this is safe even when
    // the current DOM shows only the focused post.
    const menuItems = isFocusedPost ? THREAD_EXPORT_TYPES : POST_EXPORT_TYPES;
    return {
      isThread,
      includeThread: isThread,
      requiresOpenPost: !!openFirstReason,
      openFirstReason,
      label: openFirstReason ? 'Open post first' : isThread ? 'Save thread' : 'Save post',
      title: openFirstReason
        ? 'Open this post before exporting so SourceCapsule can capture the full article/thread content'
        : isThread
          ? 'Quick-save this full thread to your SourceCapsule library'
          : 'Quick-save only this post to your SourceCapsule library',
      menuItems,
    };
  }

  // Only one export menu is open at a time; this closes the previous one.
  let closeOpenExportMenu = null;
  let exportMenuSequence = 0;

  /**
   * Build a self-contained Export control: a trigger button that toggles a small menu
   * of the three export types. `onPick(key, trigger)` runs the export. Used both for the
   * floating page-level control and for each per-post button.
   */
  // Remembered position of the floating control (so a user's drag survives reloads / SPA nav).
  const FLOAT_POS_KEY = 'sourcecapsule:floating-pos';
  function saveFloatingPos(pos) {
    try {
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top))
        localStorage.setItem(FLOAT_POS_KEY, JSON.stringify(pos));
    } catch {
      // Storage may be unavailable; position simply won't persist.
    }
  }
  function loadFloatingPos() {
    try {
      const v = JSON.parse(localStorage.getItem(FLOAT_POS_KEY));
      if (v && Number.isFinite(v.left) && Number.isFinite(v.top)) return v;
    } catch {
      // Ignore malformed/unavailable storage.
    }
    return null;
  }
  function applyFloatingPos(wrap) {
    const pos = loadFloatingPos();
    if (!pos) return;
    const left = Math.min(Math.max(0, pos.left), Math.max(0, window.innerWidth - wrap.offsetWidth));
    const top = Math.min(Math.max(0, pos.top), Math.max(0, window.innerHeight - wrap.offsetHeight));
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
  }

  function createExportControl({
    triggerLabel,
    triggerTitle,
    className,
    onPick,
    onQuick,
    menuItems = EXPORT_TYPES,
    draggable = false,
  }) {
    const wrap = document.createElement('div');
    wrap.className = className;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'xa-ctl-trigger';
    trigger.textContent = triggerLabel;
    trigger.title = triggerTitle;
    const options = document.createElement('button');
    options.type = 'button';
    options.className = 'xa-ctl-options';
    options.textContent = '\u22ef';
    options.title = 'More SourceCapsule actions';
    options.setAttribute('aria-label', 'More SourceCapsule actions');
    options.setAttribute('aria-haspopup', 'menu');
    options.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'xa-ctl-menu';
    menu.id = `sourcecapsule-menu-${++exportMenuSequence}`;
    menu.setAttribute('role', 'menu');
    options.setAttribute('aria-controls', menu.id);
    menu.hidden = true;
    // Set true at the end of a drag so the click that follows a drag doesn't open the menu.
    let suppressNextClick = false;

    const closeMenu = () => {
      menu.hidden = true;
      options.setAttribute('aria-expanded', 'false');
      menu.style.left = '';
      menu.style.top = '';
      if (closeOpenExportMenu === closeMenu) closeOpenExportMenu = null;
      document.removeEventListener('click', onDocClick, true);
      window.removeEventListener('resize', closeMenu, true);
      window.removeEventListener('scroll', closeMenu, true);
    };
    const onDocClick = (e) => {
      if (!wrap.contains(e.target) && !menu.contains(e.target)) closeMenu();
    };
    const focusableItems = () => Array.from(menu.querySelectorAll('.xa-ctl-item'));
    const onMenuKeyDown = (event) => {
      const items = focusableItems();
      if (!items.length) return;
      const current = Math.max(0, items.indexOf(document.activeElement));
      let next = null;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        options.focus();
        return;
      }
      if (event.key === 'ArrowDown') next = items[(current + 1) % items.length];
      else if (event.key === 'ArrowUp') next = items[(current - 1 + items.length) % items.length];
      else if (event.key === 'Home') next = items[0];
      else if (event.key === 'End') next = items[items.length - 1];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    };
    const placeMenu = () => {
      const anchor = options.getBoundingClientRect();
      const width = Math.min(280, Math.max(220, window.innerWidth - 24));
      menu.style.width = `${width}px`;
      const preferredLeft = anchor.right - width;
      const left = Math.min(
        Math.max(12, preferredLeft),
        Math.max(12, window.innerWidth - width - 12)
      );
      const below = anchor.bottom + 8;
      const estimatedHeight = menu.offsetHeight || 220;
      const top =
        below + estimatedHeight <= window.innerHeight - 12
          ? below
          : Math.max(12, anchor.top - estimatedHeight - 8);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    const openMenu = () => {
      if (closeOpenExportMenu) closeOpenExportMenu();
      menu.hidden = false;
      options.setAttribute('aria-expanded', 'true');
      placeMenu();
      closeOpenExportMenu = closeMenu;
      document.addEventListener('click', onDocClick, true);
      window.addEventListener('resize', closeMenu, true);
      window.addEventListener('scroll', closeMenu, true);
      const first = focusableItems()[0];
      if (first) first.focus();
    };

    menu.addEventListener('keydown', onMenuKeyDown);

    menuItems.forEach((entry) => {
      if (entry.divider) {
        const sep = document.createElement('div');
        sep.className = 'xa-ctl-sep';
        sep.setAttribute('role', 'separator');
        menu.appendChild(sep);
        return;
      }
      const { key, label } = entry;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'xa-ctl-item';
      item.setAttribute('role', 'menuitem');
      item.textContent = label;
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        onPick(key, trigger);
      });
      menu.appendChild(item);
    });

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      if (typeof onQuick === 'function') {
        closeMenu();
        onQuick(trigger);
      } else if (menu.hidden) openMenu();
      else closeMenu();
    });
    options.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    // Drag-to-move (floating control only). A pointer move beyond a small threshold becomes a
    // drag that repositions the control and persists the spot; anything smaller stays a click.
    if (draggable) {
      const THRESHOLD = 4;
      let startX = 0;
      let startY = 0;
      let baseLeft = 0;
      let baseTop = 0;
      let moved = false;
      const onMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < THRESHOLD) return;
        moved = true;
        const left = Math.min(
          Math.max(0, baseLeft + dx),
          Math.max(0, window.innerWidth - wrap.offsetWidth)
        );
        const top = Math.min(
          Math.max(0, baseTop + dy),
          Math.max(0, window.innerHeight - wrap.offsetHeight)
        );
        wrap.style.left = `${left}px`;
        wrap.style.top = `${top}px`;
        wrap.style.right = 'auto';
        wrap.style.bottom = 'auto';
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        if (moved) {
          suppressNextClick = true;
          saveFloatingPos({
            left: parseInt(wrap.style.left, 10),
            top: parseInt(wrap.style.top, 10),
          });
        }
      };
      trigger.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const rect = wrap.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        baseLeft = rect.left;
        baseTop = rect.top;
        moved = false;
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
      });
    }

    // Keep every click inside the control from bubbling to X (e.g. a per-post control sits
    // inside the post, whose own click handler would otherwise navigate to the tweet).
    wrap.addEventListener('click', (e) => e.stopPropagation());

    wrap.appendChild(trigger);
    wrap.appendChild(options);
    document.body.appendChild(menu);
    return { wrap, trigger, options };
  }

  function libraryReadme() {
    return [
      `${APP} export bundle`,
      '',
      'How to use with an AI assistant / agent:',
      '- Attach the .llm.md file together with the image files in the media/ folder.',
      '- The .llm.md is the readable text plus a metadata inventory; the media/ files are the',
      '  actual images and video poster frames it references.',
      '',
      'Full videos are NOT included (an LLM cannot watch video). Each video provides a poster',
      'still frame plus its original source link. The full self-contained .html (when present in',
      'this folder) embeds the complete media, including playable video, for offline viewing.',
      '',
      `Generated by ${APP} v${VERSION}.`,
      '',
    ].join('\n');
  }

  // Write one file (relative name may include subfolders like "media/x.jpg") into a dir handle.
  async function writeFileInDir(dir, relName, data) {
    const parts = relName.split('/');
    const fileName = parts.pop();
    let target = dir;
    for (const part of parts) target = await target.getDirectoryHandle(part, { create: true });
    const fileHandle = await target.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data instanceof Uint8Array ? data : String(data));
    await writable.close();
  }

  async function readTextFileInDir(dir, name) {
    try {
      const handle = await dir.getFileHandle(name);
      return await (await handle.getFile()).text();
    } catch {
      return '';
    }
  }

  let libraryIndexWriteQueue = Promise.resolve();
  function updateLibraryIndex(root, entry) {
    libraryIndexWriteQueue = libraryIndexWriteQueue
      .catch(() => {})
      .then(async () => {
        const filename = '_sourcecapsule-index.md';
        const current = await readTextFileInDir(root, filename);
        await writeFileInDir(root, filename, updateLibraryIndexText(current, entry));
      });
    return libraryIndexWriteQueue;
  }

  async function writeEntriesToDir(rootDir, segments, entries) {
    let dir = rootDir;
    for (const seg of segments) dir = await dir.getDirectoryHandle(seg, { create: true });
    for (const entry of entries) await writeFileInDir(dir, entry.name, entry.bytes || entry.text);
  }

  /**
   * "Save to library": write this export into a per-post folder under the user's chosen root
   * (File System Access API). `root` is the directory handle resolved by the caller while the user
   * gesture was still live (null on browsers without the API -> single .zip fallback). The raw
   * video bytes are never included - images + poster stills only - so the bundle stays small.
   */
  function buildLibraryEntries(model, debugJson, prefs, paths, share = null) {
    prepareArchiveModel(model);
    const { files, pathById } = collectBundleMediaFiles(model);
    const markdown = renderLlmMarkdown(model, debugJson, {
      mediaFiles: pathById,
      ...(share ? { share } : {}),
    });
    const entries = [
      { name: `${paths.postName}.llm.md`, text: markdown },
      { name: 'README.txt', text: libraryReadme() },
      ...files.map((f) => ({ name: f.name, bytes: f.bytes })),
    ];
    if (share && share.viewUrl) {
      entries.push({ name: 'AI_LINK.txt', text: aiLinkReceiptText(share, model) });
    }
    if (prefs.contents === 'full') {
      entries.unshift({
        name: `${paths.postName}.html`,
        text: assembleHtml(model, debugJson, share ? { share } : {}),
      });
    }
    return { entries, markdown };
  }

  function downloadLibraryZip(paths, entries, indexEntry) {
    const zipName = [paths.dateFolder, paths.postName].filter(Boolean).join('_') || paths.postName;
    const zipEntries = entries.map((e) => ({
      name: e.name,
      bytes: e.bytes || new TextEncoder().encode(e.text),
    }));
    zipEntries.push({
      name: '_sourcecapsule-entry.md',
      bytes: new TextEncoder().encode(`${renderLibraryIndexItem(indexEntry)}\n`),
    });
    downloadBlob(`${zipName}.zip`, new Blob([buildZip(zipEntries)], { type: 'application/zip' }));
    return `${zipName}.zip`;
  }

  async function saveToLibrary(model, debugJson, root, options = {}) {
    const prefs = getPrefs();
    prepareArchiveModel(model);
    const paths = bundlePaths(model, prefs, localDateStamp());
    const stats = archiveStats(model);
    const indexEntry = libraryIndexEntry(model, paths, stats);
    const share = options.share || null;
    const { entries, markdown } = buildLibraryEntries(model, debugJson, prefs, paths, share);

    if (root) {
      await writeEntriesToDir(root, paths.segments, entries);
      await updateLibraryIndex(root, indexEntry);
      return {
        location: [root.name, ...paths.segments].join('/'),
        markdown,
        videosPreservedOffline: prefs.contents === 'full' ? stats.videosPreservedOffline : 0,
        root,
        segments: paths.segments,
        postName: paths.postName,
        prefs,
      };
    }
    // No handle => the browser lacks the File System Access API (the caller already handled a
    // user-cancelled picker). Fall back to a single .zip. Files sit at the ZIP ROOT (no inner
    // folder): extracting "<name>.zip" already creates a "<name>/" folder, so an internal prefix
    // would double-nest (<name>/<name>/...). The dated name keeps zips sortable and unique.
    const location = options.deferZipDownload
      ? [paths.dateFolder, paths.postName].filter(Boolean).join('_') || paths.postName
      : downloadLibraryZip(paths, entries, indexEntry);
    return {
      location: options.deferZipDownload ? `${location}.zip` : location,
      markdown,
      videosPreservedOffline: prefs.contents === 'full' ? stats.videosPreservedOffline : 0,
      postName: paths.postName,
      paths,
      entries,
      indexEntry,
      prefs,
      zipDeferred: options.deferZipDownload === true,
    };
  }

  /**
   * Build and download the requested artifact(s) for the page (or a specific post).
   * @param exportType 'library' | 'library-share' | 'share' | 'copy' | 'html' | 'md' | 'both'
   * @param targetTweetEl when set, export exactly that post (per-post button); else the page.
   * @param trigger the clicked button, for busy-state feedback.
   */
  async function runExport(
    exportType,
    { targetTweetEl = null, trigger = null, includeThread = true } = {}
  ) {
    const type = targetTweetEl ? 'post' : detectPageType();
    if (!type) return;
    const openFirstReason = timelineArticlePreviewReason(targetTweetEl, { includeThread });
    if (openFirstReason) {
      showOpenPostFirstNotice(targetTweetEl, openFirstReason);
      return;
    }
    const restoreLabel = trigger ? trigger.textContent : '';
    const setBusy = (busy) => {
      if (!trigger) return;
      trigger.disabled = busy;
      trigger.textContent = busy ? 'Exporting...' : restoreLabel;
      const options =
        trigger.parentElement && trigger.parentElement.querySelector('.xa-ctl-options');
      if (options) options.disabled = busy;
    };
    setBusy(true);
    try {
      let metadata = {};
      const needsShare = exportType === 'share' || exportType === 'library-share';
      const needsLibrary = exportType === 'library-share' || exportType.startsWith('library');
      if (exportType === 'library-note' || needsShare) {
        metadata = await promptCaptureOptions({
          share: needsShare,
          saveLocal: exportType === 'library-share',
        });
        if (!metadata) return;
      }
      const outputType = exportType === 'library-note' ? 'library' : exportType;
      // Resolve the export folder FIRST, while we still hold the click's transient user
      // activation - showDirectoryPicker / requestPermission require it, and the media loading
      // below can easily outlast the ~5s activation window. Reused (already-granted) handles
      // resolve without a prompt. null + FSA available means the user cancelled -> abort early
      // (before the expensive media work); null + no FSA means we'll zip later.
      let libraryRoot = null;
      if (needsLibrary) {
        libraryRoot = await getRootDir();
        if (!libraryRoot && folderPickerAvailable()) {
          showToast(lastFolderPickerError || 'Export folder not set; export cancelled', {
            error: true,
          });
          return;
        }
      }
      resetMediaState();
      if (CONFIG.forceLoad) {
        showToast('Loading media...', { sticky: true });
        if (targetTweetEl && !includeThread) {
          // Per-post export: the clicked post is already on screen. Load its media IN PLACE
          // rather than scrolling the whole page - a full scroll can unmount the target under
          // X's virtualization, leaving us reading a stale/detached node.
          await loadMediaInPlace(targetTweetEl);
        } else {
          const container =
            type === 'article'
              ? pick(document, CONFIG.selectors.articleRoot, { quiet: true })
              : pick(document, CONFIG.selectors.primaryColumn, { quiet: true });
          await forceLoadMedia(
            container,
            (pct) => showToast(`Loading thread and media... ${pct}%`, { sticky: true }),
            { fromTop: type === 'article' || (type === 'post' && includeThread) }
          );
        }
      }
      showToast('Reading page...', { sticky: true });
      const model =
        type === 'article'
          ? buildModelForArticle()
          : buildModelForPost(targetTweetEl, { includeThread });
      applyCaptureMetadata(model, metadata);
      const debugJson = model._debug ? JSON.stringify(model._debug, null, 2) : '';
      delete model._debug;
      log('model', model);

      if (CONFIG.useSyndication) {
        // Cheapest first: try passively-captured GraphQL refs before any network call.
        // Most missing quote permalinks resolve here without a syndication round-trip.
        const patchedFromCapture = recoverMissingQuoteSourcesFromCapture(model);
        if (patchedFromCapture) {
          log('recovered', patchedFromCapture, 'quote permalink(s) from captured GraphQL refs');
        }
        await recoverMissingQuoteSourcesViaSyndication(model, (done, total) =>
          showToast(
            total ? `Resolving embedded post sources... ${done}/${total}` : 'Reading page...',
            { sticky: true }
          )
        );
        await enrichQuotesViaSyndication(model, (done, total) =>
          showToast(total ? `Fetching embedded tweets... ${done}/${total}` : 'Reading page...', {
            sticky: true,
          })
        );
        if (model.thread) {
          await enrichThreadViaSyndication(model, (done, total) =>
            showToast(total ? `Verifying thread media... ${done}/${total}` : 'Reading page...', {
              sticky: true,
            })
          );
        } else {
          // Single-post exports get the same authoritative media/link check the
          // thread pass gives each post - a lazily-lost image otherwise leaves
          // no block at all, invisible even to the strict gate.
          await enrichFocusedPostViaSyndication(model, () =>
            showToast('Verifying post media...', { sticky: true })
          );
        }
        if (getPrefs().replyContext) {
          // Runs BEFORE inlineMedia so the parent card's avatar/media inline
          // like any other block. Root payload comes from the per-export cache.
          await enrichReplyContextViaSyndication(model, () =>
            showToast('Fetching reply context...', { sticky: true })
          );
        }
        log('model after syndication', model);
      }

      enrichVideoCandidates(model);
      await inlineMedia(model, (done, total) => {
        showToast(total ? `Embedding media... ${done}/${total}` : 'Building file...', {
          sticky: true,
        });
      });
      await rescueMissingMedia(model, (done, total) => {
        showToast(
          total ? `Recovering media downloads... ${done}/${total}` : 'Checking media downloads...',
          {
            sticky: true,
          }
        );
      });

      // Strict export gate: after ALL recovery layers ran, if the finished model still
      // has dead-end quotes or failed media the reader would see, block and confirm.
      // The user can toggle strict mode off from the manager menu; when off, the gate
      // is skipped and the export ships regardless (the pre-strict-mode behavior).
      const runtimePrefs = getPrefs();
      if (runtimePrefs.strictExport) {
        let assessment = assessExportCompleteness(model);
        if (assessment.verdict !== 'clean') {
          // Most blockers are transient - retry each through the layer that owns
          // it before bothering the user. The modal is the LAST resort.
          showToast(`Retrying ${assessment.blockers.length} incomplete item(s)...`, {
            sticky: true,
          });
          assessment = await repairExportBlockers(model, assessment, (done, total) =>
            showToast(
              total
                ? `Retrying failed downloads... ${done}/${total}`
                : 'Retrying incomplete items...',
              { sticky: true }
            )
          );
          if (assessment.verdict === 'clean') {
            log('strict-mode auto-repair resolved all blockers');
          }
        }
        if (assessment.verdict !== 'clean') {
          hideToast();
          const proceed = await confirmShipDespiteIncomplete({
            model,
            assessment,
            debugJson,
            // Manual retry from the modal: run the same repair round again. The
            // user has usually waited a bit by now, so rate limits have cleared.
            onRetry: async (report) => {
              assessment = await repairExportBlockers(model, assessment, report);
              return assessment;
            },
          });
          if (!proceed) {
            log('export cancelled by strict-mode gate', assessment.counts);
            showToast('Export cancelled. Turn off strict mode from the menu to ship anyway.', {
              error: true,
            });
            return;
          }
          log('user chose to ship despite strict-mode gate', assessment.counts);
        }
      }

      showToast('Assembling files...', { sticky: true });
      const publishAndCopyShare = async (expiryDays = metadata.expiryDays, savedTarget = null) => {
        const created = await createShareLink(
          model,
          debugJson,
          expiryDays || CONFIG.share.defaultExpiryDays,
          (message, done, total) =>
            showToast(total ? `[${Math.min(done + 1, total)}/${total}] ${message}` : message, {
              sticky: true,
            })
        );
        rememberShareLink(created, model);
        if (savedTarget && savedTarget.root && savedTarget.segments) {
          await saveToLibrary(model, debugJson, savedTarget.root, {
            share: shareMetadataFromCreated(created),
          });
        }
        let copied = false;
        try {
          await copyText(created.viewUrl);
          copied = true;
        } catch (copyError) {
          warn('AI readable link created but automatic clipboard copy failed:', copyError.message);
        }
        showShareResult(created, { copied });
        showToast(
          `AI readable link ready; expires ${readableUtcTime(created.expiresAt)}${copied ? ' (copied)' : ''}`
        );
        return created;
      };
      const shareFromReceipt = async (savedTarget = null) => {
        const shareMetadata = await promptCaptureOptions({ share: true, saveLocal: true });
        if (!shareMetadata) {
          setReceiptActionStatus('AI readable link cancelled. Your local save is unchanged.');
          return;
        }
        applyCaptureMetadata(model, shareMetadata);
        await publishAndCopyShare(shareMetadata.expiryDays, savedTarget);
      };
      if (outputType === 'library-share') {
        const saved = await saveToLibrary(model, debugJson, libraryRoot, {
          deferZipDownload: !libraryRoot,
        });
        showCaptureReceipt({
          model,
          debugJson,
          savedLocation: saved.location,
          markdown: saved.markdown,
          videosPreservedOffline: saved.videosPreservedOffline,
          onShare: () => shareFromReceipt(saved),
        });
        try {
          const created = await publishAndCopyShare(undefined, saved);
          if (saved.zipDeferred) {
            const share = shareMetadataFromCreated(created);
            const withLink = await saveToLibrary(model, debugJson, null, {
              share,
              deferZipDownload: true,
            });
            const zipLocation = downloadLibraryZip(
              withLink.paths,
              withLink.entries,
              withLink.indexEntry
            );
            saved.location = zipLocation;
          }
        } catch (shareError) {
          errlog(shareError);
          if (saved.zipDeferred) {
            const zipLocation = downloadLibraryZip(saved.paths, saved.entries, saved.indexEntry);
            saved.location = zipLocation;
          }
          setReceiptActionStatus(
            `Local save is safe. AI readable link failed: ${shareError.message}`,
            {
              error: true,
            }
          );
        }
        return;
      }
      if (outputType === 'library') {
        const saved = await saveToLibrary(model, debugJson, libraryRoot);
        showCaptureReceipt({
          model,
          debugJson,
          savedLocation: saved.location,
          markdown: saved.markdown,
          videosPreservedOffline: saved.videosPreservedOffline,
          onShare: () => shareFromReceipt(saved),
        });
        return;
      }
      if (outputType === 'copy') {
        const markdown = renderLlmMarkdown(model, debugJson);
        await copyText(markdown);
        showToast(
          `Copied ${model.thread ? `full thread (${model.thread.capturedPosts} posts)` : type} as Markdown`
        );
        return;
      }
      if (outputType === 'share') {
        await publishAndCopyShare();
        return;
      }
      const basename = `${slugify(model.title)}.${nowStamp()}`;
      const htmlFilename = `${basename}.html`;
      const saved = [];
      let receiptMarkdown = '';
      if (outputType === 'both') {
        const html = assembleHtml(model, debugJson);
        const zipFilename = `${basename}.zip`;
        const markdownFilename = `${basename}.llm.md`;
        const markdown = renderLlmMarkdown(model, debugJson, {
          companionHtmlFilename: htmlFilename,
          companionArchiveFilename: zipFilename,
        });
        receiptMarkdown = markdown;
        downloadBlob(
          zipFilename,
          new Blob(
            [
              buildZip([
                { name: htmlFilename, bytes: new TextEncoder().encode(html) },
                { name: markdownFilename, bytes: new TextEncoder().encode(markdown) },
              ]),
            ],
            { type: 'application/zip' }
          )
        );
        saved.push(zipFilename);
        log(
          'zip',
          zipFilename,
          `(${htmlFilename} + ${markdownFilename})`,
          humanBytes(html.length + markdown.length)
        );
      } else {
        if (outputType === 'html') {
          const html = assembleHtml(model, debugJson);
          downloadHtml(htmlFilename, html);
          saved.push(htmlFilename);
          log('html', htmlFilename, humanBytes(html.length));
        }
        if (outputType === 'md') {
          // A Markdown-only export has no companion on disk, so it must not claim one.
          const markdown = renderLlmMarkdown(model, debugJson);
          receiptMarkdown = markdown;
          const markdownFilename = `${basename}.llm.md`;
          downloadBlob(
            markdownFilename,
            new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
          );
          saved.push(markdownFilename);
          log('markdown', markdownFilename, humanBytes(markdown.length));
        }
      }
      if (!receiptMarkdown) receiptMarkdown = renderLlmMarkdown(model, debugJson);
      showCaptureReceipt({
        model,
        debugJson,
        savedLocation: saved.join(' and '),
        markdown: receiptMarkdown,
        videosPreservedOffline:
          outputType === 'html' || outputType === 'both'
            ? archiveStats(model).videosPreservedOffline
            : 0,
        onShare: shareFromReceipt,
      });
    } catch (e) {
      errlog(e);
      showToast(`Export failed: ${e.message}`, { error: true });
    } finally {
      setBusy(false);
    }
  }

  function ensureFloatingControl(type) {
    const existing = document.getElementById(CONFIG.buttonId);
    if (existing) {
      // The article reader can load AFTER the control is first injected, so detectPageType may
      // have said "post" initially. Relabel the live control when the type is now known (unless
      // it's mid-export). Export itself re-checks the type at click time, so content is correct
      // regardless; this just keeps the label honest.
      const trig = existing.querySelector('.xa-ctl-trigger');
      const label = type === 'article' ? 'Save article' : 'Save thread';
      if (trig && !trig.disabled && trig.textContent !== label) trig.textContent = label;
      return;
    }
    ensureStyle();
    const { wrap } = createExportControl({
      triggerLabel: type === 'article' ? 'Save article' : 'Save thread',
      triggerTitle: `Quick-save this ${type === 'article' ? 'article' : 'full thread'} to your SourceCapsule library (drag to move)`,
      className: 'xa-ctl xa-ctl-floating',
      menuItems: EXPORT_TYPES,
      onQuick: (trigger) => runExport('library', { trigger, includeThread: true }),
      onPick: (exportType, trigger) =>
        runExport(exportType, {
          trigger,
          includeThread: true,
        }),
      draggable: true,
    });
    wrap.id = CONFIG.buttonId;
    document.body.appendChild(wrap);
    applyFloatingPos(wrap); // restore the user's chosen spot (after append so dims are known)
    log('floating control injected for', type, 'page');
  }

  // Attach an Export control to each top-level post so the user picks exactly which post
  // to export. Idempotent: skips posts that already carry a control (survives X's
  // virtualization re-renders via the coarse MutationObserver in init()).
  function ensurePerPostControls() {
    if (!CONFIG.perPostButtons) return;
    const column = pick(document, CONFIG.selectors.primaryColumn, { quiet: true });
    if (!column) return;
    ensureStyle();
    topLevelTweetEls(column).forEach((tweetEl) => {
      if (!tweetStatusId(tweetEl)) return; // only real posts (skip compose box / ads)
      const mode = postControlCaptureMode(tweetEl, column);
      const existing = tweetEl.querySelector(`.${CONFIG.postControlClass}`);
      if (existing) {
        // Cache key reflects WHICH menu array is actually rendered, not just isThread.
        // A focused post now gets THREAD_EXPORT_TYPES even when auto-detection says
        // isThread=false (escape-hatch fix); a cache key based on isThread alone would
        // leave stale POST_EXPORT_TYPES menus in place after code updates.
        const menuMode = mode.menuItems === THREAD_EXPORT_TYPES ? 'thread' : 'post';
        if (existing.getAttribute('data-sourcecapsule-menu-mode') !== menuMode) {
          existing.remove();
        } else {
          // A continuation may render after the root control. Keep the label honest as X lazily
          // fills the conversation; the click handler below also re-checks at click time.
          const trigger = existing.querySelector('.xa-ctl-trigger');
          if (trigger && !trigger.disabled) {
            trigger.textContent = mode.label;
            trigger.title = mode.title;
          }
          return;
        }
      }
      const { wrap } = createExportControl({
        triggerLabel: mode.label,
        triggerTitle: mode.title,
        className: `xa-ctl ${CONFIG.postControlClass}`,
        menuItems: mode.menuItems,
        onQuick: (trigger) => {
          const currentMode = postControlCaptureMode(tweetEl, column);
          return runExport('library', {
            targetTweetEl: tweetEl,
            trigger,
            includeThread: currentMode.includeThread,
          });
        },
        onPick: (exportType, trigger) => {
          const request = postExportRequest(exportType);
          return runExport(request.exportType, {
            targetTweetEl: tweetEl,
            trigger,
            includeThread: request.includeThread,
          });
        },
      });
      wrap.setAttribute(CONFIG.postControlFlag, '1');
      wrap.setAttribute(
        'data-sourcecapsule-menu-mode',
        mode.menuItems === THREAD_EXPORT_TYPES ? 'thread' : 'post'
      );
      // Prefer placing the control inline in the header, right before X's "..." menu, so it
      // sits beside Subscribe/More and flows with them. Fall back to an absolute overlay if
      // the header caret can't be found.
      const caret = tweetEl.querySelector('[data-testid="caret"]');
      if (caret && caret.parentElement) {
        wrap.classList.add('xa-ctl-inline');
        caret.parentElement.insertBefore(wrap, caret);
      } else {
        if (getComputedStyle(tweetEl).position === 'static') tweetEl.style.position = 'relative';
        tweetEl.appendChild(wrap);
      }
    });
  }

  // Inline "Export article" control in the article's header, beside X's "..." menu - the
  // article-page counterpart of the per-post buttons, for consistent in-context export.
  // Exports the whole article (no targetTweetEl). Degrades gracefully to the floating control
  // if the header caret can't be found.
  function ensureArticleHeaderControl() {
    if (!CONFIG.perPostButtons) return;
    const column = pick(document, CONFIG.selectors.primaryColumn, { quiet: true });
    if (!column) return;
    if (column.querySelector(`.${CONFIG.postControlClass}`)) return; // already injected
    const caret = column.querySelector('[data-testid="caret"]'); // topmost = article header
    if (!caret || !caret.parentElement) return;
    const { wrap } = createExportControl({
      triggerLabel: 'Save article',
      triggerTitle: `Quick-save this article to your SourceCapsule library`,
      className: `xa-ctl ${CONFIG.postControlClass}`,
      onQuick: (trigger) => runExport('library', { trigger }),
      onPick: (exportType, trigger) => runExport(exportType, { trigger }),
    });
    wrap.classList.add('xa-ctl-inline');
    wrap.setAttribute(CONFIG.postControlFlag, '1');
    caret.parentElement.insertBefore(wrap, caret);
  }

  function ensureButton() {
    const type = detectPageType();
    const existing = document.getElementById(CONFIG.buttonId);
    if (!type) {
      if (existing) existing.remove();
      ensurePerPostControls();
      return;
    }
    ensureStyle();
    // The floating control is opt-in (default off); inline buttons are the primary entry point.
    if (getPrefs().floatingButton) ensureFloatingControl(type);
    else if (existing) existing.remove();
    if (type === 'post') ensurePerPostControls();
    else if (type === 'article') ensureArticleHeaderControl();
  }

  // ===========================================================================
  // Lifecycle - re-evaluate across SPA navigations
  // ===========================================================================

  let networkCaptureBridgeInstalled = false;

  function networkCapturePatterns() {
    return {
      // Keep this aligned with both MAIN-world bridge implementations. Quote
      // refs are useful even when the post contains no video or long-form text;
      // filtering those ordinary GraphQL responses out here defeats the
      // capturedQuotedRefs recovery layer entirely.
      body: /video_info|variants|video\.twimg\.com|amplify_video|ext_tw_video|tweet_video|note_tweet|quoted_status/i,
      url: /\/graphql\/|\/i\/api\/|TweetDetail|TweetResult|Article|UserTweets|HomeTimeline/i,
      contentType: /json|javascript|text/i,
    };
  }

  function installUnsafeWindowNetworkCapture(target) {
    if (!target || target.__SourceCapsuleNetworkCaptureDirectInstalled) return false;
    const patterns = networkCapturePatterns();
    const shouldRead = (url, contentType) =>
      patterns.contentType.test(contentType || '') || patterns.url.test(url || '');
    const emit = (url, body, transport) => {
      try {
        if (!body) return;
        const text = String(body);
        if (!patterns.body.test(text)) return;
        handleNetworkCapturePayload({
          source: `${APP}:network-capture`,
          type: 'response',
          url: String(url || ''),
          transport: `${transport}:unsafeWindow`,
          truncated: text.length > CONFIG.video.networkCaptureMaxChars,
          body: text.slice(0, CONFIG.video.networkCaptureMaxChars),
        });
      } catch (e) {
        recordNetworkCaptureError(e);
      }
    };

    let installedAny = false;
    const originalFetch = target.fetch;
    if (typeof originalFetch === 'function') {
      target.fetch = function (...args) {
        const responsePromise = originalFetch.apply(this, args);
        try {
          responsePromise
            .then((response) => {
              try {
                const url =
                  (response && response.url) ||
                  (typeof args[0] === 'string' ? args[0] : args[0] && args[0].url) ||
                  '';
                const contentType =
                  response && response.headers && response.headers.get
                    ? response.headers.get('content-type') || ''
                    : '';
                if (!shouldRead(url, contentType) || !response || !response.clone) return;
                response
                  .clone()
                  .text()
                  .then((body) => emit(url, body, 'fetch'))
                  .catch((e) => recordNetworkCaptureError(e));
              } catch (e) {
                recordNetworkCaptureError(e);
              }
            })
            .catch((e) => recordNetworkCaptureError(e));
        } catch (e) {
          recordNetworkCaptureError(e);
        }
        return responsePromise;
      };
      installedAny = true;
    }

    const proto = target.XMLHttpRequest && target.XMLHttpRequest.prototype;
    if (proto && proto.open && proto.send) {
      const originalOpen = proto.open;
      const originalSend = proto.send;
      proto.open = function (method, url, ...rest) {
        try {
          this.__SourceCapsuleUrl = url;
        } catch (e) {
          recordNetworkCaptureError(e);
        }
        return originalOpen.call(this, method, url, ...rest);
      };
      proto.send = function (...args) {
        try {
          this.addEventListener(
            'loadend',
            () => {
              try {
                const url = this.__SourceCapsuleUrl || this.responseURL || '';
                const contentType =
                  typeof this.getResponseHeader === 'function'
                    ? this.getResponseHeader('content-type') || ''
                    : '';
                if (!shouldRead(url, contentType)) return;
                let body = '';
                if (!this.responseType || this.responseType === 'text') {
                  body = this.responseText || '';
                } else if (this.responseType === 'json' && this.response) {
                  body = JSON.stringify(this.response);
                }
                emit(url, body, 'xhr');
              } catch (e) {
                recordNetworkCaptureError(e);
              }
            },
            { once: true }
          );
        } catch (e) {
          recordNetworkCaptureError(e);
        }
        return originalSend.apply(this, args);
      };
      installedAny = true;
    }

    if (installedAny) {
      try {
        target.__SourceCapsuleNetworkCaptureDirectInstalled = true;
      } catch (e) {
        recordNetworkCaptureError(e);
      }
      networkCaptureDiagnostics.installed = true;
      networkCaptureDiagnostics.directInstalled = true;
      networkCaptureDiagnostics.mode = 'unsafeWindow';
    }
    return installedAny;
  }

  function networkCaptureBridgeSource(maxBodyChars) {
    return `(${function (limit) {
      const SOURCE = 'SourceCapsule:network-capture';
      if (window.__SourceCapsuleNetworkCaptureInstalled) return;
      window.__SourceCapsuleNetworkCaptureInstalled = true;
      const MAX_MESSAGES = 200;
      let sent = 0;
      const bodyPattern = new RegExp(
        'video_info|variants|video\\.twimg\\.com|amplify_video|ext_tw_video|tweet_video|note_tweet|quoted_status',
        'i'
      );
      const urlPattern = new RegExp(
        '/graphql/|/i/api/|TweetDetail|TweetResult|Article|UserTweets|HomeTimeline',
        'i'
      );
      const interestingBody = (text) => bodyPattern.test(text || '');
      const interestingUrl = (url) => urlPattern.test(url || '');
      const shouldRead = (url, contentType) =>
        /json|javascript|text/i.test(contentType || '') || interestingUrl(url);
      const emit = (url, body, transport) => {
        try {
          if (sent >= MAX_MESSAGES || !body) return;
          const text = String(body);
          if (!interestingBody(text)) return;
          sent += 1;
          window.postMessage(
            {
              source: SOURCE,
              type: 'response',
              url: String(url || ''),
              transport,
              truncated: text.length > limit,
              body: text.slice(0, limit),
            },
            window.location.origin
          );
        } catch {
          // Keep X untouched if capture fails.
        }
      };

      const originalFetch = window.fetch;
      if (typeof originalFetch === 'function') {
        window.fetch = function (...args) {
          const responsePromise = originalFetch.apply(this, args);
          try {
            responsePromise
              .then((response) => {
                try {
                  const url =
                    (response && response.url) ||
                    (typeof args[0] === 'string' ? args[0] : args[0] && args[0].url) ||
                    '';
                  const contentType =
                    response && response.headers && response.headers.get
                      ? response.headers.get('content-type') || ''
                      : '';
                  if (!shouldRead(url, contentType) || !response || !response.clone) return;
                  response
                    .clone()
                    .text()
                    .then((body) => emit(url, body, 'fetch'))
                    .catch(() => {});
                } catch {
                  // Ignore capture errors.
                }
              })
              .catch(() => {});
          } catch {
            // Ignore capture errors.
          }
          return responsePromise;
        };
      }

      const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
      if (proto && proto.open && proto.send) {
        const originalOpen = proto.open;
        const originalSend = proto.send;
        proto.open = function (method, url, ...rest) {
          try {
            this.__SourceCapsuleUrl = url;
          } catch {
            // Ignore capture errors.
          }
          return originalOpen.call(this, method, url, ...rest);
        };
        proto.send = function (...args) {
          try {
            this.addEventListener(
              'loadend',
              () => {
                try {
                  const url = this.__SourceCapsuleUrl || this.responseURL || '';
                  const contentType =
                    typeof this.getResponseHeader === 'function'
                      ? this.getResponseHeader('content-type') || ''
                      : '';
                  if (!shouldRead(url, contentType)) return;
                  let body = '';
                  if (!this.responseType || this.responseType === 'text') {
                    body = this.responseText || '';
                  } else if (this.responseType === 'json' && this.response) {
                    body = JSON.stringify(this.response);
                  }
                  emit(url, body, 'xhr');
                } catch {
                  // Ignore capture errors.
                }
              },
              { once: true }
            );
          } catch {
            // Ignore capture errors.
          }
          return originalSend.apply(this, args);
        };
      }
      try {
        window.postMessage(
          {
            source: SOURCE,
            type: 'installed',
            transport: 'injected',
          },
          window.location.origin
        );
      } catch {
        // Keep X untouched if capture fails.
      }
    }})(${JSON.stringify(maxBodyChars)});`;
  }

  function injectPageScript(source) {
    const script = document.createElement('script');
    script.textContent = source;
    const parent = document.documentElement || document.head || document.body;
    if (!parent) return false;
    parent.appendChild(script);
    script.remove();
    return true;
  }

  function installNetworkCaptureBridge() {
    if (
      networkCaptureBridgeInstalled ||
      typeof window === 'undefined' ||
      typeof document === 'undefined'
    ) {
      return;
    }
    networkCaptureBridgeInstalled = true;
    window.addEventListener('message', onNetworkCaptureMessage);
    if (globalThis.__SOURCECAPSULE_EXTENSION__ === true) {
      networkCaptureDiagnostics.installed = true;
      networkCaptureDiagnostics.mode = 'extension-main-pending';
      window.postMessage(
        { source: `${APP}:network-capture`, contractVersion: 1, type: 'ping' },
        location.origin
      );
      return;
    }
    networkCaptureDiagnostics.unsafeWindowAvailable =
      typeof unsafeWindow !== 'undefined' && !!unsafeWindow;
    if (networkCaptureDiagnostics.unsafeWindowAvailable) {
      try {
        installUnsafeWindowNetworkCapture(unsafeWindow);
      } catch (e) {
        recordNetworkCaptureError(e);
      }
    }
    if (networkCaptureDiagnostics.directInstalled) return;
    networkCaptureDiagnostics.mode = 'injected-pending';
    const install = () => {
      if (!injectPageScript(networkCaptureBridgeSource(CONFIG.video.networkCaptureMaxChars))) {
        setTimeout(install, 0);
      }
    };
    install();
  }

  function hookHistory() {
    const fire = () => {
      clearCapturedNetworkVideoCandidates();
      window.dispatchEvent(new Event('sourcecapsule:navigate'));
    };
    for (const m of ['pushState', 'replaceState']) {
      const orig = history[m];
      history[m] = function (...args) {
        const r = orig.apply(this, args);
        fire();
        return r;
      };
    }
    window.addEventListener('popstate', fire);
  }

  let scheduled = false;
  function scheduleEnsure() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      ensureButton();
    }, 400); // small debounce: let X finish rendering the new view
  }

  function init() {
    hookHistory();
    window.addEventListener('sourcecapsule:navigate', scheduleEnsure);
    // X mutates the DOM heavily; a coarse observer keeps the button in sync.
    const obs = new MutationObserver(() => scheduleEnsure());
    obs.observe(document.body, { childList: true, subtree: true });
    registerSettingsMenu();
    registerExtensionController();
    ensureButton();
    log(`${APP} v${VERSION} ready`);
  }

  // Browser bootstrap (guarded so the pure engine can be required from Node).
  if (typeof document !== 'undefined') {
    installNetworkCaptureBridge();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // Node-only: expose the stable, DOM-free engine for the smoke test (test/smoke.mjs).
  // `module` does not exist in the userscript sandbox, so this is a no-op there.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      assembleHtml,
      renderLlmMarkdown,
      renderBlock,
      slugify,
      // Library/bundle engine (pure pieces; browser-only delivery is not unit-tested).
      buildZip,
      crc32,
      base64ToBytes,
      dataUriToBytes,
      mimeToExt,
      bundlePaths,
      collectBundleMediaFiles,
      buildLibraryEntries,
      collectMediaRescueTasks,
      rescueMissingMedia,
      recoverableMediaFailures,
      normalizeTags,
      applyCaptureMetadata,
      libraryIndexEntry,
      renderLibraryIndexItem,
      updateLibraryIndexText,
      getShareLinks,
      setShareLinks,
      rememberShareLink,
      forgetShareLink,
      shareLinkExpired,
      aiLinkReceiptText,
      showRecentShareLinks,
      renderArchiveManifestJson,
      EXPORT_TYPES,
      POST_EXPORT_TYPES,
      THREAD_EXPORT_TYPES,
      postExportRequest,
      postControlCaptureMode,
      timelineArticlePreviewReason,
      showShareResult,
      showCaptureReceipt,
      archiveStats,
      // Strict-mode ship-blocker: assessment, diagnostic bundle, auto-repair
      // round, and the confirm modal (DOM-bound; exercised via jsdom).
      assessExportCompleteness,
      buildDiagnosticBundle,
      confirmShipDespiteIncomplete,
      extensionControllerMessage,
      folderPickerAvailable,
      pickDirectoryViaExtensionBridge,
      handleFromSourceUrl,
      escapeHtml,
      safeUrl,
      highResImageUrl,
      imageFetchCandidates,
      gmFetchBytes,
      validateMp4Download,
      validateImageDownload,
      videoCandidatesFromStructuredData,
      videoCandidatesFromCapturedBody,
      videoCandidateMatchesBlock,
      unambiguousVideoFallbackCandidate,
      handleNetworkCapturePayload,
      validateNetworkCapturePayload,
      networkCapturePatterns,
      networkCaptureSignature,
      ensureButton,
      // Long-form (note) full-text recovery from passively captured GraphQL payloads.
      noteTweetsFromCapturedBody,
      noteTweetParagraphBlocks,
      recoverQuoteNoteText,
      getCapturedNoteTweet,
      // Passive quoted-post ref capture (from the same GraphQL payloads) - used to
      // reconstruct a permalink when the DOM+syndication both drop the reference.
      quotedRefsFromCapturedBody,
      getCapturedQuotedRef,
      humanBytes,
      VERSION,
      // Extraction layer (exported for the jsdom DOM test).
      buildModelForPost,
      buildModelForArticle,
      articleListType,
      inlineHtmlFromTweetText,
      detectPageType,
      extractAuthor,
      hasThreadBoundaryBefore,
      statusIdIsAfter,
      // Media harvest (exported to test the virtualization workaround).
      resetMediaState,
      harvestMediaNow,
      dedupeQuoteCards,
      mediaOwnerStatusId,
      // Syndication transforms (pure; network call is not unit-tested).
      syndicationToken,
      syndicationToQuoteBlock,
      syndicationMediaBlocks,
      syndicationLinkBlocks,
      mergeQuoteAfterSyndication,
      syndicationRelationCandidates,
      recoverMissingQuoteSourcesViaSyndication,
      recoverMissingQuoteSourcesFromCapture,
      mediaKeyFromUrl,
      enrichThreadViaSyndication,
      enrichFocusedPostViaSyndication,
      enrichReplyContextViaSyndication,
      repairExportBlockers,
      runWithConcurrency,
      inlineMedia,
      extractLinkCard,
      extractPollBlock,
      quoteSourceUrlFromElement,
      buildTweetBlocks,
    };
  }
})();
