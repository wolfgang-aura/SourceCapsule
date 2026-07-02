const MAX_CAPSULE_BYTES = 25 * 1024 * 1024;
const VALID_EXPIRY_DAYS = new Set([1, 7, 30]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

function json(request, value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json;charset=utf-8', ...corsHeaders(request) },
  });
}

function randomToken(bytes = 16) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function tokenHash(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (item) => item.toString(16).padStart(2, '0')).join('');
}

function metaKey(id) {
  return `capsules/${id}/_meta.json`;
}

function fileKey(id, path) {
  return `capsules/${id}/${path}`;
}

function validId(id) {
  return /^[a-f0-9]{32}$/.test(String(id || ''));
}

function validFilePath(path) {
  return (
    path === 'content.html' ||
    path === 'content.md' ||
    path === 'manifest.json' ||
    /^media\/[A-Za-z0-9._-]{1,180}$/.test(path)
  );
}

async function getMeta(env, id) {
  const object = await env.CAPSULES.get(metaKey(id));
  if (!object) return null;
  const meta = JSON.parse(await object.text());
  meta._custom = object.customMetadata || {};
  return meta;
}

async function authorized(request, env, id) {
  const meta = await getMeta(env, id);
  if (!meta) return { ok: false, status: 404, meta: null };
  const value = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const hash = value ? await tokenHash(value) : '';
  return {
    ok: Boolean(hash && hash === meta._custom.tokenHash),
    status: hash ? 403 : 401,
    meta,
  };
}

async function putMeta(env, meta, tokenHashValue, status) {
  const publicMeta = { ...meta };
  delete publicMeta._custom;
  await env.CAPSULES.put(metaKey(meta.id), JSON.stringify(publicMeta), {
    httpMetadata: { contentType: 'application/json;charset=utf-8' },
    customMetadata: { tokenHash: tokenHashValue, status },
  });
}

async function deletePrefix(env, prefix) {
  let cursor;
  do {
    const page = await env.CAPSULES.list({ prefix, cursor });
    const keys = (page.objects || []).map((object) => object.key);
    if (keys.length) await env.CAPSULES.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function capsuleBytes(env, id, excludingKey = '') {
  let total = 0;
  let cursor;
  do {
    const page = await env.CAPSULES.list({ prefix: `capsules/${id}/`, cursor });
    for (const object of page.objects || []) {
      if (object.key !== metaKey(id) && object.key !== excludingKey) {
        total += Number(object.size || 0);
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return total;
}

function isExpired(meta) {
  return !meta || !meta.expiresAt || Date.parse(meta.expiresAt) <= Date.now();
}

async function createCapsule(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(request, { error: 'Expected JSON body.' }, 400);
  }
  const expiryDays = Number(body.expiryDays);
  if (!VALID_EXPIRY_DAYS.has(expiryDays)) {
    return json(request, { error: 'expiryDays must be 1, 7, or 30.' }, 400);
  }
  const id = randomToken(16);
  const uploadToken = randomToken(24);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + expiryDays * 86400000).toISOString();
  const origin = new URL(request.url).origin;
  const meta = { id, createdAt, expiresAt, expiryDays };
  await putMeta(env, meta, await tokenHash(uploadToken), 'uploading');
  return json(
    request,
    {
      id,
      uploadToken,
      deleteToken: uploadToken,
      uploadUrl: `${origin}/api/capsules/${id}/files`,
      finalizeUrl: `${origin}/api/capsules/${id}/finalize`,
      deleteUrl: `${origin}/api/capsules/${id}`,
      viewUrl: `${origin}/c/${id}`,
      markdownUrl: `${origin}/c/${id}.md`,
      expiresAt,
    },
    201
  );
}

async function uploadFile(request, env, id, path) {
  const auth = await authorized(request, env, id);
  if (!auth.ok) return json(request, { error: 'Upload authorization failed.' }, auth.status);
  if (isExpired(auth.meta)) return json(request, { error: 'Upload session expired.' }, 410);
  if (!validFilePath(path)) return json(request, { error: 'Invalid file path.' }, 400);
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_CAPSULE_BYTES) return json(request, { error: 'File is too large.' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  const key = fileKey(id, path);
  const existingBytes = await capsuleBytes(env, id, key);
  if (
    bytes.byteLength > MAX_CAPSULE_BYTES ||
    existingBytes + bytes.byteLength > MAX_CAPSULE_BYTES
  ) {
    return json(request, { error: 'Capsule exceeds the 25 MB limit.' }, 413);
  }
  await env.CAPSULES.put(key, bytes, {
    httpMetadata: {
      contentType: request.headers.get('Content-Type') || 'application/octet-stream',
    },
  });
  return json(request, { ok: true, path, bytes: bytes.byteLength });
}

async function finalizeCapsule(request, env, id) {
  const auth = await authorized(request, env, id);
  if (!auth.ok) return json(request, { error: 'Publish authorization failed.' }, auth.status);
  for (const required of ['content.html', 'content.md', 'manifest.json']) {
    if (!(await env.CAPSULES.head(fileKey(id, required)))) {
      return json(request, { error: `Missing required file: ${required}` }, 409);
    }
  }
  if ((await capsuleBytes(env, id)) > MAX_CAPSULE_BYTES) {
    return json(request, { error: 'Capsule exceeds the 25 MB limit.' }, 413);
  }
  await putMeta(env, auth.meta, auth.meta._custom.tokenHash, 'published');
  return json(request, { ok: true, id, expiresAt: auth.meta.expiresAt });
}

async function deleteCapsule(request, env, id) {
  const auth = await authorized(request, env, id);
  if (!auth.ok) return json(request, { error: 'Delete authorization failed.' }, auth.status);
  await deletePrefix(env, `capsules/${id}/`);
  return json(request, { ok: true });
}

function publicPath(pathname, id) {
  const base = `/c/${id}`;
  if (pathname === base) return 'content.html';
  if (pathname === `${base}.md`) return 'content.md';
  if (pathname === `${base}/manifest.json`) return 'manifest.json';
  const mediaPrefix = `${base}/media/`;
  if (pathname.startsWith(mediaPrefix)) {
    const name = decodeURIComponent(pathname.slice(mediaPrefix.length));
    return /^[-A-Za-z0-9._]{1,180}$/.test(name) ? `media/${name}` : '';
  }
  return '';
}

async function serveCapsule(request, env, ctx, id, path) {
  const meta = await getMeta(env, id);
  if (!meta || meta._custom.status !== 'published') {
    return new Response('Capsule not found.', { status: 404 });
  }
  if (isExpired(meta)) {
    if (ctx && ctx.waitUntil) ctx.waitUntil(deletePrefix(env, `capsules/${id}/`));
    return new Response('This SourceCapsule link has expired.', { status: 410 });
  }
  const object = await env.CAPSULES.get(fileKey(id, path));
  if (!object) return new Response('File not found.', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata && object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) {
    if (path.endsWith('.html')) headers.set('Content-Type', 'text/html;charset=utf-8');
    else if (path.endsWith('.md')) headers.set('Content-Type', 'text/markdown;charset=utf-8');
    else if (path.endsWith('.json')) headers.set('Content-Type', 'application/json;charset=utf-8');
  }
  headers.set('Cache-Control', 'public, max-age=300');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (path === 'content.html') {
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
    );
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

async function handleRequest(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(request) });
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (request.method === 'POST' && url.pathname === '/api/capsules') {
    return createCapsule(request, env);
  }
  if (segments[0] === 'api' && segments[1] === 'capsules' && validId(segments[2])) {
    const id = segments[2];
    if (request.method === 'PUT' && segments[3] === 'files') {
      return uploadFile(request, env, id, segments.slice(4).join('/'));
    }
    if (request.method === 'POST' && segments[3] === 'finalize') {
      return finalizeCapsule(request, env, id);
    }
    if (request.method === 'DELETE' && segments.length === 3) {
      return deleteCapsule(request, env, id);
    }
  }
  const match = url.pathname.match(/^\/c\/([a-f0-9]{32})(?:\.md|\/.*)?$/);
  if (match && (request.method === 'GET' || request.method === 'HEAD')) {
    const path = publicPath(url.pathname, match[1]);
    if (path) return serveCapsule(request, env, ctx, match[1], path);
  }
  if (url.pathname === '/health')
    return json(request, { ok: true, service: 'sourcecapsule-share' });
  return new Response('Not found.', { status: 404 });
}

async function cleanupExpired(env) {
  let cursor;
  do {
    const page = await env.CAPSULES.list({ prefix: 'capsules/', cursor });
    const metaObjects = (page.objects || []).filter((object) => object.key.endsWith('/_meta.json'));
    for (const item of metaObjects) {
      const object = await env.CAPSULES.get(item.key);
      if (!object) continue;
      const meta = JSON.parse(await object.text());
      if (isExpired(meta)) {
        const prefix = item.key.slice(0, -'_meta.json'.length);
        await deletePrefix(env, prefix);
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export { cleanupExpired, handleRequest };

export default {
  fetch: handleRequest,
  scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanupExpired(env));
  },
};
