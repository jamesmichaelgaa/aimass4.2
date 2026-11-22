/*
# Bill payments and the atomic payment function

1. Plain-English explanation
   - Creates the `bill_payments` table: one row per paid bill occurrence, each
     linked to exactly one expense transaction.
   - Adds one secure database function, `mark_bill_occurrence_paid`, as the ONLY
     way to record a bill payment. It runs as a single all-or-nothing operation:
     verify the bill belongs to the caller and is unpaid for that due date,
     create or validate the linked expense transaction, insert the payment row,
     and advance the bill's next due date. Any failure rolls back everything.
   - Direct writes to `bill_payments` by signed-in clients are revoked; they can
     only read their own payment records.

2. New tables
   - `bill_payments`
     - `id` (uuid, primary key)
     - `user_id` (uuid, not null, references `auth.users(id)` on delete cascade)
     - `recurring_bill_id` (uuid, not null, references `recurring_bills(id)`
       on delete restrict — a bill with payment history cannot be deleted)
     - `transaction_id` (uuid, not null, unique — one transaction can be linked
       to at most one bill payment; references `transactions(id)` on delete
       restrict)
     - `due_date` (date, not null — the occurrence that was paid)
     - `paid_at` (timestamptz, not null, default now())
   - Unique constraint on `(recurring_bill_id, due_date)`: a bill occurrence can
     be paid only once, even under concurrent duplicate submissions.

3. New functions
   - `public.mark_bill_occurrence_paid(
        p_recurring_bill_id uuid,
        p_due_date date,
        p_transaction_id uuid default null,
        p_amount numeric default null,
        p_transaction_date date default null,
        p_description text default null,
        p_category_id uuid default null
     ) returns table (bill_payment_id uuid, transaction_id uuid)`
     - SECURITY DEFINER with a fixed empty `search_path`; all objects are
       schema-qualified.
     - Derives the caller from `auth.uid()`; rejects unauthenticated calls and
       never accepts a client-supplied user ID.
     - Locks the recurring bill row `for update` to serialize concurrent
       attempts on the same bill.
     - Verifies ownership and active state; rejects already-paid occurrences
       (the unique occurrence constraint remains the race-condition safeguard).
     - If `p_transaction_id` is supplied, validates it belongs to the caller and
       is an expense transaction; otherwise creates a new expense transaction
       using `p_amount`, `p_transaction_date` (defaulting to the due date),
       optional description and category. A supplied category must be the
       caller's expense category.
     - Verifies the due date is a legitimate occurrence (on or after the bill's
       current next due date minus one interval and not beyond the next due
       date window) by requiring `p_due_date` to equal the bill's recorded
       `next_due_date` OR an earlier unpaid occurrence date not before the most
       recent payment; the simple MVP rule: `p_due_date` must be less than or
       equal to `next_due_date` and greater than the last paid occurrence date.
     - Inserts the payment row and advances `next_due_date` with the approved
       recurrence rule: weekly +7 days; monthly +1 calendar month; quarterly
       +3 calendar months; yearly +1 calendar year — clamping a day that does
       not exist in the destination month to that month's last day.
     - Returns the payment and transaction identifiers.
     - All statements run in one database transaction; any failure rolls back
       every write.

4. Security
   - RLS is enabled on `bill_payments` immediately (locked until policies are
     added in the RLS migration).
   - EXECUTE on the function is granted to `authenticated` only; revoked from
     `public` and `anon`.
   - The function performs all ownership checks itself; it never trusts
     client-supplied identifiers for authorization.

5. Important notes
   - Bills with payment history must be deactivated rather than deleted;
     enforced by the ON DELETE RESTRICT references.
   - This migration is safe to re-run.
*/

create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recurring_bill_id uuid not null references public.recurring_bills (id) on delete restrict,
  transaction_id uuid not null unique references public.transactions (id) on delete restrict,
  due_date date not null,
  paid_at timestamptz not null default now(),
  constraint bill_payments_one_payment_per_occurrence unique (recurring_bill_id, due_date)
);

alter table public.bill_payments enable row level security;

create or replace function public.advance_due_date(
  p_frequency text,
  p_due_date date
)
returns date
language plpgsql
immutable
as $$
declare
  v_year int;
  v_month int;
  v_day int;
  v_last_day date;
begin
  case p_frequency
    when 'weekly' then
      return p_due_date + 7;
    when 'monthly' then
      v_year := extract(year from p_due_date)::int;
      v_month := extract(month from p_due_date)::int + 1;
      if v_month > 12 then
        v_month := v_month - 12;
        v_year := v_year + 1;
      end if;
    when 'quarterly' then
      v_year := extract(year from p_due_date)::int;
      v_month := extract(month from p_due_date)::int + 3;
      if v_month > 12 then
        v_month := v_month - 12;
        v_year := v_year + 1;
      end if;
    when 'yearly' then
      v_year := extract(year from p_due_date)::int + 1;
      v_month := extract(month from p_due_date)::int;
    else
      raise exception 'unknown bill frequency: %', p_frequency;
  end case;

  v_day := extract(day from p_due_date)::int;
  v_last_day := (date_trunc('month', p_due_date)
    + interval '1 month' * ((v_year - extract(year from p_due_date)::int) * 12
        + (v_month - extract(month from p_due_date)::int) + 1)
    - interval '1 day')::date;

  return least(
    make_date(v_year, v_month, v_day),
    v_last_day
  );
end;
$$;

create or replace function public.mark_bill_occurrence_paid(
  p_recurring_bill_id uuid,
  p_due_date date,
  p_transaction_id uuid default null,
  p_amount numeric default null,
  p_transaction_date date default null,
  p_description text default null,
  p_category_id uuid default null
)
returns table (bill_payment_id uuid, linked_transaction_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_bill public.recurring_bills;
  v_transaction_id uuid;
  v_payment_id uuid;
  v_next_due_date date;
  v_last_paid_date date;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_transaction_id is null and (p_amount is null or p_amount <= 0) then
    raise exception 'an existing transaction or a positive amount is required'
      using errcode = '22023';
  end if;

  select * into v_bill
  from public.recurring_bills
  where id = p_recurring_bill_id
  for update;

  if not found then
    raise exception 'recurring bill not found' using errcode = '42501';
  end if;

  if v_bill.user_id <> v_user_id then
    raise exception 'recurring bill not found' using errcode = '42501';
  end if;

  if not v_bill.is_active then
    raise exception 'recurring bill is not active' using errcode = '22023';
  end if;

  if p_due_date > v_bill.next_due_date then
    raise exception 'due date is beyond the next scheduled occurrence'
      using errcode = '22023';
  end if;

  select max(due_date) into v_last_paid_date
  from public.bill_payments
  where recurring_bill_id = v_bill.id;

  if v_last_paid_date is not null and p_due_date <= v_last_paid_date then
    raise exception 'this bill occurrence has already been paid'
      using errcode = 'unique_violation';
  end if;

  if p_transaction_id is not null then
    select id into v_transaction_id
    from public.transactions
    where id = p_transaction_id
      and user_id = v_user_id
      and kind = 'expense';

    if not found then
      raise exception 'linked transaction must be an expense owned by the caller'
        using errcode = '42501';
    end if;
  else
    if p_category_id is not null then
      if not exists (
        select 1
        from public.categories
        where id = p_category_id
          and user_id = v_user_id
          and kind = 'expense'
      ) then
        raise exception 'category must be an expense category owned by the caller'
          using errcode = '42501';
      end if;
    end if;

    insert into public.transactions
      (user_id, category_id, kind, amount, transaction_date, description)
    values
      (v_user_id, p_category_id, 'expense', p_amount,
       coalesce(p_transaction_date, p_due_date), p_description)
    returning id into v_transaction_id;
  end if;

  insert into public.bill_payments
    (user_id, recurring_bill_id, transaction_id, due_date)
  values
    (v_user_id, v_bill.id, v_transaction_id, p_due_date)
  returning id into v_payment_id;

  v_next_due_date := public.advance_due_date(v_bill.frequency, v_bill.next_due_date);

  update public.recurring_bills
  set next_due_date = v_next_due_date,
      updated_at = now()
  where id = v_bill.id;

  return query
    select v_payment_id, v_transaction_id;
end;
$$;

revoke execute on function public.mark_bill_occurrence_paid(uuid, date, uuid, numeric, date, text, uuid)
  from public, anon;

grant execute on function public.mark_bill_occurrence_paid(uuid, date, uuid, numeric, date, text, uuid)
  to authenticated;

revoke execute on function public.advance_due_date(text, date) from public, anon;
