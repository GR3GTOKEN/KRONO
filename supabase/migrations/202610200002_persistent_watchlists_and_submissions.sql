create table if not exists public.watchlist_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  coin_id text not null check (
    char_length(coin_id) between 1 and 100
    and coin_id ~ '^[a-zA-Z0-9-]+$'
  ),
  created_at timestamptz not null default now(),
  primary key (user_id, coin_id)
);

alter table public.watchlist_items enable row level security;

drop policy if exists "Users can read their own watchlist"
  on public.watchlist_items;
create policy "Users can read their own watchlist"
  on public.watchlist_items for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add to their own watchlist"
  on public.watchlist_items;
create policy "Users can add to their own watchlist"
  on public.watchlist_items for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove from their own watchlist"
  on public.watchlist_items;
create policy "Users can remove from their own watchlist"
  on public.watchlist_items for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.watchlist_items from anon, authenticated;
grant select, insert, delete on public.watchlist_items to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

alter table public.project_submissions
  alter column user_id set default auth.uid();

do $$
declare
  duplicate_contracts text;
begin
  select string_agg(
    format('%s / %s (%s rows)', blockchain, contract, submission_count),
    '; '
    order by blockchain, contract
  )
  into duplicate_contracts
  from (
    select
      min(blockchain) as blockchain,
      min(contract) as contract,
      count(*) as submission_count
    from public.project_submissions
    where status <> 'rejected'
    group by lower(blockchain), lower(contract)
    having count(*) > 1
    order by lower(blockchain), lower(contract)
    limit 10
  ) duplicates;

  if duplicate_contracts is not null then
    raise exception using
      errcode = '23505',
      message = 'Cannot create the active project network/contract uniqueness index because duplicate submissions already exist.',
      detail = duplicate_contracts,
      hint = 'Review and resolve duplicate submissions without deleting user data, then rerun this migration.';
  end if;
end;
$$;

create unique index if not exists project_submissions_active_contract_unique
  on public.project_submissions (lower(blockchain), lower(contract))
  where status <> 'rejected';

drop policy if exists "Admins can read project submissions"
  on public.project_submissions;
create policy "Admins can read project submissions"
  on public.project_submissions for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can review project submissions"
  on public.project_submissions;
create policy "Admins can review project submissions"
  on public.project_submissions for update
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

revoke all on public.project_submissions from anon, authenticated;
grant select (
  id, name, symbol, blockchain, contract, website, logo, category,
  description, status, created_at
) on public.project_submissions to anon, authenticated;
grant insert (
  name, symbol, blockchain, contract, website, logo, category, description, contact
) on public.project_submissions to authenticated;
grant update (status) on public.project_submissions to authenticated;
