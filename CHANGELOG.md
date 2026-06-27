# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
