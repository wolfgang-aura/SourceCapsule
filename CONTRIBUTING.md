# Contributing to SourceCapsule

Thanks for helping out! The single most valuable contribution to this project is **fixing
selectors when X changes its page structure** — that's what keeps the tool working.

## The codebase in 60 seconds

Everything ships as one file: [`sourcecapsule.user.js`](sourcecapsule.user.js). It's split
into two layers with a deliberate seam between them:

- **Fragile layer** — reads X's DOM and produces a plain-object _model_. **All** of X's
  selectors live in the `CONFIG` block at the top of the file (marked
  `✱✱✱ EDIT HERE WHEN X CHANGES ✱✱✱`).
- **Stable layer** — the durable engine: privileged fetch (`GM_xmlhttpRequest`) → base64 →
  `assembleHtml(model)` → download. It only ever touches the model, never the DOM.

The model is the contract. When something breaks, the fix is almost always a selector in
`CONFIG`, and you should not need to touch the stable layer.

## When X breaks the export (the common case)

1. Open the broken Article/post, press <kbd>F12</kbd> → **Console**.
2. Click **Export** and read the `[SourceCapsule]` warnings — they name the selector that
   missed (e.g. `selector miss (none matched): div[data-testid="tweetText"]`).
3. Inspect the page (<kbd>F12</kbd> → **Elements**) to find the new markup.
4. Update the matching entry in `CONFIG.selectors`. Add the new selector **and keep the old
   one as a fallback** (the arrays are tried in order) so older page versions still work.
5. Re-test (below) and open a PR describing what changed.

## Developing & testing locally

You only need [Node.js](https://nodejs.org/) 18+ for the linter/tests. The userscript
itself has **no build step** — the file you edit is the file that ships.

```bash
npm install        # one-time: installs eslint + prettier (dev-only)
npm test           # runs the DOM-free engine smoke test, writes examples/sample-export.html
npm run lint       # eslint
npm run format     # prettier --write (npm run format:check to verify only)
```

To test against real X:

1. In Tampermonkey/Violentmonkey, open the installed script and **paste your edited
   version** over it (or point the editor at your local file), then save.
2. Reload an X Article and a single post; click **Export**.
3. Open each downloaded `.html`, then <kbd>F12</kbd> → **Network** → **Offline** → reload.
   Confirm images show and quoted tweets render as styled cards with no network requests.

## Pull request checklist

- [ ] Selector changes are confined to `CONFIG` (stable engine untouched).
- [ ] `npm test`, `npm run lint`, and `npm run format:check` pass.
- [ ] Tested a real Article and/or post, verified offline.
- [ ] Bumped `@version` in the metadata block and added a `CHANGELOG.md` entry.

## Originality & licensing

All code here must be **original**. Do not copy from any proprietary userscript or
extension. If you adapt a _technique_ from another open-source project, add a comment
crediting it and noting its license is compatible with our [MIT](LICENSE) license.

## Disclaimer

This tool only captures content already visible to the logged-in user. Contributors and
users are responsible for complying with [X's Terms of Service](https://x.com/tos) and
applicable law.
