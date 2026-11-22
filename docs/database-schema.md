# Database Schema — aimass4.2

**Status:** Proposed MVP schema; implement only through reviewed SQL migrations. All money uses PostgreSQL `numeric`, never floating-point types.

## 1. profiles
- `id uuid primary key references auth.users(id) on delete cascade`
- `display_name text nullable`
- `preferred_currency text not null default 'PHP'`
- `timezone text not null default 'Asia/Manila'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

## 2. cash_positions
One manually maintained cash position for the MVP; this is not a live bank balance.
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null unique references auth.users(id) on delete cascade`
- `amount numeric(14,2) not null`
- `as_of_date date not null`
- `updated_at timestamptz not null default now()`
The UI must label this as user-entered and show the as-of date.

## 3. income_schedules
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `label text not null default 'Salary'`
- `expected_amount numeric(14,2) not null check (expected_amount > 0)`
- `frequency text not null check (frequency in ('monthly','biweekly'))`
- `next_payday date not null`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
Monthly schedules advance by calendar month; if a day does not exist in a month, use the last day of that month. Biweekly schedules advance by 14 days. Do not automatically adjust weekends or holidays in MVP.

## 4. categories
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid nullable references auth.users(id) on delete cascade` (null may represent global seeded categories)
- `name text not null`
- `kind text not null check (kind in ('income','expense'))`
- `is_system boolean not null default false`
- `created_at timestamptz not null default now()`
Use explicit uniqueness rules for user and global categories. System categories are read-only to end users.

## 5. transactions
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `category_id uuid nullable references categories(id) on delete set null`
- `kind text not null check (kind in ('income','expense'))`
- `amount numeric(14,2) not null check (amount > 0)`
- `transaction_date date not null`
- `description text nullable`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
Add indexes for user_id + transaction_date. Validate that referenced category belongs to the user or is an allowed global category. Do not add a recurring bill link directly to transactions unless the chosen bill-payment model requires it.

## 6. budgets
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `category_id uuid nullable references categories(id) on delete cascade` (null denotes overall budget)
- `month date not null` (normalize to first day of month)
- `limit_amount numeric(14,2) not null check (limit_amount > 0)`
- `created_at timestamptz not null default now()`
Use a unique index/constraint that correctly handles null category_id (for example, partial unique indexes for overall and category budgets). Validate category ownership.

## 7. recurring_bills
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `category_id uuid nullable references categories(id) on delete set null`
- `name text not null`
- `amount numeric(14,2) not null check (amount > 0)`
- `frequency text not null check (frequency in ('weekly','monthly','quarterly','yearly'))`
- `next_due_date date not null`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
In-app upcoming/overdue reminders are derived from active bills and due dates; no notification delivery table is required for MVP.

## 8. bill_payments
One row per paid occurrence, preventing duplicate payment handling.
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `recurring_bill_id uuid not null references recurring_bills(id) on delete cascade`
- `transaction_id uuid not null references transactions(id) on delete restrict`
- `due_date date not null`
- `paid_at timestamptz not null default now()`
- Unique constraint on recurring_bill_id + due_date.
Validate that bill, payment, and linked expense transaction all belong to the same user and that the transaction is an expense. Marking paid and linking/creating the expense must be atomic through a secure database function or equivalent transaction-safe operation.

## 9. Optional savings goals
Savings goal and contribution tables are not a committed MVP requirement. AI can provide savings recommendations using budgets and transaction data without storing a separate goal object. Add goal tables only if product scope is explicitly expanded.

## 10. Forecast calculation inputs
Calculate on demand for MVP using:
- Cash position amount and as-of date.
- Recorded income and expense transactions after the cash-position date and through the forecast cutoff.
- Expected salary occurrences through the next payday using the active monthly/biweekly schedule.
- Unpaid recurring bill occurrences due within the forecast period.
Avoid double counting bill payments already represented by linked expense transactions. Do not persist forecast snapshots unless a later requirement justifies them.

## 11. Security requirements
- Enable RLS on every user-owned table.
- Policies scope reads/writes to `auth.uid() = user_id`; profiles use `id = auth.uid()`.
- Global seeded categories require explicit read-only policies.
- Validate referenced categories, bills, and transactions belong to the same user.
- Never rely on client-supplied user_id.
- Add indexes for user-scoped queries and foreign keys.
- Add migrations and cross-user RLS tests before production use.
