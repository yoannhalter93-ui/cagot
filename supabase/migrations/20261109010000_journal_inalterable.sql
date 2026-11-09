-- Inaltérabilité, sécurisation, conservation des factures (loi anti-fraude TVA, art. 286 I-3° bis CGI) :
--  * journal chaîné : chaque émission de facture / d'avoir et chaque paiement est enregistré avec
--    une empreinte SHA-256 qui inclut l'empreinte précédente (toute modification casse la chaîne) ;
--  * paiements enregistrés à part (date, mode, montant), jamais modifiables ni supprimables ;
--  * vérification de la chaîne et des factures (contenu identique à celui scellé à l'émission).
-- + format de numérotation « année-mois-numéro » (comme Henrri : 26-11-189).

-- ------------------------------------------------------------ journal chaîné
create table public.journal_factures (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete restrict,
  document_id uuid references public.documents (id) on delete restrict,
  evenement text not null check (evenement in ('emission', 'avoir', 'paiement')),
  numero text,
  donnees jsonb not null,
  empreinte_precedente text not null,
  empreinte text not null
);
create index journal_factures_user_idx on public.journal_factures (user_id, id);
alter table public.journal_factures enable row level security;
create policy "journal : lecture" on public.journal_factures for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.journal_factures from anon, authenticated;
grant select on public.journal_factures to authenticated;

-- Personne ne modifie ni ne supprime une ligne du journal (même avec la clé de service).
create or replace function public.journal_intouchable() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'le journal des factures ne peut pas être modifié';
end;
$$;
create trigger journal_factures_intouchable before update or delete on public.journal_factures
  for each row execute function public.journal_intouchable();

create or replace function public.empreinte_journal(p_precedente text, p_user uuid, p_evenement text, p_numero text, p_donnees jsonb)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(concat_ws('|', p_precedente, p_user::text, p_evenement, coalesce(p_numero, ''), p_donnees::text), 'UTF8')), 'hex');
$$;

-- Ajoute un événement au bout de la chaîne de l'artisan (verrou : un seul ajout à la fois).
create or replace function public.ajouter_journal(p_user uuid, p_document uuid, p_evenement text, p_numero text, p_donnees jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_prec text;
  v_donnees jsonb := p_donnees || jsonb_build_object('horodatage', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
begin
  perform pg_advisory_xact_lock(hashtext('journal-' || p_user::text));
  select empreinte into v_prec from public.journal_factures where user_id = p_user order by id desc limit 1;
  v_prec := coalesce(v_prec, repeat('0', 64));
  insert into public.journal_factures (user_id, document_id, evenement, numero, donnees, empreinte_precedente, empreinte)
  values (p_user, p_document, p_evenement, p_numero, v_donnees, v_prec, public.empreinte_journal(v_prec, p_user, p_evenement, p_numero, v_donnees));
end;
$$;
revoke all on function public.ajouter_journal(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- Émission d'une facture ou d'un avoir : scellée dans le journal.
create or replace function public.journaliser_emission() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type = 'facture' and old.statut = 'brouillon' and new.statut = 'emise' then
    perform public.ajouter_journal(new.user_id, new.id,
      case when coalesce((new.contenu->>'avoir')::boolean, false) then 'avoir' else 'emission' end,
      new.numero,
      jsonb_build_object(
        'date_document', new.date_document,
        'client', new.contenu->>'client_nom',
        'total_ht', new.contenu->'total_ht', 'montant_tva', new.contenu->'montant_tva', 'total_ttc', new.contenu->'total_ttc',
        'taux_tva', new.contenu->'taux_tva',
        'empreinte_contenu', encode(sha256(convert_to(new.contenu::text, 'UTF8')), 'hex')));
  end if;
  return new;
end;
$$;
create trigger documents_journaliser after update on public.documents
  for each row execute function public.journaliser_emission();

-- ------------------------------------------------------------ paiements
create table public.paiements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict default auth.uid(),
  document_id uuid not null references public.documents (id) on delete restrict,
  montant numeric(12, 2) not null check (montant <> 0),
  date_paiement date not null default current_date,
  mode text not null check (mode in ('virement', 'cheque', 'especes', 'carte', 'autre')),
  created_at timestamptz not null default now()
);
create index paiements_document_idx on public.paiements (document_id);
alter table public.paiements enable row level security;
create policy "paiements : lecture" on public.paiements for select to authenticated using ((select auth.uid()) = user_id);
create policy "paiements : création" on public.paiements for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.documents d where d.id = document_id and d.user_id = (select auth.uid()) and d.type = 'facture' and d.statut in ('emise', 'payee')));
revoke all on public.paiements from anon, authenticated;
grant select, insert on public.paiements to authenticated;
create trigger paiements_intouchables before update or delete on public.paiements
  for each row execute function public.journal_intouchable();

create or replace function public.journaliser_paiement() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_numero text;
begin
  select numero into v_numero from public.documents where id = new.document_id;
  perform public.ajouter_journal(new.user_id, new.document_id, 'paiement', v_numero,
    jsonb_build_object('paiement', new.id, 'montant', new.montant, 'date_paiement', new.date_paiement, 'mode', new.mode));
  return new;
end;
$$;
create trigger paiements_journaliser after insert on public.paiements
  for each row execute function public.journaliser_paiement();

-- ------------------------------------------------------------ vérification
-- Recalcule toute la chaîne de l'artisan connecté et compare chaque facture émise à son empreinte.
create or replace function public.verifier_journal()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.journal_factures;
  v_prec text := repeat('0', 64);
  n int := 0;
  d public.documents;
begin
  for r in select * from public.journal_factures where user_id = auth.uid() order by id loop
    n := n + 1;
    if r.empreinte_precedente <> v_prec or r.empreinte <> public.empreinte_journal(v_prec, r.user_id, r.evenement, r.numero, r.donnees) then
      return jsonb_build_object('ok', false, 'nb', n, 'probleme', 'chaine', 'numero', r.numero);
    end if;
    if r.evenement in ('emission', 'avoir') then
      select * into d from public.documents where id = r.document_id;
      if not found or encode(sha256(convert_to(d.contenu::text, 'UTF8')), 'hex') <> r.donnees->>'empreinte_contenu' or d.numero is distinct from r.numero then
        return jsonb_build_object('ok', false, 'nb', n, 'probleme', 'facture_modifiee', 'numero', r.numero);
      end if;
    end if;
    v_prec := r.empreinte;
  end loop;
  return jsonb_build_object('ok', true, 'nb', n, 'derniere_empreinte', v_prec);
end;
$$;
revoke all on function public.verifier_journal() from public, anon;
grant execute on function public.verifier_journal() to authenticated;

-- ------------------------------------------------------------ numérotation : format au choix
create or replace function public.formater_numero(p_uid uuid, p_type text, p_valeur int)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_type = 'facture' and (select e.infos->>'format_facture' from public.entreprises e where e.user_id = p_uid) = 'aa-mm'
      then to_char(now() at time zone 'Europe/Paris', 'YY-MM') || '-' || lpad(p_valeur::text, 3, '0')
    else public.prefixe_numero(p_uid, p_type) || '-' || extract(year from now())::int || '-' || lpad(p_valeur::text, 3, '0')
  end;
$$;
revoke all on function public.formater_numero(uuid, text, int) from public, anon, authenticated;

create or replace function public.prochain_numero(p_type text)
returns text language plpgsql security definer set search_path = '' as $$
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
  return public.formater_numero(v_uid, p_type, v_valeur);
end;
$$;
revoke all on function public.prochain_numero(text) from public, anon, authenticated;

create or replace function public.numerotation(p_prochain_facture int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_annee int := extract(year from now())::int;
  v_devis int;
  v_facture int;
begin
  if v_uid is null then raise exception 'non authentifié'; end if;
  if p_prochain_facture is not null then
    if p_prochain_facture < 1 or p_prochain_facture > 99999 then raise exception 'numéro invalide'; end if;
    insert into public.compteurs as c (user_id, type, annee, valeur)
    values (v_uid, 'facture', v_annee, p_prochain_facture - 1)
    on conflict (user_id, type, annee) do update set valeur = greatest(c.valeur, excluded.valeur);
  end if;
  select valeur into v_devis from public.compteurs where user_id = v_uid and type = 'devis' and annee = v_annee;
  select valeur into v_facture from public.compteurs where user_id = v_uid and type = 'facture' and annee = v_annee;
  return jsonb_build_object(
    'devis', public.formater_numero(v_uid, 'devis', coalesce(v_devis, 0) + 1),
    'facture', public.formater_numero(v_uid, 'facture', coalesce(v_facture, 0) + 1),
    'facture_suivante', coalesce(v_facture, 0) + 1);
end;
$$;
revoke all on function public.numerotation(int) from public, anon;
grant execute on function public.numerotation(int) to authenticated;
