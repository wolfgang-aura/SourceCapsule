# Burndown — SourceCapsule

Standing menu of debt to work through during `/burn` sessions. Ordered by value.
Add rather than resurrect: if a line is done, check it off but leave the entry
until the next burn compresses the file. Not gitignored — it's a project doc.

## Agent-doable (no human needed)

- [ ] Hunt for a live suspended/banned-account quote URL via X search. One
      good URL unblocks manual G02, G03, G04, G05, G08, G09, G10, Q05 in a
      single export attempt. Record it in SESSION_HANDOFF.md under "Need a
      genuinely broken quote".
- [ ] Poll for a real long-form "note" post whose full text is delivered by
      capture; use it to add a golden-case assertion around
      `capturedNoteTweets` swap-in.
- [ ] Wider test coverage on the passive network capture layer: same-envelope
      hash-dedup, 6 MB truncation diagnostic, quote-only body inclusion.
- [ ] Startup config self-test / diagnostic: add a menu command that dumps a
      one-shot health line (prefs, capture-cache size, syndication cache size,
      root-folder handle state) so a silently-broken install is visible in a
      single click.
- [x] Assert `Save full thread` is the FIRST drop-down item on any focused
      post (T02 order regression). Done 2026-07-16 in `test/dom.test.mjs`.

## Blocked-on-human — do not attempt

See `SESSION_HANDOFF.md` "Open items — blocked on you" for the current list
(popup/toolbar checks, real library saves, native folder picker, hosted share
upload verification). Agent tools cannot exercise the extension popup or the
File System Access folder picker.

## Ideas to grow the menu

Whenever a burn finishes, add anything noticed in passing here so the next
burn starts with a longer menu, not a blank page.
