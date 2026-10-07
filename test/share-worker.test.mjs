import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker, { cleanupExpired } from '../share-worker/worker.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryR2 {
  constructor() {
    this.objects = new Map();
    this.getCount = 0;
  }

  async put(key, value, options = {}) {
    const bytes = new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, {
      bytes,
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    });
  }

  async get(key) {
    this.getCount += 1;
    const item = this.objects.get(key);
    if (!item) return null;
    return {
      body: item.bytes,
      size: item.bytes.byteLength,
      customMetadata: item.customMetadata,
      text: async () => new TextDecoder().decode(item.bytes),
      writeHttpMetadata(headers) {
        if (item.httpMetadata.contentType)
          headers.set('Content-Type', item.httpMetadata.contentType);
      },
    };
  }

  async head(key) {
    const item = this.objects.get(key);
    return item ? { customMetadata: item.customMetadata } : null;
  }

  async list({ prefix = '', include = [] } = {}) {
    const wantCustom = include.includes('customMetadata');
    return {
      objects: Array.from(this.objects.keys())
        .filter((key) => key.startsWith(prefix))
        .map((key) => {
          const item = this.objects.get(key);
          const entry = { key, size: item.bytes.byteLength };
          // R2 only returns customMetadata when it is explicitly requested; the double
          // enforces that so the cleanup job cannot silently rely on it going missing.
          if (wantCustom) entry.customMetadata = item.customMetadata;
          return entry;
        }),
      truncated: false,
    };
  }

  async delete(keys) {
    (Array.isArray(keys) ? keys : [keys]).forEach((key) => this.objects.delete(key));
  }
}

const env = { CAPSULES: new MemoryR2() };
const ctx = { waitUntil: (promise) => promise };

const bad = await worker.fetch(
  new Request('https://share.example/api/capsules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiryDays: 999 }),
  }),
  env,
  ctx
);
assert.equal(bad.status, 400);

const createdResponse = await worker.fetch(
  new Request('https://share.example/api/capsules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiryDays: 7 }),
  }),
  env,
  ctx
);
assert.equal(createdResponse.status, 201);
const created = await createdResponse.json();
assert.match(created.id, /^[a-f0-9]{32}$/);
assert.ok(created.viewUrl.endsWith(`/c/${created.id}`));

for (const [name, content, contentType] of [
  ['content.html', '<!doctype html><title>Shared</title>', 'text/html'],
  ['content.md', '# Shared', 'text/markdown'],
  ['manifest.json', '{"ok":true}', 'application/json'],
  ['media/image-001.jpg', new Uint8Array([1, 2, 3]), 'image/jpeg'],
]) {
  const response = await worker.fetch(
    new Request(`${created.uploadUrl}/${name}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${created.uploadToken}`, 'Content-Type': contentType },
      body: content,
      duplex: 'half',
    }),
    env,
    ctx
  );
  assert.equal(response.status, 200, `upload ${name}`);
}

const finalize = await worker.fetch(
  new Request(created.finalizeUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${created.uploadToken}` },
  }),
  env,
  ctx
);
assert.equal(finalize.status, 200);

const page = await worker.fetch(new Request(created.viewUrl), env, ctx);
assert.equal(page.status, 200);
assert.equal(await page.text(), '<!doctype html><title>Shared</title>');
assert.equal(page.headers.get('X-Robots-Tag'), 'noindex, nofollow');

const markdown = await worker.fetch(new Request(created.markdownUrl), env, ctx);
assert.equal(markdown.status, 200);
assert.equal(await markdown.text(), '# Shared');

const image = await worker.fetch(new Request(`${created.viewUrl}/media/image-001.jpg`), env, ctx);
assert.equal(image.status, 200);
assert.equal(image.headers.get('Content-Type'), 'image/jpeg');
assert.equal(image.headers.get('Content-Length'), '3');
assert.equal((await image.arrayBuffer()).byteLength, 3);

// HEAD /c/{id}/media/x.jpg must report Content-Length. Without it, Slack, Discord,
// and Twitter link-preview crawlers skip the asset - which is why shared images
// silently vanished from social previews before this fix.
const imageHead = await worker.fetch(
  new Request(`${created.viewUrl}/media/image-001.jpg`, { method: 'HEAD' }),
  env,
  ctx
);
assert.equal(imageHead.status, 200);
assert.equal(imageHead.headers.get('Content-Type'), 'image/jpeg');
assert.equal(imageHead.headers.get('Content-Length'), '3');
assert.equal((await imageHead.arrayBuffer()).byteLength, 0, 'HEAD carries no body');

const pageHead = await worker.fetch(new Request(created.viewUrl, { method: 'HEAD' }), env, ctx);
assert.equal(pageHead.status, 200);
assert.equal(
  pageHead.headers.get('Content-Length'),
  String('<!doctype html><title>Shared</title>'.length)
);

// A published capsule is immutable: its token can still delete it, but uploads answer 409.
const lateUpload = await worker.fetch(
  new Request(`${created.uploadUrl}/media/image-002.jpg`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${created.uploadToken}` },
    body: new Uint8Array([4, 5, 6]),
    duplex: 'half',
  }),
  env,
  ctx
);
assert.equal(lateUpload.status, 409);
assert.equal(
  (await worker.fetch(new Request(`${created.viewUrl}/media/image-002.jpg`), env, ctx)).status,
  404
);

{
  const limitedEnv = {
    CAPSULES: env.CAPSULES,
    CREATE_LIMITER: { limit: async () => ({ success: false }) },
  };
  const limited = await worker.fetch(
    new Request('https://share.example/api/capsules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify({ expiryDays: 7 }),
    }),
    limitedEnv,
    ctx
  );
  assert.equal(limited.status, 429);

  const openEnv = {
    CAPSULES: env.CAPSULES,
    CREATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  const allowed = await worker.fetch(
    new Request('https://share.example/api/capsules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify({ expiryDays: 1 }),
    }),
    openEnv,
    ctx
  );
  assert.equal(allowed.status, 201);
  const allowedCapsule = await allowed.json();
  await worker.fetch(
    new Request(allowedCapsule.deleteUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${allowedCapsule.deleteToken}` },
    }),
    env,
    ctx
  );
}

const deleted = await worker.fetch(
  new Request(created.deleteUrl, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${created.deleteToken}` },
  }),
  env,
  ctx
);
assert.equal(deleted.status, 200);
assert.equal((await worker.fetch(new Request(created.viewUrl), env, ctx)).status, 404);

// --- Expired-capsule tombstone -------------------------------------------------
// An expired share link used to be a dead end: the worker deleted everything and
// answered with a bare 410. It now keeps a back-link to the original X post.

const SOURCE = 'https://x.com/jack/status/20';

async function publishCapsule(
  store,
  { sourceUrl = SOURCE, title = 'Hello world', handle = '@jack' } = {}
) {
  const response = await worker.fetch(
    new Request('https://share.example/api/capsules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiryDays: 7, sourceUrl, title, handle }),
    }),
    { CAPSULES: store },
    ctx
  );
  const capsule = await response.json();
  for (const [name, content, contentType] of [
    ['content.html', '<!doctype html><title>Live</title>', 'text/html'],
    ['content.md', '# Live', 'text/markdown'],
    ['manifest.json', '{"ok":true}', 'application/json'],
    ['media/image-001.jpg', new Uint8Array([1, 2, 3]), 'image/jpeg'],
  ]) {
    await worker.fetch(
      new Request(`${capsule.uploadUrl}/${name}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${capsule.uploadToken}`, 'Content-Type': contentType },
        body: content,
        duplex: 'half',
      }),
      { CAPSULES: store },
      ctx
    );
  }
  await worker.fetch(
    new Request(capsule.finalizeUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${capsule.uploadToken}` },
    }),
    { CAPSULES: store },
    ctx
  );
  return capsule;
}

// Rewrite a stored capsule's expiry to a past date, the way the clock would.
function forceExpiry(store, id, iso) {
  const item = store.objects.get(`capsules/${id}/_meta.json`);
  const meta = JSON.parse(new TextDecoder().decode(item.bytes));
  meta.expiresAt = iso;
  item.bytes = new TextEncoder().encode(JSON.stringify(meta));
  item.customMetadata = { ...item.customMetadata, expiresAt: iso };
}

const past = new Date(Date.now() - 86400000).toISOString();

{
  // A hostile or unrecognised source URL is dropped, never stored or echoed back.
  const store = new MemoryR2();
  for (const badSource of [
    'https://evil.example/jack/status/20',
    'javascript:alert(1)',
    'https://x.com.evil.example/jack/status/20',
    'https://x.com/jack/status/20?utm=1',
  ]) {
    const response = await worker.fetch(
      new Request('https://share.example/api/capsules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiryDays: 7, sourceUrl: badSource }),
      }),
      { CAPSULES: store },
      ctx
    );
    assert.equal(response.status, 201, `capsule still created for ${badSource}`);
    assert.equal((await response.json()).sourceUrl, '', `sourceUrl rejected: ${badSource}`);
  }
  const good = await worker.fetch(
    new Request('https://share.example/api/capsules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expiryDays: 7,
        sourceUrl: 'https://twitter.com/jack/status/20/photo/1',
      }),
    }),
    { CAPSULES: store },
    ctx
  );
  assert.equal((await good.json()).sourceUrl, SOURCE, 'normalized to a canonical permalink');
}

{
  // Serving an overdue capsule: content is deleted, the back-link survives.
  const store = new MemoryR2();
  const tombEnv = { CAPSULES: store };
  const capsule = await publishCapsule(store, { title: 'Title <script>alert(1)</script>' });
  forceExpiry(store, capsule.id, past);

  const expired = await worker.fetch(new Request(capsule.viewUrl), tombEnv, ctx);
  assert.equal(expired.status, 410);
  assert.match(expired.headers.get('Content-Type'), /text\/html/);
  const body = await expired.text();
  assert.ok(body.includes(SOURCE), 'tombstone links back to the original post');
  assert.ok(!body.includes('<script>alert(1)</script>'), 'title is HTML-escaped');
  assert.equal(expired.headers.get('X-Robots-Tag'), 'noindex, nofollow');

  assert.equal(store.objects.has(`capsules/${capsule.id}/content.html`), false, 'HTML deleted');
  assert.equal(
    store.objects.has(`capsules/${capsule.id}/media/image-001.jpg`),
    false,
    'media deleted'
  );
  assert.equal(store.objects.has(`capsules/${capsule.id}/_meta.json`), true, 'tombstone kept');

  // Every later request hits the tombstone path rather than the live path.
  const again = await worker.fetch(new Request(capsule.viewUrl), tombEnv, ctx);
  assert.equal(again.status, 410);
  assert.ok((await again.text()).includes(SOURCE));

  const head = await worker.fetch(new Request(capsule.viewUrl, { method: 'HEAD' }), tombEnv, ctx);
  assert.equal(head.status, 410);
  assert.ok(Number(head.headers.get('Content-Length')) > 0);
  assert.equal((await head.arrayBuffer()).byteLength, 0, 'HEAD carries no body');

  // The .md view stays machine-readable for the AI tools these links are made for.
  const markdown = await worker.fetch(new Request(capsule.markdownUrl), tombEnv, ctx);
  assert.equal(markdown.status, 410);
  assert.match(markdown.headers.get('Content-Type'), /text\/markdown/);
  assert.ok((await markdown.text()).includes(SOURCE));

  // Re-uploading into an expired capsule stays impossible.
  const reupload = await worker.fetch(
    new Request(`${capsule.uploadUrl}/content.html`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${capsule.uploadToken}`, 'Content-Type': 'text/html' },
      body: '<p>new</p>',
      duplex: 'half',
    }),
    tombEnv,
    ctx
  );
  assert.equal(reupload.status, 410);
  const refinalize = await worker.fetch(
    new Request(capsule.finalizeUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${capsule.uploadToken}` },
    }),
    tombEnv,
    ctx
  );
  assert.equal(refinalize.status, 410);

  // The creator's delete token still hard-deletes the tombstone.
  const deleted = await worker.fetch(
    new Request(capsule.deleteUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${capsule.deleteToken}` },
    }),
    tombEnv,
    ctx
  );
  assert.equal(deleted.status, 200);
  assert.equal(store.objects.has(`capsules/${capsule.id}/_meta.json`), false, 'tombstone removed');
  assert.equal((await worker.fetch(new Request(capsule.viewUrl), tombEnv, ctx)).status, 404);
}

{
  // No usable source URL means no tombstone: behaviour is exactly as before.
  const store = new MemoryR2();
  const tombEnv = { CAPSULES: store };
  const capsule = await publishCapsule(store, { sourceUrl: '' });
  forceExpiry(store, capsule.id, past);
  const expired = await worker.fetch(new Request(capsule.viewUrl), tombEnv, ctx);
  assert.equal(expired.status, 410);
  assert.equal(await expired.text(), 'This SourceCapsule link has expired.');
  assert.equal(store.objects.has(`capsules/${capsule.id}/_meta.json`), false, 'no tombstone kept');
}

{
  // The scheduled sweep: expire overdue capsules, keep fresh tombstones, drop worn-out
  // ones, and leave live capsules alone.
  const store = new MemoryR2();
  const tombEnv = { CAPSULES: store };
  const live = await publishCapsule(store);
  const overdue = await publishCapsule(store);
  const stale = await publishCapsule(store);
  forceExpiry(store, overdue.id, past);
  forceExpiry(store, stale.id, new Date(Date.now() - 200 * 86400000).toISOString());

  await cleanupExpired(tombEnv);
  assert.equal(store.objects.has(`capsules/${live.id}/content.html`), true, 'live capsule intact');
  assert.equal(
    store.objects.has(`capsules/${overdue.id}/content.html`),
    false,
    'overdue content gone'
  );
  assert.equal(store.objects.has(`capsules/${overdue.id}/_meta.json`), true, 'overdue tombstoned');

  // A tombstone older than the retention window is hard-deleted on the next sweep.
  await cleanupExpired(tombEnv);
  assert.equal(
    store.objects.has(`capsules/${stale.id}/_meta.json`),
    false,
    'worn-out tombstone gone'
  );

  // An upload abandoned before finalize leaves nothing behind, tombstone included.
  const abandoned = await (
    await worker.fetch(
      new Request('https://share.example/api/capsules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiryDays: 1, sourceUrl: SOURCE, title: 'Abandoned' }),
      }),
      tombEnv,
      ctx
    )
  ).json();
  forceExpiry(store, abandoned.id, past);
  await cleanupExpired(tombEnv);
  assert.equal(
    store.objects.has(`capsules/${abandoned.id}/_meta.json`),
    false,
    'abandoned upload leaves no tombstone'
  );

  // Cost guard: the sweep must not read every capsule. A live capsule and a fresh
  // tombstone are both judged from the list page alone.
  const readsBefore = store.getCount;
  await cleanupExpired(tombEnv);
  assert.equal(store.getCount, readsBefore, 'no per-capsule reads when nothing is due');
}

{
  // One corrupt _meta.json or one failing delete must not stop the sweep: the capsules
  // behind it still expire, and the failure is logged rather than thrown.
  const store = new MemoryR2();
  const sweepEnv = { CAPSULES: store };
  const corrupt = await publishCapsule(store);
  const wornOut = await publishCapsule(store);
  const overdue = await publishCapsule(store);
  forceExpiry(store, corrupt.id, past);
  store.objects.get(`capsules/${corrupt.id}/_meta.json`).bytes = new TextEncoder().encode('{nope');
  forceExpiry(store, wornOut.id, new Date(Date.now() - 200 * 86400000).toISOString());
  const wornKey = `capsules/${wornOut.id}/_meta.json`;
  store.objects.get(wornKey).customMetadata.status = 'expired';
  forceExpiry(store, overdue.id, past);
  const realDelete = store.delete.bind(store);
  store.delete = async (keys) => {
    if ((Array.isArray(keys) ? keys : [keys]).includes(wornKey))
      throw new Error('R2 delete failed');
    return realDelete(keys);
  };
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    await cleanupExpired(sweepEnv);
  } finally {
    console.error = realError;
  }
  assert.equal(
    store.objects.has(`capsules/${overdue.id}/content.html`),
    false,
    'a capsule after the broken ones still expires'
  );
  assert.equal(logged.length, 2, `both failures are logged: ${logged.join(' | ')}`);
  assert.ok(logged.some((line) => line.includes(corrupt.id)));
}

{
  // Uploaded files are never trusted to choose how they are served. A capsule holder
  // controls the bytes, the Content-Type header and (under media/) the extension, and
  // all of it is served from the Worker's own origin.
  const store = new MemoryR2();
  const capsule = await publishCapsule(store);
  const get = (path) =>
    worker.fetch(
      new Request(`https://share.example/c/${capsule.id}${path}`),
      { CAPSULES: store },
      ctx
    );
  // The upload path now refuses these names, so seed them as objects an older Worker stored.
  const seed = (name, type, body) =>
    store.put(`capsules/${capsule.id}/${name}`, new TextEncoder().encode(body), {
      httpMetadata: { contentType: type },
    });
  await seed('media/page.html', 'text/html', '<script>1</script>');
  await seed('media/vector.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await seed('media/pic.jpg', 'text/html', '<script>1</script>');
  await seed('media/blob.bin', 'application/octet-stream', '1');

  for (const name of ['page.html', 'vector.svg']) {
    const res = await get(`/media/${name}`);
    assert.equal(res.status, 200, name);
    assert.ok(
      !/html|svg/i.test(res.headers.get('Content-Type')),
      `${name} is not served as markup`
    );
    assert.equal(res.headers.get('Content-Type'), 'application/octet-stream', name);
    assert.match(res.headers.get('Content-Disposition') || '', /^attachment/, name);
  }
  const mislabelled = await get('/media/pic.jpg');
  assert.equal(mislabelled.headers.get('Content-Type'), 'image/jpeg', 'type comes from the path');
  for (const path of ['/media/pic.jpg', '/media/blob.bin', '.md', '/manifest.json']) {
    const res = await get(path);
    assert.match(
      res.headers.get('Content-Security-Policy') || '',
      /default-src 'none'/,
      `${path} carries a CSP`
    );
  }
  const md = await get('.md');
  assert.equal(md.headers.get('Content-Type'), 'text/markdown;charset=utf-8');
}

{
  // A malformed percent-escape is a bad request, not a Worker exception (a 500).
  const store = new MemoryR2();
  const capsule = await publishCapsule(store);
  for (const [method, path] of [
    ['GET', `/c/${capsule.id}/media/%E0`],
    ['GET', `/c/${capsule.id}/media/%`],
    ['PUT', `/api/capsules/${capsule.id}/files/media/%E0`],
    ['GET', '/%E0'],
  ]) {
    const res = await worker.fetch(
      new Request(`https://share.example${path}`, {
        method,
        headers: { Authorization: `Bearer ${capsule.uploadToken}` },
        body: method === 'PUT' ? new Uint8Array([1]) : undefined,
      }),
      { CAPSULES: store },
      ctx
    );
    assert.ok([400, 404, 409].includes(res.status), `${method} ${path} answered ${res.status}`);
  }
}

{
  // The sweep trusts the key, never an uploaded file's body: a media/_meta.json naming another
  // capsule must not expire it. Such a name is also refused at upload.
  const store = new MemoryR2();
  const attacker = await publishCapsule(store);
  const victim = await publishCapsule(store);
  forceExpiry(store, attacker.id, past);
  store.objects.set(`capsules/${attacker.id}/media/_meta.json`, {
    bytes: new TextEncoder().encode(JSON.stringify({ id: victim.id, expiresAt: past })),
    httpMetadata: {},
    customMetadata: { status: 'published', expiresAt: past },
  });
  await cleanupExpired({ CAPSULES: store });
  assert.equal(store.objects.has(`capsules/${victim.id}/content.html`), true, 'victim untouched');
  assert.equal(store.objects.has(`capsules/${attacker.id}/content.html`), false, 'own expiry runs');

  const open = new MemoryR2();
  const session = await (
    await worker.fetch(
      new Request('https://share.example/api/capsules', {
        method: 'POST',
        body: JSON.stringify({ expiryDays: 7 }),
      }),
      { CAPSULES: open },
      ctx
    )
  ).json();
  const putTo = (name, body = new Uint8Array([1])) =>
    worker.fetch(
      new Request(`${session.uploadUrl}/${name}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.uploadToken}` },
        body,
        duplex: 'half',
      }),
      { CAPSULES: open },
      ctx
    );
  assert.equal((await putTo('media/_meta.json')).status, 400, 'underscore name refused');
  // Only image names the client really uploads are accepted under media/.
  for (const name of ['media/a.html', 'media/a.svg', 'media/a.bin', 'media/a', 'media/.jpg']) {
    assert.equal((await putTo(name)).status, 400, name);
  }
  for (const name of ['media/abc123.jpg', 'media/abc123.poster.png', 'media/x-1.webp']) {
    assert.equal((await putTo(name)).status, 200, name);
  }
}

{
  // content.html allows only the lightbox script by hash. Recompute that hash from what the
  // current userscript really emits, so a lightbox edit fails here, not on live capsules.
  const { createRequire } = await import('node:module');
  const { createHash } = await import('node:crypto');
  const engine = createRequire(import.meta.url)('../sourcecapsule.user.js');
  const html = engine.assembleHtml(
    {
      title: 'T',
      heading: 'T',
      author: { name: 'A', handle: '@a' },
      sourceUrl: 'https://x.com/a/status/1',
      blocks: [{ kind: 'paragraph', html: 'hi' }],
    },
    '',
    { distribution: 'shared' }
  );
  const scripts = [...html.matchAll(/<script(?![^>]*type=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'content.html has exactly one executable inline script');
  const hash = `'sha256-${createHash('sha256').update(scripts[0][1], 'utf8').digest('base64')}'`;

  const store = new MemoryR2();
  const capsule = await publishCapsule(store);
  const page = await worker.fetch(new Request(capsule.viewUrl), { CAPSULES: store }, ctx);
  const csp = page.headers.get('Content-Security-Policy');
  const scriptSrc = csp.match(/script-src ([^;]*)/)[1];
  assert.ok(scriptSrc.split(' ').includes(hash), `CSP allows the emitted lightbox hash ${hash}`);
  assert.ok(!/unsafe-inline/.test(scriptSrc), 'no unsafe-inline for scripts');
  assert.match(csp, /form-action 'none'/);
}

{
  // An upload body is counted as it streams and cut off at the capsule's remaining budget,
  // rather than buffered whole before the size check.
  const store = new MemoryR2();
  let pulled = 0;
  const open = await (
    await worker.fetch(
      new Request('https://share.example/api/capsules', {
        method: 'POST',
        body: JSON.stringify({ expiryDays: 7 }),
      }),
      { CAPSULES: store },
      ctx
    )
  ).json();
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
      if (pulled > 200) controller.close();
    },
  });
  const over = await worker.fetch(
    new Request(`${open.uploadUrl}/media/big.jpg`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${open.uploadToken}` },
      body: stream,
      duplex: 'half',
    }),
    { CAPSULES: store },
    ctx
  );
  assert.equal(over.status, 413);
  assert.ok(pulled <= 40, `read stopped early (pulled ${pulled} MB of 200)`);
  assert.equal(store.objects.has(`capsules/${open.id}/media/big.jpg`), false);
}

{
  // Upload limiter: keyed on the capsule id, consulted only after the token is accepted.
  const store = new MemoryR2();
  const keys = [];
  const limited = { limit: async ({ key }) => (keys.push(key), { success: false }) };
  const open = await (
    await worker.fetch(
      new Request('https://share.example/api/capsules', {
        method: 'POST',
        body: JSON.stringify({ expiryDays: 7 }),
      }),
      { CAPSULES: store },
      ctx
    )
  ).json();
  const put = (token) =>
    worker.fetch(
      new Request(`${open.uploadUrl}/media/a.jpg`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: new Uint8Array([1]),
        duplex: 'half',
      }),
      { CAPSULES: store, UPLOAD_LIMITER: limited },
      ctx
    );
  assert.equal((await put('wrong')).status, 403);
  assert.equal(keys.length, 0, 'a bad token never spends the capsule budget');
  assert.equal((await put(open.uploadToken)).status, 429);
  assert.deepEqual(keys, [open.id]);

  // IPv6 clients share one create-limiter key per /64.
  const seen = [];
  const spy = { limit: async ({ key }) => (seen.push(key), { success: true }) };
  for (const ip of ['2001:db8:1:2:aaaa::1', '2001:DB8:1:2:bbbb:0:0:9', '203.0.113.7']) {
    await worker.fetch(
      new Request('https://share.example/api/capsules', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
        body: JSON.stringify({ expiryDays: 1 }),
      }),
      { CAPSULES: store, CREATE_LIMITER: spy },
      ctx
    );
  }
  assert.equal(seen[0], seen[1], 'same /64 shares a key');
  assert.equal(seen[2], '203.0.113.7');
}

{
  // A JSON body that is not an object is a 400, not a Worker exception.
  for (const raw of ['null', '[]', '7', '"x"', 'true']) {
    const res = await worker.fetch(
      new Request('https://share.example/api/capsules', { method: 'POST', body: raw }),
      { CAPSULES: new MemoryR2() },
      ctx
    );
    assert.equal(res.status, 400, raw);
    assert.match(res.headers.get('Content-Type'), /json/);
  }
}

console.log('SourceCapsule share worker test passed.');
