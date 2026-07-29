# CaseMYP production rollout

The rollout is split so the current application keeps working while Supabase
Auth accounts are created and linked.

## 0. Preconditions

- Confirm Vercel Production tracks `main`.
- Confirm Preview uses only `umMYP-staging`.
- Create a recoverable Supabase production backup and record its timestamp.
- Keep Production `CASEMYP_AUTH_MODE=legacy`.
- Never copy production customer rows into staging.

## 1. Additive workflow hardening

Run `../migrations/20260729_01_workflow_hardening.sql` in production.

This phase adds version, assignment, next-action, and soft-delete columns;
archives the retired market tables; blocks browser writes to those tables; and
creates an immutable audit log. It does not delete production data or change
the current login.

Verify:

```sql
select
  to_regclass('public.audit_log') is not null as audit_ready,
  to_regclass('public.market_archive') is not null as market_archived,
  to_regclass('public.claimedcases_archive') is not null as claimed_archived;
```

## 2. Prepare and link Supabase Auth accounts

Run `20260729_01_prepare_auth_account_link.sql`.

For every active row in `public.users`:

1. Create the user in Supabase Authentication with a real email.
2. Copy the Auth user UUID into `public.users.auth_user_id`.
3. Put the same email in `public.users.email`.
4. Keep the old login live until every account is linked.

Example:

```sql
update public.users
set auth_user_id = 'AUTH-USER-UUID'::uuid,
    email = 'person@example.com'
where userid = 'U001';
```

The diagnostic query must report `unlinked_active_users = 0` and
`active_users_without_email = 0`.

## 3. Preview role matrix

Deploy Preview with the staging URL/key, synthetic linked Auth accounts, and
`CASEMYP_AUTH_MODE=supabase`.

Test separately as Admin and Sales:

- login, refresh, logout, and expired session;
- Admin creates a general case in `รอมอบหมาย`;
- Admin bulk-assigns selected general cases;
- Sales sees only assigned general cases;
- private cases and Line OA remain separate Admin-only lists;
- duplicate warning and concurrent-edit protection work;
- Notes, Follow-up, booking, and status updates survive refresh;
- soft delete, trash, restore, and immutable audit work;
- retired market actions cannot be opened or called.

## 4. Auth/RLS cutover

Only after the matrix passes, run
`20260729_02_auth_rls_after_account_link.sql`.

The script aborts if an active account is unlinked. After it commits:

1. Set Production `CASEMYP_AUTH_MODE=supabase`.
2. Redeploy the exact tested commit.
3. Test one Admin and one Sales account immediately.
4. Confirm Sales cannot read another salesperson's cases.
5. Confirm Admin can use every operational screen.

## 5. Observation window

For the first 24 hours check Vercel runtime errors, Supabase API/Auth errors,
unassigned queue age, overdue next actions, audit growth, and unexpected RLS
denials.

Do not schedule `purge_case_myp_trash()` during this window. The purge function
is manual and cannot delete records newer than 30 days.

## Rollback

- Application failure: redeploy the previous known-good Vercel deployment.
- Before Auth/RLS: keep `CASEMYP_AUTH_MODE=legacy`; no login rollback is needed.
- After Auth/RLS: prefer fixing and redeploying the tested code. If access is
  broadly blocked, restore the latest verified Supabase backup rather than
  recreating anonymous allow-all policies by hand.
- Historical market data remains in `market_archive` and
  `claimedcases_archive`; neither legacy table is dropped.
