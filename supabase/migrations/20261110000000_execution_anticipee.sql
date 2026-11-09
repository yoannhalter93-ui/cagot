-- Contrat hors établissement : le client peut demander expressément, en signant, que les travaux
-- commencent avant la fin du délai de rétractation de 14 jours (art. L221-25 du Code de la consommation).
-- La demande est enregistrée dans le devis signé et dans la preuve de signature.
drop function if exists public.signer_devis(text, text, text, jsonb);
-- Signature par le client : options retenues, totaux recalculés, devis passé en « accepté ».
create or replace function public.signer_devis(p_jeton text, p_nom text, p_signature text, p_options jsonb, p_execution_anticipee boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.partages_devis;
  d public.documents;
  c jsonb;
  sections jsonb := '[]'::jsonb;
  s jsonb;
  l jsonb;
  lignes jsonb;
  ht numeric := 0;
  st numeric;
  total_ligne numeric;
  taux numeric;
  taux_l numeric;
  tva numeric := 0;
  cle text;
  si int := 0;
  li int;
  entetes jsonb;
  bases jsonb := '{}'::jsonb;
  ventilation jsonb := '[]'::jsonb;
  k text;
  autoliq boolean;
begin
  select * into v from public.partages_devis where jeton = p_jeton for update;
  if not found or v.revoque or v.expire_at < now() then raise exception 'lien_invalide'; end if;
  if v.signe_at is not null then raise exception 'deja_signe'; end if;
  if char_length(trim(coalesce(p_nom, ''))) < 2 or char_length(p_nom) > 120 then raise exception 'nom_invalide'; end if;
  if p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or char_length(p_signature) > 400000 then raise exception 'signature_invalide'; end if;
  if p_options is not null and jsonb_typeof(p_options) <> 'array' then raise exception 'options_invalides'; end if;
  select * into d from public.documents where id = v.document_id and type = 'devis' for update;
  if not found or d.statut not in ('brouillon', 'envoye') then raise exception 'devis_indisponible'; end if;

  c := d.contenu;
  taux := coalesce((c->>'taux_tva')::numeric, 10);
  autoliq := coalesce((c->>'autoliquidation')::boolean, false) and coalesce(c->>'client_type', '') = 'pro';
  for s in select * from jsonb_array_elements(coalesce(c->'sections', '[]'::jsonb)) loop
    lignes := '[]'::jsonb;
    st := 0;
    li := 0;
    for l in select * from jsonb_array_elements(coalesce(s->'lignes', '[]'::jsonb)) loop
      cle := si || '-' || li;
      if coalesce((l->>'option')::boolean, false) then
        l := l || jsonb_build_object('option_retenue', coalesce(p_options, '[]'::jsonb) ? cle);
      end if;
      total_ligne := round(coalesce((l->>'quantite')::numeric, 0) * coalesce((l->>'prix_unitaire_ht')::numeric, 0), 2);
      l := l || jsonb_build_object('total_ht', total_ligne);
      if not coalesce((l->>'option')::boolean, false) or coalesce((l->>'option_retenue')::boolean, false) then
        st := st + total_ligne;
        taux_l := case when autoliq then 0 when jsonb_typeof(l->'taux_tva') = 'number' then (l->>'taux_tva')::numeric else taux end;
        bases := jsonb_set(bases, array[taux_l::text], to_jsonb(coalesce((bases->>(taux_l::text))::numeric, 0) + total_ligne));
      end if;
      lignes := lignes || jsonb_build_array(l);
      li := li + 1;
    end loop;
    sections := sections || jsonb_build_array(s || jsonb_build_object('lignes', lignes, 'sous_total_ht', round(st, 2)));
    ht := ht + st;
    si := si + 1;
  end loop;
  for k in select key from jsonb_each(bases) order by key::numeric desc loop
    ventilation := ventilation || jsonb_build_array(jsonb_build_object('taux', k::numeric, 'base_ht', round((bases->>k)::numeric, 2),
      'montant_tva', round(round((bases->>k)::numeric, 2) * k::numeric / 100, 2)));
    tva := tva + round(round((bases->>k)::numeric, 2) * k::numeric / 100, 2);
  end loop;
  ht := round(ht, 2);
  c := c || jsonb_build_object('sections', sections, 'total_ht', ht, 'montant_tva', tva, 'total_ttc', ht + tva,
    'ventilation_tva', case when jsonb_array_length(ventilation) > 0 then ventilation else jsonb_build_array(jsonb_build_object('taux', taux, 'base_ht', 0, 'montant_tva', 0)) end,
    'signature_client', jsonb_build_object('nom', trim(p_nom), 'date', now(), 'execution_anticipee', coalesce(p_execution_anticipee, false)),
    'suivi', coalesce(c->'suivi', '{}'::jsonb) || jsonb_build_object('accepte', now()));

  begin
    entetes := current_setting('request.headers', true)::jsonb;
  exception when others then entetes := null;
  end;
  update public.partages_devis set
    signe_at = now(), signataire_nom = trim(p_nom), signature = p_signature, options_retenues = coalesce(p_options, '[]'::jsonb),
    contenu_signe = c,
    preuve = jsonb_build_object('ip', entetes->>'x-forwarded-for', 'navigateur', left(entetes->>'user-agent', 300), 'numero', d.numero, 'execution_anticipee', coalesce(p_execution_anticipee, false))
  where id = v.id;
  update public.documents set contenu = c, statut = 'accepte' where id = d.id;
  return jsonb_build_object('ok', true, 'signe_at', now());
end;
$$;

revoke all on function public.signer_devis(text, text, text, jsonb, boolean) from public;
grant execute on function public.signer_devis(text, text, text, jsonb, boolean) to anon, authenticated;
