-- Notifications sur le téléphone de l'artisan (Web Push), par ex. quand un client signe un devis.
create table if not exists public.push_abonnements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  endpoint text not null unique check (char_length(endpoint) between 10 and 1000 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  appareil text not null default '' check (char_length(appareil) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists push_abonnements_user_idx on public.push_abonnements (user_id);
alter table public.push_abonnements enable row level security;
create policy "push : lecture" on public.push_abonnements for select to authenticated using ((select auth.uid()) = user_id);
create policy "push : création" on public.push_abonnements for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "push : suppression" on public.push_abonnements for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.push_abonnements from anon;

-- Clés VAPID du serveur (créées par la fonction « push » elle-même, jamais lisibles par les utilisateurs).
create table if not exists public.cles_serveur (
  nom text primary key,
  valeur jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.cles_serveur enable row level security;
revoke all on public.cles_serveur from anon, authenticated;

-- Une seule notification par signature.
alter table public.partages_devis add column if not exists notifie_at timestamptz;
