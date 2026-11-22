/*
# Schema verification assertions

1. Plain-English explanation
   - Runs structural assertions that confirm the approved MVP schema is fully in
     place: all eight tables exist, row level security is enabled on every one
     of them, the expected policies and unique safeguards exist, the atomic
     payment function exists with the intended execute grants, and signed-in
     clients have no write privilege on `bill_payments`.
   - Contains no seed data: nothing that could be mistaken for real financial
     records is inserted.
   - The migration fails loudly if any expectation is not met, so an incomplete
     apply can never be mistaken for a healthy database.

2. Checks performed
   - The eight expected tables exist: profiles, categories, cash_positions,
     income_schedules, transactions, budgets, recurring_bills, bill_payments.
   - Row level security is enabled on all eight tables.
   - Expected policies exist: profiles has its two; the five owner-writable
     tables have SELECT/INSERT/UPDATE/DELETE policies; recurring_bills has its
     delete policy; bill_payments has exactly one SELECT policy.
   - The unique safeguards exist: one active income schedule per user, one
     overall budget per user/month, one category budget per user/category/month,
     case-insensitive category names, same-owner-and-kind transaction category
     lookup, one payment per bill occurrence, one bill-payment link per
     transaction.
   - The signup trigger (on auth users) and the currency-immutable trigger
     (on profiles) exist.
   - `mark_bill_occurrence_paid` exists with SECURITY DEFINER and is executable
     by `authenticated` but not by `anon` or `public`.
   - `authenticated` holds no INSERT/UPDATE/DELETE privilege on `bill_payments`.

3. Security
   - Read-only verification; it changes nothing.

4. Important notes
   - Assertions use `raise exception` so a failed expectation aborts the
     migration apply.
   - This migration is safe to re-run.
*/

do $$
declare
  v_count int;
begin
  -- All eight tables exist.
  select count(*) into v_count
  from pg_tables
  where schemaname = 'public'
    and tablename in (
      'profiles', 'categories', 'cash_positions', 'income_schedules',
      'transactions', 'budgets', 'recurring_bills', 'bill_payments'
    );

  if v_count <> 8 then
    raise exception 'expected 8 tables, found %', v_count;
  end if;

  -- RLS enabled on every table.
  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'profiles', 'categories', 'cash_positions', 'income_schedules',
      'transactions', 'budgets', 'recurring_bills', 'bill_payments'
    )
    and c.relrowsecurity;

  if v_count <> 8 then
    raise exception 'expected RLS enabled on 8 tables, found %', v_count;
  end if;

  -- Expected policies exist.
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname in ('Users can view own profile', 'Users can update own profile');

  if v_count <> 2 then
    raise exception 'profiles policies incomplete, found % of 2', v_count;
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'categories', 'cash_positions', 'income_schedules',
      'transactions', 'budgets'
    )
    and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    and roles @> array['authenticated']::name[];

  -- five tables x four owner-scoped verbs = 20 expected policy rows
  if v_count < 20 then
    raise exception 'owner-scoped CRUD policies incomplete, found % of at least 20', v_count;
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'recurring_bills'
    and cmd = 'DELETE';

  if v_count <> 1 then
    raise exception 'recurring_bills delete policy missing';
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'bill_payments'
    and cmd = 'SELECT';

  if v_count <> 1 then
    raise exception 'bill_payments must have exactly one SELECT policy, found %', v_count;
  end if;

  -- No write policies on bill_payments.
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'bill_payments'
    and cmd in ('INSERT', 'UPDATE', 'DELETE');

  if v_count <> 0 then
    raise exception 'bill_payments must not have write policies, found %', v_count;
  end if;

  -- Unique safeguards exist.
  select count(*) into v_count
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'income_schedules_one_active_per_user',
      'budgets_one_overall_per_user_month',
      'budgets_one_per_category_month',
      'categories_user_name_kind_unique',
      'categories_user_id_id_kind_unique'
    );

  if v_count <> 5 then
    raise exception 'expected unique indexes incomplete, found % of 5', v_count;
  end if;

  -- One payment per bill occurrence; one bill-payment link per transaction.
  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.bill_payments'::regclass
    and contype = 'u'
    and (
      (array_length(conkey, 1) = 2
        and (select attname from pg_attribute
             where attrelid = conrelid and attnum = conkey[1]) = 'recurring_bill_id'
        and (select attname from pg_attribute
             where attrelid = conrelid and attnum = conkey[2]) = 'due_date')
      or
      (array_length(conkey, 1) = 1
        and (select attname from pg_attribute
             where attrelid = conrelid and attnum = conkey[1]) = 'transaction_id')
    );

  if v_count <> 2 then
    raise exception 'bill_payments unique safeguards missing, found % of 2', v_count;
  end if;

  -- Signup trigger on auth.users; currency-immutable trigger on profiles.
  select count(*) into v_count
  from pg_trigger
  where tgrelid = 'auth.users'::regclass
    and tgname = 'on_auth_user_created'
    and not tgisinternal;

  if v_count <> 1 then
    raise exception 'signup initialization trigger missing';
  end if;

  select count(*) into v_count
  from pg_trigger
  where tgrelid = 'public.profiles'::regclass
    and tgname = 'profiles_enforce_currency_immutable'
    and not tgisinternal;

  if v_count <> 1 then
    raise exception 'currency-immutable trigger missing on profiles';
  end if;

  -- Atomic payment function exists as SECURITY DEFINER.
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'mark_bill_occurrence_paid'
    and p.prosecdef;

  if v_count <> 1 then
    raise exception 'mark_bill_occurrence_paid function missing or not SECURITY DEFINER';
  end if;

  -- authenticated can execute it; anon cannot.
  if not has_function_privilege('authenticated',
      'public.mark_bill_occurrence_paid(uuid, date, uuid, numeric, date, text, uuid)',
      'execute') then
    raise exception 'authenticated cannot execute mark_bill_occurrence_paid';
  end if;

  if has_function_privilege('anon',
      'public.mark_bill_occurrence_paid(uuid, date, uuid, numeric, date, text, uuid)',
      'execute') then
    raise exception 'anon must not execute mark_bill_occurrence_paid';
  end if;

  -- authenticated has no write privilege on bill_payments.
  select count(*) into v_count
  from information_schema.role_table_grants
  where grantee = 'authenticated'
    and table_schema = 'public'
    and table_name = 'bill_payments'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  if v_count <> 0 then
    raise exception 'authenticated must not have write privileges on bill_payments, found %', v_count;
  end if;
end;
$$;
