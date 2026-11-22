# aimass4.2 — Product Specification

## 1. Product overview
aimass4.2 is an AI-assisted personal budgeting application. It helps an individual understand cash flow, plan spending, record income and expenses, monitor budgets, and receive understandable AI-generated insights. The application is informational and does not provide regulated financial, investment, tax, or lending advice.

## 2. Product goals
- Make it easy to record and categorize income and expenses.
- Give users a clear view of balances, spending, and budget progress.
- Help users set monthly budgets and savings goals.
- Offer an AI assistant that summarizes user-authorized financial activity and suggests practical budgeting actions.
- Keep each user's financial data private and isolated.
- Provide a responsive, accessible web application.

## 3. Target users
Individuals who want a simple way to track personal finances and improve day-to-day budgeting. Initial release is single-user-per-account; shared household budgets are out of scope.

## 4. MVP scope
### 4.1 Accounts and authentication
- Sign up, sign in, sign out, and password recovery through Supabase Auth.
- Authenticated routes and clear session-expiry handling.
- Users can access only their own records.

### 4.2 Dashboard
- Display current-month income, expenses, and net cash flow from recorded transactions.
- Show budget utilization and recent transactions.
- Use explicit empty states when the user has no records.
- Clearly identify the currency and date range used.

### 4.3 Transactions
- Create, view, edit, and delete income and expense transactions.
- Fields: amount, transaction type, date, category, account/payment source (optional), note (optional).
- Validate positive amounts, valid dates, and required fields.
- Support filtering by date range, type, and category.

### 4.4 Categories
- Provide sensible default income and expense categories.
- Allow users to create and manage their own categories.
- Prevent a user from editing another user's categories.

### 4.5 Budgets
- Set a monthly spending limit overall and by expense category.
- Show amount spent, amount remaining, and percentage used.
- Handle zero or missing budgets without division errors.

### 4.6 Savings goals
- Create, edit, and archive a savings goal with target amount and target date (optional).
- Record contributions and show progress.
- Do not imply that a goal is a bank account or holds actual funds.

### 4.7 AI budgeting assistant
- Provide a conversational interface for budgeting questions.
- Generate summaries and suggestions from only the authenticated user's explicitly relevant data.
- Use a server-side Supabase Edge Function to call the OpenAI API.
- Never expose the OpenAI API key or service-role credentials to the browser.
- Treat user-entered transaction notes and other retrieved content as untrusted data, not instructions.
- Present generated content as general educational assistance, not professional financial advice.
- Handle missing data honestly; do not fabricate balances, transactions, or trends.
- Ask for confirmation before any AI-suggested change is written to the database. The MVP assistant is read-only.

### 4.8 Settings
- Profile basics and preferred currency.
- Account sign-out.
- Explain how to delete account/data; account deletion workflow can be implemented after MVP if not supported safely at launch.

## 5. Initial assumptions
- Default display currency: PHP (₱); user can change it in settings.
- Default timezone: Asia/Manila; store timestamps consistently and display dates in the user's configured timezone.
- Monthly budgets use calendar months.
- One personal workspace per authenticated user.
- Web-first responsive design.

## 6. Non-functional requirements
- Security: Supabase Row Level Security (RLS) on all user-owned tables; least-privilege access.
- Privacy: request only data needed for a feature; do not send all financial history to an AI model by default.
- Reliability: show loading, error, and empty states; prevent duplicate submissions.
- Accessibility: semantic controls, keyboard navigation, labels, and sufficient contrast.
- Performance: paginate or limit transaction queries; avoid loading the entire history for dashboard summaries.
- Maintainability: TypeScript, reusable components, validated data boundaries, database migrations, and tests.

## 7. Out of scope for MVP
- Bank integrations, payment processing, automated bank scraping, credit scoring, investment recommendations, tax filing, lending, multi-currency conversion, shared household accounts, and autonomous AI actions.
- No guarantees that AI output is accurate; users remain responsible for financial decisions.

## 8. Acceptance criteria
- A new user can create an account and sign in.
- An authenticated user can create, edit, filter, and delete their own transactions.
- Dashboard totals match the underlying transaction records for the selected period.
- A user can create budgets and see accurate budget progress.
- A user can create savings goals and record contributions.
- Cross-user data access is denied by RLS and verified by tests.
- AI requests execute through a server-side function; the API key is absent from frontend bundles and Git history.
- AI responses are clearly identified and do not write to financial records without user confirmation (read-only in MVP).
- The app works on desktop and mobile viewport sizes.
- Setup and deployment instructions are documented.

## 9. Product decisions requiring confirmation
- Exact branding, visual theme, and final feature prioritization.
- Whether to support recurring transactions in the first release.
- Whether currency should be changeable per user or fixed to PHP for the first release.
- Exact AI model and usage/cost limits.
