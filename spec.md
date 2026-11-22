# aimass4.2 — Product Specification

**Status:** MVP scope finalized for implementation planning  
**Product:** AI-assisted personal budgeting web application  
**Initial audience:** Filipino employees and young professionals with monthly or biweekly salaries  
**Default locale:** PHP (₱), Asia/Manila

## 1. Product vision
Help people understand where their salary goes, manage bills, and make their money last until the next payday through simple expense tracking, practical budgets, clear cash-flow forecasts, and explainable AI assistance.

## 2. Problem statement
People with regular salaries can struggle to monitor everyday expenses, remember upcoming bills, and determine whether their remaining money will last until payday. Expense tracking alone describes past activity but may not help users anticipate obligations or adjust spending before cash runs short.

aimass4.2 combines manual money tracking, spending limits, recurring bill reminders, payday forecasting, and AI-generated budgeting insights in one personal workspace.

## 3. Target users
- Filipino employees and young professionals.
- People paid monthly or biweekly.
- People who want to manually track expenses without connecting bank or e-wallet accounts.
- Users who need reminders and a clearer view of cash available before the next payday.

## 4. Product principles
- Simple enough for frequent everyday use.
- Manual entry first; no bank or e-wallet integrations in the MVP.
- Forecasts must show assumptions and are estimates, not guarantees.
- AI recommendations must be grounded in available user data and explain their reasoning.
- Private by default: each user's financial records are isolated.
- AI assists the user but does not make or execute financial decisions.

## 5. Finalized MVP scope

### 5.1 Account and onboarding
- Sign up, sign in, sign out, and password recovery using Supabase Auth.
- Collect basic profile settings, preferred currency (default PHP), timezone (default Asia/Manila), and salary schedule.
- Support **monthly and biweekly** salary schedules only.
- Allow the user to enter a current cash position / available balance and the date that balance is accurate as of.
- Guide users through entering income schedule, starting balance, recurring bills, and an initial budget.
- No bank credentials or financial account linking.

### 5.2 Salary and payday schedule
- Record expected salary amount, pay frequency (monthly or biweekly), and next expected payday.
- Allow users to update the schedule when salary or payday changes.
- Support additional/manual income entries through transactions.
- Clearly distinguish expected salary from income actually received.
- Monthly schedules use a calendar-day rule; biweekly schedules recur every 14 days. The user can edit the next expected payday.
- If a monthly payday falls on a date unavailable in a shorter month, use the last calendar day of that month for that occurrence. Do not automatically shift for weekends or holidays in the MVP.

### 5.3 Expense and income tracking
- Manually create, view, edit, and delete transactions.
- Fields: type (income/expense), amount, date, category, description/note (optional).
- Use PHP by default; allow preferred currency setting but do not support currency conversion in MVP.
- Validate positive monetary amounts, valid dates, and required fields.
- Filter by date range, type, and category.
- Provide default categories and allow user-defined categories.
- No bank/e-wallet integrations and no automatic AI categorization in MVP.

### 5.4 Budgets and spending limits
- Create an overall monthly spending limit.
- Create category-specific monthly limits.
- Show amount spent, remaining amount, and percentage used.
- Highlight approaching or exceeded limits with clear, non-alarming language.
- Calculate totals from recorded expense transactions, not AI estimates.

### 5.5 Recurring bills and in-app reminders
- Create recurring bills with name, amount, category, next due date, and frequency (weekly, monthly, quarterly, yearly).
- Show upcoming and overdue bills inside the application.
- MVP reminders are **in-app only**. Email and push notifications are out of scope.
- Allow users to mark a bill occurrence as paid and record/link its corresponding expense.
- Prevent duplicate payment records and duplicate expense counting.
- Clearly distinguish a scheduled bill from a paid transaction.
- Reminders are based on due dates and appear in dashboard/bill views; no background email/push delivery is required for MVP.

### 5.6 Payday and cash-flow forecasting
- Estimate available cash through the next expected payday using the user's manually entered cash position and as-of date, recorded transactions after that date, expected salary dates/amounts, and unpaid recurring bill occurrences due in the forecast window.
- Show the forecast period, current balance input date, expected income, upcoming obligations, and estimated remaining amount.
- Warn when projected cash may become insufficient before payday.
- Allow users to correct the cash position and salary/bill inputs.
- Clearly label all forecast values as estimates and expose the assumptions.
- Do not invent bank balances or transactions. The MVP uses only user-entered information and recorded activity.
- Forecast arithmetic is deterministic application logic; AI may explain results but must not calculate or override authoritative totals.

### 5.7 AI budgeting assistant
The MVP includes these four AI capabilities:
1. **Spending insights:** summarize spending patterns, budget progress, and notable changes in recorded activity.
2. **Budget and savings recommendations:** suggest practical adjustments based on user-entered budgets, spending, and stated goals/preferences.
3. **Payday/cash-flow explanations:** explain the deterministic forecast, highlight upcoming bills, and describe possible shortfalls using the forecast data supplied by the server.
4. **Conversational budgeting assistant:** answer natural-language questions about the user's own budgeting data and explain concepts.

Requirements:
- AI requests must go through an authenticated server-side Supabase Edge Function using an OpenAI API key stored as a secret.
- Retrieve only the authenticated user's relevant, minimal data.
- If data is insufficient, say so; never fabricate balances, transactions, or trends.
- The AI assistant is **read-only** in the MVP. It cannot create, edit, delete, mark bills paid, or change budgets.
- Treat transaction notes and user-provided text as untrusted content, not system instructions.
- Clearly identify AI-generated content as general budgeting assistance, not professional financial, tax, investment, or legal advice.
- Do not include automatic expense categorization, autonomous actions, or external financial account integrations in MVP.

### 5.8 Dashboard and reports
- Show cash position and its as-of date, current-period income/expenses/net cash flow, budget progress, upcoming bills, next payday, and a concise forecast.
- Show recent transactions and AI insights when available.
- Provide date filters and clear loading, empty, and error states.
- **PDF reports are deferred until after MVP.** No PDF export is required for initial launch.

### 5.9 Settings
- Profile, preferred currency, timezone, salary schedule, and cash position.
- Manage categories and bill reminder preferences (in-app presentation only).
- Sign out and provide a documented account/data deletion process.

## 6. Monetization decision
- Subscription pricing is **deferred**.
- Do not implement payment processing, subscription management, premium feature gating, or the proposed ₱149/month price in the MVP.
- Build the core product first and validate usage before deciding on pricing.

## 7. Explicitly out of scope for MVP
- Subscription billing, free/premium plans, and payment processing.
- PDF reports/export.
- Email and push notifications.
- Bank/e-wallet integrations and transaction scraping.
- Automatic AI expense categorization.
- Payment execution, credit scoring, lending, investment recommendations, and tax filing.
- Autonomous AI actions or AI-written financial records.
- Shared household budgets and multi-user workspaces.
- Guaranteed balance predictions or automatic weekend/holiday payday adjustment.

## 8. Non-functional requirements
- **Security:** Supabase RLS on all user-owned tables; server-side authorization; least privilege.
- **Secrets:** no OpenAI API key or Supabase service-role key in frontend code, browser storage, Git, or prompts.
- **Privacy:** send only minimum relevant financial context to AI; do not send credentials or unnecessary identifiers.
- **Reliability:** loading, empty, success, and error states; safe retries and duplicate-submit prevention.
- **Accessibility:** semantic HTML, keyboard navigation, labels, readable contrast.
- **Responsive design:** usable on mobile and desktop.
- **Maintainability:** TypeScript, modular components, migrations, tests, and documented decisions.
- **Financial correctness:** use PostgreSQL numeric values for money; avoid binary floating-point for persisted monetary amounts; test all calculations.

## 9. Key user journeys
1. **First use:** create account → configure monthly/biweekly salary and next payday → enter current cash position and as-of date → add recurring bills → set monthly budget → view dashboard.
2. **Daily tracking:** add income/expense → choose category/date → save → dashboard and budget totals update.
3. **Bill management:** review upcoming bill → mark occurrence paid → record/link expense → bill status and forecast update without double counting.
4. **Payday planning:** review estimate through next payday → inspect salary and bills → adjust spending plan.
5. **AI assistance:** ask question → server verifies identity and retrieves minimal scoped data → AI responds with grounded explanation/recommendation → user decides what to do.

## 10. Acceptance criteria
- User can register, sign in, recover access, and sign out.
- User can configure monthly or biweekly salary schedule and next payday.
- User can record and manage income and expenses manually.
- User can set overall/category budgets and see accurate progress.
- User can configure recurring bills, see upcoming/overdue bills in-app, and mark an occurrence paid without duplicate counting.
- User can enter a cash position and as-of date.
- Forecast shows the period, assumptions, expected salary, unpaid bills, and estimated remaining amount through next payday.
- AI supports spending insights, budget/savings recommendations, forecast explanations, and conversational questions.
- AI uses only the authenticated user's relevant data and does not mutate financial records.
- RLS prevents one user from reading or modifying another user's data.
- No private API key appears in frontend bundles, repository files, or logs.
- Core flows work on mobile and desktop.
- Setup, migrations, testing, and deployment instructions are documented.

## 11. Deferred decisions
- Subscription/pricing model and premium feature gating.
- PDF report format and export scope.
- Email/push reminders.
- Bank/e-wallet integration feasibility.
- Multi-currency and currency conversion.
- Weekend/holiday salary date adjustment.
