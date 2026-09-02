# SourceCapsule

English | [简体中文](README.zh-CN.md)

**Save X/Twitter threads & Articles as clean Markdown for LLMs — plus a one-file offline HTML
archive.**

One click on a post, thread, or Article produces an agent-ready folder: a clean `.llm.md` you can
paste straight into Claude or ChatGPT, the real image files it references, and a self-contained
`.html` that opens fully offline with media and quoted posts inlined. No screenshots, no
copy-paste mangling, no dead links when the thread disappears.

<!-- TODO(demo): 20-second demo GIF goes here. Flow: open a thread -> click "Save thread" ->
     show the saved folder -> drag the .llm.md into Claude. Save the recording as docs/demo.gif
     and replace this comment with:
![Demo: X thread to LLM-ready context in one click](docs/demo.gif)
-->

**Why this instead of copy-paste or screenshots?**

- **LLMs read text, not pixels.** You get Markdown in reading order with author, timestamps, and
  the source URL — plus real image files an agent can actually look at.
- **Threads resist copying.** X virtualizes long threads and lazy-loads media; SourceCapsule
  scrolls, captures, and reports honestly what it got (and what it could not get).
- **It archives, not just extracts.** The same click yields a self-contained offline HTML file
  with images, inline video, and quoted posts embedded — still readable in ten years.

## Install (30 seconds)

1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Install SourceCapsule from
   [Greasy Fork](https://greasyfork.org/en/scripts/584577-sourcecapsule-x-article-post-self-contained-html)
   (auto-updates), or open
   [sourcecapsule.user.js](https://raw.githubusercontent.com/wolfgang-aura/SourceCapsule/main/sourcecapsule.user.js)
   and click **Install**.
3. Open any post, thread, or Article on x.com and click **Save thread** / **Save article**.

The source file is also the shipped artifact: plain JavaScript, no production build step.

## What is new in v1.5

- **Reply archive (experimental).** Capture the *replies* to a post — full text, author,
  timestamp, parent id, and media links — as threaded Markdown plus a full-text CSV. See
  [Reply archive](#reply-archive-experimental) below.
- **A shorter menu.** The post drop-down had grown to ten items, which buried the common
  actions; it is now six. Nothing lost capability: **Save locally + create AI link** was two
  actions that are both still listed separately, and **Download ZIP (HTML + Markdown)** is the
  non-Chromium fallback that **Save to library** already falls back to on its own.
- **One image is one media link.** X serves the same image with and without a file extension
  before the query string, so an image seen by two capture layers used to be recorded twice.
  When two URLs name the same asset, the full-size rendition wins.

## What is new in v1.4.1

- **Complete media in AI-readable links.** Choosing **Create AI readable link** now packages the
  same captured images and video poster stills as a local save plus share. Sharing no longer
  depends on running a local save first. The existing 25 MB hosted-share cap still applies.

## What is new in v1.4

- **Strict export mode (on by default).** After every recovery layer runs, SourceCapsule walks
  the finished model and blocks the download if the reader would see a dead-end: a quoted post
  with no canonical permalink, a quoted post whose content couldn't be captured, an image that
  never inlined, or a video with neither bytes nor a poster. The block modal lists exactly what
  is broken, offers a **Copy diagnostic bundle** button (self-contained JSON with URL, verdict,
  counts, and a media-stripped model skeleton), and requires **Ship it anyway** or **Cancel
  export** to proceed. Toggle it from the userscript-manager menu or the extension popup.
- **Three-layer quote-source recovery.** The exporter now catches a quoted tweet's canonical
  permalink even when X's DOM drops the anchor: (a) parent→quoted ref triples harvested
  passively from the GraphQL responses X's own web app already downloaded, (b) syndication
  pool matching for the leftovers, (c) per-thread-post syndication that reuses the fetched
  `quoted_tweet` payload to patch source URLs and rebuild the card in one round-trip.
- **Author-profile link fallback.** In the rare case where every recovery layer misses, a
  quoted card links to the author's X profile instead of showing "Source URL unavailable" —
  never a dead-end for the reader.
- **Thread-menu escape hatch.** Every focused-post button now exposes **Save full thread** in
  its drop-down, regardless of auto-detection. Choosing it forces a full-column scroll so
  late-loading same-author replies are always captured — the "I know it's a thread, why does
  it say Save post" scenario is fixable in one click.
- **Share Worker previews.** Shared capsules now emit `Content-Length` on GET and HEAD, so
  Slack, Discord, and Twitter link previews render the shared images and pages correctly.
- **First-try recovery hardening.** Quote-only GraphQL responses are retained, quote cards that
  never mounted are rebuilt from the parent payload, Article images survive virtualization,
  DOM-only polls/card previews survive authoritative quote upgrades, and ambiguous video URLs are
  never attached to a post by guesswork. Media downloads are signature-checked so an HTTP error
  page cannot masquerade as a captured image.
- **Clearer controls and packaging.** The redesigned MV3 popup explains page readiness and
  folder-vs-ZIP delivery, with accessible switches, keyboard navigation, dark mode, and
  reduced-motion support. One-off HTML + Markdown downloads now arrive together in one ZIP.

The product remains local-first. Nothing is uploaded until you explicitly choose
**Create AI readable link** and confirm the expiry — and the reply archive never uploads at
all. When a save and a share are combined, the local copy is completed first, so an upload
failure cannot take it away. Shared capsules exclude raw video, are capped at 25 MB, and
retain source links when media cannot be included.

## Use it

On the X timeline, a status page, or an Article:

- Click **Save post**, **Save thread**, or **Save article** for the default quick-save flow.
- If a timeline card says **Open post first**, open the post and save from the status/Article page;
  the feed preview does not contain enough content for a complete archive.
- Click **...** beside it for:
  - Save full thread (on a focused post page)
  - Save with note and tags
  - Copy clean Markdown
  - Create AI readable link
  - Capture replies (experimental) — on a focused post page
  - Download reply archive — on a focused post page

The first library save asks you to choose a root folder. Desktop Chromium writes folders directly.
Browsers without the File System Access API receive a zip with the same structure.

```text
<library root>/
  _sourcecapsule-index.md
  2026-07-02/
    <handle>-<status-id>/
      <handle>-<status-id>.html
      <handle>-<status-id>.llm.md
      AI_LINK.txt              # only after an AI readable link is created
      media/
      README.txt
```

Thread capture is deliberately honest: it includes same-author posts visible during a progressive
scroll, marks post boundaries, and records `best-effort` completeness in the manifest. X can
virtualize or withhold posts, so this is not yet a guarantee of every reply in very long threads.

## Reply archive (experimental)

Everything above archives a post and its thread. This archives the **replies to** a post —
what people said back — as threaded Markdown plus a full-text CSV.

On an opened post, click **...** then:

1. **Capture replies (experimental)** — one click walks all three of X's reply surfaces
   (Latest, Top, Relevant) and merges them. Expect a few minutes on a large conversation;
   progress is reported per surface. Leave the tab in front.
2. **Download reply archive** — writes `sourcecapsule-replies-<id>.md` and `.csv`.

Replies accumulate across runs and never shrink. A populated field is never overwritten by an
empty one and the longer text always wins, so a truncated preview cannot clobber full
long-form text, and a reply that disappears from a later surface keeps what was already
captured. Storage is IndexedDB; if a write fails, it says so rather than losing the run
silently.

**Reply media is recorded as links only** — downloading media for thousands of replies is out
of scope. Images, video, and posters are listed as URLs you can follow.

### How complete is it?

Every archive reports what it captured, lists any reply id it knows about but could not fetch,
and refuses to treat X's public reply counter as a denominator. Measured across three real
conversations:

| Replies on X (counter) | Archived with content | Known but uncaptured |
| --- | --- | --- |
| 764 | 636 | 0 |
| 670 | 537 | 0 |
| 32 | 36 | 0 |

In every case the archive captured **100% of the replies X actually delivered to the browser**.
The shortfall against the counter in the first two is replies X never served at all — deleted,
blocked, restricted, or simply never returned by any surface — which are undetectable by
construction. The third row exceeds its counter because X's number appears to count direct
replies only, while the archive also captures nested replies-to-replies.

Coverage is best effort and the receipt in every export says so. Deleted, private, and
never-delivered replies remain unknowable.

## AI readable links

The userscript ships pointing at the hosted share service
(`https://sourcecapsule-share.wolfgang-aura.workers.dev`): a Cloudflare Worker + R2 backend with
per-IP rate limiting on link creation, a 25 MB package cap, and 1/7/30-day expiry with daily
cleanup. To try it:

1. Open a post on x.com and click **...** beside the SourceCapsule button.
2. Click **Create AI readable link**.
3. Keep **7 days**, or choose 1/30 days.
4. Confirm. The resulting URL is copied to your clipboard.
5. Paste the URL into a new tab. Add `.md` to the capsule URL for the clean Markdown endpoint.

When the link expires, the archived copy is deleted but the link does not go blank: it serves a
short notice page pointing back to the original post on X, so whoever you sent it to can still
find the source. The `.md` endpoint serves the same notice as Markdown. That pointer holds only
the post's public permalink, title, and author handle — nothing about who made the link — and is
removed 180 days after expiry, or immediately if you delete the link.

Successful links are remembered in this browser under **SourceCapsule: Recent AI readable links**.
Expired links remain visible but greyed out. When a link is created from a local-save receipt or the
combined save-and-link flow, SourceCapsule also writes `AI_LINK.txt` beside the saved Markdown so the
same link can be recovered from the library folder.

### Develop against a local share service

```powershell
cd SourceCapsule
npm.cmd install
npm.cmd run dev:share
```

Leave that PowerShell window open, then open Tampermonkey while on x.com and set
**SourceCapsule: Share service URL** to `http://127.0.0.1:8787`. Other hosts also need an
`@connect` grant in the userscript header (and a `host_permissions` entry in the extension
manifest).

### Self-host the share service

The backend is a small Cloudflare Worker with an R2 bucket. Deployment details are in
[`share-worker/README.md`](share-worker/README.md). Accounts, billing, and permanent-link quotas
are intentionally not part of this first share release.

## Test the Chrome extension (unpacked beta)

```powershell
cd SourceCapsule
npm.cmd run build:extension
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** in the top-right.
3. Click **Load unpacked**.
4. Choose
   `dist\sourcecapsule-extension`.
5. Disable the SourceCapsule userscript in Tampermonkey for x.com to avoid duplicate buttons.
6. Refresh a status page and test quick save, this-post-only, copy Markdown, and AI readable links.

This package reuses the tested userscript engine through a thin compatibility layer and has passed
the automated package suite plus live-X validation. It remains an unpacked beta until a separate
Chrome Web Store publication is prepared.

## Unattended capture from the command line (experimental)

One command captures a post and returns a ready AI readable link, with no clicks, no prompts,
and no clipboard use:

```powershell
node scripts\sourcecapsule-capture.mjs --url "https://x.com/handle/status/123" --json
```

```json
{
  "ok": true,
  "sourceUrl": "https://x.com/handle/status/123",
  "viewUrl": "https://sourcecapsule-share.wolfgang-aura.workers.dev/c/...",
  "markdownUrl": "https://sourcecapsule-share.wolfgang-aura.workers.dev/c/....md",
  "expiresAt": "2026-09-06T12:51:33.824Z",
  "complete": true,
  "warnings": []
}
```

Only that JSON goes to stdout. Progress and diagnostics go to stderr, and a failure exits nonzero.

It reuses the normal capture path. The extension opens the post in a **background window**, waits
for the passive GraphQL recovery layer, runs the same `share` export a menu click would run, and
keeps strict completeness validation on. If strict mode still finds missing evidence after every
recovery layer and retry, the command fails with `needs_owner` and lists what is missing, rather
than publishing a capsule with dead ends in it:

```json
{
  "ok": false,
  "error": "needs_owner",
  "message": "Strict capture could not recover missing evidence.",
  "counts": { "imageFetchFailed": 2 }
}
```

### Setup

```powershell
npm.cmd run build:extension
npm.cmd run install:native-host
```

The installer needs no administrator rights. It writes everything under `HKCU` and installs the
host into `%LOCALAPPDATA%\SourceCapsule\native-host`, registering it for Chrome, Edge, and Brave.

Then load `dist\sourcecapsule-extension` as an unpacked extension and confirm its ID reads
`gaclgcfljpjojddiikddejenlnjaggie`. The ID is pinned by a `key` in the manifest, because the
native messaging host has to name a fixed extension origin.

Verify the bridge with:

```powershell
node scripts\sourcecapsule-capture.mjs --ping
```

### Keeping the extension loaded across restarts

`--load-extension` installs at Chromium's `COMMAND_LINE` location. The browser records it in the
profile but does **not** load it again on a start that lacks the flag, so an ordinary restart has
no SourceCapsule extension at all: no service worker, no native port, and a CLI that cannot reach
the host. The worker is not asleep; it does not exist.

Install a launcher that always passes the flag:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-sourcecapsule-browser.ps1 -InstallShortcut -InstallStartup
```

That puts **Brave with SourceCapsule** on the Desktop, in the Start Menu, and in Startup. Start
the browser from it and the bridge is always there. Starting it any other way silently drops the
extension.

To check or repair the current state:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-sourcecapsule-browser.ps1 -Status
powershell -ExecutionPolicy Bypass -File scripts\start-sourcecapsule-browser.ps1 -Restart -Verify
```

`-Status` reports whether the running browser has the flag and exits nonzero when it does not.
`-Restart` closes it and starts it correctly; a browser that is already running without the flag
cannot be fixed by launching it again, because the second launch just hands its arguments to the
existing process. `-Verify` then polls `--ping` until the bridge answers, so the launcher cannot
report success while the bridge is still down.

The alternative is a one-time **Load unpacked** of `dist\sourcecapsule-extension` from
`brave://extensions`, which records the extension at the `UNPACKED` location and survives restarts
without any launcher. It is a manual UI step, and it cannot coexist with the command-line copy:
same `key`, same extension ID.

### How it fits together

The browser spawns native messaging hosts; nothing outside can dial into the browser. So the
service worker holds a long-lived port to the host, the host owns a Windows named pipe, and the
CLI connects to that pipe. One host owns the pipe at a time, which is also what enforces one
capture at a time. Timeouts are bounded at every hop and the URL is validated against a canonical
`x.com/<handle>/status/<id>` pattern in both the CLI and the extension.

### Known limits

- Windows only. The pipe and the installer are Windows-specific.
- The browser must be running with the extension loaded and signed into X, which in practice
  means starting it from the launcher above.
- If the extension is not actually running, the bridge reports
  `Specified native messaging host not found`. That is almost always a start without
  `--load-extension`, not a bad registration.
- The capture window is visible but never focused. A hidden tab has `requestAnimationFrame`
  paused and timers throttled, which starves the media force-load pass and manufactures
  strict-mode blockers.

## What is captured

| Content | Result |
| --- | --- |
| Text, headings, lists, links | Preserved in reading order |
| Same-author thread continuations | Captured best-effort, with explicit post boundaries |
| Images | Inlined at the highest accessible resolution |
| Quoted posts | Rebuilt as selectable cards using X syndication data |
| Downloadable MP4 | Embedded in a full offline HTML archive |
| HLS-only or blocked video | Poster and source link; clearly marked incomplete |
| Agent bundle | Markdown plus real image/poster files; raw video excluded |
| Replies to a post | Threaded Markdown + CSV with full text; media as links only (experimental) |
| Provenance | Source URL, author, timestamp, warnings, and capture manifest |

An archive never claims more than it actually preserved. Missing media, preview-only long-form
quotes, and incomplete video are visible in both the rendered output and manifest. For long-form
(note) posts, SourceCapsule recovers the full text when X has already delivered it to your
browser while the page was open (no extra requests); otherwise the preview is clearly flagged
as truncated.

## Settings

Open the userscript-manager menu while on x.com:

- **Layout:** folders by date (default) or flat.
- **Contents:** full archive (default) or lean Markdown + media.
- **Strict Export:** on by default; blocks silent incomplete downloads after recovery retries.
- **Reply Context:** on by default; prepends the parent post when exporting a reply.
- **Share service URL:** localhost for development, your Worker domain for production.
- **Change export folder:** select another library root.
- **Floating button:** optional; off by default.

## Development

Requirements: Node.js 18+.

```powershell
cd SourceCapsule
npm.cmd install
npm.cmd test
npm.cmd run lint
npm.cmd run format:check
npm.cmd run build:extension
```

The automated suite covers the DOM-free renderer, jsdom extraction/thread behavior, share Worker,
and extension packaging. It does not replace manual testing against X's live DOM.

## Privacy and security

- Normal saves stay on your machine.
- Sharing requires an explicit confirmation and an expiry.
- Share IDs are high-entropy and unguessable, but anyone holding a link can read it.
- Shared pages send `noindex` and restrictive security headers.
- The service rejects unsupported file paths and caps each capsule at 25 MB.
- A deletion token is created client-side and is not exposed in the public URL.
- After expiry only a back-link to the original public post survives; deleting a link removes
  that too.

Do not share sensitive posts through a public deployment until authentication and abuse controls
exist. “Unguessable” is useful access control for v1 testing, not a replacement for user accounts.

## Deliberately out of scope for v1.5

- AI summaries, chat, OCR, transcripts, or media descriptions
- Bookmark scraping and bulk export
- Permanent-link allowances, user accounts, billing, or subscriptions
- A hosted dashboard or full-text search
- HLS video reassembly
- Guaranteed capture of every post in arbitrarily long threads
- Downloading reply media (the reply archive records links only)
- Chrome Web Store publication

## License

MIT. See [LICENSE](LICENSE).
