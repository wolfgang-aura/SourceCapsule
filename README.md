# SourceCapsule

Save an X post, thread, or Article as a durable offline archive, an agent-ready folder, or a
temporary link you can give to an LLM.

> Development status: **v1.2.0 is ready for local testing.** The public install link still follows
> the latest version on `main`; do not publish this release until the manual X and Chrome checks
> below pass.

## What is new in v1.2

- **One-click quick save.** The main button immediately saves to your library.
- **Full thread by default.** On status pages, SourceCapsule scrolls from the top and captures the
  same-author thread posts it can verify. The options menu still has “this post only.”
- **Share with AI.** Create a private, unguessable web link that expires after 1, 7, or 30 days
  (7 days by default). The link exposes clean HTML, Markdown, a manifest, and image/poster files.
- **Copy clean Markdown.** Put agent-ready context directly on the clipboard.
- **Saved context.** Add an optional “saved because” note and tags before saving.
- **Local library index.** Each library root gets `_sourcecapsule-index.md`, updated on save.
- **Experimental Chrome extension.** A generated Manifest V3 package now runs the same source
  engine without Tampermonkey.

The product remains local-first. Nothing is uploaded until you explicitly choose **Share with AI**
or **Save locally + share with AI** and confirm the expiry. In the combined flow, the local copy is
completed first, so an upload failure cannot take it away. Shared capsules exclude raw video, are
capped at 25 MB, and retain source links when media cannot be included.

## Install the userscript

1. Install Tampermonkey or Violentmonkey.
2. Open
   [sourcecapsule.user.js](https://raw.githubusercontent.com/wolfgang-aura/SourceCapsule/main/sourcecapsule.user.js).
3. Click **Install**.
4. Open a post, thread, or Article on x.com.

The source file is also the shipped artifact: plain JavaScript, no production build step.

## Use it

On an X post or Article:

- Click **Save thread** or **Save article** for the default quick-save flow.
- Click **...** beside it for:
  - Save with note and tags
  - Save locally + share with AI
  - Save this post only
  - Copy clean Markdown
  - Share with AI
  - HTML + Markdown, HTML only, or Markdown only

The first library save asks you to choose a root folder. Desktop Chromium writes folders directly.
Browsers without the File System Access API receive a zip with the same structure.

```text
<library root>/
  _sourcecapsule-index.md
  2026-07-02/
    <handle>-<status-id>/
      <handle>-<status-id>.html
      <handle>-<status-id>.llm.md
      media/
      README.txt
```

Thread capture is deliberately honest: it includes same-author posts visible during a progressive
scroll, marks post boundaries, and records `best-effort` completeness in the manifest. X can
virtualize or withhold posts, so this is not yet a guarantee of every reply in very long threads.

## Share with AI

The userscript ships pointing at the hosted share service
(`https://sourcecapsule-share.wolfgang-aura.workers.dev`): a Cloudflare Worker + R2 backend with
per-IP rate limiting on link creation, a 25 MB package cap, and 1/7/30-day expiry with daily
cleanup. To try it:

1. Open a post on x.com and click **...** beside the SourceCapsule button.
2. Click **Share with AI**.
3. Keep **7 days**, or choose 1/30 days.
4. Confirm. The resulting URL is copied to your clipboard.
5. Paste the URL into a new tab. Add `.md` to the capsule URL for the clean Markdown endpoint.

### Develop against a local share service

```powershell
cd C:\Users\cheon\Desktop\Projects\eXportArticle
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

## Test the experimental Chrome extension

```powershell
cd C:\Users\cheon\Desktop\Projects\eXportArticle
npm.cmd run build:extension
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** in the top-right.
3. Click **Load unpacked**.
4. Choose
   `C:\Users\cheon\Desktop\Projects\eXportArticle\dist\sourcecapsule-extension`.
5. Disable the SourceCapsule userscript in Tampermonkey for x.com to avoid duplicate buttons.
6. Refresh a status page and test quick save, this-post-only, copy Markdown, and Share with AI.

This package is experimental. It reuses the tested userscript engine through a thin compatibility
layer; it is not ready for Chrome Web Store submission until live-X testing passes.

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
| Provenance | Source URL, author, timestamp, warnings, and capture manifest |

An archive never claims more than it actually preserved. Missing media, preview-only long-form
quotes, and incomplete video are visible in both the rendered output and manifest.

## Settings

Open the userscript-manager menu while on x.com:

- **Layout:** folders by date (default) or flat.
- **Contents:** full archive (default) or lean Markdown + media.
- **Share service URL:** localhost for development, your Worker domain for production.
- **Change export folder:** select another library root.
- **Floating button:** optional; off by default.

## Development

Requirements: Node.js 18+.

```powershell
cd C:\Users\cheon\Desktop\Projects\eXportArticle
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

Do not share sensitive posts through a public deployment until authentication and abuse controls
exist. “Unguessable” is useful access control for v1 testing, not a replacement for user accounts.

## Deliberately out of scope for v1.2

- AI summaries, chat, OCR, transcripts, or media descriptions
- Bookmark scraping and bulk export
- Permanent-link allowances, user accounts, billing, or subscriptions
- A hosted dashboard or full-text search
- HLS video reassembly
- Guaranteed capture of every post in arbitrarily long threads
- Chrome Web Store publication

## License

MIT. See [LICENSE](LICENSE).
