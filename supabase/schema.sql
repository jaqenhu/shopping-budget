-- Run once in the intended Supabase project. No shopping data is included.
begin;

create table if not exists public.shopping_budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

alter table public.shopping_budgets enable row level security;
revoke all on table public.shopping_budgets from public, anon, authenticated;
grant select, insert, update on table public.shopping_budgets to authenticated;

drop policy if exists "Users access only their own budget" on public.shopping_budgets;
create policy "Users access only their own budget"
  on public.shopping_budgets for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.touch_budget_timestamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shopping_budget_timestamp on public.shopping_budgets;
create trigger shopping_budget_timestamp
  before update on public.shopping_budgets
  for each row execute function public.touch_budget_timestamp();

commit;
