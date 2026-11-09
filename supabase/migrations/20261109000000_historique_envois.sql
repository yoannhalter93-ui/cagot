-- Historique d'envoi des devis et factures (à qui, quand, comment), visible sur chaque document.
create table public.envois_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  destinataires text[] not null default '{}' check (cardinality(destinataires) <= 20),
  moyen text not null check (moyen in ('email', 'partage')),
  created_at timestamptz not null default now()
);
create index envois_documents_document_idx on public.envois_documents (document_id, created_at desc);
alter table public.envois_documents enable row level security;
create policy "envois : lecture" on public.envois_documents for select to authenticated using ((select auth.uid()) = user_id);
create policy "envois : création" on public.envois_documents for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (select 1 from public.documents d where d.id = document_id and d.user_id = (select auth.uid())));
revoke all on public.envois_documents from anon;
grant select, insert on public.envois_documents to authenticated;
