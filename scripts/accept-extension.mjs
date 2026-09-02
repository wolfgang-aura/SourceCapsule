// Acceptance test for the MV3 extension popup, driven through the official
// chrome-devtools-mcp server ("Chrome DevTools for agents") with
// --categoryExtensions=true. This drives the real server and the real Chrome;
// it is not a simulation. See docs/extension-acceptance.md.
//
// Usage:
//   npm run build:extension        (must exist in dist/sourcecapsule-extension)
//   node scripts/accept-extension.mjs
//
// Chrome resolution order:
//   1. SOURCECAPSULE_ACCEPTANCE_CHROME env var (path to a Chrome executable)
//   2. Chrome for Testing under ~/.cache/sourcecapsule-testing (see
//      docs/extension-acceptance.md for the one-line install command)
//   3. A locally installed Google Chrome
//
// The browser runs with a throwaway profile (--isolated) and its own window;
// it never touches the owner's browser or the unattended-capture setup.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const EXT_PATH = join(REPO, 'dist', 'sourcecapsule-extension');
const OUT = join(REPO, '_scratch', 'extension-acceptance');
const PINNED_ID = 'gaclgcfljpjojddiikddejenlnjaggie';

function findChrome() {
  if (process.env.SOURCECAPSULE_ACCEPTANCE_CHROME) {
    return process.env.SOURCECAPSULE_ACCEPTANCE_CHROME;
  }
  const cache = join(homedir(), '.cache', 'sourcecapsule-testing', 'chrome');
  if (existsSync(cache)) {
    for (const build of readdirSync(cache)) {
      const exe = join(cache, build, 'chrome-win64', 'chrome.exe');
      if (existsSync(exe)) return exe;
    }
  }
  for (const base of ['C:\\Program Files', 'C:\\Program Files (x86)']) {
    const exe = join(base, 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  return null;
}

const CHROME = findChrome();
if (!CHROME) {
  console.error(
    'No Chrome found. Install Chrome for Testing (no admin, no profile impact):\n' +
      '  npx -y @puppeteer/browsers install chrome@stable --path "%USERPROFILE%\\.cache\\sourcecapsule-testing"\n' +
      'or point SOURCECAPSULE_ACCEPTANCE_CHROME at a chrome.exe.'
  );
  process.exit(2);
}
if (!existsSync(join(EXT_PATH, 'manifest.json'))) {
  console.error('dist/sourcecapsule-extension is missing — run `npm run build:extension` first.');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });

const child = spawn(
  'npx',
  [
    '-y',
    'chrome-devtools-mcp@latest',
    '--categoryExtensions=true',
    '--isolated=true',
    `--executablePath=${CHROME}`,
  ],
  { stdio: ['pipe', 'pipe', 'pipe'], shell: true }
);
child.stderr.on('data', () => {});
let nextId = 1;
const pending = new Map();

child.stdout.on(
  'data',
  (() => {
    let buf = '';
    return (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        } else if (msg.method === 'roots/list') {
          child.stdin.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { roots: [{ uri: `file:///${REPO.replace(/\\/g, '/')}`, name: 'repo' }] },
            }) + '\n'
          );
        }
      }
    };
  })()
);

function request(method, params, timeoutMs = 120000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${method}`));
    }, timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

async function call(name, args = {}) {
  const res = await request('tools/call', { name, arguments: args });
  if (res.error) throw new Error(`${name}: ${JSON.stringify(res.error)}`);
  const out = res.result ?? {};
  const text = (out.content ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
  if (out.isError) throw new Error(`${name} isError: ${text}`);
  return text;
}

// evaluate_script responses arrive wrapped in a fenced "..." with escaped quotes.
function unwrap(text) {
  const a = text.indexOf('"');
  const b = text.lastIndexOf('"');
  if (a < 0 || b <= a) return text;
  return JSON.parse(text.slice(a, b + 1));
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listPages() {
  const text = await call('list_pages');
  writeFileSync(join(OUT, 'pages-last.txt'), text);
  return text
    .split('\n')
    .map((l) => l.match(/^(sw-\d+|\d+):\s*(.+?)(?:\s*\[selected\])?$/))
    .filter(Boolean)
    .map((m) => ({ id: m[1], url: m[2].trim(), isSw: m[1].startsWith('sw-') }));
}

// list_pages may show the popup by URL or by its title ("SourceCapsule").
function popupIn(pages) {
  return (
    pages.find(
      (p) =>
        !p.isSw &&
        (p.url.includes('popup.html') ||
          p.url.startsWith(`chrome-extension://${PINNED_ID}`) ||
          p.url.trim() === 'SourceCapsule')
    ) ?? null
  );
}

async function awaitPopup(attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    const popup = popupIn(await listPages());
    if (popup) return popup;
    await sleep(500);
  }
  return null;
}

async function findSw() {
  const pages = await listPages();
  return pages.find((p) => p.isSw && p.url.includes(PINNED_ID)) ?? null;
}

// The visible EN/中文 pill label is aria-hidden, so read it from the DOM and
// pair it with the authoritative language state (aria-checked + html[lang]).
async function langLabel(pageId) {
  return unwrap(
    await call('evaluate_script', {
      pageId,
      function:
        "() => { const t = document.getElementById('lang-toggle'); const en = t.querySelector('.lang-en'); const zh = t.querySelector('.lang-zh'); const visible = en.style.color ? 'EN' : zh.style.color ? '中文' : 'none'; return visible + ' | aria-checked=' + t.getAttribute('aria-checked') + ' | html.lang=' + document.documentElement.lang; }",
      waitForStableDom: false,
    })
  ).trim();
}

async function main() {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: { roots: { listChanged: false } },
    clientInfo: { name: 'sourcecapsule-acceptance-driver', version: '1.0.0' },
  });
  console.log('[server]', JSON.stringify(init.result?.serverInfo), '| chrome:', CHROME);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const installed = await call('install_extension', { path: EXT_PATH });
  check('install_extension succeeded', true, installed.trim());

  const exts = await call('list_extensions');
  check(
    'extension has pinned ID gaclgcfljpjojddiikddejenlnjaggie',
    exts.includes(PINNED_ID),
    exts.replace(/\n/g, ' | ')
  );
  check('extension reports v1.5.2 Enabled', /v1\.5\.2 .*Enabled|Enabled .*v1\.5\.2/.test(exts));

  const pages0 = await listPages();
  const mainId = Number(pages0.find((p) => !p.isSw).id);
  await call('navigate_page', { pageId: mainId, type: 'url', url: 'https://x.com/' });
  check('navigated to https://x.com/', true);

  // The popup auto-closes when its window loses focus, so bring the window to
  // front before every trigger_extension_action.
  await call('select_page', { pageId: mainId, bringToFront: true });
  await call('trigger_extension_action', { id: PINNED_ID });
  const popup1 = await awaitPopup();
  check('popup opens via trigger_extension_action', Boolean(popup1), popup1?.url ?? 'not found');
  if (!popup1) throw new Error('no popup page');
  const popupId = Number(popup1.id);

  const snapEn = await call('take_snapshot', { pageId: popupId });
  writeFileSync(join(OUT, 'snapshot-en.txt'), snapEn);
  const labelEn = await langLabel(popupId);
  check(
    'language control initially shows EN',
    labelEn.startsWith('EN') && /aria-checked=false/.test(labelEn),
    labelEn
  );
  check(
    'static English text (tagline, Library, switches)',
    snapEn.includes('Archive X. Keep the source.') &&
      snapEn.includes('Library') &&
      snapEn.includes('Strict export')
  );
  check(
    'dynamic status text is English',
    /X page ready|recovery are active|Checking this tab|Connecting to SourceCapsule/.test(snapEn)
  );
  await call('take_screenshot', { pageId: popupId, filePath: join(OUT, 'popup-en.png') });

  const enSwitchUid = (snapEn.match(/uid=(\S+) switch "Switch language/) ?? [])[1];
  check('language toggle switch found in snapshot', Boolean(enSwitchUid));
  await call('click', { pageId: popupId, uid: enSwitchUid });
  const snapZh = await call('take_snapshot', { pageId: popupId });
  writeFileSync(join(OUT, 'snapshot-zh.txt'), snapZh);
  const labelZh = await langLabel(popupId);
  check('language control now shows 中文', labelZh.includes('中文'), labelZh);
  check(
    'all static text switched to Simplified Chinese',
    snapZh.includes('存档 X，保留来源。') &&
      snapZh.includes('资料库') &&
      snapZh.includes('严格导出') &&
      !snapZh.includes('Archive X. Keep the source.') &&
      !snapZh.includes('Strict export')
  );
  check(
    'dynamic status text switched to Chinese',
    /已就绪|恢复功能已激活|正在检查此标签页|正在连接 SourceCapsule/.test(snapZh)
  );
  await call('take_screenshot', { pageId: popupId, filePath: join(OUT, 'popup-zh.png') });

  await call('close_page', { pageId: popupId }).catch(() => null);
  await call('select_page', { pageId: mainId, bringToFront: true });
  await call('trigger_extension_action', { id: PINNED_ID });
  const popup2 = await awaitPopup();
  check('popup reopened after close', Boolean(popup2));
  if (!popup2) throw new Error('popup did not reopen');
  const popupId2 = Number(popup2.id);
  const snapZhReopen = await call('take_snapshot', { pageId: popupId2 });
  const labelZhReopen = await langLabel(popupId2);
  check(
    'Chinese preference persisted across popup reopen',
    snapZhReopen.includes('存档 X，保留来源。') && labelZhReopen.includes('中文'),
    labelZhReopen
  );
  await call('take_screenshot', { pageId: popupId2, filePath: join(OUT, 'popup-zh-reopen.png') });

  const zhSwitchUid = (snapZhReopen.match(/uid=(\S+) switch "Switch language/) ?? [])[1];
  await call('click', { pageId: popupId2, uid: zhSwitchUid });
  const snapEnAgain = await call('take_snapshot', { pageId: popupId2 });
  const labelEnAgain = await langLabel(popupId2);
  check(
    'switched back to English (control + static + dynamic)',
    labelEnAgain.startsWith('EN') &&
      /aria-checked=false/.test(labelEnAgain) &&
      snapEnAgain.includes('Archive X. Keep the source.') &&
      /X page ready|recovery are active|Checking this tab|Connecting to SourceCapsule/.test(
        snapEnAgain
      ),
    labelEnAgain
  );
  await call('take_screenshot', { pageId: popupId2, filePath: join(OUT, 'popup-en-again.png') });

  // Strict export defaults ON; turn it OFF and verify it persists. The popup
  // saves prefs into the X page's localStorage via the content-script
  // controller, not chrome.storage.
  const strictUid = (snapEnAgain.match(/uid=(\S+) switch "Strict export/) ?? [])[1];
  check('strict export switch found', Boolean(strictUid));
  if (strictUid) {
    await call('click', { pageId: popupId2, uid: strictUid });
    const liveState = unwrap(
      await call('evaluate_script', {
        pageId: popupId2,
        function:
          "() => JSON.stringify({ strict: document.getElementById('strict-export').checked })",
        waitForStableDom: false,
      })
    );
    check(
      'strict export now OFF in live popup',
      /"strict":false/.test(liveState),
      liveState.trim()
    );
    await call('close_page', { pageId: popupId2 }).catch(() => null);
    await call('select_page', { pageId: mainId, bringToFront: true });
    await call('trigger_extension_action', { id: PINNED_ID });
    const popup3 = await awaitPopup();
    check('popup reopened for settings persistence check', Boolean(popup3));
    if (popup3) {
      const prefsPersist = unwrap(
        await call('evaluate_script', {
          pageId: mainId,
          function:
            "() => JSON.stringify(JSON.parse(localStorage.getItem('sourcecapsule.prefs') || '{}'))",
          waitForStableDom: false,
        })
      );
      check(
        'x.com localStorage shows strictExport=false after reopen',
        /"strictExport":false/.test(prefsPersist),
        prefsPersist.trim().slice(0, 200)
      );
      const popupCheckbox = unwrap(
        await call('evaluate_script', {
          pageId: Number(popup3.id),
          function:
            "() => JSON.stringify({ strict: document.getElementById('strict-export').checked })",
          waitForStableDom: false,
        })
      );
      check(
        'reopened popup renders strict export unchecked',
        /"strict":false/.test(popupCheckbox),
        popupCheckbox.trim()
      );
      const uiLang = unwrap(
        await call('evaluate_script', {
          pageId: Number(popup3.id),
          function:
            '() => new Promise((res) => chrome.storage.local.get(null, res)).then((v) => JSON.stringify(v))',
          waitForStableDom: false,
        })
      );
      check(
        'chrome.storage shows uiLang=en',
        /"uiLang":"en"/.test(uiLang),
        uiLang.trim().slice(0, 200)
      );
    }
  }

  // Console output: popup, main page, and extension service worker. Only
  // SourceCapsule-related messages count as failures; the X login page emits
  // its own 404 noise.
  for (const target of [
    ['popup', await awaitPopup(2)],
    ['main (x.com)', { id: String(mainId) }],
  ]) {
    if (!target[1]) continue;
    const label = target[0];
    try {
      const msgs = await call('list_console_messages', {
        pageId: Number(target[1].id),
        types: ['error', 'warn', 'issue', 'assert'],
      });
      const body = msgs.trim();
      writeFileSync(join(OUT, `console-${label.replace(/[^a-z]/g, '')}.txt`), body || '(none)');
      check(
        `console clean on ${label}`,
        !/sourcecapsule|chrome-extension|compat\.js|page-bridge/i.test(body),
        body ? body.split('\n').slice(0, 3).join(' | ') : '(no error/warn messages)'
      );
    } catch (e) {
      check(`console readable on ${label}`, false, e.message);
    }
  }
  const sw = await findSw();
  if (sw) {
    try {
      const swMsgs = await call('list_console_messages', {
        pageId: mainId,
        serviceWorkerId: sw.id,
        types: ['error', 'warn', 'issue', 'assert'],
      });
      const body = swMsgs.trim();
      writeFileSync(join(OUT, 'console-sw.txt'), body || '(none)');
      check(
        'console clean on extension service worker',
        !/sourcecapsule|chrome-extension|background\.js/i.test(body),
        body ? body.split('\n').slice(0, 3).join(' | ') : '(no error/warn messages)'
      );
    } catch (e) {
      check('console readable on extension service worker', false, e.message);
    }
  } else {
    check('extension service worker found in list_pages', false);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('\nABORTED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    child.stdin.end();
    setTimeout(() => child.kill(), 1500);
  });
