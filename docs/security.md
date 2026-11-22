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

## Database and API security
- Enable RLS on all user-owned tables before adding real data.
- Policies must scope operations to the verified authenticated user.
- Derive user identity from the verified Supabase JWT, never from a request body field.
- Validate input on server/database boundaries.
- Use parameterized queries; do not concatenate user input into SQL.
- Apply request size limits, rate limits, and AI usage controls.
- Keep service-role usage inside trusted server functions and use it only when strictly required.
- Marking a recurring bill paid and linking/creating its expense must be atomic and protected against duplicate occurrence records.

## AI privacy and prompt safety
- Send only minimum necessary aggregates/records to answer the user's current request.
- Do not send credentials, authentication tokens, or unnecessary identifiers.
- Avoid sending raw transaction descriptions unless directly needed; if included, delimit them as untrusted data.
- Treat transaction descriptions, notes, and user-provided content as data, never as instructions that override system policy.
- Treat model output as untrusted; render safely and never execute code, SQL, or tool instructions from model text.
- AI may provide spending insights, budget/savings recommendations, forecast explanations, and conversational budgeting Q&A only.
- AI cannot mutate financial records or initiate payments in the MVP.
- Explain uncertainty and do not present output as regulated financial, investment, tax, or legal advice.

## Logging and incident response
- Do not log secrets, access tokens, raw request headers, or unnecessary financial details.
- Return generic client errors; keep safe diagnostic context server-side.
- On suspected exposure: stop use, rotate credentials, review audit/history, revoke sessions/tokens if applicable, and document remediation.
