# Mobile Capture v1: iPhone Share Sheet

## Outcome

From the X iPhone app, a user taps **Share -> Save to SourceCapsule** and receives an expiring
SourceCapsule link containing clean HTML, Markdown, provenance, and accessible media.

## Recommended architecture

1. An iOS Shortcut accepts an X status URL from the system share sheet.
2. The Shortcut sends only that URL plus a private SourceCapsule ingestion token to the share
   Worker. It never contains the X API bearer token.
3. The Worker uses the official X API to retrieve the Post with the `article`, `note_tweet`,
   author, media, and conversation fields.
4. The Worker reconstructs the capture set with the graph rules below (never with naive
   "same conversation + same author + chronological" ordering).
5. The existing SourceCapsule model/rendering rules produce HTML, Markdown, media files, and a
   manifest.
6. The Worker stores the capsule in R2 and returns its expiring view and Markdown URLs.
7. The Shortcut copies the view URL and opens a result page.

## Capture algorithm (validated by the 2026-07-02 probe)

The 2026-07-02 feasibility probe proved the naive thread rule wrong: conversation search also
returns the author's side replies to commenters, quote chains are not native conversations, and
Articles reference embedded posts that need separate hydration. The Worker must implement all
three rules:

### 1. Native reply threads: root-anchored `replied_to` graph

- Fetch same-author posts in the root's `conversation_id` (conversation search with
  `referenced_tweets` expansions).
- Build a graph from `referenced_tweets` `replied_to` edges.
- Keep only posts reachable from the selected root by following same-author parent edges.
  In the probe's real 42-post result, this kept one uninterrupted 36-post chain and cleanly
  excluded 6 same-author side replies to commenters that chronological ordering would have
  wrongly included.
- If the search response returns a pagination token and v1 does not paginate, mark the capture
  `truncated: true` — never silently drop the tail.

### 2. Articles: one batch hydration pass for embedded posts

- The `article` object supplies the full body (`plain_text` was complete at 4,054 chars in the
  probe) plus only the *direct* cover/media objects.
- Collect the embedded-post references from the Article body (probe: 19 references, 18 unique
  ids) and hydrate them with ONE multi-Post lookup call (up to 100 ids), including their media
  expansions. Skipping this step produces a materially poorer archive than desktop capture.

### 3. Quote-linked sequences: bounded backward traversal, honestly labelled

- Same-author "quote chains" have different `conversation_id` values per post; conversation
  search correctly returns nothing for them.
- Walk backward through same-author `quoted` references (each hop is available via
  `referenced_tweets.id` expansion), with a small fixed hop bound.
- Present the result as a quote-linked sequence, not a native thread, and record incomplete
  capture when the bound is hit.

### Completeness metadata

Every mobile capture records, in the manifest: which of the three modes ran, pagination/bound
truncation flags, and per-media capture status — the same honesty rules as desktop capture.

## Why this route

- It works from the X app; the user does not need to reopen a desktop browser.
- The official API now exposes `article`, `note_tweet`, media expansions, and
  `conversation_id`.
- The X bearer token remains server-side.
- It reuses the renderer and expiry system already built for desktop sharing.
- Apple Shortcuts provides a low-cost share-sheet surface without an App Store application.

## Feasibility gate — probe completed 2026-07-02

The probe (`scripts/probe-x-mobile.mjs`, `npm run probe:x -- --thread <url>`) ran against three
real URLs (an Article, a quote-linked sequence, a 36-post native thread) and confirmed the API
route is viable with the capture algorithm above. Remaining gate before building the Worker
ingestion route and Shortcut:

- Extend the probe to implement the three graph rules and re-verify against the same three URLs.
- Compare the resulting model/media inventory with the desktop capture of the same URLs.
- Probe tests use saved, redacted structural fixtures — never live paid API calls.

Probe results go into the gitignored `probe-results/` folder and may contain full public Post
content, so they must not be committed. The X bearer token goes in the gitignored `.env.local`
file as `X_BEARER_TOKEN=...`; the probe never prints it or writes it into a result.

## v1 boundaries

Build:

- iPhone Shortcut
- Public X Posts, same-author threads, long Posts, and Articles
- One private beta ingestion token
- 7-day links by default, with the existing 1/30-day alternatives
- Text, images, quoted Posts, video posters, provenance, and honest completeness warnings

Do not build yet:

- Native iOS application or App Store release
- Android support
- Protected/private Posts
- User accounts, billing, or permanent-link quotas
- WhatsApp/Telegram bots
- Cloud browser scraping or storage of X session cookies
- Video transcription, OCR, or full video hosting

## Fallback if Articles are incomplete

Use a second Safari-only Shortcut with Apple's **Run JavaScript on Web Page** action. It can extract
the DOM the user is viewing and send a normalized model to SourceCapsule. This fallback cannot run
directly inside the X app, so it requires opening the URL in Safari first and is not the primary
mobile flow.

## References

- X Post lookup fields:
  <https://docs.x.com/x-api/posts/get-post-by-id>
- X API usage and billing:
  <https://docs.x.com/x-api/fundamentals/post-cap>
- Apple Run JavaScript on Web Page:
  <https://support.apple.com/en-au/guide/shortcuts/apd218e2187d/ios>
