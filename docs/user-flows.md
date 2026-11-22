# User Flows — aimass4.2

## 1. Navigation model
Primary navigation:
- Dashboard
- Transactions
- Budgets
- Bills
- AI Assistant
- Settings

The navigation must be responsive. On small screens use a compact navigation pattern while keeping the primary actions easy to reach.

## 2. First-time onboarding
1. Visitor opens the app and chooses Sign up.
2. User creates an account and verifies email if required by Supabase Auth configuration.
3. User signs in and enters onboarding.
4. User sets display name (optional), preferred currency (PHP default), and timezone (Asia/Manila default).
5. User enters salary amount, chooses monthly or biweekly frequency, and sets the next expected payday.
6. User enters current available cash amount and the date that amount is accurate as of. Explain this is a manually supplied cash position, not a bank connection.
7. User may add recurring bills and due dates.
8. User may set an overall monthly budget and category budgets.
9. User reaches the dashboard with a setup checklist or clear empty states for anything skipped.

Validation:
- Salary amount must be positive.
- Payday and cash-position as-of date must be valid dates.
- Frequency choices are monthly and biweekly only.
- User may skip optional bills/budgets and complete them later.

## 3. Daily transaction entry
1. User opens Transactions and selects Add transaction.
2. User chooses Income or Expense.
3. User enters amount, date, category, and optional description.
4. Client provides immediate validation; server/database constraints remain authoritative.
5. On save, the app confirms success and refreshes affected dashboard and budget totals.
6. User can edit or delete their own transaction after confirmation for destructive deletion.

## 4. Budget management
1. User opens Budgets.
2. User chooses a month and creates an overall monthly limit.
3. User optionally adds category-specific limits.
4. Dashboard and budget page show spent, remaining, and percentage used.
5. When a limit is approaching or exceeded, display a clear, non-alarming status.
6. Changing a budget recalculates progress from recorded expense transactions.

## 5. Recurring bills and in-app reminders
1. User opens Bills and selects Add recurring bill.
2. User enters name, amount, category (optional), frequency, and next due date.
3. App lists upcoming and overdue bills based on the user's timezone/date.
4. User opens a bill occurrence and selects Mark as paid.
5. App asks for confirmation and creates/links exactly one expense transaction with a bill-payment occurrence.
6. The bill's next due date advances according to its recurrence rule.
7. If the user cancels, no payment or transaction is written.

No email or push reminder is sent in MVP. The in-app dashboard and Bills page are the reminder surfaces.

## 6. Payday and cash-flow forecast
1. User opens Dashboard or Forecast.
2. App displays the cash-position amount and its as-of date.
3. App calculates expected cash through the next scheduled payday from:
   - cash position,
   - transactions after the cash-position date,
   - expected salary occurrences,
   - unpaid recurring bill occurrences due before the forecast cutoff.
4. App displays the forecast period, inputs, expected income, upcoming bills, and estimated remaining cash.
5. If the estimate is negative or below a configured threshold (if one exists), show a neutral warning and the contributing items.
6. User can update cash position, salary schedule, or bill details; the forecast recalculates.
7. Clearly label all outputs as estimates, not guaranteed balances.

## 7. AI Assistant
1. User opens AI Assistant or chooses an insight card.
2. User selects a supported task or enters a natural-language budgeting question.
3. Client sends the request with the current Supabase access token to the AI Edge Function.
4. Function verifies identity, checks rate limits, and retrieves only the minimal user-scoped context needed.
5. Function calls OpenAI and returns a constrained answer.
6. UI identifies the answer as AI-generated and shows a limitation/disclaimer where appropriate.
7. User can ask a follow-up question.
8. AI does not write transactions, edit budgets, mark bills paid, or change salary settings.

Supported MVP tasks:
- Spending insights.
- Budget and savings recommendations.
- Explanation of the deterministic payday forecast.
- Conversational budgeting questions.

If there is insufficient information, the assistant should say what is missing and suggest which data the user can enter.

## 8. Authentication and session handling
- Protected pages require an authenticated Supabase session.
- If a session expires, preserve no sensitive unsaved data in URLs; ask the user to sign in again.
- Sign out clears the local session.
- Password recovery uses the Supabase Auth recovery flow and configured redirect URLs.

## 9. Empty, loading, and error states
- New user: show onboarding/setup guidance, not fabricated sample financial data.
- No transactions: show a clear Add transaction action.
- No budgets: explain how to create the first budget.
- No bills: explain in-app reminders and offer Add bill.
- Forecast missing inputs: list the missing salary/cash-position details.
- AI unavailable or rate-limited: show a safe error and keep the rest of the app usable.
- Network failure: avoid duplicate submissions and allow a safe retry.

## 10. Destructive actions
Deleting a transaction, category, bill, or account-related data requires clear confirmation. Explain the effect on totals/forecasts. AI suggestions never trigger these actions.
