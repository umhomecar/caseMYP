# CaseMYP staging database

These scripts are intentionally separated from production migrations. They are
for the isolated `umMYP-staging` Supabase project only.

## Installation order

1. Open the Supabase SQL Editor while the selected project is
   `umMYP-staging`.
2. Run `01_compatibility_schema.sql`.
3. Confirm the result reports `expected_table_count = 14`.
4. Do not copy production rows into staging.
5. Add only synthetic test users and test cases after the schema check passes.

## Security boundary

`01_compatibility_schema.sql` temporarily reproduces the anonymous access
required by the current browser-only application. This is safe only while the
staging database contains synthetic data and its URL/key are used exclusively
by preview deployments.

The production rollout must not reuse the staging compatibility policies.
Production requires Supabase Auth, scoped RLS policies, removal of legacy
plaintext passwords, transactional RPC functions for multi-table workflows,
timestamp migration, and a verified backup/rollback plan.
