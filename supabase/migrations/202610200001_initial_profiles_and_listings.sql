create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

create table if not exists public.project_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  symbol text not null check (char_length(symbol) between 1 and 12),
  blockchain text not null check (char_length(blockchain) between 1 and 60),
  contract text not null check (char_length(contract) between 1 and 120),
  website text not null check (website ~ '^https?://'),
  logo text not null check (logo ~ '^https?://'),
  category text not null check (char_length(category) between 1 and 40),
  description text not null check (char_length(description) between 1 and 1200),
  contact text not null check (char_length(contact) between 3 and 254),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists project_submissions_user_created_idx
  on public.project_submissions (user_id, created_at desc);

create index if not exists project_submissions_approved_created_idx
  on public.project_submissions (created_at desc)
  where status = 'approved';

alter table public.project_submissions enable row level security;

create policy "Anyone can read approved project listings"
  on public.project_submissions for select
  to anon, authenticated
  using (status = 'approved');

create policy "Users can read their own project submissions"
  on public.project_submissions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Authenticated users can submit projects for review"
  on public.project_submissions for insert
  to authenticated
  with check ((select auth.uid()) = user_id and status = 'pending');

revoke all on public.profiles from anon, authenticated;
grant select, update on public.profiles to authenticated;
revoke all on public.project_submissions from anon, authenticated;
grant select on public.project_submissions to anon, authenticated;
grant insert on public.project_submissions to authenticated;
