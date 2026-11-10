-- Anciens documents importés d'un autre logiciel (Henrri, Excel…) : archive en lecture seule,
-- avec leur numéro d'origine (pas renumérotés, hors du journal sécurisé de Cagot).
create table if not exists public.factures_importees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  type text not null default 'facture' check (type in ('facture', 'avoir', 'devis')),
  numero text not null check (char_length(numero) between 1 and 60),
  date_document date,
  client_nom text not null default '' check (char_length(client_nom) <= 200),
  objet text not null default '' check (char_length(objet) <= 500),
  total_ht numeric(12, 2),
  total_tva numeric(12, 2),
  total_ttc numeric(12, 2),
  statut text not null default '' check (char_length(statut) <= 60),
  source text not null default '' check (char_length(source) <= 60),
  donnees jsonb not null default '{}'::jsonb check (pg_column_size(donnees) <= 20000),
  created_at timestamptz not null default now(),
  unique (user_id, type, numero)
);
create index if not exists factures_importees_user_idx on public.factures_importees (user_id, date_document desc);
alter table public.factures_importees enable row level security;
create policy "importées : lecture" on public.factures_importees for select to authenticated using ((select auth.uid()) = user_id);
create policy "importées : création" on public.factures_importees for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "importées : suppression" on public.factures_importees for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.factures_importees from anon;
