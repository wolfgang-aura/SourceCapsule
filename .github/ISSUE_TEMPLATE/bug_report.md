---
name: Bug report
about: Something didn't export correctly (missing media, broken layout, a crash)
title: '[bug] '
labels: bug
---

<!--
Because X changes its page structure often, the most common bug is a "selector
miss" — the script can't find part of the page anymore. The console output below
is the single most useful thing you can give us.
-->

## What went wrong
A clear description of what you expected vs what happened.

## The post/article
- URL (you can redact the handle if you like):
- Type: [ ] Article  [ ] Single post
- Did it contain: [ ] images  [ ] video/GIF  [ ] quoted tweet

## Console output (important)
1. Open the page, press F12 → "Console" tab.
2. Click Export.
3. Paste everything that starts with `[SourceCapsule]` here:

```
(paste console output)
```

## Environment
- Userscript manager: [ ] Tampermonkey  [ ] Violentmonkey  [ ] other:
- Browser + version:
- OS:
- SourceCapsule version (top of the script, `@version`):

## Exported file (optional)
If you can, attach or describe the broken `.html` (e.g. "images missing", "quoted
tweet showed as plain text").
