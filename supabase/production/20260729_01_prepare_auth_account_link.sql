-- PHASE 1B: Prepare account linking without changing the current login flow.
-- Safe to run before the Auth/RLS cutover. This script does not remove legacy
-- passwords and does not change existing RLS policies.

begin;

alter table public.users
  add column if not exists auth_user_id uuid unique references auth.users(id),
  add column if not exists email text;

create unique index if not exists users_email_unique_idx
  on public.users (lower(email))
  where email is not null and btrim(email) <> '';

commit;

-- Expected result before running phase 2: unlinked_active_users = 0.
select
  count(*) filter (where status = 'active') as active_users,
  count(*) filter (
    where status = 'active' and auth_user_id is null
  ) as unlinked_active_users,
  count(*) filter (
    where status = 'active' and (email is null or btrim(email) = '')
  ) as active_users_without_email
from public.users;
