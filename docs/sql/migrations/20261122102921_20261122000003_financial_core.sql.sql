/*
# Financial core tables

1. Plain-English explanation
   - Creates the five core financial tables: cash positions, income schedules,
     transactions, budgets, and recurring bills — each owned by one user.
   - All monetary amounts use PostgreSQL `numeric(14,2)` — never floating point.

2. New tables
   - `cash_positions`
     - `id` (uuid, primary key)
     - `user_id` (uuid, not null, unique — exactly one cash position per user,
       defaults to the authenticated user)
     - `amount` (numeric(14,2), not null, must be >= 0)
     - `as_of_date` (date, not null — the closing balance date)
     - `updated_at` (timestamptz, not null)
   - `income_schedules`
     - `id` (uuid, primary key)
     - `user_id` (uuid, not null, defaults to the authenticated user)
     - `label` (text, not null, default 'Salary')
     - `expected_amount` (numeric(14,2), not null, must be > 0)
     - `frequency` (text, not null, 'monthly' or 'biweekly' only)
     - `next_payday` (date, not null)
     - `is_active` (boolean, not null, default true)
     - `created_at`, `updated_at` (timestamptz, not null)
   - `transactions`
     - `id` (uuid, primary key)
     - `user_id` (uuid, not null, defaults to the authenticated user)
     - `category_id` (uuid, nullable — uncategorized transactions allowed)
     - `kind` (text, not null, 'income' or 'expense')
     - `amount` (numeric(14,2), not null, must be > 0)
     - `transaction_date` (date, not null)
     - `description` (text, nullable)
     - `created_at`, `updated_at` (timestamptz, not null)
   - `budgets`
     - `id` (uuid, primary key)
     - `user_id` (uuid, not null, defaults to the authenticated user)
     - `category_id` (uuid, nullable — null means the overall monthly budget)
     - `month` (date, not null, must be the first day of its month)
     - `limit_amount` (numeric(14,2), not null, must be > 0)
     - `created_at` (timestamptz, not null)
   - `recurring_bills`
     - `id` (uuid, primary key)
     - `user_id` (uuid, not null, defaults to the authenticated user)
     - `category_id` (uuid, nullable)
     - `name` (text, not null)
     - `amount` (numeric(14,2), not null, must be > 0)
     - `frequency` (text, not null, weekly/monthly/quarterly/yearly)
     - `next_due_date` (date, not null)
     - `is_active` (boolean, not null, default true)
     - `created_at`, `updated_at` (timestamptz, not null)

3. Integrity rules
   - Partial unique index: at most one ACTIVE income schedule per user.
   - Partial unique indexes: one overall budget per user/month (category null)
     and one category budget per user/category/month.
   - Budget `month` must be the first day of its calendar month.
   - Transactions enforce same-owner and same-kind categories through a
     composite foreign key `(user_id, category_id, kind)` referencing the
     matching unique index on `categories`.
   - Budgets and recurring bills reference their category together with the
     owner via composite foreign keys; their expense-kind requirement is
     validated by trigger functions added in this migration.

4. Security
   - RLS is enabled on all five tables immediately (locked until policies are
     added in the RLS migration).
   - Validation functions are regular invoker-rights functions and read only the
     rows the caller already references; they carry no authorization decisions
     of their own and are reachable only while modifying related tables.
   - No secrets or production data are embedded in this migration.

5. Important notes
   - Recurrence date advancement (monthly clamping, biweekly +14 days) is
     application/forecast logic per the approved decision and is not enforced
     here; the bill-payment RPC advances bill due dates with its own rule.
   - This migration is safe to re-run.
*/

create table if not exists public.cash_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  amount numeric(14, 2) not null check (amount >= 0),
  as_of_date date not null,
  updated_at timestamptz not null default now()
);

alter table public.cash_positions enable row level security;

create table if not exists public.income_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null default 'Salary',
  expected_amount numeric(14, 2) not null check (expected_amount > 0),
  frequency text not null check (frequency in ('monthly', 'biweekly')),
  next_payday date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.income_schedules enable row level security;

-- At most one active salary schedule per user.
create unique index if not exists income_schedules_one_active_per_user
  on public.income_schedules (user_id) where (is_active);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid null,
  kind text not null check (kind in ('income', 'expense')),
  amount numeric(14, 2) not null check (amount > 0),
  transaction_date date not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_category_same_user_and_kind
    foreign key (user_id, category_id, kind)
    references public.categories (user_id, id, kind)
    on delete restrict
);

alter table public.transactions enable row level security;

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid null,
  month date not null check (extract(day from month) = 1),
  limit_amount numeric(14, 2) not null check (limit_amount > 0),
  created_at timestamptz not null default now(),
  constraint budgets_category_same_user_fk
    foreign key (user_id, category_id)
    references public.categories (user_id, id)
    on delete restrict
);

alter table public.budgets enable row level security;

-- One overall budget per user per month.
create unique index if not exists budgets_one_overall_per_user_month
  on public.budgets (user_id, month) where (category_id is null);

-- One category budget per user, category, and month.
create unique index if not exists budgets_one_per_category_month
  on public.budgets (user_id, category_id, month) where (category_id is not null);

create table if not exists public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid null,
  name text not null,
  amount numeric(14, 2) not null check (amount > 0),
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_bills_category_same_user_fk
    foreign key (user_id, category_id)
    references public.categories (user_id, id)
    on delete restrict
);

alter table public.recurring_bills enable row level security;

create or replace function public.assert_budget_category_is_expense()
returns trigger
language plpgsql
as $$
declare
  category_kind text;
begin
  if new.category_id is null then
    return new;
  end if;

  select kind into category_kind
  from public.categories
  where id = new.category_id;

  if category_kind is null or category_kind <> 'expense' then
    raise exception 'budget category must exist and be an expense category'
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create or replace function public.assert_bill_category_is_expense()
returns trigger
language plpgsql
as $$
declare
  category_kind text;
begin
  if new.category_id is null then
    return new;
  end if;

  select kind into category_kind
  from public.categories
  where id = new.category_id;

  if category_kind is null or category_kind <> 'expense' then
    raise exception 'recurring bill category must exist and be an expense category'
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists budgets_assert_category_expense on public.budgets;
create trigger budgets_assert_category_expense
before insert or update of category_id on public.budgets
for each row execute function public.assert_budget_category_is_expense();

drop trigger if exists recurring_bills_assert_category_expense on public.recurring_bills;
create trigger recurring_bills_assert_category_expense
before insert or update of category_id on public.recurring_bills
for each row execute function public.assert_bill_category_is_expense();

-- Keep audit timestamps current.
drop trigger if exists cash_positions_set_updated_at on public.cash_positions;
create trigger cash_positions_set_updated_at
before update on public.cash_positions
for each row execute function public.set_updated_at();

drop trigger if exists income_schedules_set_updated_at on public.income_schedules;
create trigger income_schedules_set_updated_at
before update on public.income_schedules
for each row execute function public.set_updated_at();

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
before update on public.transactions
for each row execute function public.set_updated_at();

drop trigger if exists recurring_bills_set_updated_at on public.recurring_bills;
create trigger recurring_bills_set_updated_at
before update on public.recurring_bills
for each row execute function public.set_updated_at();
