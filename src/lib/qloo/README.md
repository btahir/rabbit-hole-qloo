# Qloo transport

Owned TypeScript adapter using native fetch, strict Zod wire contracts, fixed GET endpoints, bounded attempts/body/time, private scoped cache keys and subscriber-aware singleflight. Public fixtures are synthetic, never retained live API output.

The application wrapper in `../core/qloo.ts` supplies shared attempt quotas and private cache scope. `FixtureTransport` exists for contract tests; product examples use a separately authored catalog. All live credentials stay server-side. See the application README for run instructions and limitations.
