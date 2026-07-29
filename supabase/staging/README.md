# CaseMYP staging database

These scripts are intentionally separated from production migrations. They are
for the isolated `umMYP-staging` Supabase project only.

## Installation order

1. Open the Supabase SQL Editor while the selected project is
   `umMYP-staging`.
2. Run `01_compatibility_schema.sql`.
3. Confirm the result reports `expected_table_count = 14`.
4. In `02_seed_synthetic_data.sql`, replace
   `CHANGE_TO_A_NEW_TEST_ONLY_PASSWORD` with a new password used nowhere else.
5. Run `02_seed_synthetic_data.sql`.
6. Confirm the result reports three synthetic users and three synthetic cases.
7. Run `03_workflow_hardening.sql`.
8. Verify that `version`, `next_action`, `next_action_at`, and `deleted_at`
   exist on `public.cases`, and that `public.audit_log` was created.
9. Redeploy the Vercel Preview only after steps 1–8 pass.
10. Do not copy production rows into staging.

## Security boundary

`01_compatibility_schema.sql` temporarily reproduces the anonymous access
required by the current browser-only application. This is safe only while the
staging database contains synthetic data and its URL/key are used exclusively
by preview deployments.

The production rollout must not reuse the staging compatibility policies.
Production requires Supabase Auth, scoped RLS policies, removal of legacy
plaintext passwords, transactional RPC functions for multi-table workflows,
timestamp migration, and a verified backup/rollback plan.

## Production rollout boundary

- `../migrations/20260729_01_workflow_hardening.sql` is the safe additive phase.
  It archives the retired market tables, adds concurrency/soft-delete fields,
  and creates an immutable audit log without deleting customer data.
- `../production/20260729_02_auth_rls_after_account_link.sql` is intentionally
  guarded. It aborts if any active account has not been linked to Supabase Auth.
- `../production/20260729_01_prepare_auth_account_link.sql` adds account-linking
  columns without changing the current login or RLS policies.
- Follow `../production/ROLLOUT.md` for backup, account linking, Preview role
  tests, cutover, monitoring, and rollback.
- Do not run the Auth/RLS phase directly in production until the Admin and Sales
  role matrix has passed in Preview and a recoverable backup has been verified.
