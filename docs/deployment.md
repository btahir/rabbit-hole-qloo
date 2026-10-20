# Deployment setup

The app runs on [ShipTiffin](https://shiptiffin.com) with the config at the repository root. It uses Postgres for durable state and Valkey for Qloo response caching, request pacing and the credential allowance ledger. The release command creates `rabbit_hole_records` idempotently; requests and builds never create tables. Postgres connections disable prepared statements for the transaction pooler.

## Environment

| Names | Configuration |
| --- | --- |
| `QLOO_API_KEY`, `ANTHROPIC_API_KEY` | Server-only provider secrets. |
| `SESSION_SECRET`, `SHARE_TOKEN_SECRET` | Distinct random secrets, at least 32 characters each. Keep stable to preserve sessions and links. |
| `APP_ORIGIN` | The public HTTPS origin, without a trailing slash. |
| `DATABASE_URL`, `DATABASE_POOL_MAX`, `REDIS_URL`, `VALKEY_PREFIX` | Supplied by ShipTiffin. The Postgres pool uses at most five connections. |
| `ANTHROPIC_MODEL` | Optional; only `claude-haiku-5-5` has a verified cost contract. |
| `QLOO_MODE` | Leave unset for live discovery when the key is present; `fixture` explicitly selects synthetic data. |
| `ENTITLEMENT_NAMESPACE` | Optional; defaults to `default`. Keep stable. |
| `QLOO_CREDENTIAL_SCOPE` | Required stable allocation label, 8–80 letters, digits, underscores or hyphens. Do not put a key here. |
| `QLOO_QUOTA_RESETS_AT` | Required future UTC ISO timestamp for the confirmed provider window. |
| `QLOO_PROJECT_CALL_ALLOWANCE` | Required integer, 1–2,500; this app's share of the remaining credential allowance. |
| `QLOO_PROJECT_ALLOCATION_VERIFIED` | Set to `1` only after confirming that allocation. |
| `QLOO_DAILY_ATTEMPTS` | Optional, 1–500; defaults to 150. Counts uncached HTTP attempts, including retries. |
| `DAILY_BUDGET_USD`, `TOTAL_BUDGET_USD` | Optional; defaults to 3/day and 25 cumulative. Model reservations, not provider account limits. |
| `INFERENCE_PAUSED` | `1` pauses paid inference. |

Leave `QLOO_DEV_CACHE_DIR` and `ALLOW_MEMORY_STORE` unset on the box. `NODE_ENV` and `PORT` are runtime-managed; browser-test variables in `.env.example` are local only.

## Before enabling live Qloo

Provision a hash at `qloo:credential:<scope>:allowance:v1` using the project's prefixed KV client. Its fields are:

- `contract`: JSON with `reset` (the configured UTC timestamp as epoch milliseconds) and `ceiling` (the confirmed project allowance), in that order.
- `used`: the verified number of attempts already charged to that allocation.

Keep this key without expiry and back it up. The app fails closed if it is absent, exhausted, expired or mismatched. Never reset lost usage to zero. Reconcile the shared credential across every app before allocating or renewing a window.

## Optional opening samples and comparisons

Search works without preloaded samples. The three one-click starts require a reviewed activation manifest in private KV at `rabbit-hole:<namespace>:samples:v1`, validated by `activationSchema` in `src/lib/core/activated-samples.ts`. Retain identity and discovery evidence for every review gate; a successful API call is not a review.

For local preparation, `scripts/prepare-live.ts` reads `.cache/reviewed-identities.json` and `.cache/sample-reviews.json`, validates them and writes `.cache/activated-samples.json` plus frozen comparison data. It consumes Qloo quota. Keep those files private. Publish only reviewed manifests through the project's KV client, which supplies `VALKEY_PREFIX`; the app does not seed them on startup. Saved comparisons use `rabbit-hole:<namespace>:comparisons:v1` and remain labelled ordering audits, not evidence of user benefit.

## Existing installations

Setting `DATABASE_URL` selects Postgres before Valkey. For an existing KV-only installation, migrate its `rabbit-hole:<namespace>:core:v2` index and record bodies into `rabbit_hole_records` before switching backends, with writes paused. Do not switch an active installation to an empty database: that would lose access to its sessions, shares and budget accounting. Fresh installations need only the release migration.
