#!/usr/bin/env node
// Receives bridge diagnostics from a DEVELOPMENT extension build and prints them.
// A service worker cannot write to disk, so this is how its connect failures become
// visible outside devtools. Development builds only; production never posts.
//
//   node scripts/bridge-diagnostics.mjs
'use strict';

import http from 'node:http';
import process from 'node:process';

const PORT = 8799;

http
  .createServer((req, res) => {
    // The extension posts cross-origin from chrome-extension://, so preflight must pass.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const event = JSON.parse(body || '{}');
        const detail =
          typeof event.detail === 'object' ? JSON.stringify(event.detail) : String(event.detail);
        console.log(`${event.at}  ${String(event.stage).padEnd(16)} ${detail}`);
      } catch (error) {
        console.log(`unparseable diagnostic: ${error.message}`);
      }
      res.writeHead(204).end();
    });
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`listening for SourceCapsule bridge diagnostics on http://127.0.0.1:${PORT}`);
  });

process.on('SIGINT', () => process.exit(0));
