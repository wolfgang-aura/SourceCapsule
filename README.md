# SourceCapsule

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

The product remains local-first. Nothing is uploaded until you explicitly choose
**Create AI readable link** or **Save locally + create AI link** and confirm the expiry. In the combined flow, the local copy is
completed first, so an upload failure cannot take it away. Shared capsules exclude raw video, are
capped at 25 MB, and retain source links when media cannot be included.

## Use it

On the X timeline, a status page, or an Article:

- Click **Save post**, **Save thread**, or **Save article** for the default quick-save flow.
- If a timeline card says **Open post first**, open the post and save from the status/Article page;
  the feed preview does not contain enough content for a complete archive.
- Click **...** beside it for:
  - Save this post only
  - Save with note and tags
  - Copy clean Markdown
  - Create AI readable link
  - Save locally + create AI link
  - Download ZIP (HTML + Markdown)

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

Successful links are remembered in this browser under **SourceCapsule: Recent AI readable links**.
Expired links remain visible but greyed out. When a link is created from a local-save receipt or the
combined save-and-link flow, SourceCapsule also writes `AI_LINK.txt` beside the saved Markdown so the
same link can be recovered from the library folder.

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
6. Refresh a status page and test quick save, this-post-only, copy Markdown, and AI readable links.

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
quotes, and incomplete video are visible in both the rendered output and manifest. For long-form
(note) posts, SourceCapsule recovers the full text when X has already delivered it to your
browser while the page was open (no extra requests); otherwise the preview is clearly flagged
as truncated.

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

## Deliberately out of scope for v1.4

- AI summaries, chat, OCR, transcripts, or media descriptions
- Bookmark scraping and bulk export
- Permanent-link allowances, user accounts, billing, or subscriptions
- A hosted dashboard or full-text search
- HLS video reassembly
- Guaranteed capture of every post in arbitrarily long threads
- Chrome Web Store publication

## License

MIT. See [LICENSE](LICENSE).
