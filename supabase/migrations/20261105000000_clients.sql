-- Carnet de clients de l'artisan (privé, comme le reste).
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  nom text not null default '' check (char_length(nom) <= 200),
  telephone text not null default '' check (char_length(telephone) <= 40),
  email text not null default '' check (char_length(email) <= 200),
  adresse text not null default '' check (char_length(adresse) <= 500),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_user_idx on public.clients (user_id, nom);

alter table public.clients enable row level security;
create policy "clients : lecture" on public.clients for select to authenticated using ((select auth.uid()) = user_id);
create policy "clients : création" on public.clients for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "clients : modification" on public.clients for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "clients : suppression" on public.clients for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.clients from anon;
