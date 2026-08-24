# SourceCapsule Share Worker

Optional Cloudflare Worker + R2 service for expiring, unlisted Share-with-AI links.

The userscript uploads only after the user confirms **Share with AI**.
Shared packages contain static HTML, Markdown, a capture manifest, images, and video poster frames.
Full video files are deliberately excluded.

The production deployment lives at `https://sourcecapsule-share.wolfgang-aura.workers.dev`
(the userscript's default endpoint). Link creation is rate-limited per IP via a Workers
rate-limiting binding (`CREATE_LIMITER` in `wrangler.toml`).

## Local development

```powershell
npx wrangler dev --config .\share-worker\wrangler.toml --local
```

Then point the userscript at `http://127.0.0.1:8787` from the userscript-manager menu.

## Cloudflare setup (deploy your own)

```powershell
npx wrangler r2 bucket create sourcecapsule-shares
npx wrangler r2 bucket create sourcecapsule-shares-dev
npx wrangler deploy --config .\share-worker\wrangler.toml
```

To serve from a custom domain later, attach it to the Worker in the Cloudflare dashboard and add
matching `@connect` / `host_permissions` grants to the userscript and extension manifest.

The API supports 1-day, 7-day, and 30-day expiry. A daily scheduled handler removes expired
objects. Accounts, billing, and no-expiry slots are intentionally not part of this first build.

## Expiry tombstones

`POST /api/capsules` accepts an optional `sourceUrl` (plus `title` and `handle`) naming the X post
the capsule was captured from. `sourceUrl` must be a canonical public permalink
(`https://x.com/<handle>/status/<id>`, `twitter.com` and a `/photo/N` suffix are normalised);
anything else is dropped and the capsule is still created, it just expires without a back-link.
The create response echoes the accepted value so a caller can tell.

At expiry the capsule's content — HTML, Markdown, manifest, media — is deleted and a ~300-byte
`_meta.json` tombstone is kept in its place. `/c/<id>` and `/c/<id>.md` then answer `410` with a
notice page (HTML or Markdown) linking back to the original post, instead of a bare error. A
capsule with no stored `sourceUrl` is deleted outright, exactly as before. `DELETE /api/capsules/<id>`
removes the tombstone along with everything else, and the scheduled handler hard-deletes any
tombstone more than `TOMBSTONE_RETENTION_DAYS` (180) past its expiry.

Storage cost is negligible — a million tombstones is roughly 300 MB, inside R2's free tier. The
scheduled sweep reads `expiresAt` from `customMetadata` on the list page, so a capsule that is not
due costs no object read at all; that matters once tombstones accumulate.
