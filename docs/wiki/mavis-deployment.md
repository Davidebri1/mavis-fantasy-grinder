# Deployment — publishing to Cloudflare Pages and proving what is live

## The live site & backend API (permanent Cloudflare deployment)

- **Frontend (Cloudflare Pages)**: **https://mavis-fantasy-grinder.pages.dev/** — project `mavis-fantasy-grinder`, built from `frontend/react` with `VITE_API_URL=https://mavis-fantasy-grinder-api.ebridavid.workers.dev` (and falling back to that same Worker URL automatically on non-localhost origins).
- **Backend Optimizer & Data API (Cloudflare Worker)**: **https://mavis-fantasy-grinder-api.ebridavid.workers.dev** — Worker `mavis-fantasy-grinder-api`, deployed from `backend/django/` (`wrangler.jsonc`, `worker/mavis-container-proxy.mjs`, `worker/mavis-edge-api.mjs`). Serves `/api/health/`, `/api/slates/`, `/api/players/`, `/api/optimize/`, `/api/import/*`, and `/api/export/*` at the edge when `DJANGO_CONTAINER` is unbound, and proxies to Gunicorn/Postgres when `wrangler.containers.jsonc` is used.

```bash
# 1. Deploy backend API Worker
cd backend/django
npx wrangler@4.157.0 deploy

# 2. Build & publish frontend Pages bundle against live Worker
cd ../../frontend/react
VITE_API_URL=https://mavis-fantasy-grinder-api.ebridavid.workers.dev npm run build
node scripts/mavis-deploy-cloudflare.mjs
node scripts/mavis-verify-deploy.mjs             # proves the live site matches dist/ by SHA256
```

Authentication is wrangler's own (`npx wrangler login`, which opens a browser and asks the operator to
approve). No token is stored in this repo, and none is needed in CI unless a publish job is added.

**Why it moved off Surge:** on 2026-11-04 the project owner asked for a host other than Surge and named
Cloudflare. The Surge flow below is kept as history; it is no longer how this site is published.

## How to prove the live site is the build you think it is

Cloudflare Pages does not reliably return a usable `ETag`, so the check is done by hashing the bytes that
come back:

1. Read the local `dist/index.html`, take every `./assets/...` file it references.
2. SHA256 each local file.
3. Fetch the same path from the live site, SHA256 the response bytes.
4. Every hash must match. Anything else means the live site is serving a different build.

`frontend/react/scripts/mavis-verify-deploy.mjs` does exactly this and exits non-zero on any mismatch.

This is the method to use before and after any publish. "I deployed it" is not evidence; a matching
SHA256 on every asset is.

## The state of the live site on 2026-11-04

On **2026-11-04** the first Cloudflare Pages deployment of this repo's tip commit was verified by SHA256:
`dist/index.html` and both referenced assets hashed identically to the bytes served from
`mavis-fantasy-grinder.pages.dev`. The live site and the repo's tip commit were the same build on that
date.

## Superseded: the Surge flow (2026-10-31 to 2026-11-04)

Until 2026-11-04 the public site was **https://fantasygrinder.surge.sh/**, published with the surge CLI
from the `frontend/react` directory. Surge returns two headers that make a publish verifiable:

- **`ETag`** — the SHA256 of the served file.
- **`surge-stamp`** — the publish timestamp in epoch milliseconds.

On **2026-11-04** a fetch of `https://fantasygrinder.surge.sh/` still returned HTML referencing
`./assets/index-B45PN6sy.js` — the **September build**, published **2026-09-13T02:50:19Z** — meaning
Surge kept serving the old build while the repo tip carried the newer glass rebuild (`c415472`). The
surge CLI authenticates from the operator's `~/.netrc` and prompts when it cannot authenticate; running
it unauthenticated in a non-interactive shell is what caused the incident recorded in
[mavis-credential-incident.md](mavis-credential-incident.md). Read that page before touching Surge again.

## Verification tooling in the repo

As of 2026-11-14, `frontend/react/scripts/` contains:

- `mavis-check-card-layout.mjs` — Playwright measurement of the home card row. See
  [mavis-home-screen-layout.md](mavis-home-screen-layout.md) for what it reports.
- `mavis-deploy-cloudflare.mjs` — publishes `dist/` to Cloudflare Pages. `--dry-run` prints the file
  count and byte total without uploading.
- `mavis-verify-deploy.mjs` — proves the live site matches a local build, hash by hash.

The Surge scripts (`deploy-surge.mjs`, `verify-deploy.mjs`) were deleted on 2026-11-04; they remain in
the git history.

## Checklist for publishing

1. `git status` — confirm the working tree is clean and you know which commit you are shipping.
2. `cd frontend/react && npm run build`.
3. Run `node scripts/mavis-check-card-layout.mjs` against the built app if the change touched the home
   screen.
4. `node scripts/mavis-deploy-cloudflare.mjs`.
5. `node scripts/mavis-verify-deploy.mjs` — it must print `MATCH` and exit 0.
6. Deploy the backend Worker from `backend/django/` using `npx wrangler@4.157.0 deploy`
   (`wrangler.jsonc`, `worker/mavis-container-proxy.mjs`, `worker/mavis-edge-api.mjs`). For optional
   full Django/Postgres container hosting, use `wrangler.containers.jsonc` (`Dockerfile` + Workers Paid
   plan with Containers enabled and Docker daemon).
7. Note the commit hash and the deployment URL in the next dated wiki entry.

See also [mavis-locations.md](mavis-locations.md) for where the build output sits on disk.
