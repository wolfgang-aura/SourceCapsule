# Handoff Note — Language Toggle Verification

## Status: RESOLVED (2026-09-02)

The browser verification this note asked for has been done — not with a
hand-rolled Playwright script but with the official **Chrome DevTools for
agents** (`chrome-devtools-mcp@1.8.0`, `--categoryExtensions=true`) against
the real MV3 build (`npm run build:extension`, unpacked install, pinned ID
`gaclgcfljpjojddiikddejenlnjaggie`).

Every item on the original checklist passed, plus persistence and console
checks (24/24):

1. Unpacked extension installed via `install_extension` — pinned ID confirmed.
2. Opened `https://x.com/` and triggered the toolbar action; the real popup
   was snapshotted and screenshotted.
3. Bottom-nav language control showed **EN** initially.
4. Switching to Chinese flipped all visible text, including the dynamic
   status card ("X 页面 已就绪 / 引用、长文及媒体恢复功能已激活。").
5. Close + reopen: Chinese persisted (`chrome.storage.local` `uiLang`).
6. Switched back to English; English text returned.
7. Popup and service-worker consoles were clean of SourceCapsule errors.
8. Bonus: the strict-export toggle was switched off and its persistence into
   the X page's `sourcecapsule.prefs` localStorage was verified after reopen.

The repeatable procedure now lives in `docs/extension-acceptance.md`, and the
automation is `npm run accept:extension` (`scripts/accept-extension.mjs`).
BURNDOWN.md no longer claims agents cannot exercise the popup.

Remaining manual-only item: the File System Access folder picker (a real
native dialog cannot be driven from DevTools automation).
