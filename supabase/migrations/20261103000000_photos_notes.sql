-- Photos des notes de chantier : rangées dans un espace de stockage privé,
-- un dossier par artisan (<user_id>/<note_id>/<fichier>.jpg), invisible des autres.
alter table public.notes add column photos text[] not null default '{}'
  check (cardinality(photos) <= 20);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos-notes', 'photos-notes', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "photos notes : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'photos-notes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos notes : ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos-notes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos notes : suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'photos-notes' and (storage.foldername(name))[1] = (select auth.uid())::text);
