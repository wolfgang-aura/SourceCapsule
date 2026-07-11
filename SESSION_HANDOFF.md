# Session Handoff — SourceCapsule media-share failure

Last verified: 2026-07-11 (Asia/Singapore)

## Current state

- Repository: `wolfgang-aura/SourceCapsule`
- Branch: `main`
- `main` is 3 local commits ahead of `origin/main`; none of these commits have been pushed or deployed.
- HEAD: `2a72f9c` (`wip: fall back to page media fetch`)
- Prior checkpoints: `e76a00d` (X referrer for media requests), `50101c3` (retry media immediately before share upload).
- Working tree is clean except user-owned untracked `.claude/` and `sourcecapsule-extension.zip`.
- Production share Worker has not been changed. There is no dev server to restart.

## User-visible issue

The user is using the Chrome MV3 extension's **Create AI Readable link** action on this X Article:

`https://x.com/Vegahao/status/2075576963021033522`

The Article visibly contains eight images. X's page DOM exposes all eight `pbs.twimg.com/media/...` URLs, and direct browser navigation to those URLs loads valid JPEGs. However, every share capsule tested contains only the author avatar; the eight Article image blocks render as **Image unavailable at export time**.

Verified failing capsules:

- `https://sourcecapsule-share.wolfgang-aura.workers.dev/c/7d20dbe5fc3ecbd93c8741d901246836`
- `https://sourcecapsule-share.wolfgang-aura.workers.dev/c/b2ecedf1c69cbbd7c1aff6270fc4b416`
- `https://sourcecapsule-share.wolfgang-aura.workers.dev/c/d95e79ee69ca38c63f224229ebe23f9d`
- `https://sourcecapsule-share.wolfgang-aura.workers.dev/c/245b69fa50ce79bed449b1d9ebf9ed99`
- `https://sourcecapsule-share.wolfgang-aura.workers.dev/c/6791a329f3dcc4083157d5d348d98459`

The latest capsule was rechecked after the latest attempted fix and still has:

- 2 rendered `<img>` elements: one 35 KB data URI avatar and one empty/missing image placeholder path.
- 8 `.xa-missing` Article image blocks.
- No Article image bytes uploaded/rendered.

The failure is before or during media byte capture, not an R2 routing/rendering problem. The share Worker correctly serves the HTML and the missing-media placeholders.

## What has been tried

1. `50101c3`: `createShareLink()` now runs a final `rescueMissingMedia(model)` pass immediately before collecting upload files. This was intended to handle lazy Article images missed by the earlier capture pass.
2. `e76a00d`: added `referrer: https://x.com/` and `strict-origin-when-cross-origin` to userscript, MV3 content fallback, and MV3 background media requests. The next live export was still missing all eight images.
3. `2a72f9c`: added `fetchAsDataUriFromPage()`, a final page-context `fetch()` fallback with browser credentials after every privileged candidate fetch fails validation. The latest live export was still missing all eight images.

All changes were tested with:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run format:check
npm.cmd run build:extension
```

All passed. The generated package is at:
`C:\Users\cheon\Desktop\Projects\eXportArticle\dist\sourcecapsule-extension`

## Important observations

- The X page log showed `harvested media urls: 8` and the current DOM showed the eight expected media URLs.
- Direct browser navigation to `HM3uC40agAAc3be.jpg` variants (`orig`, `4096x4096`, `large`, `medium`, `small`) loaded valid images.
- The extension's `GM_xmlhttpRequest` compatibility layer routes through the MV3 service worker, then base64-encodes response bytes. This is now the highest-priority suspect.
- Current console logs do not expose the per-image failure status/URL during the user's export, so the exact failing layer remains unproven.
- The latest user export was made after reloading the extension, according to the user, but the exact runtime logs for that export are not available.

## Recommended next investigation

Do not make another speculative fetch change first. Instrument one export so the user-visible diagnostics record, per image:

- media URL and candidate URL;
- request path: MV3 background, compat direct fetch, or page fetch;
- HTTP status;
- response `Content-Type`;
- byte length;
- validation failure reason;
- whether `fetch()` threw a CORS/network error.

Put this in the diagnostic bundle or a temporary visible export summary, not only `console.warn`, because the user reported no warnings. Then run one fresh export and use the evidence to choose between:

- MV3 service-worker response/message-size corruption;
- `pbs.twimg.com` response rejection/anti-hotlink behavior;
- page-context CORS failure;
- `validateImageDownload()` rejecting valid X image bytes;
- model mutation/collection losing successful bytes before `collectBundleMediaFiles()`.

Also add a regression test for the discovered failure response once the exact status/body is known. Do not push, deploy the Worker, publish the userscript, or update the Chrome Web Store listing without explicit user authorization.

## User handoff instruction

The user is switching to a stronger model. Start by reading this file, checking `git status -sb` and `git log -15 --oneline --decorate`, then inspect the media-fetch instrumentation and the latest failing capsule. The next model should treat the issue as an unresolved Chrome MV3 media-byte capture bug, not as a missing local-download problem.
