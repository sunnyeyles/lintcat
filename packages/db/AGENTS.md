# packages/db

Imports use extensionless relative paths (`./client`), not `#src/`.

A schema change in `src/schema.ts` needs `pnpm db:generate` and the generated
migration committed under `drizzle/`; CI applies it with `db:migrate` before the
web app deploys.

Tests use `createTestDatabase()` (`src/test-database.ts`): an in-memory PGlite
with `drizzle/` applied, so no `DATABASE_URL` is needed.

The Neon HTTP driver behind `db()` has no interactive transactions. Writes that
must be atomic go through `withWriteDatabase(run)`, where `.transaction()` works.

Commands and details: `README.md`.
