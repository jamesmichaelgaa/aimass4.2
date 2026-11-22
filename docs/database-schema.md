# Database Schema — aimass4.2

**Status:** Proposed design, not yet implemented. Finalize after product scope review. All monetary values use PostgreSQL `numeric`, not floating-point types.

## Core tables

### profiles
- `id uuid primary key references auth.users(id) on delete cascade`
- `display_name text nullable`
- `preferred_currency text not null default 'PHP'`
- `timezone text not null default 'Asia/Manila'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### income_schedules
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `label text not null default 'Salary'`
- `expected_amount numeric(14,2) not null check (expected_amount > 0)`
- `frequency text not null check (frequency in ('weekly','biweekly','monthly'))`
- `next_payday date not null`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### categories
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid nullable references auth.users(id) on delete cascade` (null may represent seeded global categories)
- `name text not null`
- `kind text not null check (kind in ('income','expense'))`
- `is_system boolean not null default false`
- `created_at timestamptz not null default now()`
- Add constraints/indexes to prevent duplicate category names within a user's category scope.

### transactions
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `category_id uuid nullable references categories(id) on delete set null`
- `kind text not null check (kind in ('income','expense'))`
- `amount numeric(14,2) not null check (amount > 0)`
- `transaction_date date not null`
- `description text nullable`
- `recurring_bill_id uuid nullable` (FK added after recurring_bills table)
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- Index by user_id and transaction_date.
- Ensure referenced category and recurring bill belong to the same user.

### budgets
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `category_id uuid nullable references categories(id) on delete cascade` (null denotes overall budget)
- `month date not null` (normalized to first day of month)
- `limit_amount numeric(14,2) not null check (limit_amount > 0)`
- `created_at timestamptz not null default now()`
- Unique user/category/month, including a deliberate uniqueness strategy for null category_id.

### recurring_bills
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
- Add indexes for user_id and next_due_date.

### bill_payments (or a paid-occurrence ledger)
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `recurring_bill_id uuid not null references recurring_bills(id) on delete cascade`
- `transaction_id uuid nullable references transactions(id) on delete set null`
- `due_date date not null`
- `paid_at timestamptz not null default now()`
- Unique recurring_bill_id + due_date to prevent duplicate payment records.
- Ensure linked transaction belongs to the same user and is an expense.

### savings_goals (optional MVP; confirm scope)
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `name text not null`
- `target_amount numeric(14,2) not null check (target_amount > 0)`
- `target_date date nullable`
- `status text not null default 'active' check (status in ('active','completed','archived'))`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### savings_contributions (optional MVP; confirm scope)
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `goal_id uuid not null references savings_goals(id) on delete cascade`
- `amount numeric(14,2) not null check (amount > 0)`
- `contribution_date date not null`
- `note text nullable`
- `created_at timestamptz not null default now()`

## Forecasting
The initial forecast can be calculated from:
- User-entered starting/available balance (decide whether this is a profile field or a separate cash account table).
- Active income schedule and next payday.
- Actual income and expense transactions in the forecast window.
- Unpaid recurring bill occurrences due before the next payday.

A forecast snapshot table is not required for the first implementation; calculate on demand unless performance or audit needs justify persistence. Clearly label estimates and their assumptions.

## Security requirements
- Enable RLS on every user-owned table.
- Policies must scope reads/writes to `auth.uid() = user_id`; profiles use `id = auth.uid()`.
- Global seeded categories need explicit read-only policies; users must not modify system categories.
- Validate that category, bill, goal, and linked transaction references belong to the same user.
- Never rely on client-supplied user_id.
- Add indexes for common user-scoped queries and foreign keys.
- Add migrations and cross-user RLS tests before production use.

## Decisions to confirm
- Starting balance / cash account model.
- Whether savings goals belong in MVP.
- Whether weekly payroll is needed or only monthly/biweekly.
- Whether recurring bill frequency needs custom intervals.
- Whether to support multiple currencies or one preferred currency in MVP.
