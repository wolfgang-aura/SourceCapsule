/**
 * Polls in syndication-rebuilt posts (#94).
 *
 * A poll used to survive only when X had mounted it in the DOM. Every post the engine
 * rebuilds from `cdn.syndication.twimg.com/tweet-result` (a deeper quote-chain level, a
 * reply-context card, a quote card that never mounted, a focused post whose poll was
 * virtualized away) lost it with no note. The payload carries the poll in `card`.
 *
 * TEST-verified only: no browser, no network.
 *
 * Run with: node test/syndication-poll.test.mjs   (or npm test)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const engine = require(join(here, '..', 'sourcecapsule.user.js'));

const POLL_ID = '2111862427415650671';
const POLL_URL = `https://x.com/kctrades/status/${POLL_ID}`;

// The shape of a real payload's `card` (trimmed from 2111862427415650671).
function pollCard({ final = false, end = '2026-10-19T16:50:13Z' } = {}) {
  const s = (value) => ({ string_value: value, type: 'STRING' });
  return {
    name: 'poll4choice_text_only',
    url: 'card://2111862420000000000',
    binding_values: {
      choice1_label: s('10k to 20k swing'),
      choice1_count: s('9'),
      choice2_label: s('5k to 10k swing'),
      choice2_count: s('20'),
      choice3_label: s('Half port size trades'),
      choice3_count: s('8'),
      choice4_label: s('Full port size trades'),
      choice4_count: s('12'),
      end_datetime_utc: s(end),
      last_updated_datetime_utc: s('2026-10-18T17:19:01Z'),
      counts_are_final: { boolean_value: final, type: 'BOOLEAN' },
    },
  };
}

function pollTweet(extra = {}) {
  return {
    __typename: 'Tweet',
    id_str: POLL_ID,
    text: 'How do you size your trades?',
    created_at: '2026-10-18T16:50:13.000Z',
    user: { name: 'KC', screen_name: 'kctrades' },
    card: pollCard(extra),
  };
}

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

const pollsIn = (blocks) =>
  (blocks || []).flatMap((b) =>
    b.kind === 'poll' ? [b] : b.kind === 'quote' ? pollsIn(b.blocks) : []
  );

console.log('SourceCapsule syndication-poll test\n');

await check('a quote rebuilt from syndication keeps its poll, with counts', () => {
  const quote = engine.syndicationToQuoteBlock(pollTweet({ final: true }));
  const polls = pollsIn(quote.blocks);
  assert.equal(polls.length, 1, 'the poll must be in the rebuilt quote');
  const [poll] = polls;
  assert.deepEqual(
    poll.choices.map((c) => [c.label, c.votes, c.percentage]),
    [
      ['10k to 20k swing', '9', '18.4%'],
      ['5k to 10k swing', '20', '40.8%'],
      ['Half port size trades', '8', '16.3%'],
      ['Full port size trades', '12', '24.5%'],
    ]
  );
  assert.equal(poll.totalVotes, '49');
  assert.equal(poll.status, 'Final results');
  assert.equal(poll.sourcePostId, POLL_ID);
  assert.equal(poll.resultsUnavailable, false);
});

await check('an open poll says the counts are a snapshot', () => {
  const quote = engine.syndicationToQuoteBlock(pollTweet({ end: '2999-01-01T00:00:00Z' }));
  const [poll] = pollsIn(quote.blocks);
  assert.match(poll.status, /open until 2999-01-01 00:00:00 UTC/i);
  assert.match(poll.status, /counts as of 2026-10-18 17:19:01 UTC/);
});

await check('a poll two levels down a quote chain reaches the .llm.md', () => {
  const parent = {
    __typename: 'Tweet',
    id_str: '2111862427415650999',
    text: 'Look at this poll',
    created_at: '2026-10-18T17:00:00.000Z',
    user: { name: 'Q', screen_name: 'quoter' },
    quoted_tweet: pollTweet(),
  };
  const model = {
    type: 'post',
    title: 'Poll chain',
    author: { name: 'M', handle: '@m' },
    sourceUrl: 'https://x.com/m/status/2111862427415651000',
    exportedAt: '2026-10-19T00:00:00Z',
    blocks: [{ kind: 'paragraph', html: 'Main' }, engine.syndicationToQuoteBlock(parent)],
  };
  assert.equal(engine.archiveStats(model).polls, 1);
  const md = engine.renderLlmMarkdown(model);
  assert.match(md, /5k to 10k swing - 40\.8%, 20 votes/);
});

await check('the DOM poll wins when it shows results, and is not duplicated', () => {
  const domPoll = {
    kind: 'poll',
    choices: [
      { label: '10k to 20k swing', percentage: '18%', votes: '9' },
      { label: '5k to 10k swing', percentage: '41%', votes: '20' },
    ],
    status: 'Final results',
    sourcePostId: POLL_ID,
    sourceUrl: POLL_URL,
    resultsUnavailable: false,
  };
  const existing = {
    kind: 'quote',
    sourceUrl: POLL_URL,
    blocks: [{ kind: 'paragraph', html: 'x' }, domPoll],
  };
  const merged = engine.mergeQuoteAfterSyndication(
    existing,
    engine.syndicationToQuoteBlock(pollTweet())
  );
  const polls = pollsIn(merged.blocks);
  assert.equal(polls.length, 1);
  assert.equal(polls[0].choices[0].percentage, '18%');
});

await check('syndication counts replace a DOM poll that showed none', () => {
  const domPoll = {
    kind: 'poll',
    choices: [{ label: '10k to 20k swing' }, { label: '5k to 10k swing' }],
    sourcePostId: POLL_ID,
    sourceUrl: POLL_URL,
    resultsUnavailable: true,
  };
  const existing = { kind: 'quote', sourceUrl: POLL_URL, blocks: [domPoll] };
  const merged = engine.mergeQuoteAfterSyndication(
    existing,
    engine.syndicationToQuoteBlock(pollTweet())
  );
  const polls = pollsIn(merged.blocks);
  assert.equal(polls.length, 1);
  assert.equal(polls[0].resultsUnavailable, false);
  assert.equal(polls[0].totalVotes, '49');
});

await check('a focused post whose poll never reached the DOM gets it back', async () => {
  const model = {
    type: 'post',
    title: 'Focused',
    author: { name: 'KC', handle: '@kctrades' },
    sourceUrl: POLL_URL,
    exportedAt: '2026-10-19T00:00:00Z',
    blocks: [{ kind: 'paragraph', html: 'How do you size your trades?' }],
  };
  await engine.enrichFocusedPostViaSyndication(
    model,
    null,
    async () => pollTweet(),
    () => null
  );
  assert.equal(model.blocks.filter((b) => b.kind === 'poll').length, 1);
});

console.log('');
if (failures) {
  console.error(`${failures} syndication-poll check(s) failed`);
  process.exit(1);
}
console.log('All syndication-poll checks passed');
