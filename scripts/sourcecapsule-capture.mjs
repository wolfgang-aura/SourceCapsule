#!/usr/bin/env node
// Unattended SourceCapsule capture.
//
//   node scripts/sourcecapsule-capture.mjs --url "https://x.com/handle/status/123" --json
//
// Structured JSON goes to stdout, progress and diagnostics to stderr, nonzero exit on
// failure. The CLI never touches X itself: it hands the URL to the extension through the
// native messaging host and prints what comes back.
'use strict';

import net from 'node:net';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Windows named pipe path: \\.\pipe\sourcecapsule-capture
const DEFAULT_PIPE = String.raw`\\.\pipe\sourcecapsule-capture`;
// Tests (and any parallel install) can point at their own pipe so they never fight
// the host the browser already has running.
const PIPE = process.env.SOURCECAPSULE_PIPE || DEFAULT_PIPE;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const CONNECT_RETRIES = 3;
const CONNECT_RETRY_DELAY_MS = 750;

// Only a canonical post permalink is accepted. Anything else (search pages, profiles,
// redirect shorteners) would either fail downstream or capture the wrong thing.
const CANONICAL_X_URL =
  /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})(?:[/?#].*)?$/;

function parseArgs(argv) {
  const args = { json: false, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--url') args.url = argv[++i];
    else if (arg === '--ping') args.ping = true;
    else if (arg === '--timeout') args.timeoutMs = Number(argv[++i]) * 1000;
    else if (arg === '--expiry-days') args.expiryDays = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function canonicalXUrl(value) {
  const match = CANONICAL_X_URL.exec(String(value || '').trim());
  if (!match) return null;
  return { url: `https://x.com/${match[1]}/status/${match[2]}`, handle: match[1], id: match[2] };
}

// stdout carries the contract and nothing else. The transport's correlation id and any
// future envelope fields stay on this side of the boundary.
const RESULT_FIELDS = [
  'ok',
  'sourceUrl',
  'viewUrl',
  'markdownUrl',
  'expiresAt',
  'complete',
  'warnings',
  'error',
  'message',
  'blockers',
  'counts',
];

export function formatResult(reply) {
  const out = {};
  for (const field of RESULT_FIELDS) {
    if (reply && Object.prototype.hasOwnProperty.call(reply, field)) out[field] = reply[field];
  }
  if (out.ok && !Array.isArray(out.warnings)) out.warnings = [];
  return out;
}

function progress(...parts) {
  process.stderr.write(`[sourcecapsule] ${parts.join(' ')}\n`);
}

function connectOnce() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(PIPE);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

async function connectWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
    try {
      return await connectOnce();
    } catch (error) {
      lastError = error;
      progress(
        `host not reachable (attempt ${attempt}/${CONNECT_RETRIES}): ${error.code || error.message}`
      );
      if (attempt < CONNECT_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS));
      }
    }
  }
  throw new Error(
    `Cannot reach the SourceCapsule native host (${lastError && lastError.code}). Is Chrome running with the extension loaded?`
  );
}

async function request(payload, timeoutMs) {
  const socket = await connectWithRetry();
  return await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`No reply from the extension within ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs + 5000);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        resolve(JSON.parse(buffer.slice(0, index)));
      } catch (error) {
        reject(new Error(`Malformed reply from host: ${error.message}`));
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.write(`${JSON.stringify(payload)}\n`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (args.ping) {
    progress('pinging extension through the native host');
    const reply = await request({ id, action: 'ping', timeoutMs: 15000 }, 15000);
    process.stdout.write(`${JSON.stringify(reply, null, 2)}\n`);
    return reply.ok ? 0 : 1;
  }

  const canonical = canonicalXUrl(args.url);
  if (!canonical) {
    throw new Error(
      'A canonical post URL is required, e.g. https://x.com/handle/status/1234567890.'
    );
  }
  progress(`capturing ${canonical.url}`);
  const reply = await request(
    {
      id,
      action: 'capture-share',
      url: canonical.url,
      expiryDays: args.expiryDays,
      timeoutMs: args.timeoutMs,
    },
    args.timeoutMs
  );
  process.stdout.write(`${JSON.stringify(formatResult(reply), null, 2)}\n`);
  return reply.ok ? 0 : 1;
}

// Only run when invoked directly, so tests can import canonicalXUrl without side effects.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      progress(`failed: ${error.message}`);
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: 'cli_error', message: error.message }, null, 2)}\n`
      );
      process.exit(1);
    });
}
