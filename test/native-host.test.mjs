// Transport test for the local automation bridge. Chrome is stubbed: this test spawns
// the real native host, speaks native messaging framing on its stdio the way Chrome
// would, and drives it from the pipe side the way the CLI does.
//
// It proves the round trip (CLI -> pipe -> host -> "extension" -> host -> CLI), the
// one-at-a-time lock, and the request timeout, with no browser involved.
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { canonicalXUrl, formatResult } from '../scripts/sourcecapsule-capture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A dedicated pipe per test run, so the test never collides with the host the browser
// already has running (which owns the real \\.\pipe\sourcecapsule-capture).
const PIPE = String.raw`\\.\pipe\sourcecapsule-test-` + process.pid;

function encode(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function decoder(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) return;
      onMessage(JSON.parse(buffer.subarray(4, 4 + length).toString('utf8')));
      buffer = buffer.subarray(4 + length);
    }
  };
}

function sendOverPipe(payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(PIPE);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      socket.end();
      resolve(JSON.parse(buffer.slice(0, index)));
    });
    socket.on('error', reject);
  });
}

function canonicalUrlChecks() {
  assert.equal(
    canonicalXUrl('https://x.com/handle/status/123').url,
    'https://x.com/handle/status/123'
  );
  assert.equal(
    canonicalXUrl('https://twitter.com/handle/status/123?s=20').url,
    'https://x.com/handle/status/123'
  );
  assert.equal(canonicalXUrl('https://x.com/handle'), null);
  assert.equal(canonicalXUrl('https://evil.example/x.com/handle/status/123'), null);
  assert.equal(canonicalXUrl('http://x.com/handle/status/123'), null);
  console.log('ok  canonical X URL validation');
}

function resultContractChecks() {
  // stdout is a contract other programs parse. Transport fields must never leak into it.
  const success = formatResult({
    id: '1788094282150-dgglbo',
    ok: true,
    sourceUrl: 'https://x.com/handle/status/123',
    viewUrl: 'https://example.workers.dev/c/abc',
    markdownUrl: 'https://example.workers.dev/c/abc.md',
    expiresAt: '2026-09-06T12:51:33.824Z',
    complete: true,
    warnings: [],
  });
  assert.deepEqual(Object.keys(success), [
    'ok',
    'sourceUrl',
    'viewUrl',
    'markdownUrl',
    'expiresAt',
    'complete',
    'warnings',
  ]);
  assert.equal('id' in success, false);

  const blocked = formatResult({
    id: 'x1',
    ok: false,
    error: 'needs_owner',
    message: 'Strict capture could not recover missing evidence.',
    counts: { imageFetchFailed: 2 },
    blockers: [{ kind: 'image' }],
  });
  assert.deepEqual(blocked, {
    ok: false,
    error: 'needs_owner',
    message: 'Strict capture could not recover missing evidence.',
    blockers: [{ kind: 'image' }],
    counts: { imageFetchFailed: 2 },
  });
  console.log('ok  stdout result contract');
}

async function transportChecks() {
  const host = spawn(process.execPath, [path.join(root, 'native-host', 'sourcecapsule-host.mjs')], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, SOURCECAPSULE_PIPE: PIPE },
  });
  const received = [];
  let ready;
  const readyPromise = new Promise((resolve) => {
    ready = resolve;
  });
  host.stdout.on(
    'data',
    decoder((message) => {
      if (message.type === 'sourcecapsule:host-status') {
        assert.equal(message.ok, true, 'host should own the pipe');
        ready();
        return;
      }
      if (message.type === 'sourcecapsule:heartbeat') return;
      received.push(message);
      // Stand in for the service worker: answer whatever the CLI asked for.
      if (message.action === 'ping') {
        host.stdin.write(encode({ id: message.id, ok: true, extensionVersion: 'test' }));
      }
      // 'never-answered' is deliberately dropped to exercise the host timeout.
    })
  );

  try {
    await readyPromise;

    const pong = await sendOverPipe({ id: 'a1', action: 'ping', timeoutMs: 5000 });
    assert.deepEqual(pong, { id: 'a1', ok: true, extensionVersion: 'test' });
    assert.equal(received[0].url, undefined);
    console.log('ok  round trip CLI -> host -> extension -> CLI');

    const timedOut = await sendOverPipe({
      id: 'a2',
      action: 'never-answered',
      timeoutMs: 1000,
    });
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.error, 'timeout');
    console.log('ok  bounded request timeout');

    // Lock: hold one request open, then confirm a second is refused as busy.
    const held = sendOverPipe({ id: 'a3', action: 'never-answered', timeoutMs: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const busy = await sendOverPipe({ id: 'a4', action: 'capture-share', timeoutMs: 3000 });
    assert.equal(busy.ok, false);
    assert.equal(busy.error, 'busy');
    console.log('ok  one capture at a time');
    await held;
  } finally {
    host.kill();
  }
}

canonicalUrlChecks();
resultContractChecks();
await transportChecks();
console.log('native-host transport tests passed');
