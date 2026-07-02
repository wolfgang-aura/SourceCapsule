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
4. For a thread, the Worker searches the same `conversation_id` and retains same-author Posts in
   chronological order.
5. The existing SourceCapsule model/rendering rules produce HTML, Markdown, media files, and a
   manifest.
6. The Worker stores the capsule in R2 and returns its expiring view and Markdown URLs.
7. The Shortcut copies the view URL and opens a result page.

## Why this route

- It works from the X app; the user does not need to reopen a desktop browser.
- The official API now exposes `article`, `note_tweet`, media expansions, and
  `conversation_id`.
- The X bearer token remains server-side.
- It reuses the renderer and expiry system already built for desktop sharing.
- Apple Shortcuts provides a low-cost share-sheet surface without an App Store application.

## Feasibility gate

Do not build the Worker ingestion route or Shortcut until the probe confirms:

- X Articles include their complete body structure, not only title/preview.
- Long Posts expose full `note_tweet` text.
- Article and Post media URLs are usable from the Worker.
- Recent same-author thread continuations can be recovered in correct order.
- The expected API cost per capture is acceptable.

Run the bounded probe against a small hand-picked set. Results go into the gitignored
`probe-results/` folder and may contain full public Post content, so they must not be committed.
The X bearer token goes in the gitignored `.env.local` file as `X_BEARER_TOKEN=...`; the probe
never prints it or writes it into a result.

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
