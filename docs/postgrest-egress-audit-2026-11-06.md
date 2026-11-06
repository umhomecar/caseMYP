# CaseMYP PostgREST Egress audit — 2026-11-06

## Verified findings (read-only)

- Supabase project: umMYP (`lhmycnzarbcmweavhnxh`), organization `umhomecar`.
- Organization billing Egress: 8.10 GB against a 5 GB Free quota, as seen in dashboard screenshots; grace period ends 2026-11-14.
- 2026-11-02 breakdown: 1.325 GB in PostgREST Egress (100% that day).
- 2026-11-02 edge logs: 247 GET requests to `/rest/v1/cases` (plus 107 OPTIONS).
- Of those GET requests, 152 were unfiltered `?deleted_at=is.null&order=caseid.desc`, and 16 were `?deleted_at=is.null&order=updatedat.desc`.
- Logs show the app requesting all case columns by default and using large pagination limits. Response byte totals per endpoint have **not** been verified.

## Proposed safe code changes (not yet applied)

In `js/app.jsx`:
1. `checkCaseDuplicates`: add `select: 'caseid,customername,contact'` to avoid loading unused case fields. Preserve its current matching logic.
2. `getDashboard`: add `select: 'sales,status'` to its GET from `cases`; these are the only fields the dashboard aggregation references.
3. Replace the new-case preview's `getCases({all:'true'})` call with a targeted `getCaseIdPreview` API action which queries only `caseid`, sorted descending and limited to one row for the selected monthly prefix. Keep actual case ID generation and collision handling unchanged.

## Validation required before merge

- Run `npm run check` and inspect the generated preview.
- Validate Thai monthly case IDs, backdated-month preview, duplicate detection, admin/sales dashboards, current/history search, create/update/booking and notifications.
- Confirm the new preview query retrieves a single `caseid` and the duplicate/dashboard queries select fewer columns.
- Check Supabase Usage the next day; historical billed Egress will not be erased by a code fix.
- Confirm production runtime config points to the intended Supabase project before rollout.

No database, storage, policies, migrations, production deployment, or records were modified.
