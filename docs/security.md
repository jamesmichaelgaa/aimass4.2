# Security Policy — aimass4.2

## Security principles
1. Secrets stay in trusted secret stores, never in frontend bundles or Git.
2. Treat the browser and all client-provided values as untrusted.
3. Enforce authorization in PostgreSQL RLS and verified server-side functions.
4. Minimize financial data shared with third-party AI services.
5. AI functionality is read-only in the MVP.

## Secret storage
| Value | Correct location | Browser exposure |
|---|---|---|
| OpenAI API key | Supabase Edge Function secret manager | Never |
| Supabase service-role key | Trusted server environment only | Never |
| Database password/connection string | Supabase or trusted server secret store | Never |
| Supabase project URL | Frontend environment config | Public |
| Supabase anon/publishable key | Frontend environment config | Public identifier; RLS is mandatory |

Do not put secrets in `VITE_*` variables. Any variable bundled by a frontend build is public.

## Git safeguards
- Commit `.env.example` with placeholder values only.
- Ignore `.env`, `.env.local`, `.env.*.local`, private keys, certificates, credential files, and local Supabase secret files.
- Enable GitHub secret scanning and push protection where available.
- Review diffs before pushing.
- Never paste secrets into chat, prompts, issues, PRs, screenshots, or documentation.
- If a secret is exposed, rotate/revoke it immediately; investigate history and downstream usage.

## Database authorization and RLS
- Enable RLS on every user-owned table before adding real data.
- Use owner-scoped policies: `user_id = (select auth.uid())` for owned records and `id = (select auth.uid())` for profiles.
- Derive identity from the verified Supabase JWT; never trust a user ID supplied in a request body or query parameter.
- Review SQL grants as well as RLS policies. RLS does not grant table privileges by itself.
- Deny direct client writes to `bill_payments`; use only the dedicated atomic payment function.
- Default categories are user-owned rows, not globally shared records.
- Validate category ownership and category kind for transactions, budgets, and bills.
- Validate that bill-payment records, bills, and linked expense transactions belong to the same user.
- Use constraints, composite foreign keys, and narrowly scoped database functions/triggers for cross-table integrity.
- Use a hardened `SECURITY DEFINER` function only when necessary: fix its `search_path`, schema-qualify objects, derive identity from `auth.uid()`, validate ownership, avoid dynamic SQL, and grant execution narrowly.
- See `docs/database-schema.md` and `docs/sql-migration-plan.md` for the approved schema and policy model.

## Database operations
- Use separate development and production Supabase projects when practical.
- Never commit database passwords, access tokens, service-role keys, or local Supabase secret files.
- Apply reviewed migrations through a controlled workflow; do not edit production schema manually as the normal process.
- Back up production data and document recovery procedures before launch.
- Do not log secrets, access tokens, raw request headers, or unnecessary financial details.

## AI privacy and prompt safety
- Send only minimum necessary aggregates/records to answer the user's current request.
- Do not send credentials, authentication tokens, or unnecessary identifiers.
- Avoid sending raw transaction descriptions unless directly needed; if included, delimit them as untrusted data.
- Treat transaction descriptions, notes, and user-provided content as data, never as instructions that override system policy.
- Treat model output as untrusted; render safely and never execute code, SQL, or tool instructions from model text.
- AI may provide spending insights, budget/savings recommendations, forecast explanations, and conversational budgeting Q&A only.
- AI cannot mutate financial records or initiate payments in the MVP.
- Explain uncertainty and do not present output as regulated financial, investment, tax, or legal advice.
- Implemented 2026-11-22 (ai-assistant Edge Function): JWT verified twice (gateway `verify_jwt` plus `auth.getUser()` in the function); all database reads run under the caller's own token via RLS — the service-role key is never used for user data. Category/bill names sent to the provider are length-bounded (60 chars) with control characters and code-fence markers stripped, then passed inside `=== USER DATA START/END ===` markers the system prompt declares as untrusted data. No transaction descriptions leave the server. The model reply is returned as a JSON string and rendered as plain text, never HTML. Errors return generic messages; specifics go to the server console only. Per-user rate limit of 10 requests/minute with a distinct, non-revealing 429 message.

## Logging and incident response
- Return generic client errors; keep safe diagnostic context server-side.
- On suspected exposure: stop use, rotate credentials, review audit/history, revoke sessions/tokens if applicable, and document remediation.
