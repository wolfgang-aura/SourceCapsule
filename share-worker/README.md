# SourceCapsule Share Worker

Optional Cloudflare Worker + R2 service for expiring, unlisted Share-with-AI links.

The userscript remains local by default. It uploads only after the user confirms **Share with AI**.
Shared packages contain static HTML, Markdown, a capture manifest, images, and video poster frames.
Full video files are deliberately excluded.

## Local development

```powershell
npx wrangler dev --config .\share-worker\wrangler.toml --local
```

The userscript defaults to `http://127.0.0.1:8787`. Change the endpoint from the userscript-manager
menu when testing another environment.

## Cloudflare setup

```powershell
npx wrangler r2 bucket create sourcecapsule-shares
npx wrangler r2 bucket create sourcecapsule-shares-dev
npx wrangler deploy --config .\share-worker\wrangler.toml
```

Before a public release, configure Cloudflare rate limiting or Turnstile for `POST /api/capsules`,
attach the chosen custom domain, and replace the userscript's default share endpoint.

The API supports 1-day, 7-day, and 30-day expiry. A daily scheduled handler removes expired
objects. Accounts, billing, and no-expiry slots are intentionally not part of this first build.
