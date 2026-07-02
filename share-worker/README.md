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
