# Architecture Notes — aimass4.2

## 1. Product context
aimass4.2 is an AI-assisted personal budgeting application for Filipino employees and young professionals with regular monthly or biweekly income. The MVP focuses on manual tracking, budgets, recurring bill reminders, payday forecasting, and AI spending insights. Bank/e-wallet integrations are excluded from MVP.

## 2. System overview
```text
User
  |
  v
Bolt-hosted React + TypeScript web application
  |                         |
  | Supabase session        | authenticated AI request
  v                         v
Supabase Auth          Supabase Edge Function
  |                         |
  v                         v
PostgreSQL + RLS         OpenAI API
  |
  +-- profiles and salary schedules
  +-- income/expense transactions
  +-- categories and budgets
  +-- recurring bills and reminders
  +-- forecast inputs/snapshots (if needed)
  +-- savings goals (MVP scope subject to prioritization)

GitHub stores source, docs, migrations, tests, and CI.
Codex implements/reviews code following AGENTS.md.
```

## 3. Technology choices
- **Frontend/hosting:** Bolt-generated React + TypeScript + Vite application; Bolt Hosting is the initial preferred deployment target for simplicity.
- **Backend/database:** Supabase PostgreSQL, Auth, RLS, and Edge Functions.
- **AI:** OpenAI API called only by a trusted server-side Edge Function.
- **Source control:** GitHub is the source of truth.
- **Engineering agent:** Codex follows AGENTS.md, adds tests, and reviews changes.
- **CI:** GitHub Actions for lint, typecheck, tests, and build once scripts are established.

## 4. Main components
### Web client
- Handles presentation, navigation, user input, and authenticated Supabase calls.
- Displays transaction, budget, bill, and forecast information.
- Client-side checks improve usability but are not security controls.
- Never contains OpenAI API keys or Supabase service-role credentials.

### Supabase Auth and PostgreSQL
- Auth establishes the user identity.
- PostgreSQL stores user profiles, pay schedules, transactions, categories, budgets, recurring bills, and reminder state.
- RLS enforces ownership at the database boundary.
- Use migrations as the canonical schema history.
- Store money as PostgreSQL numeric values.

### Recurring bill and reminder processing
- Store recurrence rule, next due date, amount, and status separately from paid transactions.
- A bill becomes a paid expense only through an explicit user action or verified workflow.
- Prevent duplicate expense creation when a bill is marked paid.
- In-app reminders can be derived from upcoming due dates at read time for MVP; scheduled email/push delivery is a later enhancement unless specifically approved.

### Payday forecast service
- Calculate estimates using user-entered starting balance, salary schedule, recorded transactions, and upcoming recurring obligations through the next expected payday.
- Clearly expose the date range and assumptions.
- Keep calculation logic deterministic and testable; AI may explain the result but must not invent or replace numeric calculations.
- Treat forecast output as an estimate, not a guaranteed balance.

### AI Edge Function
- Verify the caller's Supabase JWT and derive user identity from it.
- Validate request payload and rate-limit requests.
- Retrieve only relevant user-scoped aggregates and records.
- Minimize sensitive context before sending to OpenAI.
- Keep provider key in Supabase Edge Function secrets.
- Treat transaction notes and other user-controlled content as untrusted.
- Return constrained explanatory text; never execute model-generated code or SQL.
- MVP assistant is read-only and cannot mutate financial records.

## 5. Data flow
1. User authenticates with Supabase Auth.
2. Client reads/writes permitted records; PostgreSQL RLS enforces ownership.
3. Transactions and budgets update dashboard summaries.
4. Forecast logic combines manually entered balance, pay schedule, transactions, and upcoming bills for the selected forecast window.
5. AI request is sent to an authenticated Edge Function.
6. Function retrieves minimal relevant user data, calls OpenAI, and returns an explanation or recommendation.
7. User remains in control of all changes.

## 6. Security and privacy
- Enable RLS for every user-owned table.
- Do not trust client-provided user IDs.
- Keep privileged keys and provider secrets server-side.
- Do not put secrets in VITE_ variables.
- Minimize data sent to AI; never send auth tokens or credentials.
- Avoid logging transaction descriptions and sensitive financial details.
- Test cross-user isolation and prompt-injection handling.
- See docs/security.md.

## 7. Deployment and environments
- Use a separate development Supabase project and production project when practical.
- Bolt Hosting serves the web frontend.
- Supabase hosts database, auth, and Edge Functions.
- Configure public frontend environment variables separately from server-side secrets.
- Apply migrations deliberately and verify RLS before real users enter data.
- CI should run quality checks before changes are merged/deployed.

## 8. Open technical decisions
- Exact schedule model for monthly/biweekly payroll and edge cases around weekends/holidays.
- Whether to persist forecast snapshots or calculate on demand.
- Reminder delivery mechanism beyond in-app reminders.
- Whether savings goals are included in MVP.
- Whether PDF reports and premium subscription are launch requirements.
