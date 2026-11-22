# Database Schema — aimass4.2

**Status:** Reviewed and approved MVP design; implementation must happen through versioned SQL migrations after documentation is finalized. No Supabase project or migration has been created yet. All persisted money uses PostgreSQL `numeric`, never floating-point types.

## Design principles

- Every financial record belongs to exactly one authenticated user.
- User identity comes from the verified Supabase JWT via `auth.uid()`, never from a client-supplied owner ID.
- The MVP supports one preferred currency per user and does not perform currency conversion.
- Financial dates use PostgreSQL `date`; audit timestamps use `timestamptz`.
- RLS is mandatory on every user-owned table. Constraints and trusted database operations enforce relationships that RLS alone cannot guarantee.

## 1. profiles

One profile per Supabase Auth user.
- `id uuid primary key references auth.users(id) on delete cascade`
- `display_name text nullable`
- `preferred_currency text not null default 'PHP'`
- `timezone text not null default 'Asia/Manila'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Create the profile through a trusted signup trigger or an idempotent server-side initialization flow. Do not allow a user to create or modify another user's profile. Currency is a display preference, not a conversion feature. Per ADR-011 (2026-11-22): currency changes are allowed while no financial records exist and blocked once any financial records exist (transactions, bill payments, or budgets), so historical amounts are never silently relabelled. The currently applied trigger blocks ALL changes; a follow-up migration implementing the conditional rule is pending.

## 2. cash_positions

One manually maintained cash position per user; this is not a live bank balance.
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null unique references auth.users(id) on delete cascade`
- `amount numeric(14,2) not null check (amount >= 0)`
- `as_of_date date not null`
- `updated_at timestamptz not null default now()`

The UI must label this as user-entered and display the as-of date. Treat the amount as the closing cash position at the end of that date. Forecast calculations therefore include recorded transactions dated strictly after `as_of_date`.

## 3. income_schedules

The MVP supports one active salary schedule per user. Inactive historical rows may be retained.
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `label text not null default 'Salary'`
- `expected_amount numeric(14,2) not null check (expected_amount > 0)`
- `frequency text not null check (frequency in ('monthly','biweekly'))`
- `next_payday date not null`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Add a partial unique index on `user_id` where `is_active = true`. Monthly schedules advance by calendar month; if a day does not exist in a month, use that month's last calendar day. Biweekly schedules advance by 14 days. Do not automatically adjust weekends or holidays in MVP. Additional income is recorded as ordinary income transactions.

## 4. categories

All categories, including defaults, are user-owned. Seed each user's default categories during trusted account initialization; users may add custom categories.
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `name text not null`
- `kind text not null check (kind in ('income','expense'))`
- `is_system boolean not null default false`
- `created_at timestamptz not null default now()`

Add a case-insensitive unique index on `(user_id, lower(name), kind)`. Default/system categories may be protected from deletion or renaming through database policy/trigger rules. Do not use nullable `user_id` or globally shared category rows in the MVP; this keeps ownership and RLS straightforward.

## 5. transactions

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `category_id uuid nullable`
- `kind text not null check (kind in ('income','expense'))`
- `amount numeric(14,2) not null check (amount > 0)`
- `transaction_date date not null`
- `description text nullable`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Add indexes for `(user_id, transaction_date)` and relevant user-scoped filters. Enforce that a selected category belongs to the same user and has the same `kind` as the transaction. A database constraint using suitable composite keys or a trigger may enforce this; frontend validation is not sufficient. A null category is allowed for uncategorized transactions.

## 6. budgets

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `category_id uuid nullable` (null denotes the overall budget)
- `month date not null check (extract(day from month) = 1)`
- `limit_amount numeric(14,2) not null check (limit_amount > 0)`
- `created_at timestamptz not null default now()`

Use two partial unique indexes: one on `(user_id, month)` where `category_id is null`, and one on `(user_id, category_id, month)` where `category_id is not null`. A category budget must reference a category owned by the same user and of kind `expense`. Overall and category budget totals are calculated from expense transactions; do not store derived spent amounts as authoritative values.

## 7. recurring_bills

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `category_id uuid nullable`
- `name text not null`
- `amount numeric(14,2) not null check (amount > 0)`
- `frequency text not null check (frequency in ('weekly','monthly','quarterly','yearly'))`
- `next_due_date date not null`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

A selected category must belong to the same user and be of kind `expense`. Deactivate a bill with `is_active = false` rather than hard-deleting a bill that has payment history. Preserve historical payment and expense records. In-app upcoming/overdue reminders are derived from active bills and due dates; no notification-delivery table is required for MVP.

Bill recurrence advances by calendar periods. Weekly advances by seven days; monthly, quarterly, and yearly advance by their respective calendar periods. If the destination month does not contain the original day number, clamp the occurrence to that month's last calendar day.

## 8. bill_payments

One row per paid bill occurrence, linked to exactly one expense transaction.
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `recurring_bill_id uuid not null references recurring_bills(id) on delete restrict`
- `transaction_id uuid not null unique references transactions(id) on delete restrict`
- `due_date date not null`
- `paid_at timestamptz not null default now()`
- Unique constraint on `(recurring_bill_id, due_date)`

Enforce that the bill, payment, and linked transaction belong to the same user, and that the linked transaction is an expense. Use a secure database function/RPC as the single payment operation. In one database transaction it must verify ownership and unpaid occurrence, create or link the expense, insert the payment record, and advance `next_due_date`. Any failure must roll back all changes. The unique bill-occurrence constraint and unique transaction link protect against duplicate submissions and double counting. Do not permit a client to insert arbitrary payment links directly.

## 9. Tables intentionally deferred

Savings goals/contributions, forecast snapshots, notification delivery history, bank/e-wallet accounts, and subscription/payment records are not MVP tables. Add them only after a product requirement justifies the additional complexity.

## 10. Forecast calculation contract

Calculate forecasts on demand; do not persist snapshots in MVP.
- Starting cash is the user's cash position amount, treated as the closing balance on `as_of_date`.
- Include recorded income and expense transactions dated after `as_of_date` through the forecast cutoff.
- The forecast ends on the next expected payday, inclusive. Include the expected salary occurrence on that payday as forecast income and label it clearly as expected, not received.
- Include unpaid recurring bill occurrences due after the cash-position date and through the forecast cutoff. Exclude occurrences already represented by a paid bill payment and its linked expense transaction.
- Prevent an expected salary occurrence from being counted again as actual income if the user records that same payday's salary; the implementation must define and test a reliable reconciliation rule before release.
- Show the forecast period, as-of date, starting cash, expected income, recorded activity, unpaid obligations, assumptions, and estimated ending cash.
- Forecast arithmetic is deterministic application logic. AI may explain server-calculated results but must not calculate or override authoritative totals.

## 11. Security and integrity requirements

- Enable RLS on every user-owned table, including profiles.
- Policies scope rows to `auth.uid() = user_id`; profiles use `id = auth.uid()`.
- Never trust a client-supplied `user_id`; derive ownership from the verified session in trusted operations.
- Validate category ownership and category kind for transactions, budgets, and bills.
- Validate bill/payment/transaction ownership and expense kind in the trusted payment operation and database integrity layer.
- Restrict direct writes to bill payment records; expose only the atomic payment operation.
- Add indexes for ownership filters, date filters, and foreign keys.
- Add migrations and cross-user RLS, duplicate-payment, category-integrity, and forecast-calculation tests before production use.
