# aimass4.2 — Product Specification

**Status:** Draft for review  
**Product:** AI-assisted personal budgeting web application  
**Initial market:** Filipino employees and young professionals with regular monthly or biweekly income

## 1. Product vision
Help people understand where their salary goes, stay ahead of recurring bills, and make their money last until the next payday through simple tracking, useful forecasts, and explainable AI-assisted budgeting guidance.

## 2. Problem statement
People with regular salaries often struggle to monitor daily expenses, remember upcoming bills, and judge whether their remaining money will last until payday. Expense tracking alone may show what has already happened but does not always help users anticipate obligations or make adjustments before they run short.

aimass4.2 combines manual money tracking, budget limits, recurring bill reminders, payday forecasting, and AI-generated insights in one personal budgeting workspace.

## 3. Target users
- Filipino employees and young professionals.
- People paid monthly or biweekly.
- People who want to track expenses manually without connecting bank or e-wallet accounts.
- Users who need reminders and a clearer view of cash available before their next payday.

## 4. Product principles
- Simple enough for frequent, everyday use.
- Manual entry first; no bank or e-wallet integrations in the MVP.
- Forecasts must show assumptions and must not imply certainty.
- AI recommendations must be based on available user data and explain their reasoning.
- Private by default: each user's financial records are isolated.
- AI is an assistant, not an autonomous financial decision-maker.

## 5. MVP scope

### 5.1 Account and onboarding
- Sign up, sign in, sign out, and password recovery using Supabase Auth.
- Collect basic profile settings, preferred currency (default PHP), timezone (default Asia/Manila), and salary schedule.
- Support monthly or biweekly pay frequency in the initial release.
- Provide onboarding guidance for entering income, bills, and starting transactions.
- Do not require bank credentials or financial account linking.

### 5.2 Income and payday schedule
- Record expected income amount, pay frequency, and next expected payday.
- Allow users to update their salary schedule when it changes.
- Support additional/manual income entries.
- Clearly distinguish expected income from income actually received.
- Use the schedule as an input to cash-flow and payday forecasts.

### 5.3 Expense and income tracking
- Manually create, view, edit, and delete transactions.
- Transaction fields: type (income/expense), amount, date, category, description/note (optional), and recurring item link (optional).
- Use PHP as the default currency; format amounts consistently.
- Validate positive monetary amounts, valid dates, and required fields.
- Filter and search by date range, type, and category.
- Provide default categories and allow user-defined categories.
- No bank or e-wallet integrations in MVP.

### 5.4 Budgets and spending limits
- Create an overall monthly spending limit.
- Create category-specific monthly limits.
- Show amount spent, remaining amount, and percentage used.
- Highlight approaching or exceeded limits with clear, non-alarming language.
- Calculate totals from actual recorded expense transactions, not AI estimates.

### 5.5 Recurring bills and reminders
- Create recurring bills with name, amount, category, due date/next due date, and recurrence frequency.
- Support common frequencies such as weekly, monthly, quarterly, and yearly where practical.
- Show upcoming and overdue bills.
- Provide in-app reminders/notifications in the MVP; email/push delivery is a later decision.
- Allow users to mark a bill as paid, recording or linking a corresponding expense to avoid double counting.
- Clearly distinguish a scheduled bill from a paid transaction.

### 5.6 Payday and cash-flow forecasting
- Estimate available cash through the next expected payday using the user's entered starting balance, expected income dates/amounts, recorded transactions, and upcoming bills.
- Show forecast period, assumptions, upcoming obligations, and estimated remaining amount.
- Warn when projected cash may become insufficient before payday.
- Allow users to correct inputs and understand how the forecast changes.
- Label forecasts as estimates; do not present them as guaranteed balances.
- Do not invent bank balances or transactions. The MVP relies on data manually entered by the user.

### 5.7 AI spending insights and recommendations
- Provide an AI assistant for questions about the user's recorded spending and budget.
- Summarize spending patterns, notable category changes, and budget progress.
- Suggest practical budget adjustments and savings opportunities.
- Explain recommendations with reference to relevant user-provided data.
- Support payday-aware suggestions such as identifying upcoming bills and discretionary spending that may be reduced.
- If data is insufficient, say so and ask the user to add or clarify information.
- Make AI requests through a server-side Supabase Edge Function using an OpenAI API key stored as a secret.
- The AI assistant is read-only in the MVP: it cannot create, edit, delete, pay, or schedule financial records.
- Treat notes and imported/user-supplied text as untrusted content, not instructions.
- Clearly state that AI output is general budgeting assistance, not professional financial, tax, investment, or legal advice.

### 5.8 Dashboard and reports
- Show current available/starting balance where supplied, income, expenses, and net cash flow for a selected period.
- Show budget progress, upcoming bills, next payday, and a concise cash-flow forecast.
- Show recent transactions and key AI insights when available.
- Provide useful date filters and clear empty states.
- PDF/export reports are a post-MVP enhancement unless specifically prioritized later.

### 5.9 Settings
- Profile, preferred currency, timezone, and salary schedule.
- Manage categories and notification preferences.
- Sign out and provide a documented account/data deletion process.

## 6. Proposed pricing model (not yet committed)
A possible freemium model discussed during discovery:
- Free: manual tracking and basic budgeting.
- Premium: expanded AI insights, payday forecasting, and recommendations.
- Proposed premium price: ₱149/month.

Pricing, plan limits, payment provider, and which features are free versus premium require validation and are not MVP implementation requirements until approved.

## 7. Out of scope for MVP
- Bank and e-wallet integrations or automatic transaction scraping.
- Payment processing or bill payment execution.
- Credit scoring, lending, investment recommendations, or tax filing.
- Autonomous AI actions or AI-written financial records.
- Shared household budgets and multi-user workspaces.
- Guaranteed balance predictions.
- Subscription billing until the pricing model is validated.

## 8. Non-functional requirements
- **Security:** Supabase RLS on all user-owned tables; server-side authorization; least privilege.
- **Secrets:** no OpenAI API key or Supabase service-role key in frontend code, browser storage, Git, or prompts.
- **Privacy:** send only the minimum relevant financial context to the AI provider; explain AI data use.
- **Reliability:** loading, empty, success, and error states; safe retries and duplicate-submit prevention.
- **Accessibility:** semantic HTML, keyboard navigation, labels, readable contrast.
- **Responsive design:** usable on mobile and desktop.
- **Maintainability:** TypeScript, modular components, migrations, tests, and documented decisions.
- **Financial correctness:** use PostgreSQL numeric values for money and test calculations; do not use binary floating-point for persisted monetary amounts.

## 9. Key user journeys
1. **First use:** create account → enter salary frequency and next payday → enter starting balance (optional) → add recurring bills → set budget → view dashboard.
2. **Daily tracking:** add expense/income → select category/date → save → dashboard and budget totals update.
3. **Bill management:** review upcoming bill → mark paid → record/link expense → upcoming obligations update.
4. **Payday planning:** review forecast to next payday → inspect expected income and bills → adjust spending plan.
5. **AI assistance:** ask a budgeting question → server verifies identity and retrieves minimal scoped data → AI returns explanation/recommendations → user decides what to do.

## 10. Acceptance criteria
- User can register, sign in, recover access, and sign out.
- User can configure monthly or biweekly salary schedule and next payday.
- User can manually record and manage income and expenses.
- User can set overall and category budgets and see correct progress.
- User can configure recurring bills, see upcoming/overdue items, and mark bills paid without double counting.
- Payday forecast displays the period, assumptions, expected bills/income, and an estimated remaining amount.
- AI insights use only the authenticated user's relevant data and clearly disclose uncertainty.
- AI cannot mutate financial data in the MVP.
- RLS prevents one user from reading or modifying another user's data.
- No private API key appears in frontend bundles, repository files, or logs.
- Core flows work on mobile and desktop.
- Setup, migration, testing, and deployment instructions are documented.

## 11. Open questions to resolve before implementation
- Exact starting-balance model and whether users track multiple cash accounts.
- Whether recurring bill reminders are in-app only for MVP.
- Whether salary schedule supports only monthly/biweekly or also weekly/semi-monthly.
- Whether premium pricing/feature gating is part of the first public release.
- Whether PDF reports are needed in MVP or post-MVP.
- Final AI usage limits and model selection.
