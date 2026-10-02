# DESIGN.md

Visual rules for the UI SourceCapsule injects into x.com (trigger, menus, toasts, modals). The
exported capsule HTML has its own look and is out of scope here.

## Principle

SourceCapsule lives inside X, so it borrows X's visual language instead of bringing its own.
Pill buttons, X blue and X's greys are deliberate here because they match the host page.

## Golden viewports

- 1280×900 on X dark ("Lights out" / "Dim"), the owner's daily setup.
- 375×812 light, to catch wrapping and horizontal scroll.

Check both before shipping a modal change. Use a local harness that loads the real
`sourcecapsule.user.js` with fixture data, not hand-copied markup.

## Colour tokens (X palette)

| Role             | Light     | Dark      |
| ---------------- | --------- | --------- |
| Primary / link   | `#1d9bf0` | `#1d9bf0` |
| Danger text      | `#b00020` | `#f4212e` |
| Danger armed bg  | `#f4212e` | `#f4212e` |
| Body text        | `#0f1419` | `#e7e9ea` |
| Muted text       | `#536471` | `#8b98a5` |
| Modal surface    | `#fff`    | `#15202b` |
| Secondary button | `#eff3f4` | `#273340` |
| Border           | `#cfd9de` | `#38444d` |

## Type scale

20 (modal title) / 15 (row title, bold) / 14 (body, buttons) / 13 (meta, row buttons) / 12
(fine print). Buttons inherit the page font. Never put `inherit` inside the `font` shorthand:
browsers drop the whole declaration and fall back to the UA font.

## Spacing

4 / 8 / 12 / 16 / 20. Rows pad 12, radius 12. Row buttons pad 8×12.

## What a viewer should notice first

In the Recent AI readable links modal: the live links and their **Copy link** button. Expired
links are history, so they sit folded below with only "Original post" and "Remove".

## Rules for destructive actions

No `window.confirm` from the extension's isolated world: it blocks the tab and no automation
can answer it. Confirm in place instead (the button arms into a red "Confirm delete" for 5 s).
