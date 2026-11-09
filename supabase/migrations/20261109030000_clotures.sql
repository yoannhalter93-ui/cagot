-- Clôtures périodiques (loi anti-fraude TVA, art. 286 I-3° bis CGI) : à la fin de chaque mois et de
-- chaque année, les totaux (factures, avoirs, TVA, encaissements) et le cumul depuis le début
-- (« grand total perpétuel ») sont scellés dans le journal chaîné. Rien ne peut plus les modifier.
alter table public.journal_factures drop constraint journal_factures_evenement_check;
alter table public.journal_factures add constraint journal_factures_evenement_check
  check (evenement in ('emission', 'avoir', 'paiement', 'cloture'));

-- Clôture toutes les périodes terminées pas encore clôturées (appelée à l'ouverture du journal).
create or replace function public.cloturer_periodes()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_debut date;
  v_mois date;
  v_fin date;
  v_ce_mois date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  n int := 0;
  v_periode text;
begin
  if v_uid is null then raise exception 'non authentifié'; end if;
  perform pg_advisory_xact_lock(hashtext('cloture-' || v_uid::text));
  select date_trunc('month', min((donnees->>'horodatage')::timestamptz) at time zone 'Europe/Paris')::date into v_debut
    from public.journal_factures where user_id = v_uid and evenement <> 'cloture';
  if v_debut is null then return jsonb_build_object('clotures', 0); end if;

  v_mois := v_debut;
  while v_mois < v_ce_mois loop
    v_fin := (v_mois + interval '1 month')::date;
    v_periode := to_char(v_mois, 'YYYY-MM');
    if not exists (select 1 from public.journal_factures where user_id = v_uid and evenement = 'cloture' and donnees->>'periode' = v_periode) then
      perform public.ajouter_cloture(v_uid, 'mensuelle', v_periode, v_mois, v_fin);
      n := n + 1;
    end if;
    -- clôture annuelle au passage d'une année terminée
    if extract(month from v_mois) = 12 then
      v_periode := to_char(v_mois, 'YYYY');
      if not exists (select 1 from public.journal_factures where user_id = v_uid and evenement = 'cloture' and donnees->>'periode' = v_periode) then
        perform public.ajouter_cloture(v_uid, 'annuelle', v_periode, make_date(extract(year from v_mois)::int, 1, 1), v_fin);
        n := n + 1;
      end if;
    end if;
    v_mois := v_fin;
  end loop;
  return jsonb_build_object('clotures', n);
end;
$$;

-- Totaux d'une période calculés à partir du journal lui-même (pas des documents modifiables).
create or replace function public.ajouter_cloture(p_user uuid, p_type text, p_periode text, p_debut date, p_fin date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t record;
  p record;
  c record;
begin
  select count(*) filter (where evenement = 'emission') as nb_factures,
         count(*) filter (where evenement = 'avoir') as nb_avoirs,
         coalesce(sum(case when evenement = 'avoir' then -abs((donnees->>'total_ht')::numeric) else (donnees->>'total_ht')::numeric end), 0) as ht,
         coalesce(sum(case when evenement = 'avoir' then -abs((donnees->>'montant_tva')::numeric) else (donnees->>'montant_tva')::numeric end), 0) as tva,
         coalesce(sum(case when evenement = 'avoir' then -abs((donnees->>'total_ttc')::numeric) else (donnees->>'total_ttc')::numeric end), 0) as ttc
    into t
    from public.journal_factures
   where user_id = p_user and evenement in ('emission', 'avoir')
     and ((donnees->>'horodatage')::timestamptz at time zone 'Europe/Paris')::date >= p_debut
     and ((donnees->>'horodatage')::timestamptz at time zone 'Europe/Paris')::date < p_fin;
  select count(*) as nb, coalesce(sum((donnees->>'montant')::numeric), 0) as total into p
    from public.journal_factures
   where user_id = p_user and evenement = 'paiement'
     and ((donnees->>'horodatage')::timestamptz at time zone 'Europe/Paris')::date >= p_debut
     and ((donnees->>'horodatage')::timestamptz at time zone 'Europe/Paris')::date < p_fin;
  select coalesce(sum(case when evenement = 'avoir' then -abs((donnees->>'total_ttc')::numeric) when evenement = 'emission' then (donnees->>'total_ttc')::numeric else 0 end), 0) as ttc,
         coalesce(sum((donnees->>'montant')::numeric) filter (where evenement = 'paiement'), 0) as encaisse
    into c
    from public.journal_factures
   where user_id = p_user and evenement in ('emission', 'avoir', 'paiement')
     and ((donnees->>'horodatage')::timestamptz at time zone 'Europe/Paris')::date < p_fin;
  perform public.ajouter_journal(p_user, null, 'cloture', null, jsonb_build_object(
    'type', p_type, 'periode', p_periode, 'du', p_debut, 'au', p_fin - 1,
    'nb_factures', t.nb_factures, 'nb_avoirs', t.nb_avoirs,
    'total_ht', round(t.ht, 2), 'total_tva', round(t.tva, 2), 'total_ttc', round(t.ttc, 2),
    'nb_paiements', p.nb, 'encaisse', round(p.total, 2),
    'cumul_perpetuel_ttc', round(c.ttc, 2), 'cumul_perpetuel_encaisse', round(c.encaisse, 2)));
end;
$$;

revoke all on function public.ajouter_cloture(uuid, text, text, date, date) from public, anon, authenticated;
revoke all on function public.cloturer_periodes() from public, anon;
grant execute on function public.cloturer_periodes() to authenticated;
