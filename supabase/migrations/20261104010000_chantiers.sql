-- Chantiers (conversations avec l'IA) : plusieurs en parallèle, enregistrés en ligne.
create table public.chantiers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  titre text not null default '' check (char_length(titre) <= 200),
  historique jsonb not null default '[]'::jsonb check (pg_column_size(historique) <= 2000000),
  document_id uuid references public.documents (id) on delete set null,
  note_id uuid references public.notes (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chantiers_user_idx on public.chantiers (user_id, updated_at desc);
create index chantiers_document_idx on public.chantiers (document_id);
create index chantiers_note_idx on public.chantiers (note_id);

alter table public.chantiers enable row level security;
create policy "chantiers : lecture" on public.chantiers for select to authenticated using ((select auth.uid()) = user_id);
create policy "chantiers : création" on public.chantiers for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "chantiers : modification" on public.chantiers for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "chantiers : suppression" on public.chantiers for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.chantiers from anon;
