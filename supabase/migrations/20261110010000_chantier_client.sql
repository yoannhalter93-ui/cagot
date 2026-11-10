-- Chantier créé depuis la fiche d'un client : lien vers ce client (ses coordonnées vont dans le
-- devis automatiquement, sans être recopiées dans la note).
alter table public.chantiers add column if not exists client_id uuid references public.clients (id) on delete set null;
create index if not exists chantiers_client_idx on public.chantiers (client_id);
