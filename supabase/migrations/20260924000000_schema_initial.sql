-- Schéma Cagot : chaque artisan n'accède qu'à ses propres données (Row Level Security).

-- ---------------------------------------------------------------- entreprises
create table public.entreprises (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  infos jsonb not null default '{}'::jsonb,
  metiers text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- tarifs
create table public.tarifs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  corps_etat text not null default '',
  designation text not null check (char_length(designation) <= 300),
  unite text not null default 'u' check (char_length(unite) <= 20),
  prix numeric(12, 2) not null default 0 check (prix >= 0),
  created_at timestamptz not null default now()
);
create index tarifs_user_idx on public.tarifs (user_id);

-- ---------------------------------------------------------------- documents
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  type text not null check (type in ('devis', 'facture')),
  statut text not null default 'brouillon'
    check (statut in ('brouillon', 'envoye', 'accepte', 'refuse', 'emise', 'payee')),
  numero text,
  date_document timestamptz not null default now(),
  devis_id uuid references public.documents (id) on delete set null,
  contenu jsonb not null,
  conversation jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, numero)
);
create index documents_user_idx on public.documents (user_id, created_at desc);
create index documents_devis_idx on public.documents (devis_id);

-- ---------------------------------------------------------------- numérotation
-- Compteurs par artisan / type / année. Pas d'accès direct : uniquement via les fonctions.
create table public.compteurs (
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  annee int not null,
  valeur int not null default 0,
  primary key (user_id, type, annee)
);

create or replace function public.prochain_numero(p_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_annee int := extract(year from now())::int;
  v_valeur int;
begin
  if v_uid is null then raise exception 'non authentifié'; end if;
  if p_type not in ('devis', 'facture') then raise exception 'type invalide'; end if;
  insert into public.compteurs as c (user_id, type, annee, valeur)
  values (v_uid, p_type, v_annee, 1)
  on conflict (user_id, type, annee) do update set valeur = c.valeur + 1
  returning valeur into v_valeur;
  return (case p_type when 'devis' then 'DEV' else 'FAC' end) || '-' || v_annee || '-' || lpad(v_valeur::text, 3, '0');
end;
$$;
-- Jamais appelable directement (sinon on pourrait « sauter » des numéros de facture).
revoke all on function public.prochain_numero(text) from public, anon, authenticated;

-- Numéro de devis attribué automatiquement à la création (jamais fourni par l'appli).
create or replace function public.numeroter_devis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.devis_id is not null and not exists (
    select 1 from public.documents d where d.id = new.devis_id and d.user_id = new.user_id
  ) then
    raise exception 'devis d''origine introuvable';
  end if;
  if new.type = 'devis' then
    new.numero := public.prochain_numero('devis');
  end if;
  if new.type = 'facture' then
    new.numero := null;           -- une facture reçoit son numéro seulement à l'émission
    new.statut := 'brouillon';
  end if;
  return new;
end;
$$;
create trigger documents_numeroter before insert on public.documents
  for each row execute function public.numeroter_devis();

-- Émission d'une facture : numéro chronologique sans trou, puis verrouillage.
create or replace function public.emettre_facture(p_id uuid)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documents;
begin
  select * into v_doc from public.documents
   where id = p_id and user_id = auth.uid() and type = 'facture'
   for update;
  if not found then raise exception 'facture introuvable'; end if;
  if v_doc.statut <> 'brouillon' then raise exception 'facture déjà émise'; end if;
  update public.documents
     set numero = public.prochain_numero('facture'), statut = 'emise', date_document = now()
   where id = p_id
   returning * into v_doc;
  return v_doc;
end;
$$;
revoke all on function public.emettre_facture(uuid) from public, anon;
grant execute on function public.emettre_facture(uuid) to authenticated;
revoke all on function public.numeroter_devis() from public, anon, authenticated;

-- Règles de protection des documents :
--  * une facture émise ne peut plus être modifiée (seul le passage à « payée » est permis) ;
--  * une facture émise ne peut pas être supprimée (obligation légale de conservation) ;
--  * le numéro, le type et le propriétaire ne peuvent jamais être modifiés à la main.
create or replace function public.proteger_documents()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.type = 'facture' and old.statut <> 'brouillon' then
      raise exception 'une facture émise ne peut pas être supprimée (faire un avoir)';
    end if;
    return old;
  end if;

  if new.user_id <> old.user_id or new.type <> old.type then
    raise exception 'modification interdite';
  end if;
  if new.numero is distinct from old.numero
     and not (old.type = 'facture' and old.statut = 'brouillon' and new.statut = 'emise') then
    raise exception 'le numéro ne peut pas être modifié';
  end if;
  if old.type = 'facture' and old.statut <> 'brouillon' then
    if new.contenu <> old.contenu or new.date_document <> old.date_document
       or new.statut not in ('emise', 'payee') then
      raise exception 'une facture émise ne peut plus être modifiée';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger documents_proteger before update or delete on public.documents
  for each row execute function public.proteger_documents();

-- ---------------------------------------------------------------- RLS
alter table public.entreprises enable row level security;
alter table public.tarifs enable row level security;
alter table public.documents enable row level security;
alter table public.compteurs enable row level security;  -- aucune policy : inaccessible directement

create policy "entreprise : lecture" on public.entreprises for select to authenticated using ((select auth.uid()) = user_id);
create policy "entreprise : création" on public.entreprises for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "entreprise : modification" on public.entreprises for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "tarifs : lecture" on public.tarifs for select to authenticated using ((select auth.uid()) = user_id);
create policy "tarifs : création" on public.tarifs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "tarifs : modification" on public.tarifs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tarifs : suppression" on public.tarifs for delete to authenticated using ((select auth.uid()) = user_id);

create policy "documents : lecture" on public.documents for select to authenticated using ((select auth.uid()) = user_id);
create policy "documents : création" on public.documents for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "documents : modification" on public.documents for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "documents : suppression" on public.documents for delete to authenticated using ((select auth.uid()) = user_id);

-- Aucun accès pour les visiteurs non connectés.
revoke all on public.entreprises, public.tarifs, public.documents, public.compteurs from anon;
revoke all on public.compteurs from authenticated;
