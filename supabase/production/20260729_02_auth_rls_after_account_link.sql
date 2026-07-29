-- PHASE 2: Supabase Auth + scoped RLS cutover.
-- DO NOT RUN until every active public.users row has auth_user_id populated,
-- the preview deployment has passed the full role matrix, and a backup exists.

begin;

alter table public.users
  add column if not exists auth_user_id uuid unique references auth.users(id),
  add column if not exists email text;

do $$
begin
  if exists (
    select 1 from public.users
    where status = 'active' and auth_user_id is null
  ) then
    raise exception
      'STOP: active users without auth_user_id. Link all accounts before RLS cutover.';
  end if;
end
$$;

create or replace function public.current_case_myp_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role
  from public.users
  where auth_user_id = auth.uid() and status = 'active'
  limit 1
$$;

create or replace function public.current_case_myp_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select name
  from public.users
  where auth_user_id = auth.uid() and status = 'active'
  limit 1
$$;

create or replace function public.current_case_myp_user_id()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select userid
  from public.users
  where auth_user_id = auth.uid() and status = 'active'
  limit 1
$$;

-- Remove broad legacy policies from the operational tables.
do $$
declare
  rec record;
begin
  for rec in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'cases','bookings','case_followups','case_notes','notifications',
        'standalone_cases','targets','users','profile_images','bank_logos',
        'history','fcm_tokens'
      )
  loop
    execute format('drop policy if exists %I on %I.%I',
      rec.policyname, rec.schemaname, rec.tablename);
  end loop;
end
$$;

create policy "admin manages cases"
  on public.cases for all to authenticated
  using (public.current_case_myp_role() = 'Admin')
  with check (public.current_case_myp_role() = 'Admin');
create policy "sales read assigned cases"
  on public.cases for select to authenticated
  using (sales = public.current_case_myp_name());
create policy "sales update assigned cases"
  on public.cases for update to authenticated
  using (sales = public.current_case_myp_name() and deleted_at is null)
  with check (sales = public.current_case_myp_name() and deleted_at is null);

create policy "admin manages bookings"
  on public.bookings for all to authenticated
  using (public.current_case_myp_role() = 'Admin')
  with check (public.current_case_myp_role() = 'Admin');
create policy "sales read own bookings"
  on public.bookings for select to authenticated
  using (sales = public.current_case_myp_name() and deleted_at is null);

create policy "admin manages standalone cases"
  on public.standalone_cases for all to authenticated
  using (public.current_case_myp_role() = 'Admin')
  with check (public.current_case_myp_role() = 'Admin');

create policy "admin reads users"
  on public.users for select to authenticated
  using (public.current_case_myp_role() = 'Admin' or auth_user_id = auth.uid());
create policy "admin manages users"
  on public.users for all to authenticated
  using (public.current_case_myp_role() = 'Admin')
  with check (public.current_case_myp_role() = 'Admin');

-- Child tables inherit access from the related assigned case.
create policy "case notes by assigned case"
  on public.case_notes for all to authenticated
  using (
    public.current_case_myp_role() = 'Admin'
    or exists (
      select 1 from public.cases c
      where c.caseid = case_notes.caseid
        and c.sales = public.current_case_myp_name()
        and c.deleted_at is null
    )
  )
  with check (
    public.current_case_myp_role() = 'Admin'
    or exists (
      select 1 from public.cases c
      where c.caseid = case_notes.caseid
        and c.sales = public.current_case_myp_name()
        and c.deleted_at is null
    )
  );

create policy "followups by assigned case"
  on public.case_followups for all to authenticated
  using (
    public.current_case_myp_role() = 'Admin'
    or exists (
      select 1 from public.cases c
      where c.caseid = case_followups.caseid
        and c.sales = public.current_case_myp_name()
        and c.deleted_at is null
    )
  )
  with check (
    public.current_case_myp_role() = 'Admin'
    or exists (
      select 1 from public.cases c
      where c.caseid = case_followups.caseid
        and c.sales = public.current_case_myp_name()
        and c.deleted_at is null
    )
  );

create policy "history by assigned case"
  on public.history for all to authenticated
  using (
    public.current_case_myp_role() = 'Admin'
    or exists (
      select 1 from public.cases c
      where c.caseid = history.caseid
        and c.sales = public.current_case_myp_name()
    )
  )
  with check (
    public.current_case_myp_role() = 'Admin'
    or exists (
      select 1 from public.cases c
      where c.caseid = history.caseid
        and c.sales = public.current_case_myp_name()
    )
  );

create policy "notifications scoped to recipient"
  on public.notifications for all to authenticated
  using (
    public.current_case_myp_role() = 'Admin'
    or sales = public.current_case_myp_name()
  )
  with check (
    public.current_case_myp_role() = 'Admin'
    or sales = public.current_case_myp_name()
  );

create policy "admin manages targets"
  on public.targets for all to authenticated
  using (public.current_case_myp_role() = 'Admin')
  with check (public.current_case_myp_role() = 'Admin');
create policy "sales read own targets"
  on public.targets for select to authenticated
  using (sales_name = public.current_case_myp_name());

create policy "authenticated read profile images"
  on public.profile_images for select to authenticated using (true);
create policy "admin manages profile images"
  on public.profile_images for all to authenticated
  using (public.current_case_myp_role() = 'Admin')
  with check (public.current_case_myp_role() = 'Admin');

create policy "authenticated read bank logos"
  on public.bank_logos for select to authenticated using (true);
create policy "admin manages bank logos"
  on public.bank_logos for all to authenticated
  using (public.current_case_myp_role() = 'Admin')
  with check (public.current_case_myp_role() = 'Admin');

create policy "users manage own push token"
  on public.fcm_tokens for all to authenticated
  using (
    public.current_case_myp_role() = 'Admin'
    or userid = public.current_case_myp_user_id()
  )
  with check (
    public.current_case_myp_role() = 'Admin'
    or userid = public.current_case_myp_user_id()
  );

-- Legacy plaintext passwords are removed only after Auth login succeeds.
alter table public.users alter column password drop not null;
update public.users set password = null;
revoke select on public.users from anon, authenticated;
grant select (
  userid, username, name, role, status, avatar, startdate, auth_user_id, email
) on public.users to authenticated;
revoke all on public.market, public.claimedcases from anon, authenticated;

commit;
