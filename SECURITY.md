# Security Policy

eXportArticle is a userscript that runs on `x.com`/`twitter.com` with elevated userscript
permissions. This document explains what it can access, why, the trust model, and how to
report a vulnerability.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** via a
[GitHub security advisory](../../security/advisories/new) rather than a public issue, so a
fix can ship before details are public. Include the script version (`@version`), browser +
userscript manager, and reproduction steps. We aim to acknowledge within a few days.

## Permissions, and why each is needed

The userscript metadata block requests:

| Grant | Why |
| --- | --- |
| `GM_xmlhttpRequest` | Fetch media **bytes** from `*.twimg.com` to base64-inline them. A normal page fetch can't read these cross-origin bytes; this is the whole reason it's a userscript. |
| `unsafeWindow` | Read X's own API/GraphQL responses **in your browser** to discover the full MP4 URL behind a video. No page data is injected back; only response bodies are inspected locally. Also used to reach the File System Access API (`showDirectoryPicker`) for **Save to library**. |
| `GM_registerMenuCommand`, `GM_unregisterMenuCommand` | Add the **Save to library** settings (layout / contents / change folder) to the userscript-manager menu. No page or network access. |
| `@connect pbs.twimg.com`, `video.twimg.com`, `abs.twimg.com`, `cdn.syndication.twimg.com` | Allow the media fetch to reach X's media/syndication hosts. |
| `@connect x.com`, `twitter.com` | Resolve canonical post URLs/metadata. |
| `@connect sourcecapsule-share.wolfgang-aura.workers.dev` | Only used when you explicitly choose **Create AI readable link** / **Save locally + create AI link** and confirm the upload dialog. See "Optional AI share links" below. |
| `@connect 127.0.0.1`, `localhost` | Local development only — lets a maintainer point the share client at a local `wrangler dev` share Worker via the userscript-manager menu. No live X page ever posts to loopback. |
| `@run-at document-start` | Install the video-discovery hook before X's own scripts run, so early API responses aren't missed. |

## What it does — and never does

**Accesses (all locally, in your browser):**

- Media bytes from `*.twimg.com` (images, videos, posters, avatars) — the in-code fetch is
  restricted to `twimg.com` hosts, in addition to the `@connect` allowlist.
- X's own `fetch`/XHR API responses, read only to extract MP4 video variants. This is the
  same data the page already loaded for you.
- The DOM of the article/post you choose to export.

**Local storage and file writing (Save to library):**

- **Writes export files to a folder you explicitly pick** via the browser's File System Access
  API. The script only writes the export's own files (`post.html`/`post.llm.md`/`media/`) into
  that chosen folder and its dated subfolders; it never reads your existing files, and it cannot
  access any location you didn't grant. On browsers without that API it instead triggers a normal
  `.zip` download. **No new network access** — this is local disk only.
- **IndexedDB** stores the chosen folder's handle so you don't re-pick it each time; **`localStorage`**
  stores two small preferences (layout, contents). Both are on the `x.com` origin, local to your
  browser, and never transmitted.

**Never:**

- ❌ Sends your data anywhere without an explicit action. There is **no analytics and no
  telemetry**. Outbound requests during a normal capture only go to `twimg.com` /
  syndication hosts to download media for embedding.
- ❌ Takes any action on your account (post, like, follow, DM).
- ❌ Reads anything you can't already see on the page (no passwords, no DMs).

## Optional AI share links (`sourcecapsule-share.wolfgang-aura.workers.dev`)

**Save to library**, **Copy clean Markdown**, and **Download HTML + Markdown** are 100%
local — nothing leaves your browser.

The two share actions — **Create AI readable link** and **Save locally + create AI link** —
upload the same package you would have saved locally (rendered HTML, Markdown, capture
manifest, images, and video poster stills; no raw video; capped at 25 MB) to the
project's Cloudflare Worker + R2 share service. Each upload:

- happens only after you explicitly click the share action **and** confirm the expiry
  dialog (default 7 days; 1 or 30 optional);
- returns a high-entropy unlisted URL — anyone with the link can read it until expiry;
- generates a deletion credential kept only in your browser;
- has its retention, deletion, and Cloudflare data-processing terms documented in
  [PRIVACY.md](PRIVACY.md).

The Worker's source is under [`share-worker/`](share-worker/) in this repository.

## Output safety

The exported `.html` is opened later from `file://`, so it is built defensively:

- **No dynamic code from page content.** The exporter uses no `innerHTML`, `eval`,
  `new Function`, or `document.write`; the export is assembled as escaped strings.
- **Allowlist sanitization.** Tweet/article rich text is reduced to a fixed set of safe
  inline tags (`a`, `br`, `code`, `strong`, `em`); any other element is dropped to escaped
  text. A `<script>` in X's DOM can never be reproduced as a tag.
- **Link-scheme allowlist (`safeUrl`).** Every URL that becomes an `href` is restricted to
  `http(s)`/`mailto`, so `javascript:`/`data:`/`vbscript:` links cannot execute when the
  archive is opened. Covered by a unit test.
- **The network-capture bridge** posts only to `location.origin`, and the receiver verifies
  the message origin, same-window source, and a payload tag before processing.

The companion `.llm.md` contains **no** base64, data URLs, CSS, or scripts by design.

## Trust model and auto-update

The userscript's `@updateURL`/`@downloadURL` point at the `main` branch of this public
repository. Installing it means trusting this repo's maintainers and GitHub's delivery: a
change merged to `main` will auto-update on installed clients. Mitigations:

- `main` is the default branch and should be branch-protected; releases are tagged.
- To avoid auto-update, install a specific tagged release and disable auto-update in your
  userscript manager.

## Security review status

The codebase was reviewed for the first public release. No high-severity issues were found;
the privileged paths (DOM→string export, `GM_xmlhttpRequest` fetch, the `unsafeWindow`
network-capture bridge) are conservative. Low-severity hardening from that review —
`safeUrl` link-scheme allowlist, `twimg.com` fetch host check, and `location.origin`
message targeting/validation — is implemented in `v0.5.0`.
