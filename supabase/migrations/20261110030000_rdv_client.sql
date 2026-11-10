-- Rendez-vous lié à un client du carnet (adresse, téléphone et e-mail repris automatiquement).
alter table public.rendez_vous add column if not exists client_id uuid references public.clients (id) on delete set null;
create index if not exists rendez_vous_client_idx on public.rendez_vous (client_id);
