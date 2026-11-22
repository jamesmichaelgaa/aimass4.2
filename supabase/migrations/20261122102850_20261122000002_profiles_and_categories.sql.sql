/*
# Profiles and user-owned categories

1. Plain-English explanation
   - Creates the `profiles` table (one per signed-up user, with PHP currency and
     Asia/Manila timezone defaults) and the `categories` table.
   - All categories — including the built-in defaults — belong to an individual
     user; there are no globally shared category rows in the MVP.
   - Adds a trusted signup trigger so every new Supabase Auth user automatically
     receives a profile and their own default income/expense categories.
   - Blocks changes to the preferred currency in the MVP, so historical amounts
     are never silently relabelled.

2. New tables
   - `profiles`
     - `id` (uuid, primary key, references `auth.users(id)` on delete cascade)
     - `display_name` (text, nullable)
     - `preferred_currency` (text, not null, default 'PHP', 3 uppercase letters)
     - `timezone` (text, not null, default 'Asia/Manila')
     - `created_at`, `updated_at` (timestamptz, not null)
   - `categories`
     - `id` (uuid, primary key)
     - `user_id` (uuid, not null, references `auth.users(id)` on delete cascade,
       defaults to the authenticated user so client inserts can omit it)
     - `name` (text, not null)
     - `kind` (text, not null, 'income' or 'expense')
     - `is_system` (boolean, not null, default false — true for seeded defaults)
     - `created_at` (timestamptz, not null)

3. Indexes
   - Case-insensitive uniqueness of category names per user and kind:
     unique index on `(user_id, lower(name), kind)`.
   - Supporting index on `(user_id, id)` so later tables can reference a
     category together with its owner in one lookup.

4. Security
   - RLS is enabled on both tables immediately (fully locked until policies are
     added in the RLS migration; no data can be read or written meanwhile).
   - Signup trigger function `public.handle_new_user()`:
     - SECURITY DEFINER with a fixed empty `search_path`; all objects are
       schema-qualified.
     - Creates the profile with PHP / Asia/Manila defaults, idempotently
       (`on conflict do nothing`).
     - Seeds the user's default system categories only when the user has none,
       so retries never duplicate.
     - EXECUTE is revoked from `public` and `anon`; only the auth trigger uses it.
   - `public.enforce_currency_immutable()` trigger blocks any UPDATE that changes
     `preferred_currency` on `profiles`, per the approved decision to block all
     currency changes in the MVP.
   - No secrets or production data are embedded in this migration.

5. Important notes
   - The seeded default categories are: Salary, Other Income (income);
     Food, Transportation, Utilities, Rent, Entertainment, Health, Other
     (expense). All are marked `is_system = true` and are protected from user
     modification/deletion by the RLS policies added in the RLS migration.
   - This migration is safe to re-run.
*/

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  preferred_currency text not null default 'PHP' check (preferred_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Asia/Manila',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('income', 'expense')),
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

create unique index if not exists categories_user_name_kind_unique
  on public.categories (user_id, lower(name), kind);

create unique index if not exists categories_user_id_id_unique
  on public.categories (user_id, id);

-- Keep `updated_at` current on profile edits.
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Approved decision: block all preferred-currency changes in the MVP so
-- historical amounts are never silently relabelled.
create or replace function public.enforce_currency_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.preferred_currency is distinct from old.preferred_currency then
    raise exception 'preferred_currency is fixed in the MVP and cannot be changed'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_currency_immutable on public.profiles;
create trigger profiles_enforce_currency_immutable
before update on public.profiles
for each row execute function public.enforce_currency_immutable();

-- Trusted, idempotent signup initialization: profile + default categories.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.categories where user_id = new.id
  ) then
    insert into public.categories (user_id, name, kind, is_system) values
      (new.id, 'Salary', 'income', true),
      (new.id, 'Other Income', 'income', true),
      (new.id, 'Food', 'expense', true),
      (new.id, 'Transportation', 'expense', true),
      (new.id, 'Utilities', 'expense', true),
      (new.id, 'Rent', 'expense', true),
      (new.id, 'Entertainment', 'expense', true),
      (new.id, 'Health', 'expense', true),
      (new.id, 'Other', 'expense', true);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon;
