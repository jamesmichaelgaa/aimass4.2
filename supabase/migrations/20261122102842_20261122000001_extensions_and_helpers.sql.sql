/*
# Extensions and shared helpers

1. Purpose
   - Prepare shared database helpers used by later migrations for aimass4.2.
   - No extensions are required: `gen_random_uuid()` is built into PostgreSQL 13+,
     and this schema uses only core PostgreSQL features.

2. New functions
   - `public.set_updated_at()` — trigger function that refreshes the `updated_at`
     timestamp of a row whenever that row is updated. It is attached to tables
     that have an `updated_at` column in later migrations.

3. Security
   - This helper performs no authorization decisions; it only maintains audit
     timestamps. Trigger functions invoked by the database engine do not require
     EXECUTE privileges from the modifying user.

4. Important notes
   - No tables, data, RLS, or grants are changed in this migration.
   - This migration is safe to re-run (`create or replace`).
*/

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
