# Database Schema — aimass4.2

This is the proposed MVP schema. Treat it as a design contract until reviewed and implemented through SQL migrations. All monetary fields use PostgreSQL `numeric`, never floating-point types.

## Tables

### profiles
- `id uuid primary key references auth.users(id) on delete cascade`
- `display_name text nullable`
- `preferred_currency text not null default 'PHP'`
- `timezone text not null default 'Asia/Manila'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### categories
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `name text not null`
- `kind text not null check (kind in ('income','expense'))`
- `is_system boolean not null default false`
- `created_at timestamptz not null default now()`
- Unique user/name/kind constraint.

### transactions
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `category_id uuid nullable references categories(id) on delete set null`
- `kind text not null check (kind in ('income','expense'))`
- `amount numeric(14,2) not null check (amount > 0)`
- `transaction_date date not null`
- `description text nullable`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- Index by user_id and transaction_date; validate category ownership and kind consistency.

### budgets
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `category_id uuid nullable references categories(id) on delete cascade` (null denotes overall budget)
- `month date not null` (normalize to first day of month)
- `limit_amount numeric(14,2) not null check (limit_amount > 0)`
- `created_at timestamptz not null default now()`
- Unique user/category/month; include a strategy for uniqueness when category_id is null.

### savings_goals
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `name text not null`
- `target_amount numeric(14,2) not null check (target_amount > 0)`
- `target_date date nullable`
- `status text not null default 'active' check (status in ('active','completed','archived'))`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### savings_contributions
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `goal_id uuid not null references savings_goals(id) on delete cascade`
- `amount numeric(14,2) not null check (amount > 0)`
- `contribution_date date not null`
- `note text nullable`
- `created_at timestamptz not null default now()`

## Security requirements
- Enable RLS on every table.
- User-owned rows must have policies for SELECT, INSERT, UPDATE, and DELETE where appropriate, constrained by `auth.uid() = user_id`.
- For profiles, constrain `id = auth.uid()`.
- Ensure referenced categories and goals belong to the same authenticated user; use carefully designed constraints/triggers or secure RPC logic.
- System categories require a deliberate read-only policy; do not let a user claim or modify system records.
- Never rely only on a client-supplied `user_id`.
- Add indexes for common user-scoped queries and foreign keys.
- Add migrations and cross-user RLS tests before production use.

## Open schema decisions
- Whether accounts/payment sources are needed in MVP.
- Exact system category seeding mechanism.
- Whether recurring transactions are in first release.
- Whether to store currency per transaction (recommended if multiple currencies may be added); MVP assumes user's preferred currency.
