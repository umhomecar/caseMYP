-- CASE_MYP LINE recipients
-- Separates "ผู้ส่งเคส" (เกมส์ / อาท) from salesperson accounts in public.users.
-- Safe additive migration: no existing rows are deleted or changed.

begin;

create table if not exists public.line_recipients (
  sender_name text primary key,
  line_user_id text unique,
  active boolean not null default true,
  registered_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint line_recipients_sender_name_check
    check (sender_name in ('เกมส์', 'อาท')),
  constraint line_recipients_user_id_check
    check (
      line_user_id is null
      or line_user_id ~ '^U[0-9A-Fa-f]{32}$'
    )
);

insert into public.line_recipients (sender_name)
values ('เกมส์'), ('อาท')
on conflict (sender_name) do nothing;

alter table public.line_recipients enable row level security;

-- This table contains stable LINE user IDs and is server-only.
-- Browser clients must never read or modify it.
revoke all on table public.line_recipients from public, anon, authenticated;
grant select, insert, update on table public.line_recipients to service_role;

comment on table public.line_recipients is
  'Server-only LINE 1:1 destinations for CASE_MYP case senders; independent of salesperson users.';
comment on column public.line_recipients.sender_name is
  'Logical case sender name, currently เกมส์ or อาท.';
comment on column public.line_recipients.line_user_id is
  'LINE Messaging API userId learned from a verified webhook registration event.';

commit;

select sender_name, active, line_user_id is not null as registered
from public.line_recipients
order by sender_name;
