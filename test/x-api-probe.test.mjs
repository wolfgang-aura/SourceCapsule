import assert from 'node:assert/strict';
import {
  collectStringStats,
  postIdFromUrl,
  requestParams,
  summarizeLookup,
} from '../scripts/probe-x-mobile.mjs';

assert.equal(
  postIdFromUrl('https://x.com/example/status/2072322225143980180?s=20'),
  '2072322225143980180'
);
assert.equal(
  postIdFromUrl('https://mobile.twitter.com/example/status/1234567890/photo/1'),
  '1234567890'
);
assert.equal(postIdFromUrl('https://example.com/example/status/1234567890'), '');

const params = requestParams({ query: 'conversation_id:123 from:example' });
assert.match(params['tweet.fields'], /article/);
assert.match(params['tweet.fields'], /note_tweet/);
assert.match(params.expansions, /article\.media_entities/);
assert.equal(params.query, 'conversation_id:123 from:example');

const fixture = {
  data: {
    id: '123',
    author_id: '42',
    conversation_id: '123',
    text: 'Article preview',
    article: {
      title: 'A complete title',
      content: [{ text: 'The long Article body.' }],
    },
    note_tweet: { text: 'Long post text.' },
    referenced_tweets: [{ id: '122', type: 'quoted' }],
  },
  includes: {
    users: [{ id: '42', username: 'writer' }],
    media: [{ media_key: '3_1', type: 'photo' }],
  },
};
const summary = summarizeLookup(fixture);
assert.equal(summary.author, '@writer');
assert.equal(summary.hasArticle, true);
assert.equal(summary.hasNoteTweet, true);
assert.equal(summary.mediaCount, 1);
assert.equal(summary.referencedPostCount, 1);
assert.ok(summary.article.totalStringChars > summary.textChars);

const stats = collectStringStats({ a: '123', nested: [{ b: '12345' }] });
assert.deepEqual(stats.keys, ['a', 'b', 'nested']);
assert.equal(stats.stringCount, 2);
assert.equal(stats.totalStringChars, 8);
assert.equal(stats.longestStringChars, 5);

console.log('SourceCapsule X API probe tests passed.');
