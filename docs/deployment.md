# Deploy on ShipTiffin

From this repository's root, with the intended box already selected and authenticated, set four values and deploy. The shell variables below refer to values you supply privately; no credentials belong in the repository.

```sh
tiffin secrets set rabbit-hole QLOO_API_KEY --value "$QLOO_API_KEY"
tiffin secrets set rabbit-hole ANTHROPIC_API_KEY --value "$ANTHROPIC_API_KEY"
tiffin secrets set rabbit-hole SESSION_SECRET --value "$SESSION_SECRET"
tiffin secrets set rabbit-hole APP_ORIGIN --value "$APP_ORIGIN"
tiffin deploy
```

| Required name       | Value                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| `QLOO_API_KEY`      | Qloo API credential authorized for this demo.                         |
| `ANTHROPIC_API_KEY` | Direct Anthropic credential with access to Claude Haiku 5.5.          |
| `SESSION_SECRET`    | Random secret of at least 32 characters; keep stable across releases. |
| `APP_ORIGIN`        | Public HTTPS origin, without a trailing slash.                        |

`SHARE_TOKEN_SECRET` is optional. Without it, the app derives a separate share-encryption key from `SESSION_SECRET` using HMAC with a fixed purpose label. Existing installations that already set a share secret must keep it to retain existing encrypted links. Changing the session secret invalidates sessions and, when derived, share encryption.

## Defaults

The app is public and anonymous by default. Provider keys select live discovery; no public-mode flag is required.

| Optional name                          | Default / behavior                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ANTHROPIC_MODEL`                      | `claude-haiku-5-5`; other models fail the verified cost contract.                               |
| `QLOO_MODE`                            | Live with a Qloo key; `fixture` explicitly selects synthetic examples.                          |
| `ENTITLEMENT_NAMESPACE`                | `default`; keep stable.                                                                         |
| `QLOO_CREDENTIAL_SCOPE`                | `rabbit-hole`; stable project-local allocation label.                                           |
| `QLOO_PROJECT_CALL_ALLOWANCE`          | 2,500 uncached HTTP attempts, including retries and release warming.                            |
| `QLOO_QUOTA_RESETS_AT`                 | `2026-11-18T00:00:00Z`; live requests fail closed at this boundary. No automatic counter reset. |
| `QLOO_ACCESS_VALID_UNTIL`              | `2026-12-01T00:00:00Z` exclusive: access through November 30 UTC.                               |
| `QLOO_PROJECT_ALLOCATION_VERIFIED`     | `1` for the hackathon allocation; `0` disables its use.                                         |
| `QLOO_DAILY_ATTEMPTS`                  | 150 across visitors and warming.                                                                |
| `DAILY_BUDGET_USD`, `TOTAL_BUDGET_USD` | $3/day and $25 cumulative model reservations, including warming.                                |
| `INFERENCE_PAUSED`                     | Unset; `1` pauses paid inference and Qloo attempts.                                             |
| `TRUST_PROXY`                          | Enabled when `TIFFIN_URL` is present; `0` opts out, `1` explicitly trusts one edge hop.         |

ShipTiffin injects `DATABASE_URL`, `DATABASE_POOL_MAX`, `REDIS_URL`, `VALKEY_PREFIX`, `TIFFIN_URL`, `NODE_ENV` and `PORT`. Do not set them as app secrets. Postgres uses `prepare: false` and at most five connections for PgBouncer. The edge's `X-Forwarded-For` supplies the client address: the app reads the rightmost entry, matching Tiffin's documented one-hop depth, validates it, then hashes it with a daily salt. Direct environments ignore forwarded headers unless explicitly enabled. Do not expose a trusted-proxy app around the edge.

The 2,500-call default is this project's allocation, not a provider account reset or a discovery of remaining balance. A shared credential must have sufficient allowance across all its projects. Existing allowance hashes are never replaced, even when configuration changes. Changing the scope creates a different allocation and must not be used to reset usage. Reconcile renewals or damaged counters explicitly before changing their contract.

## What release does

`bun run release` runs after build with the app environment, before traffic switches, following ShipTiffin's release lifecycle.

1. Apply idempotent Postgres migrations. A migration failure blocks release.
2. Atomically create the non-expiring, project-prefixed allowance hash only if absent. Existing live counters and malformed/changed contracts are preserved; mismatches fail closed.
3. Hydrate the committed curated IDs from live Qloo, validate identities and filter candidate eligibility. Warm opening discoveries and run both Haiku comparison arms against the same frozen curated catalog.
4. Save successful catalogs, briefs, discoveries, arms and completed comparisons in Postgres. Publish three prepared samples and saved comparisons to Valkey. No private disk manifests or manual imports are needed.

Warming stops below Tiffin's ten-minute hook timeout. Its hard ceilings are **30 uncached Qloo attempts** (including retries) and **$0.10 model reservations per invocation**. Every comparison arm reserves its four-step worst case before contacting Haiku; the runner bounds each step to 8,000 input tokens and 1,024 output tokens, with no retries. Failed or unknown usage retains the full reservation. These calls also count toward the normal project quotas. The [verified Haiku pricing](https://platform.claude.com/docs/en/about-claude/pricing) includes the five-minute prompt-cache write rate.

Successful stages are immutable checkpoints: subsequent releases skip them and can restore the Valkey display records from Postgres with zero provider calls. Response-cache expiry is independent; normal live discovery can fetch fresh evidence. Incomplete stages retry on a later release within a new release budget. Automatic sample checks are recorded separately from legacy human-reviewed manifests. Comparisons are ordering audits, not proof of user benefit.

Provider failure, exhausted quota, a warming timeout or unavailable KV does not fail an otherwise migrated release. Missing samples are visibly unavailable; existing successful data is retained. Searches still use live providers and their usual error states. Logs report stages, safe error codes and counters, never credentials or raw provider errors.

## Existing installations and local checks

Keep `QLOO_DEV_CACHE_DIR` and `ALLOW_MEMORY_STORE` unset on the box. Never ship `.env.local` or `.cache/`. A fresh project requires only the four values and deploy above. For an existing KV-only installation, migrate its state into Postgres with writes paused before enabling `DATABASE_URL`; pointing it at an empty database would discard access to sessions, shares and budget history.

Locally, start isolated Postgres and Valkey, supply their connection variables and the provider credentials, then run `bun run release` followed by `bun --bun next start`. Run release again to check that allowance usage and model reservations do not increase. A release with unavailable providers should exit successfully after migration and leave samples unavailable.
