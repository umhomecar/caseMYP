# CaseMYP-New secure login gateway (draft)

Scope: ONLY isolated Supabase project `vujcmmnnakqqjiejavfs`. Do not merge or deploy to the original CaseMYP Production without a separate review.

## Why
Legacy browser code sends `username` and `password` in a Supabase REST URL. The new project correctly denies `anon` access to `public.users`. Adding `GRANT SELECT ON users TO anon` is not safe: that could expose account credentials.

## Changes
- Server-side `/api/casemyp-gateway` verifies the existing legacy username/password.
- HTTP-only Secure SameSite=Strict signed session cookie (8-hour absolute expiry); passwords never returned to browsers or included in their Supabase URLs.
- Browser Supabase REST reads/writes are routed to the server API **only when** `CASEMYP_SECURE_GATEWAY=true` and the build points to the isolated new project.
- Gateway whitelists tables, confirms origin, checks sessions against active users, hides password columns.
- Admin requests can use the gateway; Sales writes are deliberately blocked pending a complete ownership/role authorization review. **This is not yet ready for live employee use.**

## Preview environment variables (server only)
- `CASEMYP_SUPABASE_URL=https://vujcmmnnakqqjiejavfs.supabase.co`
- `CASEMYP_SUPABASE_SECRET_KEY` or `CASEMYP_SUPABASE_SERVICE_ROLE_KEY` — configure in Vercel only; never copy into git/browser.
- `CASEMYP_SESSION_SECRET` — 32+ cryptographically random characters, server-only.
- `CASEMYP_SECURE_GATEWAY=true`
- `CASEMYP_AUTH_MODE=legacy`
- Existing `CASEMYP_SUPABASE_ANON_KEY` still used for the existing Supabase client configuration; must point to the new project.

Do not enable the gateway without strict rate limiting at the Vercel edge for `/api/casemyp-gateway` to mitigate password guessing. Plaintext legacy passwords should ultimately be migrated to a salted password hash or Supabase Auth without forcibly changing the user-facing login workflow.

## Required pre-release work
1. Verify serverless function builds and Preview environment variables on the isolated Vercel project.
2. Add persistent login rate limits and smoke-test login / wrong password / expired session / logout.
3. Audit Sales permissions and implement field/row-level authorization for mutations without changing intended case assignment behavior.
4. Review other existing serverless endpoints, including LINE endpoints, for authorization.
5. Exercise UI, queue, notes, history, notifications, and LINE OA on isolated Preview. Do not merge/deploy over original Production.
