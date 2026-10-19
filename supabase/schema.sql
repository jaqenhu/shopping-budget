-- >_ schema · 小账本的私人抽屉 🔐
-- 在自己的 Supabase 项目执行；这里只定义结构与权限，不包含购物记录。
begin;

create table if not exists public.shopping_budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

-- [ownership] 登录只是入口；RLS 继续限定每个人只能读写自己的那一行。
alter table public.shopping_budgets enable row level security;
revoke all on table public.shopping_budgets from public, anon, authenticated;
grant select, insert, update on table public.shopping_budgets to authenticated;

drop policy if exists "Users access only their own budget" on public.shopping_budgets;
create policy "Users access only their own budget"
  on public.shopping_budgets for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- [timestamp] 更新时间由数据库记录，避免依赖各设备的本地时钟。
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
