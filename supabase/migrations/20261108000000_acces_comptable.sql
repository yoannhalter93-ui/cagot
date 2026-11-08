-- Accès de l'expert-comptable : l'artisan l'invite par un lien secret ; le comptable crée
-- son compte Cagot (ou se connecte), accepte l'invitation, puis consulte en LECTURE SEULE
-- les factures émises et payées de l'artisan. Aucun accès aux devis, chantiers, notes, clients.
-- L'artisan peut retirer l'accès à tout moment.
create table public.acces_comptables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  nom text not null default '' check (char_length(nom) <= 120),
  email text not null default '' check (char_length(email) <= 200),
  jeton text not null unique check (char_length(jeton) >= 40),
  comptable_id uuid references auth.users (id) on delete cascade,
  accepte_at timestamptz,
  consulte_at timestamptz,
  revoque boolean not null default false,
  created_at timestamptz not null default now(),
  check (comptable_id is null or comptable_id <> user_id)
);
create index acces_comptables_user_idx on public.acces_comptables (user_id);
create index acces_comptables_comptable_idx on public.acces_comptables (comptable_id);
alter table public.acces_comptables enable row level security;

-- L'artisan gère ses invitations (le comptable, lui, passe uniquement par les fonctions ci-dessous).
create policy "acces comptables : lecture" on public.acces_comptables for select to authenticated using ((select auth.uid()) = user_id);
create policy "acces comptables : création" on public.acces_comptables for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "acces comptables : modification" on public.acces_comptables for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "acces comptables : suppression" on public.acces_comptables for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.acces_comptables from anon, authenticated;
grant select, delete on public.acces_comptables to authenticated;
grant insert (nom, email, jeton) on public.acces_comptables to authenticated;
grant update (nom, revoque) on public.acces_comptables to authenticated;

-- Le comptable accepte l'invitation (lien secret valable 30 jours, une seule personne).
create or replace function public.accepter_acces_comptable(p_jeton text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.acces_comptables;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'non authentifié'; end if;
  select * into v from public.acces_comptables where jeton = p_jeton for update;
  if not found or v.revoque then return jsonb_build_object('erreur', 'lien_invalide'); end if;
  if v.user_id = v_uid then return jsonb_build_object('erreur', 'propre_compte'); end if;
  if v.comptable_id is not null and v.comptable_id <> v_uid then return jsonb_build_object('erreur', 'deja_utilise'); end if;
  if v.comptable_id is null and v.created_at < now() - interval '30 days' then return jsonb_build_object('erreur', 'expire'); end if;
  update public.acces_comptables set comptable_id = v_uid, accepte_at = coalesce(accepte_at, now()) where id = v.id;
  return jsonb_build_object('ok', true, 'acces', v.id,
    'entreprise', (select e.infos->>'nom' from public.entreprises e where e.user_id = v.user_id));
end;
$$;

-- Les dossiers (artisans) auxquels le comptable connecté a accès.
create or replace function public.dossiers_comptables()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'acces', a.id, 'nom', coalesce(nullif(e.infos->>'nom', ''), 'Entreprise sans nom'),
      'siret', e.infos->>'siret', 'depuis', a.accepte_at) order by e.infos->>'nom'), '[]'::jsonb)
  from public.acces_comptables a
  left join public.entreprises e on e.user_id = a.user_id
  where a.comptable_id = auth.uid() and not a.revoque;
$$;

-- Factures émises et payées d'un dossier, avec les infos de l'entreprise (pour les PDF).
create or replace function public.factures_comptable(p_acces uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.acces_comptables;
begin
  select * into v from public.acces_comptables where id = p_acces and comptable_id = auth.uid() and not revoque;
  if not found then return jsonb_build_object('erreur', 'acces_refuse'); end if;
  update public.acces_comptables set consulte_at = now() where id = v.id;
  return jsonb_build_object(
    'entreprise', coalesce((select e.infos from public.entreprises e where e.user_id = v.user_id), '{}'::jsonb),
    'factures', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'type', d.type, 'numero', d.numero, 'statut', d.statut,
          'date_document', d.date_document, 'updated_at', d.updated_at, 'contenu', d.contenu) order by d.date_document desc, d.numero desc)
      from public.documents d
      where d.user_id = v.user_id and d.type = 'facture' and d.statut in ('emise', 'payee')), '[]'::jsonb));
end;
$$;

revoke all on function public.accepter_acces_comptable(text) from public, anon;
revoke all on function public.dossiers_comptables() from public, anon;
revoke all on function public.factures_comptable(uuid) from public, anon;
grant execute on function public.accepter_acces_comptable(text) to authenticated;
grant execute on function public.dossiers_comptables() to authenticated;
grant execute on function public.factures_comptable(uuid) to authenticated;
