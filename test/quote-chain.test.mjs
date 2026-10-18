/**
 * Quote chains deeper than two levels (#85).
 *
 * A syndication payload carries exactly one level of `quoted_tweet`, and that nested
 * object has no id of its own next hop. So a chain main -> A -> B -> C -> ... is only
 * discoverable by fetching each leaf by id. This drives followQuoteChainsViaSyndication
 * with stubbed one-level payloads and checks the model, the .llm.md receipt and the HTML.
 *
 * TEST-verified only: no browser, no network.
 *
 * Run with: node test/quote-chain.test.mjs   (or npm test)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const engine = require(join(here, '..', 'sourcecapsule.user.js'));

const MAIN = '2111240021563056451';
// main -> A -> B -> C -> D -> E -> F, F quotes nothing.
const CHAIN = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({
  name,
  id: String(2110000000000000000 + (6 - i) * 1000),
  handle: i === 5 ? 'diros009' : 'hibtc37',
}));

function tweet(index, { nested = true } = {}) {
  const link = CHAIN[index];
  const next = CHAIN[index + 1];
  const payload = {
    __typename: 'Tweet',
    id_str: link.id,
    text: `Post ${link.name} text`,
    created_at: '2026-10-01T00:00:00.000Z',
    user: { name: link.name, screen_name: link.handle },
  };
  // Real payloads stop at one level: the nested quoted_tweet never carries its own.
  if (nested && next) payload.quoted_tweet = tweet(index + 1, { nested: false });
  return payload;
}

function stubFetch(overrides = {}) {
  const calls = [];
  const fetchTweet = async (id) => {
    calls.push(String(id));
    if (overrides[id]) return overrides[id]();
    const index = CHAIN.findIndex((link) => link.id === String(id));
    if (index < 0) throw Object.assign(new Error('syndication: HTTP 404'), { status: 404 });
    return tweet(index);
  };
  return { fetchTweet, calls };
}

// What the DOM gives us: the main post and a quote card for A carrying a poll that
// syndication does not return. X never renders a quote inside a quote card.
function domModel() {
  return {
    type: 'post',
    title: 'Chain',
    sourceUrl: `https://x.com/hibtc37/status/${MAIN}`,
    author: { name: 'hibtc37', handle: '@hibtc37' },
    exportedAt: '2026-10-18T00:00:00.000Z',
    blocks: [
      { kind: 'paragraph', html: 'Main post' },
      {
        kind: 'quote',
        author: { name: 'A', handle: '@hibtc37' },
        sourceUrl: `https://x.com/hibtc37/status/${CHAIN[0].id}`,
        blocks: [
          { kind: 'paragraph', html: 'Post A text' },
          { kind: 'poll', question: 'DOM-only poll', choices: [{ label: 'yes' }] },
        ],
      },
    ],
  };
}

function chainIds(model) {
  const ids = [];
  let quote = model.blocks.find((b) => b.kind === 'quote');
  while (quote) {
    ids.push(quote.sourceUrl.split('/').pop());
    quote = quote.blocks.find((b) => b.kind === 'quote');
  }
  return ids;
}

function findBlock(blocks, kind) {
  for (const b of blocks || []) {
    if (b.kind === kind) return b;
    const inner = findBlock(b.blocks, kind);
    if (inner) return inner;
  }
  return null;
}

// 1. The whole chain is followed, one fetch per hop, and the DOM poll survives.
{
  const model = domModel();
  const { fetchTweet } = stubFetch();
  await engine.followQuoteChainsViaSyndication(model, null, fetchTweet);
  assert.deepEqual(
    chainIds(model),
    CHAIN.map((link) => link.id),
    'all six quote levels are nested in the model'
  );
  assert.ok(
    model.blocks[1].blocks.some((b) => b.kind === 'poll'),
    'the DOM-only poll on the first quote survives'
  );
  assert.equal(findBlock(model.blocks, 'quote-chain-note'), null, 'a chain that ends is no gap');
  const md = engine.renderLlmMarkdown(model);
  assert.match(md, /Status: COMPLETE/);
  // Headings stop at ###### from level four on; the numbers must keep levels apart.
  ['1', '1.1', '1.1.1', '1.1.1.1', '1.1.1.1.1', '1.1.1.1.1.1'].forEach((n) => {
    assert.ok(md.includes(`Post ${n}\n`), `quote label ${n} is present`);
  });
  assert.match(md, /###### Nested Quoted Post 1\.1\.1\.1\.1\.1\n/);
  assert.match(md, /- Embedded posts: 6 total/);
  const html = engine.assembleHtml(model);
  assert.equal((html.match(/class="[^"]*xa-nested-tweet-card/g) || []).length, 5, 'nested cards');
  // Each card's permalink sits in its own header, above what it quotes (#89). In a footer
  // they came out innermost first, stacked below the whole chain.
  const links = [...html.matchAll(/class="xa-quote-link" href="[^"]*\/status\/(\d+)"/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(
    links,
    CHAIN.map((link) => link.id),
    'quote permalinks read top-down, outermost first'
  );
}

// 2. Past the hop cap: a visible note, a receipt that is not COMPLETE, and no blocker.
{
  const model = domModel();
  const { fetchTweet } = stubFetch();
  await engine.followQuoteChainsViaSyndication(model, null, fetchTweet, { maxDepth: 3 });
  assert.deepEqual(chainIds(model), [CHAIN[0].id, CHAIN[1].id, CHAIN[2].id]);
  const note = findBlock(model.blocks, 'quote-chain-note');
  assert.ok(note, 'the cap leaves a note in the model');
  assert.equal(note.reason, 'cap');
  const md = engine.renderLlmMarkdown(model);
  assert.match(md, /Status: INCOMPLETE/);
  assert.ok(md.includes(`not followed past ${CHAIN[2].id}`), 'the .llm.md names the last hop');
  const html = engine.assembleHtml(model);
  assert.ok(html.includes(`not followed past ${CHAIN[2].id}`), 'the HTML shows the note');
  assert.match(html, /Incomplete capture/);
  assert.equal(engine.archiveStats(model).quoteChainsUnfollowed, 1);
  assert.equal(
    engine.assessExportCompleteness(model).verdict,
    'clean',
    'a capped chain is never a strict-mode blocker'
  );
}

// 3. A chain that ends exactly at the cap is complete: the leaf at the cap is fetched
// to find out, and only a further quote earns the note.
{
  const model = domModel();
  const { fetchTweet } = stubFetch();
  await engine.followQuoteChainsViaSyndication(model, null, fetchTweet, { maxDepth: 6 });
  assert.equal(chainIds(model).length, 6);
  assert.equal(findBlock(model.blocks, 'quote-chain-note'), null);
  assert.match(engine.renderLlmMarkdown(model), /Status: COMPLETE/);
}

// 4. Failures. A 5xx on a leaf is an honest gap; a 404 means X says the post is gone,
// which is a tombstone note, not a gap. Thread segments are walked like the main post.
{
  const failing = {
    blocks: [
      { kind: 'thread-marker', statusId: MAIN, sourceUrl: `https://x.com/hibtc37/status/${MAIN}` },
      engine.syndicationToQuoteBlock(tweet(0)),
    ],
  };
  const model = { ...domModel(), thread: { capturedPosts: 1 }, blocks: failing.blocks };
  const { fetchTweet } = stubFetch({
    [CHAIN[1].id]: () => {
      throw Object.assign(new Error('syndication: HTTP 503'), { status: 503 });
    },
  });
  await engine.followQuoteChainsViaSyndication(model, null, fetchTweet);
  const note = findBlock(model.blocks, 'quote-chain-note');
  assert.equal(note && note.reason, 'error', 'a 503 leaves an error note');
  assert.match(engine.renderLlmMarkdown(model), /Status: INCOMPLETE/);

  const gone = { ...domModel(), blocks: [engine.syndicationToQuoteBlock(tweet(0))] };
  const notFound = stubFetch({
    [CHAIN[1].id]: () => {
      throw Object.assign(new Error('syndication: HTTP 404'), { status: 404 });
    },
  });
  await engine.followQuoteChainsViaSyndication(gone, null, notFound.fetchTweet);
  const tombstone = findBlock(gone.blocks, 'quote-tombstone');
  assert.ok(tombstone && tombstone.chainEnd, 'a 404 on a leaf becomes a quote tombstone');
  assert.equal(findBlock(gone.blocks, 'quote-chain-note'), null);
  assert.match(engine.renderLlmMarkdown(gone), /Status: COMPLETE/);
}

// 5. A cycle stops without a note.
{
  const looped = tweet(1);
  looped.quoted_tweet = tweet(0, { nested: false });
  const model = domModel();
  const { fetchTweet } = stubFetch({ [CHAIN[1].id]: () => looped });
  await engine.followQuoteChainsViaSyndication(model, null, fetchTweet);
  assert.deepEqual(chainIds(model), [CHAIN[0].id, CHAIN[1].id]);
  assert.equal(findBlock(model.blocks, 'quote-chain-note'), null);
}

// 5b. A reply-context card's quote chain is followed too (#98): it used to stop one level
// down with no note. A cut-short chain there is context, so it is a note, not a gap.
{
  const contextModel = () => ({
    ...domModel(),
    blocks: [
      { ...engine.syndicationToQuoteBlock(tweet(3, { nested: false })), replyContext: true },
      { kind: 'paragraph', html: 'Main post' },
    ],
  });
  const model = contextModel();
  const { fetchTweet } = stubFetch();
  await engine.followQuoteChainsViaSyndication(model, null, fetchTweet);
  assert.deepEqual(chainIds(model), [CHAIN[3].id, CHAIN[4].id, CHAIN[5].id]);

  const capped = contextModel();
  await engine.followQuoteChainsViaSyndication(capped, null, stubFetch().fetchTweet, {
    maxDepth: 2,
  });
  assert.ok(findBlock(capped.blocks, 'quote-chain-note'), 'the cap is still stated');
  const md = engine.renderLlmMarkdown(capped);
  assert.match(md, /Status: COMPLETE/, 'a cut-short chain in the context is no capture gap');
  assert.match(md, /Quote chain not followed past/);
}

// 6. A quote the main pass could not fetch is rebuilt by the strict-mode repair round,
// which must follow its chain too, not stop at the one level the payload carries.
{
  const model = domModel();
  model.blocks[1].blocks = [];
  const { fetchTweet } = stubFetch();
  await engine.repairExportBlockers(model, engine.assessExportCompleteness(model), null, {
    fetchTweet,
    rescue: async () => {},
    pauseMs: 0,
  });
  assert.deepEqual(
    chainIds(model),
    CHAIN.map((link) => link.id),
    'the repair round follows the chain'
  );
}

// 7. A level built from its parent's nested quoted_tweet has no `card` or `note_tweet`:
// real payloads drop both there. The leaf's own by-id payload, already fetched to find the
// next hop, supplies its poll and long-form flag (#94).
{
  const model = domModel();
  const B = CHAIN[1];
  const s = (value) => ({ string_value: value, type: 'STRING' });
  const { fetchTweet } = stubFetch({
    [B.id]: () => ({
      ...tweet(1),
      note_tweet: { id: 'note-b' },
      card: {
        name: 'poll2choice_text_only',
        binding_values: {
          choice1_label: s('Up'),
          choice1_count: s('3'),
          choice2_label: s('Down'),
          choice2_count: s('1'),
          counts_are_final: { boolean_value: true, type: 'BOOLEAN' },
        },
      },
    }),
  });
  const lookupNote = (id) => (id === B.id ? { text: 'Post B full long-form text' } : null);
  await engine.followQuoteChainsViaSyndication(model, null, fetchTweet, { lookupNote });
  const quoteB = model.blocks[1].blocks.find((b) => b.kind === 'quote');
  assert.equal(quoteB.sourceUrl.split('/').pop(), B.id);
  const poll = quoteB.blocks.find((b) => b.kind === 'poll');
  assert.ok(poll, 'level B keeps the poll its own payload carries');
  assert.equal(poll.choices[0].percentage, '75%');
  assert.equal(quoteB.noteRecovered, true, 'level B gets its full long-form text');
  assert.match(engine.renderLlmMarkdown(model), /Post B full long-form text/);
  assert.deepEqual(
    chainIds(model),
    CHAIN.map((link) => link.id),
    'the chain still continues'
  );
}

// 8. A quoted post that is gone on X renders as a tombstone, never an empty quote (#102).
{
  const A = CHAIN[0];
  const payload = {
    ...tweet(0, { nested: false }),
    quoted_tweet: {
      __typename: 'TweetTombstone',
      tombstone: { text: { text: 'This Post was deleted by the Post author.' } },
    },
  };
  const card = engine.syndicationToQuoteBlock(payload);
  assert.equal(card.sourceUrl.split('/').pop(), A.id);
  assert.equal(
    card.blocks.filter((b) => b.kind === 'quote').length,
    0,
    'no empty quote with no URL'
  );
  const tomb = card.blocks.find((b) => b.kind === 'quote-tombstone');
  assert.ok(tomb, 'the gone post is an honest tombstone');
  assert.match(tomb.notice, /deleted/);
  const model = {
    ...domModel(),
    blocks: [{ kind: 'paragraph', html: 'Main post' }, card],
  };
  const assessment = engine.assessExportCompleteness(model);
  assert.equal(assessment.blockers.length, 0, JSON.stringify(assessment.blockers));
}

// 9. Content the DOM had and syndication left out survives the merge (#102).
{
  const A = CHAIN[0];
  const B = CHAIN[1];
  const dom = {
    kind: 'quote',
    author: { name: 'A', handle: '@hibtc37' },
    sourceUrl: `https://x.com/hibtc37/status/${A.id}`,
    blocks: [
      { kind: 'paragraph', html: 'Post A text' },
      { kind: 'quote-tombstone', notice: 'This Post is unavailable.' },
    ],
  };
  const merged = engine.mergeQuoteAfterSyndication(
    dom,
    engine.syndicationToQuoteBlock(tweet(0, { nested: false }))
  );
  assert.ok(
    merged.blocks.some((b) => b.kind === 'quote-tombstone'),
    'a DOM tombstone is kept when the payload says nothing'
  );

  const withNested = {
    ...dom,
    blocks: [
      { kind: 'paragraph', html: 'Post A text' },
      {
        kind: 'quote',
        author: { name: 'B', handle: '@hibtc37' },
        sourceUrl: `https://x.com/hibtc37/status/${B.id}`,
        blocks: [{ kind: 'paragraph', html: 'Post B text' }],
      },
    ],
  };
  const kept = engine.mergeQuoteAfterSyndication(
    withNested,
    engine.syndicationToQuoteBlock(tweet(0, { nested: false }))
  );
  const nested = kept.blocks.find((b) => b.kind === 'quote');
  assert.ok(nested, 'a DOM nested quote the payload omits is kept');
  assert.equal(nested.sourceUrl.split('/').pop(), B.id);

  // But a payload that has its own nested quote is authoritative: no twin.
  const fresh = engine.mergeQuoteAfterSyndication(
    withNested,
    engine.syndicationToQuoteBlock(tweet(0))
  );
  assert.equal(fresh.blocks.filter((b) => b.kind === 'quote').length, 1, 'no duplicate nest');
  assert.equal(fresh.blocks.filter((b) => b.kind === 'quote-tombstone').length, 0);
}

// 10. A rebuild from A's payload (whose nested B never carries note_tweet) keeps what B
//     learned from its own payload: recovered long-form text, a preview flag, a chain note.
{
  const [A, B, C] = CHAIN;
  const oldA = () => ({
    kind: 'quote',
    author: { name: 'A', handle: '@hibtc37' },
    sourceUrl: `https://x.com/hibtc37/status/${A.id}`,
    blocks: [
      { kind: 'paragraph', html: 'Post A text' },
      {
        kind: 'quote',
        author: { name: 'B', handle: '@hibtc37' },
        sourceUrl: `https://x.com/hibtc37/status/${B.id}`,
        noteRecovered: true,
        blocks: [
          { kind: 'paragraph', html: 'Post B full long-form text' },
          {
            kind: 'quote',
            author: { name: 'C', handle: '@hibtc37' },
            sourceUrl: `https://x.com/hibtc37/status/${C.id}`,
            truncated: true,
            blocks: [
              { kind: 'paragraph', html: 'Post C preview' },
              { kind: 'quote-chain-note', reason: 'cap', statusId: C.id, limit: 2 },
            ],
          },
        ],
      },
    ],
  });
  const merged = engine.mergeQuoteAfterSyndication(
    oldA(),
    engine.syndicationToQuoteBlock(tweet(0))
  );
  const b = merged.blocks.find((x) => x.kind === 'quote');
  assert.equal(b.noteRecovered, true, 'B keeps its recovered long-form text');
  assert.match(b.blocks[0].html, /full long-form/);
  assert.equal(b.truncated, false);
  const c = b.blocks.find((x) => x.kind === 'quote');
  assert.ok(c, 'C survives a one-level rebuild');
  assert.equal(c.truncated, true, 'C still says only a preview was available');
  assert.ok(
    c.blocks.some((x) => x.kind === 'quote-chain-note'),
    'the cap note survives'
  );
}

// 11. A quote whose own fetch answers with a tombstone keeps its DOM card, and says it
//     could not be cross-checked (#102, #99).
{
  const model = domModel();
  const A = CHAIN[0];
  await engine.enrichQuotesViaSyndication(model, null, async (id) =>
    id === A.id ? { __typename: 'TweetTombstone', tombstone: { text: { text: 'Gone' } } } : null
  );
  const quote = model.blocks.find((b) => b.kind === 'quote');
  assert.equal(quote.sourceUrl.split('/').pop(), A.id);
  assert.match(quote.blocks[0].html, /Post A text/);
  assert.ok(
    (model.syndicationUnchecked || []).some((item) => item.statusId === A.id),
    'the card is named as not cross-checked'
  );
}

console.log('quote-chain test passed');
