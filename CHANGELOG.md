# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Documentation

- SECURITY.md now lists every `@connect` host the shipped userscript declares (the
  individual `twimg.com` subdomains, the loopback dev entries, and the
  `sourcecapsule-share.wolfgang-aura.workers.dev` share Worker), and documents the AI
  share upload path in its own "Optional AI share links" section instead of implying that
  no user data ever leaves the browser.

## [1.4.1] - 2026-07-11

### Fixed

- **AI-readable links now include the same captured images and video posters as local library
  exports.** Share-only exports now assign archive media IDs before packaging, instead of
  accidentally relying on a local save to prepare the model first. Media recovery also gets a
  final retry immediately before upload, with X-compatible request fallbacks for the MV3 build.

## [1.4.0] - 2026-07-11

### Added

- The MV3 popup now has a clearer library/capture hierarchy, page-specific readiness status,
  explicit folder-vs-ZIP delivery copy, inline setting-save feedback, accessible switch controls,
  dark mode, and reduced-motion support. In-page export menus now expose proper ARIA menu state,
  keyboard navigation, focus restoration, and live-region progress toasts.
- Syndication quote transforms now create external link-card blocks from URL entities and preserve
  richer DOM-only card metadata and polls recursively, including polls nested inside quoted posts.
- **Strict export mode (on by default).** Every export now runs through a completeness gate
  after all recovery layers finish. If any embedded post would ship without a canonical
  permalink, any quoted post's content couldn't be captured, or any image or video would
  render as an "unavailable" placeholder, the download is blocked with a modal that lists
  exactly what's broken, offers a **Copy diagnostic bundle** button (self-contained JSON
  with URL, verdict, counts, and a media-stripped model skeleton), and requires **Ship it
  anyway** or **Cancel export** to proceed. The pref is user-toggleable via the
  Tampermonkey/Violentmonkey menu and the MV3 extension popup.
- **Passive GraphQL quoted-post ref capture.** The network-capture layer now also harvests
  `<parentId, quotedId, quotedHandle>` triples from every TweetDetail /
  TweetResultByRestId response X's own web app downloads. When the DOM later strips a
  quote's `/status/` anchor (routine after virtualization), the exporter reconstructs the
  permalink locally, without a syndication round-trip.
- **Position-based quote-source recovery** that walks thread markers and pairs each
  segment's unresolved quote with the corresponding captured ref, closing the
  handle-collision edge case that broke the pool-based syndication matcher.
- **Thread-menu escape hatch.** Every focused-post button (any URL ending in
  `/status/{id}`) now exposes **Save full thread** in its drop-down menu, regardless of
  whether auto-detection recognized the thread. Choosing it forces a full-column scroll
  so late-loading same-author replies are always captured.
- **Strict-gate auto-repair round.** When the completeness gate finds blockers, the
  exporter now retries each through the layer that owns it - re-checking passively
  captured quote refs, re-running the pool-based quote permalink matcher, re-fetching
  dead quote cards from syndication, and re-running the media rescue pass - after a
  short pause, and only shows the blocking modal if the export is still incomplete.
  Most transient failures (rate limits, dropped connections) now self-heal without the
  user seeing anything.
- **"Retry recovery" button in the strict-gate modal.** When the modal does appear, one
  click re-runs the full repair round in place: if everything recovers, the export
  proceeds immediately; otherwise the blocker list updates to show exactly what is
  still broken. No more cancel-and-restart just to retry a flaky connection.
- **Single-post syndication media check.** Focused single-post exports get the same
  authoritative syndication media/link diff that thread posts already got. Previously a
  lazily-lost image on a single post produced no model block at all, making the miss
  invisible even to the strict gate.
- **Syndication fetch retries.** `cdn.syndication.twimg.com` fetches (the backbone of all
  quote recovery and thread media recovery) now retry transient failures with backoff;
  404 (deleted/protected) stops immediately. Previously a single dropped request silently
  degraded a quote card to its DOM scrape.
- **Honest tombstone notes.** A quoted post that is already gone on X itself (deleted,
  banned/suspended, or restricted account — X's "This Post is unavailable" box) is now
  captured as an explicit "Quoted post unavailable on X" note in the HTML, the `.llm.md`,
  the manifest (`quoteTombstones` count + warning), and the capture receipt ("Quoted
  posts gone on X" row) — instead of being silently omitted while the receipt claimed
  Complete. Intentionally never a strict-gate blocker: there is nothing to capture.
- **Reply context (pref, default on).** When the exported post is a reply, the post it
  answers is fetched from syndication and prepended as a labelled "In reply to" card in
  the HTML and as "Reply Context Post 1" in the `.llm.md` — a reply archived alone often
  loses its meaning. A parent that is itself gone on X gets an honest "Replied-to post
  unavailable on X" note (never a blocker); a parent already captured inside a
  same-author thread export is never duplicated. Toggleable via the userscript-manager
  menu ("Reply context") and the extension popup ("Include reply context").
- **Parallel media downloads.** The main inline pass now fetches up to 3 media items at
  once (`CONFIG.mediaFetchConcurrency`), cutting big-thread export time roughly 3x. The
  rescue and repair passes intentionally stay sequential — they retry failures, where
  gentler pacing is what makes retries succeed.
- **Link-card thumbnails.** External-link preview cards now embed their preview image
  (X's `card_img`) in the offline HTML. Strictly decorative: a failed thumbnail renders
  nothing (no placeholder), never counts as missing media, and never gates the export.
- **Per-export syndication cache.** Successful `tweet-result` payloads are reused across
  all recovery layers within one export (pool recovery, quote/thread/focused enrichment,
  reply context), removing duplicate network round-trips. Failures are never cached, so
  the auto-repair round and the modal's Retry recovery always get a fresh attempt.

### Changed

- Passive GraphQL capture now accepts bodies up to 6 MB, records any remaining truncation in the
  diagnostic bundle, and hashes the complete bounded body for duplicate suppression instead of
  comparing only the first/last 80 characters.
- Quote-card detection tolerates X omitting `tabindex="0"` from its clickable wrapper while keeping
  author/text guards that exclude ordinary external-link cards.
- Unmatched video candidates are no longer paired to video blocks by bitrate-sorted array index.
  Keyless fallback is allowed only when one unresolved block and one logical media ID remain.
- Quoted posts without a resolvable canonical permalink link to the author's X profile
  (`https://x.com/{handle}`) instead of showing a "Source URL unavailable" notice; the
  underlying `data-xa-source-fallback="author-profile"` attribute lets tooling and future
  strict-mode rules distinguish the fallback from the exact-match case.
- `enrichThreadViaSyndication` now uses each thread post's own `quoted_tweet` payload to
  patch missing quote source URLs AND rebuild the card from authoritative data - saving
  one syndication round-trip per quote.
- Per-post control cache key reflects the rendered menu array (thread vs post) so
  extension reloads pick up new menu items without a full tab reload.
- The MV3 popup exposes the **Strict export (block incomplete)** toggle alongside layout
  and floating-button preferences.
- All release surfaces now report version `1.4.0` consistently.

### Fixed

- Quote-only GraphQL responses now pass through both userscript and MV3 MAIN-world bridge filters;
  previously passive quote-ref recovery silently ignored ordinary text-only quotes unless the same
  response also contained video or long-form Note data.
- Long X Articles now scroll from the top and merge progressively harvested ownerless body images
  back into reading order, so images virtualized away before final extraction are not silently lost.
- A quote card that never mounted in the DOM is rebuilt from the parent post's authoritative
  `quoted_tweet` payload; the absence can no longer evade the strict completeness gate.
- Syndication quote upgrades retain DOM-captured polls and rich link-card thumbnails instead of
  replacing them with the public endpoint's narrower text/media representation.
- Image fetches validate content type and file signatures. HTTP-200 HTML/JSON error pages now fall
  through to size variants or become honest missing-media blockers instead of false successes.
- Paired HTML + Markdown downloads now arrive in one clearly labelled ZIP instead of two loose
  sibling downloads, and the Markdown records where its HTML companion is packaged.
- Media references in ordinary post Markdown now correctly say `Attached to: main post` instead of
  incorrectly calling every root document an Article.
- Share Worker now sets `Content-Length` on GET and HEAD responses (R2's
  `writeHttpMetadata` omits it), so Slack, Discord, and Twitter link-preview crawlers
  can size and render shared images and content.
- Three-layer quote-source recovery (captured refs, syndication pool, per-thread-post
  syndication) eliminates the "Alex Prompter" regression where thread exports shipped
  quote cards with dead `Source URL unavailable` notices instead of working permalinks.
- Media fetches stop retrying a URL that returned HTTP 404 (authoritative miss) so the
  next size-variant candidate runs immediately, and rate-limited (HTTP 429) fetches back
  off substantially longer before retrying.
- Video poster stills now get the same lower-resolution fallback candidates as photos
  (`ext_tw_video_thumb` / `amplify_video_thumb` / `tweet_video_thumb` paths).
- A quote card rebuilt from a syndication payload missing `id_str` no longer overwrites
  a verified permalink with a malformed one.
- The media rescue pass now retries avatars that were never attempted (e.g. on quote
  cards rebuilt after the main inline pass), not only ones whose first fetch failed.
- A video whose player was still booting at capture time (no poster, no URL in the DOM
  yet) is now healed in place with the post's syndication data instead of exporting a
  dead "Video unavailable" card next to a recovered duplicate.

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
