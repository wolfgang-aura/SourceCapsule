// Transport test for the local automation bridge. Chrome is stubbed: this test spawns
// the real native host, speaks native messaging framing on its stdio the way Chrome
// would, and drives it from the pipe side the way the CLI does.
//
// It proves the round trip (CLI -> pipe -> host -> "extension" -> host -> CLI), the
// one-at-a-time lock, and the request timeout, with no browser involved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
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
    env: { ...process.env, SOURCECAPSULE_PIPE: PIPE, SOURCECAPSULE_LOCK_GRACE_MS: '1500' },
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

    const readLog = () =>
      fs.readFileSync(path.join(os.tmpdir(), 'sourcecapsule-native-host.log'), 'utf8');
    const timedOut = await sendOverPipe({
      id: 'a2',
      action: 'never-answered',
      timeoutMs: 1000,
    });
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.error, 'timeout');
    console.log('ok  bounded request timeout');

    // The timer answers the CLI but the extension may still be capturing, so the lock must
    // hold: a retry now would start a second capture of the same post (#69). The late
    // reply's link must reach the log.
    const retry = await sendOverPipe({ id: 'a2r', action: 'capture-share', timeoutMs: 3000 });
    assert.equal(retry.error, 'busy', 'a request timeout must not release the capture lock');
    const lateUrl = `https://share.test/c/after-timeout-${process.pid}`;
    host.stdin.write(encode({ id: 'a2', ok: true, viewUrl: lateUrl }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(readLog().includes(lateUrl), 'reply after the request timeout is logged');
    const afterLate = await sendOverPipe({ id: 'a2p', action: 'ping', timeoutMs: 5000 });
    assert.equal(afterLate.ok, true, 'lock is released once the late reply arrives');
    // An id the host no longer knows still gets its link logged, not dropped.
    const orphanUrl = `https://share.test/c/orphan-${process.pid}`;
    host.stdin.write(encode({ id: 'never-seen', ok: true, viewUrl: orphanUrl }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(readLog().includes(orphanUrl), 'reply for an unknown id is logged');
    console.log('ok  request timeout keeps the lock until the extension replies');

    // A dead worker must not hold the lock forever: the hard cap releases it.
    const dead = await sendOverPipe({ id: 'a2d', action: 'never-answered', timeoutMs: 500 });
    assert.equal(dead.error, 'timeout');
    const heldByDead = await sendOverPipe({ id: 'a2e', action: 'capture-share', timeoutMs: 3000 });
    assert.equal(heldByDead.error, 'busy');
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const capped = await sendOverPipe({ id: 'a2f', action: 'ping', timeoutMs: 5000 });
    assert.equal(capped.ok, true, 'hard cap releases the lock for a dead worker');
    console.log('ok  hard cap releases the lock when the extension never replies');

    // Lock: hold one request open, then confirm a second is refused as busy.
    const held = sendOverPipe({ id: 'a3', action: 'never-answered', timeoutMs: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const busy = await sendOverPipe({ id: 'a4', action: 'capture-share', timeoutMs: 3000 });
    assert.equal(busy.ok, false);
    assert.equal(busy.error, 'busy');
    console.log('ok  one capture at a time');
    await held;
    host.stdin.write(encode({ id: 'a3', ok: false, error: 'late' }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    // The CLI can disconnect while the extension is still capturing. The lock must hold
    // until the extension answers, and the late reply's link must reach the host log.
    const captureAsk = received.length;
    const gone = net.connect(PIPE);
    await new Promise((resolve) => gone.on('connect', resolve));
    gone.write(`${JSON.stringify({ id: 'a5', action: 'capture-share', timeoutMs: 20000 })}
`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(received.length, captureAsk + 1, 'extension received the capture');
    gone.destroy();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const stillBusy = await sendOverPipe({ id: 'a6', action: 'capture-share', timeoutMs: 3000 });
    assert.equal(stillBusy.error, 'busy', 'a closed CLI socket must not release the lock');
    const viewUrl = `https://share.test/c/late-${process.pid}`;
    host.stdin.write(encode({ id: 'a5', ok: true, viewUrl }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(readLog().includes(viewUrl), 'late reply viewUrl is logged when the CLI is gone');
    const free = await sendOverPipe({ id: 'a7', action: 'ping', timeoutMs: 5000 });
    assert.equal(free.ok, true, 'lock is released once the extension has replied');
    console.log('ok  lock survives a closed CLI socket and the late reply is logged');

    // The registered host is a .cmd that runs node.exe with the browser's own stdio, so
    // nothing between them closes stdin for the host. The host itself must exit when the
    // browser's stream ends, or an orphan keeps the pipe and every later CLI call hangs.
    const exited = new Promise((resolve) => host.on('exit', resolve));
    host.stdin.end();
    const outcome = await Promise.race([
      exited.then(() => 'exited'),
      new Promise((resolve) => setTimeout(() => resolve('still running'), 5000)),
    ]);
    assert.equal(outcome, 'exited', 'host must exit when the browser closes its stdin');
    const released = await new Promise((resolve) => {
      const probe = net.connect(PIPE);
      probe.on('connect', () => {
        probe.destroy();
        resolve(false);
      });
      probe.on('error', () => resolve(true));
    });
    assert.ok(released, 'the pipe is released once the host exits');
    console.log('ok  host exits and releases the pipe when the browser stream ends');
  } finally {
    host.kill();
  }
}

// Two hosts, one pipe (#70): the second must keep retrying and take over when the first
// goes away, instead of sitting idle until its browser restarts.
async function pipeTakeoverChecks() {
  if (process.platform !== 'win32') {
    // Off Windows the "pipe" is a socket file that outlives its owner, so B can never listen.
    console.log('skip pipe takeover (Windows named pipes only)');
    return;
  }
  const takeoverPipe = String.raw`\\.\pipe\sourcecapsule-takeover-` + process.pid;
  const env = {
    ...process.env,
    SOURCECAPSULE_PIPE: takeoverPipe,
    SOURCECAPSULE_LISTEN_RETRY_MS: '300',
  };
  const startHost = () => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'native-host', 'sourcecapsule-host.mjs')],
      { stdio: ['pipe', 'pipe', 'inherit'], env }
    );
    const statuses = [];
    const waiters = [];
    child.stdout.on(
      'data',
      decoder((message) => {
        if (message.type === 'sourcecapsule:host-status') {
          statuses.push(message);
          for (const waiter of waiters.splice(0)) waiter();
        } else if (message.action === 'ping') {
          child.stdin.write(encode({ id: message.id, ok: true, extensionVersion: 'test' }));
        }
      })
    );
    const status = async (count) => {
      const deadline = Date.now() + 8000;
      while (statuses.length < count && Date.now() < deadline) {
        await new Promise((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 200);
        });
      }
      assert.ok(statuses.length >= count, `host status #${count} never arrived`);
      return statuses[count - 1];
    };
    return { child, status };
  };
  const a = startHost();
  let b;
  try {
    const first = await a.status(1);
    assert.equal(first.ok, true, 'A owns the pipe');
    b = startHost();
    const second = await b.status(1);
    assert.equal(second.ok, false);
    assert.equal(second.error, 'pipe_in_use');
    a.child.stdin.end();
    const taken = await b.status(2);
    assert.equal(taken.ok, true, 'B reports ok once it owns the pipe');
    const ping = await runCli(['--ping'], takeoverPipe);
    assert.equal(ping.code, 0, `--ping against B (stderr: ${ping.stderr})`);
    assert.equal(JSON.parse(ping.stdout).ok, true);
    console.log('ok  a host that lost the pipe race takes over when the owner exits');
  } finally {
    a.child.kill();
    if (b) b.child.kill();
  }
}

function runCli(args, pipe, script = path.join(root, 'scripts', 'sourcecapsule-capture.mjs')) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, SOURCECAPSULE_PIPE: pipe },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    // A hung CLI is the failure under test, so bound it instead of hanging the suite.
    const guard = setTimeout(() => child.kill(), 8000);
    child.on('close', (code) => {
      clearTimeout(guard);
      resolve({ code, stdout, stderr, ms: Date.now() - started });
    });
  });
}

async function cliChecks() {
  // The host (or the browser behind it) can die after the CLI has connected. The CLI must
  // report that at once, not sit out the capture timeout (up to five minutes).
  const dropPipe = String.raw`\\.\pipe\sourcecapsule-drop-` + process.pid;
  const server = net.createServer((socket) => {
    socket.once('data', () => socket.destroy());
  });
  await new Promise((resolve) => server.listen(dropPipe, resolve));
  try {
    const dropped = await runCli(['--ping'], dropPipe);
    assert.equal(dropped.code, 1, `CLI exit code (stderr: ${dropped.stderr})`);
    assert.ok(dropped.ms < 6000, `CLI took ${dropped.ms}ms to notice the closed connection`);
    assert.match(JSON.parse(dropped.stdout).message, /closed|reply/i);
  } finally {
    server.close();
  }
  console.log('ok  CLI fails fast when the host closes mid-request');

  // --reload asks once, then waits for a worker to answer ping. A fake host answers both.
  const reloadPipe = String.raw`\\.\pipe\sourcecapsule-reload-` + process.pid;
  const asked = [];
  let supportsReload = true;
  const fakeHost = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.once('data', (line) => {
      const message = JSON.parse(line);
      asked.push(message.action);
      const reply =
        message.action === 'reload' && !supportsReload
          ? { id: message.id, ok: false, error: 'unknown_action' }
          : { id: message.id, ok: true, extensionVersion: 'test' };
      socket.end(`${JSON.stringify(reply)}\n`);
    });
  });
  await new Promise((resolve) => fakeHost.listen(reloadPipe, resolve));
  try {
    const reloaded = await runCli(['--reload'], reloadPipe);
    assert.equal(reloaded.code, 0, `--reload exit code (stderr: ${reloaded.stderr})`);
    assert.deepEqual(asked, ['reload', 'ping']);
    assert.equal(JSON.parse(reloaded.stdout).reloaded, true);
    // stdout is a contract: the transport correlation id must not leak through --reload.
    assert.equal('id' in JSON.parse(reloaded.stdout), false);
    const pinged = await runCli(['--ping'], reloadPipe);
    assert.deepEqual(JSON.parse(pinged.stdout), { ok: true, extensionVersion: 'test' });

    supportsReload = false;
    const old = await runCli(['--reload'], reloadPipe);
    assert.equal(old.code, 1);
    assert.match(JSON.parse(old.stdout).message, /brave:\/\/extensions/);
  } finally {
    fakeHost.close();
  }
  console.log('ok  --reload waits for the reloaded extension and explains an old build');

  // Bad numeric flags are a usage error before any connection is attempted. Number('5m')
  // is NaN, and a NaN timer fires immediately, so a typo used to look like a host timeout.
  const noPipe = String.raw`\\.\pipe\sourcecapsule-absent-` + process.pid;
  for (const args of [
    ['--timeout', '5m'],
    ['--timeout', '0'],
    ['--timeout', '-3'],
    ['--timeout'],
    ['--expiry-days', 'soon'],
    ['--expiry-days', '2'],
    ['--expiry-days'],
  ]) {
    const result = await runCli(['--url', 'https://x.com/a/status/1', ...args], noPipe);
    assert.equal(result.code, 1, args.join(' '));
    assert.doesNotMatch(result.stderr, /not reachable/, `${args.join(' ')} reached the pipe`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.match(out.message, new RegExp(args[0].replace(/^--/, '')), args.join(' '));
  }
  const ok = await runCli(
    ['--url', 'https://x.com/a/status/1', '--timeout', '30', '--expiry-days', '7'],
    noPipe
  );
  assert.match(ok.stderr, /not reachable/, 'valid flags still proceed to connect');
  console.log('ok  CLI rejects bad --timeout and --expiry-days before connecting');
}

// Branded Google Chrome 137+ ignores --load-extension, so a launcher that hands it that flag
// produces a shortcut that looks healthy while the extension never loads (#44). The stand-in
// browsers are empty executables carrying only the version resource the launcher reads.
async function launcherChecks() {
  if (process.platform !== 'win32') {
    console.log('skip launcher browser selection (Windows only)');
    return;
  }
  const csc = path.join(
    process.env.WINDIR,
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe'
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sourcecapsule-launcher-'));
  try {
    const extensionDir = path.join(tmp, 'ext');
    fs.mkdirSync(extensionDir);
    fs.writeFileSync(path.join(extensionDir, 'manifest.json'), '{}');
    // Windows resets ProgramFiles for every 64-bit process, so auto-detection cannot be
    // pointed at stand-ins. Each one is passed explicitly with -BrowserPath instead.
    const fakeBrowser = (relative, product) => {
      const exe = path.join(tmp, relative);
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      const source = path.join(tmp, `${path.basename(exe)}.cs`);
      fs.writeFileSync(
        source,
        `using System.Reflection;\n[assembly: AssemblyProduct("${product}")]\n` +
          '[assembly: AssemblyFileVersion("141.0.0.0")]\nclass P { static void Main() {} }\n'
      );
      const built = spawnSync(csc, ['/nologo', `/out:${exe}`, source], { encoding: 'utf8' });
      assert.equal(built.status, 0, built.stdout);
      return exe;
    };
    const launchArgs = (browser, dir = extensionDir) => {
      const run = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(root, 'scripts', 'start-sourcecapsule-browser.ps1'),
          '-ShowLaunchArgs',
          '-BrowserPath',
          browser,
          '-ExtensionDir',
          dir,
        ],
        { encoding: 'utf8' }
      );
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const args = run.stdout.match(/^Arguments: (.*)$/m);
      assert.ok(args, run.stdout);
      return { args: args[1], output: run.stdout };
    };

    const chrome = launchArgs(fakeBrowser(path.join('chrome', 'chrome.exe'), 'Google Chrome'));
    assert.doesNotMatch(chrome.args, /--load-extension/, 'Chrome must not get --load-extension');
    assert.match(chrome.args, /CalculateNativeWinOcclusion/, 'Chrome still needs occlusion off');
    assert.match(chrome.output, /Load unpacked/, 'Chrome users are told to load it once');

    // Chrome for Testing ships a chrome.exe too, and still honors the flag.
    const testing = launchArgs(
      fakeBrowser(path.join('cft', 'chrome.exe'), 'Google Chrome for Testing')
    );
    assert.match(testing.args, /--load-extension=/);
    const edgeExe = fakeBrowser(path.join('edge', 'msedge.exe'), 'Microsoft Edge');
    const edge = launchArgs(edgeExe);
    assert.match(edge.args, /--load-extension=/);
    console.log('ok  launcher never relies on --load-extension for Google Chrome');

    // A trailing backslash used to put a backslash before the closing quote, which Windows
    // reads as an escaped quote and merges every later flag into the extension path.
    const slashed = launchArgs(edgeExe, extensionDir + path.sep);
    assert.doesNotMatch(slashed.args, /\\"/, 'no backslash before a quote');
    assert.match(slashed.args, /--load-extension="[^"]+" --disable-features=/);
    console.log('ok  launcher trims a trailing backslash from -ExtensionDir');

    // Edge's startup boost ran the extension windowless from sign-in and owned the capture
    // pipe, while -Status inspected only Brave and said capture would fail.
    // A copy of the signed node.exe stands in for Edge: Smart App Control blocks an unsigned
    // compiled stand-in from running at all. It spawns a child whose command line looks like a
    // host, writes the child's pid, and keeps it alive.
    const foreignExe = path.join(tmp, 'foreign', 'msedge.exe');
    fs.mkdirSync(path.dirname(foreignExe));
    fs.copyFileSync(process.execPath, foreignExe);
    const pidFile = path.join(tmp, 'foreign.pid');
    const foreign = spawn(
      foreignExe,
      [
        '-e',
        'const [, pidFile, node] = process.argv;' +
          'const c = require("child_process").spawn(node, ["-e", "setTimeout(() => {}, 60000)", "sourcecapsule-host-standin"], { stdio: "ignore" });' +
          'require("fs").writeFileSync(pidFile, String(c.pid)); setTimeout(() => {}, 60000);',
        pidFile,
        process.execPath,
      ],
      { stdio: 'ignore' }
    );
    const waitUntil = Date.now() + 10000;
    while (!fs.existsSync(pidFile) && Date.now() < waitUntil)
      spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 200)']);
    const hostPid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(hostPid > 0, 'stand-in host started');
    try {
      const status = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(root, 'scripts', 'start-sourcecapsule-browser.ps1'),
          '-Status',
          '-BrowserPath',
          fakeBrowser(path.join('managed', 'chromium.exe'), 'Chromium'),
          '-ExtensionDir',
          extensionDir,
        ],
        { encoding: 'utf8' }
      );
      assert.match(status.stdout, new RegExp(`host pid ${hostPid} belongs to .*msedge\\.exe`));
      assert.equal(status.status, 3, status.stdout + status.stderr);
      console.log('ok  launcher -Status reports a host owned by another browser');
    } finally {
      process.kill(hostPid);
      // The temp directory cannot be removed while its msedge.exe is still running.
      const exited = new Promise((resolve) => foreign.once('exit', resolve));
      foreign.kill();
      await exited;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

// A junction or symlink to the repo made import.meta.url (real path) differ from argv[1], so
// main() never ran and the CLI exited 0 with empty stdout.
async function junctionChecks() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sourcecapsule-junction-'));
  try {
    const link = path.join(tmp, 'scripts-link');
    fs.symlinkSync(path.join(root, 'scripts'), link, 'junction');
    const result = await runCli(
      ['--url', 'not-a-post-url'],
      String.raw`\\.\pipe\sourcecapsule-absent-junction-` + process.pid,
      path.join(link, 'sourcecapsule-capture.mjs')
    );
    assert.equal(result.code, 1, 'CLI must run, and fail, through a junction');
    assert.equal(JSON.parse(result.stdout).ok, false);
    console.log('ok  CLI runs when started through a junction');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The proxy aborts its own fetch on timeout. compat.js only calls ontimeout for an error
// matching /timeout/i, and the raw abort message does not.
async function proxyTimeoutChecks() {
  const require = createRequire(import.meta.url);
  const background = require(path.join(root, 'extension-src', 'background.js'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
    });
  try {
    const reply = await new Promise((resolve) =>
      background.handleMessage(
        {
          type: 'sourcecapsule:http',
          request: { url: 'https://pbs.twimg.com/media/a.jpg', timeout: 30 },
        },
        null,
        resolve
      )
    );
    assert.equal(reply.ok, false);
    assert.match(reply.error, /timeout/i);
    console.log('ok  proxy timeout is reported as a timeout, not an abort');
  } finally {
    globalThis.fetch = realFetch;
  }
}

canonicalUrlChecks();
resultContractChecks();
await launcherChecks();
await transportChecks();
await pipeTakeoverChecks();
await cliChecks();
await junctionChecks();
await proxyTimeoutChecks();
console.log('native-host transport tests passed');
