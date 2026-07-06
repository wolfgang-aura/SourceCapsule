# How we built a self-contained exporter - a "test" & demo

Source: https://x.com/ada/article/12345
Exported at: 2026-06-25 10:00:00 UTC
Exporter: SourceCapsule v1.3.0
Language: en
Published at: 2026-06-24 09:30:00 UTC
Author: Ada Lovelace @ada
Capture note: This file preserves content visible to the logged-in user at export time. It may not include unavailable, private, deleted, failed, or unloaded content.

## What This File Is

This is the text + metadata companion (a .llm.md file). Reading only this file, an agent or LLM has access to:
- The full article/post text and embedded-post text (in the sections below).
- A metadata-only inventory of every image and video: type, dimensions, duration, original source URL, byte size, and SHA-256.

This file does NOT contain the media itself: no image pixels, no video or audio bytes, no transcripts, and no visual descriptions. From this file alone you cannot view the images or play/transcribe the videos.
The media bytes are embedded (base64) inside the companion file sample-export.html, downloaded alongside this markdown. If you also have that file, the media is available there; if you only have this markdown, it is not.

## Capture Summary

- Main text: captured
- Embedded posts: 4 total
  - Direct embedded posts: 3
  - Nested quoted posts: 1
- Polls: 1
- Images: 2 captured, 1 missing
- Videos found: 5
- Videos preserved offline: 2
- Video posters captured: 2
- Video source links preserved: 5
- Incomplete media: 3
- Source links: 13
- Duplicate media groups: 1
- Warnings:
  - Image image-002 was unavailable at export time.
  - Video video-003 was detected, but the video file was not preserved offline. Only the poster and source link were preserved.
  - Video video-005 was detected, but the video file was not preserved offline. No poster and source link were preserved.
  - Video video-005 was unavailable at export time.
  - Video poster for video-006 was unavailable at export time.
  - Video video-007 was detected, but the video file was not preserved offline. No poster and source link were preserved.
  - Video video-007 was unavailable at export time.
  - Quoted post 7 was unavailable at export time.
  - Quoted post 8 was unavailable at export time.
  - 6 item(s) were unavailable at export time.
  - 1 duplicate media hash group(s) were detected.
  - Video video-003 was detected, but the video file was not preserved offline. Only the poster and source link were preserved.
  - Video video-003 has no transcript or visual description in llm.md.
  - Video video-004 bytes are embedded in the companion file sample-export.html; this markdown holds only metadata (no video bytes, transcript, or visual description).
  - Video video-005 was detected, but the video file was not preserved offline. No poster and source link were preserved.
  - Video video-005 has no transcript or visual description in llm.md.
  - Video video-006 bytes are embedded in the companion file sample-export.html; this markdown holds only metadata (no video bytes, transcript, or visual description).
  - Video video-007 was detected, but the video file was not preserved offline. No poster and source link were preserved.
  - Video video-007 has no transcript or visual description in llm.md.
  - Embedded Post 1 text may be truncated because only preview text may have been available at export time.

---

## Main Article

## Intro &lt;script&gt;alert(1)&lt;/script&gt;

Plain text with a link & an ampersand.

- First item
- Second item with link

**Poll: Which archive format?**
- HTML - 75%
- Markdown - 25%
- Total votes: 120
- Status: Poll closed
- Source: https://x.com/ada/status/12345

[Image: image-001 - Image attached to main X article by @ada, archive media image-001]

[Missing image: image-002 - broken]

[Video: video-003 - video file not preserved offline; poster captured; source link preserved]

[Video: video-004 - 14:45, 438x270, bytes embedded in companion file sample-export.html, not in this markdown]

[Missing video: video-005 - video file not preserved offline; poster unavailable; source link preserved]

[Video: video-006 - 0:12, 640x360, bytes embedded in companion file sample-export.html, not in this markdown]

[Missing video: video-007 - video file not preserved offline; poster unavailable; source link preserved]

Timeline reference: Embedded Post 1 - https://x.com/charles/status/42

[Embedded Post 1 appears here. Full text below.]

[Embedded Post 2 appears here. Full text below.]

[Embedded Post 3 appears here. Full text below.]

1. 2026-06-24 timeline after cards: Embedded Post 1 - https://x.com/charles/status/42
2. 2026-06-25 source-only timeline: Source link - https://x.com/ada/status/1234567890

---

## Embedded / Quoted Posts

### Embedded Post 1
Author: Charles Babbage
Handle: @charles
Post ID: 42
URL: https://x.com/charles/status/42
Timestamp: 2026-06-24 11:00:00 UTC
Text status: possibly truncated
Warning: This embedded post text may be truncated because only preview text was available at export time.

Text:

> A quoted post with its own image. This preview keeps going until it ends in an obviously incomplete number 20

Media:
- Image: image-008 - Image attached to quoted X post by @charles

#### Nested Quoted Post 1.1
Author: Nested Source
Handle: @nested
Post ID: 43
URL: https://x.com/nested/status/43
Timestamp: 2026-06-24 11:05:00 UTC

Text:

> Nested quoted context.

### Embedded Post 2
Post ID: 7
URL: https://x.com/private/status/7

Text:

> [Quoted post unavailable]

### Embedded Post 3
Post ID: 8
URL: https://x.com/deleted/status/8

Text:

> [Quoted post unavailable]

---

## Duplicate Media

- image-001 and image-008 share SHA-256: sha256:duplicate-media-hash

---

## Media References

### Image image-001
- Attached to: main article
- Alt: Image attached to main X article by @ada, archive media image-001
- Width: 1200
- Height: 800
- MIME: image/png
- Pixels location: embedded in companion file sample-export.html (not in this markdown)
- Byte size: 68
- SHA-256: sha256:duplicate-media-hash
- Source post ID: 12345
- Source URL: https://x.com/ada/article/12345
- Original URL: https://pbs.twimg.com/media/x.jpg

### Image image-002
- Attached to: main article
- Alt: broken
- Original URL: https://pbs.twimg.com/media/missing.jpg
- Missing: yes

### Video video-003
- Attached to: main article
- Status: not preserved offline
- Mode: poster-only
- Offline playable: no
- Poster captured: yes
- Source link preserved: yes
- Video file MIME: unavailable
- Video file byte size: unavailable
- Video file SHA-256: unavailable
- Original video URL: unavailable
- Failure reason: video_url_discovery_failed
- Transcript: unavailable
- Keyframe description: unavailable
- Source post ID: 999
- Source URL: https://x.com/ada/status/999

### Video video-004
- Attached to: main article
- Width: 438
- Height: 270
- Status: preserved offline
- Mode: offline-video
- Offline playable: yes
- Duration: 14:45
- MIME: video/mp4
- Poster captured: yes
- Source link preserved: yes
- Bytes location: embedded in companion file sample-export.html (not in this markdown)
- Transcript: unavailable
- Keyframe description: unavailable
- Byte size: 456
- SHA-256: sha256:video-hash
- Source post ID: 1000
- Source URL: https://x.com/ada/status/1000

### Video video-005
- Attached to: main article
- Status: not preserved offline
- Mode: poster-only
- Offline playable: no
- Source link preserved: yes
- Video file MIME: unavailable
- Video file byte size: unavailable
- Video file SHA-256: unavailable
- Original video URL: unavailable
- Failure reason: video_url_discovery_failed
- Transcript: unavailable
- Keyframe description: unavailable
- Source URL: https://x.com/ada/status/deleted-video
- Missing: yes

### Video video-006
- Attached to: main article
- Width: 640
- Height: 360
- Status: preserved offline
- Mode: offline-video
- Offline playable: yes
- Duration: 0:12
- MIME: video/mp4
- Poster captured: no
- Source link preserved: yes
- Bytes location: embedded in companion file sample-export.html (not in this markdown)
- Transcript: unavailable
- Keyframe description: unavailable
- Byte size: 789
- SHA-256: sha256:video-without-poster-hash
- Source post ID: 1001
- Source URL: https://x.com/ada/status/1001

### Video video-007
- Attached to: main article
- Status: not preserved offline
- Mode: poster-only
- Offline playable: no
- Source link preserved: yes
- Video file MIME: unavailable
- Video file byte size: unavailable
- Video file SHA-256: unavailable
- Original video URL: unavailable
- Failure reason: video_url_discovery_failed
- Transcript: unavailable
- Keyframe description: unavailable
- Source post ID: 1002
- Source URL: https://x.com/ada/status/1002
- Missing: yes

### Image image-008
- Attached to: embedded post 1
- Alt: Image attached to quoted X post by @charles
- Width: 640
- Height: 480
- MIME: image/png
- Pixels location: embedded in companion file sample-export.html (not in this markdown)
- Byte size: 68
- SHA-256: sha256:duplicate-media-hash
- Original URL: https://pbs.twimg.com/media/q.jpg

---

## Missing / Incomplete Content

- image: image-002
  Reason: download_failed
- video: video-005
  Reason: download_failed
  Source URL: https://x.com/ada/status/deleted-video
- video-poster: video-006
  Reason: download_failed
  Source post ID: 1001
  Source URL: https://x.com/ada/status/1001
- video: video-007
  Reason: unsupported_media
  Source post ID: 1002
  Source URL: https://x.com/ada/status/1002
- quoted-post: 7
  Reason: private_or_deleted
  Source post ID: 7
  Source URL: https://x.com/private/status/7
- quoted-post: 8
  Reason: private_or_deleted
  Source post ID: 8
  Source URL: https://x.com/deleted/status/8
- video-003: video file not preserved offline; poster captured; source link preserved.
  Reason: video_file_not_captured
  Source post ID: 999
  Source URL: https://x.com/ada/status/999
- video-005: video file not preserved offline; poster unavailable; source link preserved.
  Reason: video_file_not_captured
  Source URL: https://x.com/ada/status/deleted-video
- video-007: video file not preserved offline; poster unavailable; source link preserved.
  Reason: video_file_not_captured
  Source post ID: 1002
  Source URL: https://x.com/ada/status/1002

---

## Source Links

1. https://x.com/ada/article/12345
2. https://example.com
3. https://example.org/path
4. https://x.com/ada/status/999
5. https://x.com/ada/status/1000
6. https://x.com/ada/status/deleted-video
7. https://x.com/ada/status/1001
8. https://x.com/ada/status/1002
9. https://x.com/charles/status/42
10. https://x.com/nested/status/43
11. https://x.com/private/status/7
12. https://x.com/deleted/status/8
13. https://x.com/ada/status/1234567890
