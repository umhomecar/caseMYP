-- Line OA monthly case codes. Apply to the CaseMYP database before deploying the UI.
-- Existing rows retain their IDs, names, report text, and timestamps.
begin;

alter table public.standalone_cases
  add column if not exists case_code text;

-- Backfill historical Line OA rows in their original creation month (Bangkok time).
-- A deleted case retains its number; no case number is ever reused.
with numbered as (
  select id,
    to_char(created_at at time zone 'Asia/Bangkok', 'YYMM') as period,
    row_number() over (
      partition by to_char(created_at at time zone 'Asia/Bangkok', 'YYMM')
      order by created_at, id
    ) as seq
  from public.standalone_cases
  where case_type = 'line_oa' and case_code is null
)
update public.standalone_cases s
set case_code = 'L' || n.period ||
  case when n.seq < 1000 then lpad(n.seq::text, 3, '0') else n.seq::text end
from numbered n where s.id = n.id;

create unique index if not exists standalone_cases_line_oa_case_code_uniq
  on public.standalone_cases (case_code)
  where case_type = 'line_oa' and case_code is not null;

-- Generation happens atomically inside the INSERT transaction, not in JavaScript.
-- The existing table INSERT policy remains the authorization boundary.
create or replace function public.assign_standalone_line_oa_case_code()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  period text;
  seq bigint;
begin
  if TG_OP = 'UPDATE' then
    -- Make the assigned case code immutable, including on soft deletion/restoration.
    NEW.case_code := OLD.case_code;
    return NEW;
  end if;

  if NEW.case_type <> 'line_oa' then
    NEW.case_code := null;
    return NEW;
  end if;

  -- Use the database clock in Thailand, not a device's local time.
  period := to_char(statement_timestamp() at time zone 'Asia/Bangkok', 'YYMM');

  -- Serialize concurrent inserts within the same month.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('caseMYP:line_oa:' || period, 0));

  select coalesce(max(substring(case_code from 6)::bigint), 0) + 1
    into seq
  from public.standalone_cases
  where case_type = 'line_oa'
    and case_code like ('L' || period || '%')
    and case_code ~ '^L[0-9]{4}[0-9]+$';

  NEW.case_code := 'L' || period ||
    case when seq < 1000 then lpad(seq::text, 3, '0') else seq::text end;
  return NEW;
end;
$$;

revoke all on function public.assign_standalone_line_oa_case_code() from public;
revoke all on function public.assign_standalone_line_oa_case_code() from anon, authenticated;

drop trigger if exists trg_standalone_line_oa_case_code on public.standalone_cases;
create trigger trg_standalone_line_oa_case_code
before insert or update on public.standalone_cases
for each row execute function public.assign_standalone_line_oa_case_code();

alter table public.standalone_cases
  add constraint standalone_cases_line_oa_code_required
  check (case_type <> 'line_oa' or case_code is not null);

commit;
