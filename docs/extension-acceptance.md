# Extension popup acceptance testing (Chrome DevTools for agents)

The MV3 extension popup can be exercised end to end by an agent through the
official [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp)
server ("Chrome DevTools for agents"). This is the durable replacement for the
old claim that agent tools cannot inspect the extension popup — they can, and
`scripts/accept-extension.mjs` automates it against the real build.

## What it proves

One command drives the real `chrome-devtools-mcp@latest` server and a real
Chrome through the whole flow:

```bash
npm run build:extension   # produce dist/sourcecapsule-extension
npm run accept:extension  # node scripts/accept-extension.mjs
```

The script installs `dist/sourcecapsule-extension` with `install_extension`,
confirms the pinned extension ID (`gaclgcfljpjojddiikddejenlnjaggie`) via
`list_extensions`, opens `https://x.com/`, opens the popup with
`trigger_extension_action`, and then checks the popup a11y snapshot, DOM, and
screenshots: EN default, full EN→ZH-CN switch (static and dynamic status
text), persistence across popup close/reopen, switch back to English, the
strict-export toggle persisting into the X page's `sourcecapsule.prefs`
localStorage, and clean console output on the popup, the page, and the
extension service worker. Screenshots and snapshots land in
`_scratch/extension-acceptance/` (gitignored).

## Chrome requirements

- **chrome-devtools-mcp ≥ 1.8.0** with `--categoryExtensions=true` — without
  that flag the five extension tools (`install_extension`, `list_extensions`,
  `reload_extension`, `trigger_extension_action`, `uninstall_extension`) do
  not exist. Extension tools also require the default pipe connection; they
  do not work over `browserUrl`/`wsEndpoint`.
- A Chrome **stable-or-newer** binary. If the machine has no Google Chrome,
  install Chrome for Testing (no admin, separate cache, does not touch any
  existing browser):

  ```bash
  npx -y @puppeteer/browsers install chrome@stable --path "%USERPROFILE%\.cache\sourcecapsule-testing"
  ```

  The script finds it there automatically, or accepts an explicit path via
  `SOURCECAPSULE_ACCEPTANCE_CHROME`.

## Quirks that cost debugging time (do not relearn them)

- **The popup closes the moment its window loses focus.** Call
  `select_page` with `bringToFront: true` before every
  `trigger_extension_action`, then poll `list_pages` — the popup takes up to
  a few hundred milliseconds to appear.
- **`list_pages` may show the popup by its title ("SourceCapsule") instead of
  its URL**, depending on timing. Match both.
- **The extension service worker is listed under `list_pages` as `sw-N`.**
  `list_console_messages` accepts its id via `serviceWorkerId` but still
  requires `pageId`.
- **`evaluate_script` responses are wrapped** in a fenced, JSON-escaped
  string — unwrap before regex-matching against raw quotes.
- **The strict-export / reply-context toggles do not persist in
  chrome.storage.** The popup sends `set-preference` to the content-script
  controller, which writes the X page's `localStorage` key
  `sourcecapsule.prefs`. Only `uiLang` lives in `chrome.storage.local`.
- The test profile is throwaway (`--isolated`), so nothing here touches the
  owner's browser, the pinned Brave launcher, or unattended capture.
