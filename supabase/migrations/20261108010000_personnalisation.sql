-- Personnalisation : début des numéros choisi par l'artisan (ex. « PP » → PP-2026-001),
-- reprise de la numérotation venant d'un autre logiciel, et réglages visibles sur la page client.

-- Préfixe : 1 à 10 lettres/chiffres, sinon DEV / FAC. Le compteur reste le même (aucun trou, aucun doublon).
create or replace function public.prefixe_numero(p_uid uuid, p_type text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select upper(e.infos->>(case p_type when 'devis' then 'prefixe_devis' else 'prefixe_facture' end))
       from public.entreprises e
      where e.user_id = p_uid
        and upper(e.infos->>(case p_type when 'devis' then 'prefixe_devis' else 'prefixe_facture' end)) ~ '^[A-Z0-9]{1,10}$'),
    case p_type when 'devis' then 'DEV' else 'FAC' end);
$$;
revoke all on function public.prefixe_numero(uuid, text) from public, anon, authenticated;

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
  return public.prefixe_numero(v_uid, p_type) || '-' || v_annee || '-' || lpad(v_valeur::text, 3, '0');
end;
$$;
revoke all on function public.prochain_numero(text) from public, anon, authenticated;

-- Aperçu des prochains numéros ; avec p_prochain_facture, l'artisan qui arrive d'un autre logiciel
-- continue sa numérotation de l'année (le compteur ne peut qu'avancer : jamais de doublon).
create or replace function public.numerotation(p_prochain_facture int default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    'devis', public.prefixe_numero(v_uid, 'devis') || '-' || v_annee || '-' || lpad((coalesce(v_devis, 0) + 1)::text, 3, '0'),
    'facture', public.prefixe_numero(v_uid, 'facture') || '-' || v_annee || '-' || lpad((coalesce(v_facture, 0) + 1)::text, 3, '0'),
    'facture_suivante', coalesce(v_facture, 0) + 1);
end;
$$;
revoke all on function public.numerotation(int) from public, anon;
grant execute on function public.numerotation(int) to authenticated;

-- Page client du devis : le modèle, les textes, les labels et le pied de page de l'artisan.
create or replace function public.devis_public(p_jeton text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.partages_devis;
  d public.documents;
  e jsonb;
begin
  select * into v from public.partages_devis where jeton = p_jeton;
  if not found or v.revoque or v.expire_at < now() then return jsonb_build_object('erreur', 'lien_invalide'); end if;
  select * into d from public.documents where id = v.document_id and type = 'devis';
  if not found then return jsonb_build_object('erreur', 'lien_invalide'); end if;
  select infos into e from public.entreprises where user_id = d.user_id;
  update public.partages_devis set consulte_at = coalesce(consulte_at, now()) where id = v.id;
  return jsonb_build_object(
    'numero', d.numero, 'date_document', d.date_document, 'statut', d.statut,
    'contenu', coalesce(v.contenu_signe, d.contenu),
    'entreprise', jsonb_build_object(
      'nom', e->>'nom', 'adresse', e->>'adresse', 'telephone', e->>'telephone', 'email', e->>'email',
      'siret', e->>'siret', 'tva_intra', e->>'tva_intra', 'franchise_tva', coalesce((e->>'franchise_tva')::boolean, false),
      'assurance', e->>'assurance', 'validite', e->>'validite', 'acompte', e->>'acompte', 'conditions', e->>'conditions',
      'logo', e->>'logo', 'couleur', e->>'couleur',
      'modele', e->>'modele', 'intro_devis', e->>'intro_devis', 'fin_devis', e->>'fin_devis',
      'pied_page', e->>'pied_page', 'labels', e->'labels', 'mediateur', e->>'mediateur'),
    'signe_at', v.signe_at, 'signataire_nom', v.signataire_nom, 'signature', v.signature,
    'expire_at', v.expire_at);
end;
$$;
revoke all on function public.devis_public(text) from public;
grant execute on function public.devis_public(text) to anon, authenticated;
