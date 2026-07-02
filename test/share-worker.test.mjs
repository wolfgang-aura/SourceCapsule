import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker from '../share-worker/worker.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryR2 {
  constructor() {
    this.objects = new Map();
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
    const item = this.objects.get(key);
    if (!item) return null;
    return {
      body: item.bytes,
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

  async list({ prefix = '' } = {}) {
    return {
      objects: Array.from(this.objects.keys())
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key, size: this.objects.get(key).bytes.byteLength })),
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
assert.equal(page.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');

const markdown = await worker.fetch(new Request(created.markdownUrl), env, ctx);
assert.equal(markdown.status, 200);
assert.equal(await markdown.text(), '# Shared');

const image = await worker.fetch(new Request(`${created.viewUrl}/media/image-001.jpg`), env, ctx);
assert.equal(image.status, 200);
assert.equal((await image.arrayBuffer()).byteLength, 3);

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

console.log('SourceCapsule share worker test passed.');
