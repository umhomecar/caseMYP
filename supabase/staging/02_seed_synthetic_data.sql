-- CaseMYP synthetic staging data
-- IMPORTANT: Run only after 01_compatibility_schema.sql in umMYP-staging.
-- Never reuse a real password in this file.
--
-- Before running, replace CHANGE_TO_A_NEW_TEST_ONLY_PASSWORD below with one
-- temporary password used only for these three staging accounts.

begin;

set local case_myp.test_password = 'CHANGE_TO_A_NEW_TEST_ONLY_PASSWORD';

do $$
begin
  -- Safety guard: this constraint exists only in the isolated staging baseline.
  if not exists (
    select 1
    from pg_constraint
    where conname = 'claimedcases_caseid_key'
      and conrelid = 'public.claimedcases'::regclass
  ) then
    raise exception
      'STOP: staging safety marker missing. Do not run this script in production.';
  end if;

  if current_setting('case_myp.test_password')
     like 'CHANGE\_TO\_%' escape '\' then
    raise exception
      'STOP: replace CHANGE_TO_A_NEW_TEST_ONLY_PASSWORD before running.';
  end if;
end
$$;

-- Make the script safely repeatable without touching non-test rows.
delete from public.case_followups
where caseid in ('2607TEST01', '2607TEST02', '2607TEST03');
delete from public.case_notes
where caseid in ('2607TEST01', '2607TEST02', '2607TEST03');
delete from public.bookings
where caseid in ('2607TEST01', '2607TEST02', '2607TEST03');
delete from public.claimedcases
where caseid in ('2607TEST01', '2607TEST02', '2607TEST03');
delete from public.market
where id in ('2607TEST01', '2607TEST02', '2607TEST03');
delete from public.notifications
where caseid in ('2607TEST01', '2607TEST02', '2607TEST03')
   or sales in ('แอดมินทดสอบ', 'เซลส์ทดสอบ A', 'เซลส์ทดสอบ B');
delete from public.history
where caseid in ('2607TEST01', '2607TEST02', '2607TEST03');
delete from public.cases
where caseid in ('2607TEST01', '2607TEST02', '2607TEST03');
delete from public.users
where userid in ('STAGE001', 'STAGE002', 'STAGE003');

insert into public.users (
  userid, username, password, name, role, status, startdate
)
values
  (
    'STAGE001',
    'staging_admin',
    current_setting('case_myp.test_password'),
    'แอดมินทดสอบ',
    'Admin',
    'active',
    '01/07/2026'
  ),
  (
    'STAGE002',
    'staging_sales_a',
    current_setting('case_myp.test_password'),
    'เซลส์ทดสอบ A',
    'Sales',
    'active',
    '01/07/2026'
  ),
  (
    'STAGE003',
    'staging_sales_b',
    current_setting('case_myp.test_password'),
    'เซลส์ทดสอบ B',
    'Sales',
    'active',
    '01/07/2026'
  );

insert into public.cases (
  caseid, customername, contact, report, status, sales,
  createdat, updatedat, sent, market, attachment
)
values
  (
    '2607TEST01',
    'ลูกค้าทดสอบ ปัจจุบัน',
    '000-000-0001',
    'ข้อมูลจำลองสำหรับทดสอบการแก้ไขเคส',
    'รอข้อมูล',
    'เซลส์ทดสอบ A',
    to_char(timezone('Asia/Bangkok', now()), 'DD/MM/YYYY HH24:MI'),
    to_char(timezone('Asia/Bangkok', now()), 'DD/MM/YYYY HH24:MI'),
    'ปกติ',
    false,
    ''
  ),
  (
    '2607TEST02',
    'ลูกค้าทดสอบ เคสรับตลาด',
    '000-000-0002',
    'ข้อมูลจำลองสำหรับทดสอบเคสที่รับจากตลาด',
    'กำลังติดต่อ',
    'เซลส์ทดสอบ B',
    to_char(timezone('Asia/Bangkok', now()) - interval '1 day', 'DD/MM/YYYY HH24:MI'),
    to_char(timezone('Asia/Bangkok', now()), 'DD/MM/YYYY HH24:MI'),
    'ปกติ',
    true,
    ''
  ),
  (
    '2607TEST03',
    'ลูกค้าทดสอบ ตลาดเคส',
    '000-000-0003',
    'ข้อมูลจำลองสำหรับทดสอบการรับเคสจากตลาด',
    'ติดต่อไม่ได้',
    'เซลส์ทดสอบ B',
    to_char(timezone('Asia/Bangkok', now()) - interval '4 days', 'DD/MM/YYYY HH24:MI'),
    to_char(timezone('Asia/Bangkok', now()) - interval '4 days', 'DD/MM/YYYY HH24:MI'),
    'ปกติ',
    true,
    ''
  );

insert into public.market (
  id, name, contact, report, status, old_sales, expiredsales, poolstatus
)
values (
  '2607TEST03',
  'ลูกค้าทดสอบ ตลาดเคส',
  '000-000-0003',
  'ข้อมูลจำลองสำหรับทดสอบการรับเคสจากตลาด',
  'ติดต่อไม่ได้',
  'เซลส์ทดสอบ B',
  'เซลส์ทดสอบ B',
  'เปิด'
);

insert into public.claimedcases (
  caseid, customername, contact, report, status, fromsales,
  sale, newstatus, assignedat, notes
)
values (
  '2607TEST02',
  'ลูกค้าทดสอบ เคสรับตลาด',
  '000-000-0002',
  'ข้อมูลจำลองสำหรับทดสอบเคสที่รับจากตลาด',
  'กำลังติดต่อ',
  'เซลส์ทดสอบ B',
  'เซลส์ทดสอบ A',
  'กำลังติดต่อ',
  to_char(timezone('Asia/Bangkok', now()) - interval '25 hours', 'DD/MM/YYYY HH24:MI'),
  ''
);

insert into public.bookings (
  caseid, sales, customer, facebook, ads, brand, model, plate,
  status, note, createdat
)
values (
  '2607TEST01',
  'เซลส์ทดสอบ A',
  'ลูกค้าทดสอบ ปัจจุบัน',
  'บัญชีทดสอบ',
  'โฆษณาทดสอบ',
  'Toyota',
  'Test Model',
  'ทดสอบ 0001',
  'จองแล้ว',
  'รายการจำลอง ห้ามใช้เป็นข้อมูลจริง',
  to_char(timezone('Asia/Bangkok', now()), 'DD/MM/YYYY HH24:MI')
);

insert into public.case_notes (
  caseid, sales, note, createdat, deletedat
)
values (
  '2607TEST01',
  'เซลส์ทดสอบ A',
  'โน้ตจำลองสำหรับทดสอบเพิ่ม แก้ไข และลบ',
  to_char(timezone('Asia/Bangkok', now()), 'DD/MM/YYYY HH24:MI'),
  null
);

insert into public.case_followups (
  caseid, sales, customername, due_date, note, status,
  createdat, doneat, deletedat, notified_on
)
values (
  '2607TEST01',
  'เซลส์ทดสอบ A',
  'ลูกค้าทดสอบ ปัจจุบัน',
  to_char((timezone('Asia/Bangkok', now()) + interval '1 day')::date, 'YYYY-MM-DD'),
  'นัดติดตามจำลอง',
  'pending',
  to_char(timezone('Asia/Bangkok', now()), 'DD/MM/YYYY HH24:MI'),
  '',
  null,
  ''
);

insert into public.notifications (
  sales, caseid, message, createdat, status
)
values
  (
    'เซลส์ทดสอบ A',
    '2607TEST01',
    '🔔 แจ้งเตือนจำลองสำหรับตรวจสอบหน้าแจ้งเตือน',
    to_char(timezone('Asia/Bangkok', now()), 'DD/MM/YYYY HH24:MI'),
    'unread'
  ),
  (
    'แอดมินทดสอบ',
    '2607TEST03',
    '📢 ข้อมูลทั้งหมดใน Staging เป็นข้อมูลจำลอง',
    to_char(timezone('Asia/Bangkok', now()), 'DD/MM/YYYY HH24:MI'),
    'unread'
  );

insert into public.history (
  caseid, sales, action, detail, createdat
)
values
  (
    '2607TEST01',
    'เซลส์ทดสอบ A',
    'เพิ่มเคส',
    'สร้างข้อมูลจำลองสำหรับ Staging',
    to_char(timezone('Asia/Bangkok', now()), 'DD/MM/YYYY HH24:MI')
  ),
  (
    '2607TEST02',
    'เซลส์ทดสอบ A',
    'รับเคส',
    'รับเคสจำลองจากตลาด',
    to_char(timezone('Asia/Bangkok', now()) - interval '25 hours', 'DD/MM/YYYY HH24:MI')
  ),
  (
    '2607TEST03',
    'เซลส์ทดสอบ B',
    'ส่งตลาด',
    'ส่งเคสจำลองขึ้นตลาด',
    to_char(timezone('Asia/Bangkok', now()) - interval '4 days', 'DD/MM/YYYY HH24:MI')
  );

commit;

select 'users' as object_name, count(*) as row_count
from public.users
where userid like 'STAGE%'
union all
select 'cases', count(*)
from public.cases
where caseid like '%TEST%'
union all
select 'market', count(*)
from public.market
where id like '%TEST%'
union all
select 'claimedcases', count(*)
from public.claimedcases
where caseid like '%TEST%'
union all
select 'bookings', count(*)
from public.bookings
where caseid like '%TEST%'
union all
select 'case_notes', count(*)
from public.case_notes
where caseid like '%TEST%'
union all
select 'case_followups', count(*)
from public.case_followups
where caseid like '%TEST%'
union all
select 'notifications', count(*)
from public.notifications
where caseid like '%TEST%'
union all
select 'history', count(*)
from public.history
where caseid like '%TEST%'
order by object_name;
