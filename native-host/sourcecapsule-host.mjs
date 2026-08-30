#!/usr/bin/env node
// SourceCapsule native messaging host.
//
// Chrome spawns this process (never the other way around), so the CLI cannot talk to
// the extension directly. This host bridges the two:
//   CLI  --(newline JSON over a Windows named pipe)-->  host
//   host --(native messaging framing over stdio)------>  extension service worker
// and routes the reply back by request id.
//
// Exactly one host owns the pipe. A second instance fails to listen and exits, which
// is also what enforces one-capture-at-a-time across Chrome profiles.
'use strict';

import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Windows named pipe path: \\.\pipe\sourcecapsule-capture
const DEFAULT_PIPE = String.raw`\\.\pipe\sourcecapsule-capture`;
// Tests (and any parallel install) can point at their own pipe so they never fight
// the host the browser already has running.
const PIPE = process.env.SOURCECAPSULE_PIPE || DEFAULT_PIPE;
const LOG = path.join(os.tmpdir(), 'sourcecapsule-native-host.log');
const REQUEST_MAX_MS = 15 * 60 * 1000;

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(' ')}\n`;
  try {
    fs.appendFileSync(LOG, line);
  } catch {
    /* logging must never take the host down */
  }
}

// ---- Chrome side: native messaging framing -------------------------------------

function sendToChrome(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

let stdinBuffer = Buffer.alloc(0);
function readChromeMessages(onMessage) {
  process.stdin.on('data', (chunk) => {
    stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
    for (;;) {
      if (stdinBuffer.length < 4) return;
      const length = stdinBuffer.readUInt32LE(0);
      if (stdinBuffer.length < 4 + length) return;
      const body = stdinBuffer.subarray(4, 4 + length);
      stdinBuffer = stdinBuffer.subarray(4 + length);
      try {
        onMessage(JSON.parse(body.toString('utf8')));
      } catch (error) {
        log('bad message from chrome:', error.message);
      }
    }
  });
  process.stdin.on('end', () => {
    log('chrome closed the port; exiting');
    process.exit(0);
  });
}

// ---- CLI side: named pipe -------------------------------------------------------

const pending = new Map(); // id -> { socket, timer }

function replyToCli(id, payload) {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id);
  try {
    entry.socket.write(`${JSON.stringify(payload)}\n`);
    entry.socket.end();
  } catch (error) {
    log('failed writing reply', id, error.message);
  }
}

const server = net.createServer((socket) => {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        socket.write(`${JSON.stringify({ ok: false, error: 'invalid_json' })}\n`);
        socket.end();
        return;
      }
      const id = String(request.id || Date.now());
      if (pending.size > 0 && request.action !== 'ping') {
        socket.write(
          `${JSON.stringify({ ok: false, error: 'busy', message: 'Another SourceCapsule capture is already running.' })}\n`
        );
        socket.end();
        return;
      }
      const timeoutMs = Math.min(Number(request.timeoutMs) || REQUEST_MAX_MS, REQUEST_MAX_MS);
      const timer = setTimeout(() => {
        replyToCli(id, { ok: false, error: 'timeout', message: `No reply within ${timeoutMs}ms.` });
      }, timeoutMs);
      pending.set(id, { socket, timer });
      socket.on('close', () => {
        const entry = pending.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(id);
        }
      });
      log('forwarding', id, request.action || 'unknown');
      sendToChrome({ ...request, id });
    }
  });
  socket.on('error', (error) => log('cli socket error:', error.message));
});

server.on('error', (error) => {
  log('pipe listen failed:', error.message);
  // Another host already owns the pipe. Stay attached to Chrome so this instance is
  // harmless, but never race for requests.
  sendToChrome({ type: 'sourcecapsule:host-status', ok: false, error: 'pipe_in_use' });
});

server.listen(PIPE, () => {
  log('listening on', PIPE, 'pid', process.pid);
  sendToChrome({ type: 'sourcecapsule:host-status', ok: true, pipe: PIPE, pid: process.pid });
});

// Chrome suspends an idle MV3 service worker after ~30s. An inbound native message
// resets that timer, so the host, not the worker, owns the keepalive.
setInterval(() => sendToChrome({ type: 'sourcecapsule:heartbeat', at: Date.now() }), 20000);

readChromeMessages((message) => {
  if (message && message.type === 'sourcecapsule:heartbeat') return;
  if (message && message.id) replyToCli(String(message.id), message);
  else log('unrouted message from chrome:', JSON.stringify(message).slice(0, 200));
});
