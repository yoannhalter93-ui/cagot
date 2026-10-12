-- Notes de chantier (bloc-notes plein écran) : privées à chaque artisan, comme le reste.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  titre text not null default '' check (char_length(titre) <= 200),
  contenu text not null default '' check (char_length(contenu) <= 50000),
  document_id uuid references public.documents (id) on delete set null,
  envoyee_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_user_idx on public.notes (user_id, updated_at desc);
create index notes_document_idx on public.notes (document_id);

alter table public.notes enable row level security;
create policy "notes : lecture" on public.notes for select to authenticated using ((select auth.uid()) = user_id);
create policy "notes : création" on public.notes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "notes : modification" on public.notes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "notes : suppression" on public.notes for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.notes from anon;
