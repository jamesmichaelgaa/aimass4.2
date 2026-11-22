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
  +-- income/expense transactions and categories
  +-- monthly budgets
  +-- recurring bills and paid occurrences
  +-- optional savings goals if retained after schema review

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
- PostgreSQL stores profiles, cash position/as-of date, salary schedules, transactions, categories, budgets, recurring bills, and paid bill occurrences.
- RLS enforces ownership at the database boundary.
- SQL migrations are the canonical schema history.
- Monetary values use PostgreSQL numeric types.

### 4.3 In-app bill reminders
- Recurring bill records store frequency and next due date.
- The application queries the user's active bills and derives upcoming/overdue states.
- Reminders appear in the dashboard and bills screen when the user opens the application.
- No email, push, or scheduled delivery service is required for MVP.
- A bill occurrence is marked paid through an explicit user action. Link it to one expense transaction or create that transaction atomically through a safe database operation to prevent double counting.
- Use a unique bill-occurrence identity (bill + due date) to prevent duplicate payment records.

### 4.4 Payday and cash-flow forecast
- Deterministic application/database logic calculates the estimate through the next expected payday.
- Inputs: user-entered cash position and as-of date, recorded transactions after that date, expected monthly/biweekly salary, and unpaid recurring bill occurrences due within the forecast period.
- Monthly recurrence uses calendar-month progression; biweekly recurrence advances by 14 days.
- For a monthly payday that does not exist in a given month, use that month's last calendar day. Weekend/holiday adjustments are not in MVP.
- Clearly expose date range, source inputs, expected income, unpaid bills, and estimated remaining cash.
- AI may explain the result but cannot recalculate, overwrite, or invent authoritative amounts.

### 4.5 AI Edge Function
- Verify caller's Supabase JWT and derive user identity from verified claims.
- Validate payload, enforce request limits, and rate-limit AI usage.
- Retrieve only minimal data belonging to the authenticated user.
- Send only relevant summaries to OpenAI; never send credentials, access tokens, or unnecessary identifiers.
- Support: spending insights, budget/savings recommendations, forecast explanations, and conversational budgeting Q&A.
- Treat transaction notes and other user-controlled text as untrusted content.
- Treat model output as untrusted; render safely and never execute generated code or SQL.
- AI is read-only in MVP and cannot modify any financial records.

## 5. Key data flow
1. User authenticates with Supabase Auth.
2. Client reads/writes allowed records; RLS enforces ownership.
3. Transactions and budgets update dashboard aggregates.
4. Recurring bill due dates drive in-app upcoming/overdue reminders.
5. Forecast logic combines the user's cash position, salary schedule, transactions, and unpaid bill occurrences.
6. Client sends a question or selected AI task to the authenticated Edge Function.
7. Function verifies identity, retrieves minimal relevant data, calls OpenAI, and returns a grounded response.
8. User reviews the response and remains responsible for all changes.

## 6. Security and privacy
- Enable RLS on every user-owned table.
- Never trust client-supplied user IDs.
- Keep OpenAI and service-role secrets server-side.
- Do not put secrets in VITE_ variables.
- Minimize data sent to AI; never send credentials or auth tokens.
- Avoid logging transaction descriptions and sensitive financial details.
- Test cross-user isolation, prompt injection, and authorization.
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
