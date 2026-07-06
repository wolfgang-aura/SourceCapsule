# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-07-07

### Added

- Persistent capture receipts with post, poll, image, video, poster, incomplete-media, and
  recovered long-form Note counts, plus expandable diagnostics and post-save AI actions.
- Poll capture before and after voting, including choices, percentages, vote totals, and status
  when X exposes them. Polls are preserved in HTML, Markdown, and the structured manifest.
- A Manifest V3 toolbar popup for library layout, Full/Lean contents, floating-button visibility,
  and export-folder controls.
- A static MAIN-world extension bridge for reliable passive GraphQL capture.
- A hosted-capsule install call-to-action that is excluded from local archives.
- A production Chrome Web Store package build with automated manifest, host, bridge, popup, and
  file-set checks.

### Changed

- The focused root of a detected same-author thread is labelled **Save thread** and quick-saves the
  full thread; continuation and reply controls remain **Save post** and capture one post only.
- Post, thread, and Article exports now use accurate content headings and receipt labels.
- All release surfaces now report version `1.3.0` consistently.

### Fixed

- Extension sharing now permits the configured production Cloudflare Worker host.
- Brave and Chromium environments without a usable folder picker fall back cleanly to a ZIP
  instead of blocking library saves.
- Extension media capture retries through a host-bounded direct request when its service-worker
  request bridge fails, preventing otherwise valid images and videos from becoming all-missing
  archives.
- Long capture receipts are constrained and scrollable, and completed exports clear stale progress
  toasts.
- Post-vote polls are detected even when X removes the pre-vote radio-group markup.

### Security

- Production extension packages exclude localhost and obsolete development share hosts.
- Extension request and page-bridge payloads use explicit host allowlists, size limits, schema
  validation, and duplicate suppression.

## [1.2.2] - 2026-07-06

### Fixed

- Thread exports no longer treat same-author posts from X's **Discover more** recommendation
  section as thread continuations or download their unrelated media.
- Parent post IDs are now read outside embedded quote cards, preventing a quote permalink from
  corrupting thread ordering and media attribution.

## [1.2.0] - 2026-07-02

### Added

- One-click library save, with full same-author thread capture enabled by default on status pages.
- Explicit thread boundaries and best-effort completeness metadata in HTML, Markdown, and manifest.
- Optional “saved because” note and tags, plus a root `_sourcecapsule-index.md` updated on save.
- Copy-clean-Markdown action for pasting context directly into an agent or LLM.
- Combined **Save locally + share with AI** action; it captures once, saves the library copy first,
  then publishes and copies the expiring link. A failed upload leaves the local copy intact.
- Expiring “Share with AI” links with 1, 7, or 30 day expiry, clean HTML/Markdown endpoints,
  manifest, and real image/poster files. The deployable Cloudflare Worker + R2 service is included.
- Experimental Manifest V3 Chrome extension package generated from the userscript source of truth.

### Changed

- The primary inline control now saves immediately; secondary export choices live under `...`.
- Thread capture performs a progressive top-to-bottom scan before building the model.
- Shared capsules exclude raw video and enforce a 25 MB upload cap.

### Security

- Sharing is explicit, time-limited, and uses high-entropy capsule IDs.
- Shared responses use no-index and restrictive content-security headers.
- The Worker validates upload paths, expiry choices, and deletion/finalization tokens.

## [1.1.0] - 2026-06-28

### Added

- **Save to library.** A new primary export option that writes each export into an organized,
  per-post folder (`<root>/<date>/<handle>-<id>/`) containing `post.html` (full mode),
  `post.llm.md`, a `media/` folder, and a `README.txt`. You pick the root folder once (remembered
  via IndexedDB) and exports drop in automatically — so an agent can be pointed at a date folder to
  summarize a day's exports. Uses the File System Access API on desktop Chromium (Chrome, Edge,
  Opera, Vivaldi, Arc); **other browsers (Brave, Firefox, Safari, mobile) get a single `.zip`**
  with the same per-post layout via a built-in store-only zip writer.
- **LLM bundle media as real files.** In Save to library, images and **video poster stills** are
  written next to the Markdown as actual files, and the `.llm.md` references them with relative
  `![](media/…)` embeds. Raw video bytes are deliberately excluded (an LLM can't watch video), so
  the bundle stays small while remaining viewable by an agent.
- **`## What This File Is` header in `.llm.md`.** Every Markdown companion now states up front what
  it does and does not contain, and points at exactly where the media lives (bundle `media/` files,
  the named companion `.html`, or "not saved" for Markdown-only).
- **Library settings in the userscript-manager menu.** Toggle Layout (`by date` / `flat`),
  Contents (`full` / `lean`), and the page-level **Floating button** (now **off by default** —
  the inline per-post / article-header buttons are the primary entry point), or change the export
  folder — no in-app settings panel.
- **Author fallback from the source URL.** When author metadata can't be read from the page, the
  Markdown derives the `@handle` from the post/article URL (flagged as derived).

### Fixed

- **`.llm.md` no longer references a nonexistent `archive.html`.** The companion now names the real
  sibling file (or states honestly that Markdown-only / bundle exports keep no embedded bytes),
  instead of pointing readers at a file that was never written.
- **No more double-numbered list items ("1. 2. …").** When X fragments a manually-numbered article
  list around an embedded post, each piece is a single-item ordered list whose text already carries
  the author's number (sometimes bolded, e.g. `<strong>2. …`). The HTML and Markdown renderers now
  detect a self-numbered item and keep the author's number instead of adding their own marker.
- **Bulleted article lists are no longer turned into numbered lists.** List-type detection tested
  `/ordered/` before `/unordered/`, and "ordered" is a substring of "un​ordered" — so every
  bulleted list (X labels them `unordered` / "Bulleted list") was mis-classified as numbered.
  Detection now checks unordered first and anchors "ordered" on a word boundary.

## [1.0.0] - 2026-06-27

First public release.

### Added

- **Per-post Export buttons.** On status pages, every top-level post now carries its own
  Export control, so you pick exactly which post to export instead of relying on one
  page-level button (no more accidentally exporting the wrong tweet). The button is placed
  **inline in the post header, beside X's "..." menu / Subscribe** (falling back to a
  hover-reveal overlay if that anchor isn't found). Article pages get the same inline
  **"Export article"** button in their header for a consistent, in-context export. The
  page-level draggable floating control remains as the always-available fallback. Toggle
  with `CONFIG.perPostButtons`.
- **Choose your output: HTML, Markdown, or both.** Every Export control now opens a small
  menu offering `HTML + Markdown` (default), `HTML only`, or `Markdown only`, instead of
  always downloading both files.
- **Draggable floating control.** The page-level Export button now defaults to a spot clear of
  X's bottom-right Grok/Messages cluster, can be **dragged anywhere**, and remembers its
  position across reloads. The label also self-corrects to "Export article" if X's article
  reader finishes loading after the button was first shown.
- **Honest truncation flag for long-form embedded posts.** X's public syndication endpoint
  only returns a preview for long-form ("note") posts, not the full text. The export now
  detects this for certain (via the `note_tweet` signal) and clearly marks such quotes as
  truncated — a visible notice with a "Read the full post on X" link in the HTML, and a
  `Text status: truncated (long-form post)` line in the Markdown — instead of silently
  presenting the preview as the whole post.

### Fixed

- **Double-escaped entities in embedded-post text.** Tweet text from syndication is already
  HTML-encoded by X (`&amp;`, `&lt;`, `&gt;`); it was being escaped again, so an `&` showed
  as the literal `&amp;` in the archive. It's now decoded before re-escaping.

### Security

- **Link-scheme allowlist for exported files (`safeUrl`).** Every URL that becomes an
  `href` in the exported HTML is now restricted to `http(s)`/`mailto`. This neutralizes
  `javascript:`/`data:`/`vbscript:` links that could otherwise survive HTML-escaping and
  execute when the archive is opened from `file://`. Covered by a unit test.
- **Bounded privileged media fetch.** `GM_xmlhttpRequest` byte fetches are now restricted
  in code to `*.twimg.com` hosts (in addition to the `@connect` grants), so a crafted
  media URL in a post cannot direct the privileged fetch at an arbitrary origin.
- **Tightened network-capture messaging.** The page-context capture bridge now posts to
  `location.origin` (not `*`), and the receiver verifies message origin, same-window
  source, and the payload tag before processing.

## [0.x] - Pre-release development

Private iterative development before the first public release. Built the core export engine
(privileged media fetch -> base64 inlining -> self-contained HTML), syndication-based
rebuilding of embedded/quoted posts, audited best-effort video preservation, structured
missing/incomplete-media reporting, and the LLM Markdown (`.llm.md`) companion.
