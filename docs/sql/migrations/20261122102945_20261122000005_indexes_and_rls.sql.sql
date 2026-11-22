/*
# Supporting indexes and row level security policies

1. Plain-English explanation
   - Adds the remaining query indexes for date filters, ownership filters, and
     foreign-key columns.
   - Enables the full row level security policy set: every signed-in user can
     see and change only their own rows. Signed-out callers see nothing.
   - Protects the built-in default categories from modification or deletion.
   - Blocks deleting a recurring bill that has payment history (it must be
     deactivated instead).
   - `bill_payments` is read-only for clients; payments are recorded only
     through the atomic payment function from the previous migration.
   - `profiles` cannot be inserted or deleted by clients: profiles are created
     by the trusted signup trigger and removed only through the account/data
     deletion flow.

2. Indexes
   - `transactions (user_id, transaction_date)`.
   - `budgets (user_id, month)`.
   - `recurring_bills (user_id, is_active, next_due_date)`.
   - `bill_payments (user_id, due_date)`.
   - Foreign-key support: `transactions (category_id)`,
     `transactions (transaction_date)`, `budgets (category_id)`,
     `recurring_bills (category_id)`, `bill_payments (recurring_bill_id)`,
     `bill_payments (transaction_id)` (the unique constraint already indexes
     `transaction_id`; this index covers ownership+date lookups).

3. Security — policies per table (all TO authenticated, owner-scoped)
   - `profiles`: SELECT own row (`id = auth.uid()`); UPDATE own row, and the
     database trigger additionally blocks preferred-currency changes. No INSERT
     or DELETE policies.
   - `cash_positions`: owner-scoped SELECT / INSERT / UPDATE / DELETE.
   - `income_schedules`: owner-scoped SELECT / INSERT / UPDATE / DELETE.
   - `categories`: owner-scoped SELECT / INSERT; UPDATE and DELETE only for
     non-system rows the user owns.
   - `transactions`: owner-scoped SELECT / INSERT / UPDATE / DELETE; same-owner
     and same-kind category integrity is enforced by the composite foreign key.
   - `budgets`: owner-scoped SELECT / INSERT / UPDATE / DELETE; expense-category
     integrity enforced by trigger.
   - `recurring_bills`: owner-scoped SELECT / INSERT / UPDATE; DELETE only when
     the bill has no payment history.
   - `bill_payments`: SELECT own rows only. No INSERT / UPDATE / DELETE policies
     and no write grants: the payment function is the only write path.

4. Security — grants
   - SELECT granted on all eight tables to `authenticated`.
   - INSERT / UPDATE / DELETE granted only where a corresponding policy allows
     the verb; `bill_payments` gets SELECT only.
   - No `anon` grants anywhere: every table requires sign-in.
   - No service-role grants in this migration; the AI Edge Function phase adds
     narrowly scoped grants when that server code exists.

5. Important notes
   - RLS is already enabled on every table from the earlier migrations.
   - This migration is safe to re-run.
*/

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, transaction_date);

create index if not exists transactions_category_idx
  on public.transactions (category_id);

create index if not exists transactions_date_idx
  on public.transactions (transaction_date);

create index if not exists budgets_user_month_idx
  on public.budgets (user_id, month);

create index if not exists budgets_category_idx
  on public.budgets (category_id);

create index if not exists recurring_bills_user_active_due_idx
  on public.recurring_bills (user_id, is_active, next_due_date);

create index if not exists recurring_bills_category_idx
  on public.recurring_bills (category_id);

create index if not exists bill_payments_user_due_idx
  on public.bill_payments (user_id, due_date);

create index if not exists bill_payments_bill_idx
  on public.bill_payments (recurring_bill_id);

create index if not exists bill_payments_transaction_idx
  on public.bill_payments (transaction_id);

-- ---------------------------------------------------------------------------
-- Grants: authenticated read on everything; writes only where policy allows.
-- ---------------------------------------------------------------------------

grant select on
  public.profiles,
  public.categories,
  public.cash_positions,
  public.income_schedules,
  public.transactions,
  public.budgets,
  public.recurring_bills,
  public.bill_payments
to authenticated;

grant insert, update, delete on
  public.categories,
  public.cash_positions,
  public.income_schedules,
  public.transactions,
  public.budgets,
  public.recurring_bills
to authenticated;

-- profiles: no client insert; display name/timezone updates only.
grant update (display_name, timezone) on public.profiles to authenticated;

-- bill_payments is read-only for clients; the payment RPC is the write path.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view own categories" on public.categories;
create policy "Users can view own categories"
on public.categories for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can insert own categories" on public.categories;
create policy "Users can insert own categories"
on public.categories for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can update own non-system categories" on public.categories;
create policy "Users can update own non-system categories"
on public.categories for update
to authenticated
using (user_id = (select auth.uid()) and not is_system)
with check (user_id = (select auth.uid()) and not is_system);

drop policy if exists "Users can delete own non-system categories" on public.categories;
create policy "Users can delete own non-system categories"
on public.categories for delete
to authenticated
using (user_id = (select auth.uid()) and not is_system);

-- ---------------------------------------------------------------------------
-- cash_positions
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view own cash position" on public.cash_positions;
create policy "Users can view own cash position"
on public.cash_positions for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can insert own cash position" on public.cash_positions;
create policy "Users can insert own cash position"
on public.cash_positions for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can update own cash position" on public.cash_positions;
create policy "Users can update own cash position"
on public.cash_positions for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete own cash position" on public.cash_positions;
create policy "Users can delete own cash position"
on public.cash_positions for delete
to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- income_schedules
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view own income schedules" on public.income_schedules;
create policy "Users can view own income schedules"
on public.income_schedules for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can insert own income schedules" on public.income_schedules;
create policy "Users can insert own income schedules"
on public.income_schedules for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can update own income schedules" on public.income_schedules;
create policy "Users can update own income schedules"
on public.income_schedules for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete own income schedules" on public.income_schedules;
create policy "Users can delete own income schedules"
on public.income_schedules for delete
to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view own transactions" on public.transactions;
create policy "Users can view own transactions"
on public.transactions for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can insert own transactions" on public.transactions;
create policy "Users can insert own transactions"
on public.transactions for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can update own transactions" on public.transactions;
create policy "Users can update own transactions"
on public.transactions for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete own transactions" on public.transactions;
create policy "Users can delete own transactions"
on public.transactions for delete
to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view own budgets" on public.budgets;
create policy "Users can view own budgets"
on public.budgets for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can insert own budgets" on public.budgets;
create policy "Users can insert own budgets"
on public.budgets for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can update own budgets" on public.budgets;
create policy "Users can update own budgets"
on public.budgets for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete own budgets" on public.budgets;
create policy "Users can delete own budgets"
on public.budgets for delete
to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- recurring_bills
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view own recurring bills" on public.recurring_bills;
create policy "Users can view own recurring bills"
on public.recurring_bills for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can insert own recurring bills" on public.recurring_bills;
create policy "Users can insert own recurring bills"
on public.recurring_bills for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can update own recurring bills" on public.recurring_bills;
create policy "Users can update own recurring bills"
on public.recurring_bills for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete own bills without payment history" on public.recurring_bills;
create policy "Users can delete own bills without payment history"
on public.recurring_bills for delete
to authenticated
using (
  user_id = (select auth.uid())
  and not exists (
    select 1 from public.bill_payments
    where bill_payments.recurring_bill_id = recurring_bills.id
  )
);

-- ---------------------------------------------------------------------------
-- bill_payments (read-only for clients)
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view own bill payments" on public.bill_payments;
create policy "Users can view own bill payments"
on public.bill_payments for select
to authenticated
using (user_id = (select auth.uid()));
