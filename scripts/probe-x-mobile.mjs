import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.x.com/2';
const REQUEST_TIMEOUT_MS = 20000;
const POST_FIELDS = [
  'article',
  'attachments',
  'author_id',
  'conversation_id',
  'created_at',
  'entities',
  'note_tweet',
  'referenced_tweets',
  'text',
].join(',');
const EXPANSIONS = [
  'article.cover_media',
  'article.media_entities',
  'attachments.media_keys',
  'author_id',
  'referenced_tweets.id',
  'referenced_tweets.id.attachments.media_keys',
  'referenced_tweets.id.author_id',
].join(',');
const MEDIA_FIELDS = [
  'alt_text',
  'duration_ms',
  'height',
  'media_key',
  'preview_image_url',
  'type',
  'url',
  'variants',
  'width',
].join(',');
const USER_FIELDS = ['name', 'profile_image_url', 'protected', 'username', 'verified'].join(',');

function postIdFromUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      host !== 'x.com' &&
      host !== 'www.x.com' &&
      host !== 'mobile.x.com' &&
      host !== 'twitter.com' &&
      host !== 'www.twitter.com' &&
      host !== 'mobile.twitter.com'
    ) {
      return '';
    }
    const match = url.pathname.match(/\/status\/(\d{1,19})(?:\/|$)/);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function requestParams(extra = {}) {
  return {
    'tweet.fields': POST_FIELDS,
    expansions: EXPANSIONS,
    'media.fields': MEDIA_FIELDS,
    'user.fields': USER_FIELDS,
    ...extra,
  };
}

function collectStringStats(value) {
  const strings = [];
  const keys = new Set();
  const walk = (item) => {
    if (typeof item === 'string') {
      strings.push(item);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }
    if (!item || typeof item !== 'object') return;
    Object.entries(item).forEach(([key, child]) => {
      keys.add(key);
      walk(child);
    });
  };
  walk(value);
  return {
    keys: Array.from(keys).sort(),
    stringCount: strings.length,
    totalStringChars: strings.reduce((sum, item) => sum + item.length, 0),
    longestStringChars: strings.reduce((max, item) => Math.max(max, item.length), 0),
  };
}

function summarizeLookup(payload) {
  const post = payload && payload.data ? payload.data : {};
  const users = (payload && payload.includes && payload.includes.users) || [];
  const media = (payload && payload.includes && payload.includes.media) || [];
  const author = users.find((user) => user.id === post.author_id) || users[0] || {};
  return {
    id: post.id || '',
    conversationId: post.conversation_id || '',
    author: author.username ? `@${author.username}` : '',
    textChars: String(post.text || '').length,
    hasNoteTweet: Boolean(post.note_tweet),
    noteTweet: collectStringStats(post.note_tweet),
    hasArticle: Boolean(post.article),
    article: collectStringStats(post.article),
    mediaCount: media.length,
    mediaTypes: Array.from(new Set(media.map((item) => item.type).filter(Boolean))),
    referencedPostCount: Array.isArray(post.referenced_tweets) ? post.referenced_tweets.length : 0,
  };
}

async function xApiGet(endpoint, params, bearerToken) {
  const url = new URL(`${API_BASE}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`X API returned non-JSON HTTP ${response.status}.`);
    }
    if (!response.ok) {
      const detail =
        (payload && (payload.detail || payload.title)) ||
        (Array.isArray(payload.errors) && payload.errors[0] && payload.errors[0].detail) ||
        'Request failed.';
      throw new Error(`X API HTTP ${response.status}: ${detail}`);
    }
    return payload;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`X API request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function probeOne(sourceUrl, bearerToken, includeThread, progress) {
  const postId = postIdFromUrl(sourceUrl);
  if (!postId) throw new Error('Expected an x.com or twitter.com status URL.');

  progress('Looking up the source post');
  const lookup = await xApiGet(`/tweets/${postId}`, requestParams(), bearerToken);
  const summary = summarizeLookup(lookup);
  progress(
    `Post received: article=${summary.hasArticle}, note=${summary.hasNoteTweet}, media=${summary.mediaCount}`
  );

  let thread = null;
  let threadError = '';
  if (includeThread) {
    const author = summary.author.replace(/^@/, '');
    if (!summary.conversationId || !author) {
      threadError = 'Missing conversation_id or author username; thread search skipped.';
      progress(threadError);
    } else {
      progress('Searching for same-author thread continuations');
      try {
        thread = await xApiGet(
          '/tweets/search/recent',
          requestParams({
            query: `conversation_id:${summary.conversationId} from:${author} -is:retweet`,
            max_results: '100',
          }),
          bearerToken
        );
        progress(`Thread search returned ${(thread.data || []).length} post(s)`);
      } catch (error) {
        threadError = error.message;
        progress(`Thread search unavailable: ${threadError}`);
      }
    }
  }

  return {
    sourceUrl,
    postId,
    summary,
    lookup,
    thread,
    threadError,
  };
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function loadBearerToken() {
  if (process.env.X_BEARER_TOKEN) return process.env.X_BEARER_TOKEN;
  try {
    const text = await readFile(path.resolve('.env.local'), 'utf8');
    const line = text.split(/\r?\n/).find((item) => item.trim().startsWith('X_BEARER_TOKEN='));
    if (!line) return '';
    const value = line.slice(line.indexOf('=') + 1).trim();
    return value.replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    return '';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const includeThread = args.includes('--thread');
  const urls = args.filter((arg) => !arg.startsWith('--'));
  const bearerToken = await loadBearerToken();

  if (!urls.length) {
    console.error(
      'Usage: npm.cmd run probe:x -- [--thread] https://x.com/<handle>/status/<id> [...]'
    );
    process.exitCode = 2;
    return;
  }
  if (!bearerToken) {
    console.error(
      'X_BEARER_TOKEN is not set. Add it to the gitignored .env.local file; it is never printed.'
    );
    process.exitCode = 2;
    return;
  }

  const results = [];
  let failures = 0;
  console.log(
    `Starting bounded X API probe: ${urls.length} URL(s), at most ${includeThread ? 2 : 1} request(s) each.`
  );
  for (let index = 0; index < urls.length; index += 1) {
    const label = `[${index + 1}/${urls.length}]`;
    const progress = (message) => console.log(`${label} ${message}`);
    try {
      results.push(await probeOne(urls[index], bearerToken, includeThread, progress));
      progress('Done');
    } catch (error) {
      failures += 1;
      results.push({ sourceUrl: urls[index], error: error.message });
      progress(`Failed: ${error.message}`);
    }
  }

  const outputDir = path.resolve('probe-results');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `x-mobile-${timestampForFilename()}.json`);
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        includeThread,
        requestUpperBound: urls.length * (includeThread ? 2 : 1),
        results,
      },
      null,
      2
    )}\n`
  );
  console.log(`Summary: ${urls.length - failures} succeeded, ${failures} failed.`);
  console.log(`Raw API shapes saved locally: ${outputPath}`);
  if (failures) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) await main();

export { collectStringStats, loadBearerToken, postIdFromUrl, requestParams, summarizeLookup };
