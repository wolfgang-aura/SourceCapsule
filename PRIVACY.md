# SourceCapsule Privacy Policy

Last updated: July 7, 2026

SourceCapsule is a browser extension and userscript that lets a user save a selected X (formerly
Twitter) post, thread, or Article as a local archive, agent-ready Markdown, or an optional
expiring share link. This policy explains what data SourceCapsule handles and why.

## Summary

- SourceCapsule is local-first. Creating a normal archive does not upload the captured content to
  SourceCapsule servers.
- SourceCapsule does not sell user data, use it for advertising, or use it to determine
  creditworthiness or for lending.
- Content is uploaded only when the user explicitly chooses a sharing action and confirms it.
- Shared capsules are unlisted but are readable by anyone who has the link. They expire after the
  user-selected period of 1, 7, or 30 days.
- SourceCapsule does not collect passwords, authentication cookies, payment information, health
  information, or a history of pages the user visits.

## Data SourceCapsule handles

When the user initiates a capture, SourceCapsule processes information from the selected X page
that is needed to create the archive. Depending on the post, this can include:

- post, thread, or Article text;
- author display names, usernames, profile images, and source URLs;
- publication timestamps and post metadata;
- images, video files or poster frames, polls, and quoted-post content;
- capture-completeness information; and
- notes or tags entered by the user.

This information may include personally identifiable information and website content. The user
chooses which X page to capture. SourceCapsule does not build or retain a browsing-history log.

## Local archives and local storage

For local saves, captured content is processed in the browser and written to a location selected
by the user, copied to the clipboard, or downloaded as files. SourceCapsule does not receive these
local archives.

SourceCapsule stores limited operational data in the browser, including export preferences,
floating-button position, a previously approved export-folder handle where supported, and
credentials and metadata associated with share links created from that browser. Users can remove
local archives themselves and can clear SourceCapsule site or extension data through their
browser.

## Optional expiring share links

SourceCapsule uploads content only after the user chooses **Share with AI** or
**Save locally + share with AI** and confirms the sharing dialog.

The uploaded package can contain rendered HTML, Markdown, a capture manifest, images, video poster
frames, source URLs, author information, timestamps, and user-entered notes or tags. Raw video
files are not uploaded. Each package is limited to 25 MB.

The sharing service is hosted using Cloudflare Workers and Cloudflare R2. Cloudflare therefore
processes the uploaded package and ordinary network request information. The service uses the
requester's IP address only to rate-limit creation of new share links. SourceCapsule does not use
IP addresses for advertising, profiling, or location tracking.

A shared capsule is not indexed intentionally, but it is not access-controlled by an account:
anyone with its high-entropy URL can view it. Users should not share sensitive or private content
unless they are comfortable with every recipient of the link being able to access it.

## Retention and deletion

The user selects a 1-day, 7-day, or 30-day expiry when creating a share link. The sharing service
rejects access after expiry and automatically removes expired capsule objects during scheduled
cleanup. A share deletion credential is generated for each link and retained only in the user's
browser; it is not included in the public URL.

Local archives remain wherever the user saved them until the user deletes them. Browser-stored
preferences and metadata remain until cleared by the user or browser.

## Data sharing

SourceCapsule shares uploaded data with Cloudflare only as the infrastructure provider required
to operate the user-requested expiring-link feature. Anyone to whom the user gives a share link
can access that capsule until it expires.

SourceCapsule does not sell data, transfer data to data brokers, use data for advertising, or
transfer data for purposes unrelated to its single purpose. It does not use or transfer data to
determine creditworthiness or for lending.

## Permissions

SourceCapsule requests access to supported X domains and related X media or syndication hosts so
it can read the selected content and retrieve the media needed for an archive. It requests access
to the SourceCapsule sharing host only for the optional sharing feature. The `activeTab`
permission lets the toolbar popup communicate with the active supported X tab after the user
interacts with the extension.

SourceCapsule does not load or execute remotely hosted JavaScript or WebAssembly. Remote requests
retrieve content or media data, not executable extension code.

## Limited Use

SourceCapsule's use and transfer of information is limited to providing and improving its single
purpose: creating user-requested local archives, Markdown, and optional expiring share links from
selected X content.

The use of information received from Google APIs will adhere to the Chrome Web Store User Data
Policy, including the Limited Use requirements.

## Security

SourceCapsule uses high-entropy share identifiers and upload credentials, HTTPS in production,
package-size and file-path validation, restrictive response headers, and scheduled expiry. No
method of storage or transmission is completely secure, and an unlisted link should not be
treated as equivalent to account-based access control.

## Children's privacy

SourceCapsule is not directed to children and does not knowingly collect children's personal
information.

## Changes to this policy

This policy may be updated when SourceCapsule's behavior changes. The current version and its
effective date will remain available in this repository.

## Contact

For privacy questions, open an issue at
[github.com/wolfgang-aura/SourceCapsule/issues](https://github.com/wolfgang-aura/SourceCapsule/issues).
Do not include private captured content or private share links in a public issue.
