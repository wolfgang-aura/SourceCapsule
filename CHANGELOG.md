# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
