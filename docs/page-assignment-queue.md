# CaseMYP — Page case assignment queue (staged, NOT enabled)

## Confirmed operating rule (2026-11-02)
- Thailand local time Asia/Bangkok, **10:00 inclusive to 17:00 exclusive**.
- Continuous cursor across days; do NOT reset each morning.
- Outside this window assign `รอมอบหมาย` without advancing the cursor.
- Sequence of **15 slots**, repeating forever:
  `1,2,1,3,2,4,1,3,2,5,1,4,3,2,1`
  1=แฟ๊บ (5), 2=บอลเล็ก (4), 3=บอลใหญ่ (3), 4=เพ้นท์ (2), 5=พีร์ (1).
- Manual overrides should not advance the auto-queue. Existing cases must not be retroactively changed.
- Preserve original sender and record the actual assigned sales in case history.

## Safety-critical implementation plan

1. Locate the **actual CaseMYP Supabase project** and inspect `cases`, `users`, RLS, auth mode, history, notification policies and current insertion flow.
2. Create a **database-atomic** case insertion + queue allocation transaction: lock one row of queue state (`SELECT ... FOR UPDATE`), validate Bangkok time on the database server, map the next slot to the real `users.name` values, insert the case, advance cursor only after successful insert, and commit all changes together. Roll back together if any part fails.
3. Do **not** expose a privileged / SECURITY DEFINER queue-advance function to anonymous clients. Implement authenticated server-side authorization or strictly scoped invoker + RLS after verifying production auth. Do not rely on localStorage, a JavaScript counter, or read-then-write client requests.
4. Ensure retries with the same idempotency key cannot create another case or consume another slot. Handle concurrent clients, duplicate IDs, and timezone boundary cases.
5. Respect manual sales selection and backdated entries according to an explicit product policy; never auto-assign historical cases without user authorization.
6. Validate all five sales names exist exactly in production `users` (user list previously may show different names); if any are absent, fail closed to `รอมอบหมาย` with an actionable warning.
7. Show current slot and next assignee to authorized admins; audit queue moves.
8. Test 15 sequential inserts, 16th wrap, simultaneous inserts, 09:59/10:00/16:59/17:00 boundaries, crossing midnight, retry and failure rollback, before enabling production.

## Deployment gate
**Do not merge into main or turn on auto-assignment** until the real CaseMYP database is accessible and above tests pass. Current connected Supabase accounts only showed unrelated projects, so the queue cannot safely be installed in production at this time.

## Database verification — 2026-11-02
- Connected project account: Umhomecar, project `umMYP` (`lhmycnzarbcmweavhnxh`), active.
- Verified real schema via Supabase `list_tables`: `public.cases` (~1633 rows), `public.users` (~10), `public.history`, `public.notifications`. All reported with RLS enabled. `cases.caseid` is text PK; `cases.sales` text; `cases.version` integer; `users.name`, `users.role`, `users.status` exist.
- SQL inspection via `execute_sql` is currently blocked by tool security validation. Do not assume verified exact sales names/production connection solely from table existence.
- No SQL migrations applied, no live records modified, no auto-assignment activated.
- **Critical access:** client supports legacy auth using public Supabase anon key; do not expose security-definer RPC to untrusted clients. Verify actual auth and RLS before choosing architecture and enabling queue.
