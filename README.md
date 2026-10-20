# Rabbit Hole

Follow your taste through three unexpected discoveries in film, music and books, then share a trail someone else can branch from.

![Rabbit Hole: discoveries connected by taste](docs/discoveries.webp)

**Qloo finds the connections. Haiku chooses the next move.** Qloo resolves your starting point and retrieves cross-category recommendations with directed affinity evidence. A bounded Claude Haiku agent calls tools, reads those results and chooses the next medium and discoveries. Each door explains its connection; “Why this?” exposes the source. Qloo affinity is evidence of shared taste, not a promise you'll enjoy something.

Finish after one to three discoveries, save an unlisted trail and let a friend take a different turn—no account needed.

## Run locally

Requires Bun 1.4+; Node.js 24 is supported for development tools.

```sh
bun install --frozen-lockfile
cp .env.example .env.local
bun run dev
```

Open [localhost:3000](http://localhost:3000). Blank provider keys run a labelled synthetic example. To use live discovery, fill `QLOO_API_KEY` and `ANTHROPIC_API_KEY`; the supported model defaults to `claude-haiku-5-5`. All variables are listed in [.env.example](.env.example). Secrets stay server-side.

Without services, local state lives in memory and resets on restart. `DATABASE_URL` selects Postgres (run `bun run db:migrate` first); otherwise `REDIS_URL` selects durable Valkey. `VALKEY_PREFIX` scopes KV keys. A missing Anthropic key selects the disclosed deterministic guide; live provider failures never silently become synthetic data.

```sh
bun run typecheck
bun run lint
bun run test
bun --bun next build
bun --bun next start
```

A local production server needs `APP_ORIGIN=http://localhost:3000` and `ALLOW_MEMORY_STORE=1` if no services are configured. To run the offline browser suite after building: `bun run test:browser -- --workers=2` with the pinned Playwright Chromium headless shell available. Live tests are opt-in and consume provider quota.

## Deploy on ShipTiffin

[tiffin.config.ts](tiffin.config.ts) declares project `rabbit-hole`, one Next.js `web` app, a Bun build and `bun run release`. ShipTiffin supplies Postgres and Valkey, runs the release hook before switching traffic, and starts Next.js under Bun with its adapter.

Set just four values: `QLOO_API_KEY`, `ANTHROPIC_API_KEY`, `SESSION_SECRET` (random, at least 32 characters) and `APP_ORIGIN` (public HTTPS origin). Then run `tiffin deploy` from this checkout. [Deployment setup](docs/deployment.md) has the exact commands and defaults. No manual migration, quota provisioning or private sample import is needed.

Release creates missing tables and the project allowance, preserves existing counters, and prepares three opening samples plus five saved Qloo/Haiku comparisons. It checkpoints successful work in Postgres and publishes it to Valkey. Each release permits at most 30 uncached Qloo HTTP attempts and $0.10 in bounded model reservations; repeated completed releases make no provider calls. Failed warming leaves the app serving with samples marked unavailable; search remains available when its providers are healthy. Never upload `.env.local` or `.cache/`.

The agent is limited to four model steps, two Qloo Insights operations and six HTTP attempts per run, with $3/day and $25 cumulative model reservation caps by default. Shared trails expire after 30 days; anyone with a link can read it. Editing belongs to the original browser cookie.

![A completed trail](docs/trail.webp)

## Licence

[MIT](LICENSE) © 2026 Bilal Tahir. Third-party dependencies and fonts retain their own licences; font notices are in `public/fonts/`. Qloo data and third-party artwork are not covered by the code licence.
