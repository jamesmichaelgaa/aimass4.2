# Architecture Notes — aimass4.2

## 1. Product context
aimass4.2 is an AI-assisted personal budgeting web application for Filipino employees and young professionals with monthly or biweekly income. MVP includes manual tracking, budgets, recurring bills with in-app reminders, payday cash-flow forecasting, and four AI capabilities: spending insights, budget/savings recommendations, forecast explanations, and conversational budgeting Q&A.

Subscription pricing, PDF reports, email/push reminders, bank integrations, and automatic AI categorization are deferred.

## 2. Technology choices
- **Frontend and hosting:** Bolt-generated React + TypeScript + Vite application; Bolt Hosting is the initial deployment target.
- **Backend/database:** Supabase PostgreSQL, Auth, Row Level Security, and Edge Functions.
- **AI:** OpenAI API called only by a trusted server-side Edge Function.
- **Source control:** GitHub is the source of truth.
- **Engineering agent:** Codex follows AGENTS.md, adds tests, and reviews changes.
- **CI:** GitHub Actions for lint, typecheck, tests, and build after package scripts exist.

## 3. System overview
```text
User
  |
  v
Bolt-hosted React + TypeScript client
  |                         |
  | authenticated CRUD      | authenticated AI request
  v                         v
Supabase Auth          Supabase Edge Function
  |                         |
  v                         v
PostgreSQL + RLS          OpenAI API
  |
  +-- profiles and cash positions
  +-- monthly/biweekly income schedules
  +-- user-owned income/expense categories and transactions
  +-- monthly budgets
  +-- recurring bills and paid occurrences

GitHub: source, docs, migrations, tests, CI
Codex: repository-aware implementation and review
```

## 4. Main components

### 4.1 Web client
- Handles presentation, navigation, user input, and authenticated Supabase calls.
- Displays transactions, budgets, bills, cash position, payday forecast, and AI responses.
- Client validation improves usability but is not a security boundary.
- Never contains OpenAI API keys or Supabase service-role credentials.

### 4.2 Supabase Auth and PostgreSQL
- Auth establishes user identity and session.
- PostgreSQL stores profiles, one cash position per user, one active monthly/biweekly salary schedule per user, user-owned categories, transactions, budgets, recurring bills, and paid bill occurrences.
- Default categories are created for each user during trusted account initialization. There are no globally shared category rows in the MVP.
- RLS enforces ownership at the database boundary; constraints/triggers and trusted database operations enforce cross-table ownership and category-kind rules.
- SQL migrations are the canonical schema history.
- Monetary values use PostgreSQL numeric types. The MVP uses one preferred currency per user and does not perform currency conversion.

### 4.3 In-app bill reminders and payment recording
- Recurring bill records store frequency and next due date.
- The application queries the user's active bills and derives upcoming/overdue states.
- Reminders appear in the dashboard and bills screen when the user opens the application. No email, push, or scheduled delivery service is required for MVP.
- A bill occurrence is marked paid through one secure database function/RPC.
- That operation verifies ownership and, atomically, creates or links one expense transaction, inserts one payment record, and advances the bill's next due date. A failure rolls back the entire operation.
- Unique constraints protect the bill occurrence and prevent one expense transaction from being linked to multiple bill payments.
- Deactivate bills instead of deleting records with payment history; preserve historical payments and transactions.
- Weekly recurrence advances by seven days. Monthly, quarterly, and yearly recurrence advances by calendar periods and clamps a missing day to the destination month's last day.

### 4.4 Payday and cash-flow forecast
- Deterministic application/database logic calculates the estimate through the next expected payday.
- The cash position is treated as the closing balance on its as-of date. Only transactions dated after that date are added to the forecast.
- The forecast cutoff is the next expected payday, inclusive; the expected salary on that date is included and labelled as expected income, not received.
- Include unpaid recurring bill occurrences due after the cash-position date and through the cutoff. Paid occurrences are represented by their linked expense transactions and must not be subtracted a second time.
- Reconcile an expected salary occurrence against an actual salary transaction for the same payday to prevent duplicate income. Define and test the matching rule before release.
- Clearly expose date range, source inputs, expected income, recorded activity, unpaid bills, assumptions, and estimated remaining cash.
- AI may explain the result but cannot recalculate, overwrite, or invent authoritative amounts.

### 4.5 AI Edge Function
- Implemented 2026-11-22 as `ai-assistant` (`supabase/functions/ai-assistant/`), deployed with `verify_jwt = true`.
- Verify caller's Supabase JWT and derive user identity from verified claims: done — the gateway enforces the JWT, the function additionally verifies it via `auth.getUser()` and reads data with a client that carries the caller's token, so RLS scopes every read to the verified user. The service-role key is not used for user data.
- Validate payload, enforce request limits, and rate-limit AI usage: done — schema/type validation, 2000-char message cap, 6-turn history cap, 700-token completion cap, 45s upstream timeout, 10 requests/minute per user (in-memory; per-instance, reset on redeploy/scale).
- Retrieve only minimal data belonging to the authenticated user: done — aggregates only (month totals, top categories, budget progress, active bills, schedule, cash position); no raw transaction descriptions are sent to the provider.
- Send only relevant summaries to OpenAI; never send credentials, access tokens, or unnecessary identifiers: done.
- Support: spending insights, budget/savings recommendations, forecast explanations, and conversational budgeting Q&A: insights, recommendations, and Q&A are live behind the Assistant page; forecast explanations are implemented end-to-end at the prompt layer but remain disabled until the Phase 3 forecast runtime verification passes (see docs/ai-agent-spec.md §9b).
- Treat transaction notes and other user-controlled text as untrusted content: done — names are length-bounded and sanitized, data is fence-delimited, and the system prompt declares the fence as data.
- Treat model output as untrusted; render safely and never execute generated code or SQL: done — the reply is a JSON string rendered as text.
- AI is read-only in MVP and cannot modify any financial records: enforced structurally — the function performs SELECT-only queries and takes no write path.

### 4.6 Account Deletion Edge Function
- Implemented 2026-11-22 as `delete-account` (`supabase/functions/delete-account/`), deployed with `verify_jwt = true`.
- Verify caller's Supabase JWT and derive user identity from verified claims: done — the gateway enforces the JWT, the function additionally verifies it via `auth.getUser()`, and the deleted user id is taken only from the verified token, never from the request body. A user therefore can only ever delete their own account; cross-user deletion is structurally impossible.
- Re-authentication happens in the client before the call: the user re-enters their password and signs in again; the fresh session's token is what the function receives. A stolen idle session alone is not enough to destroy an account.
- The deletion itself uses the Supabase Admin API (`auth.admin.deleteUser`) with the service-role key read from Deno.env on the server — the key is never exposed to the frontend, logged, or included in responses.
- Data deletion relies on the schema's own foreign keys: every user-owned table (`profiles`, `categories`, `transactions`, `budgets`, `cash_positions`, `income_schedules`, `recurring_bills`, `bill_payments`) has `user_id REFERENCES auth.users(id) ON DELETE CASCADE`, so deleting the auth user removes all of that user's rows atomically in one database-enforced cascade. Cross-table RESTRICT FKs (transactions→categories, budgets→categories, recurring_bills→categories, bill_payments→transactions/recurring_bills) reference rows belonging to the same user, so they never block the cascade. Categories are per-user rows (including each user's `is_system` defaults); deleting a user removes their copies and leaves every other user's categories intact. No views or materialized views exist that could be orphaned.
- After the admin delete the function best-effort revokes the user's refresh tokens (`auth.admin.signOut`); failure there is logged and non-fatal because the user row no longer authorizes anything.
- Responses are generic; detail goes to the console only.

## 5. Key data flow
1. User authenticates with Supabase Auth.
2. Trusted account initialization creates the user's profile and default categories.
3. Client reads/writes allowed records; RLS enforces ownership.
4. Transactions and budgets update dashboard aggregates.
5. Recurring bill due dates drive in-app upcoming/overdue reminders.
6. A bill-payment RPC records the payment and linked expense atomically.
7. Forecast logic combines the user's cash position, salary schedule, transactions, and unpaid bill occurrences.
8. Client sends a question or selected AI task to the authenticated Edge Function.
9. Function verifies identity, retrieves minimal relevant data, calls OpenAI, and returns a grounded response.
10. User reviews the response and remains responsible for all changes.

## 6. Security and privacy
- Enable RLS on every user-owned table.
- Never trust client-supplied user IDs.
- Keep OpenAI and service-role secrets server-side.
- Do not put secrets in VITE_ variables.
- Minimize data sent to AI; never send credentials or auth tokens.
- Avoid logging transaction descriptions and sensitive financial details.
- Test cross-user isolation, prompt injection, authorization, category ownership, and atomic bill payment.
- See docs/security.md and docs/ai-agent-spec.md.

## 7. Environments and deployment
- Use separate development and production Supabase projects when practical.
- Bolt Hosting serves the frontend.
- Supabase hosts database, auth, and Edge Functions.
- Configure public frontend settings separately from server-side secrets.
- Apply migrations deliberately and verify RLS before real users enter data.
- GitHub Actions should run quality checks before merge/deployment.

## 8. Deferred architecture
- Subscription/payment provider and premium entitlements.
- PDF generation/export.
- Email/push notification delivery.
- Bank/e-wallet integrations and automatic transaction categorization.
- Weekend/holiday salary date adjustment.
- Savings-goal and contribution tables, forecast snapshots, and notification-delivery history.
