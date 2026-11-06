-- Devis interactif : le client ouvre un lien secret, choisit ses options et signe.
create table public.partages_devis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  jeton text not null unique check (char_length(jeton) >= 40),
  expire_at timestamptz not null default now() + interval '90 days',
  revoque boolean not null default false,
  consulte_at timestamptz,
  signe_at timestamptz,
  signataire_nom text check (char_length(signataire_nom) <= 120),
  signature text check (char_length(signature) <= 400000),
  options_retenues jsonb,
  contenu_signe jsonb,
  preuve jsonb,
  created_at timestamptz not null default now()
);
create index partages_devis_document_idx on public.partages_devis (document_id);
alter table public.partages_devis enable row level security;
create policy "partages : lecture" on public.partages_devis for select to authenticated using ((select auth.uid()) = user_id);
create policy "partages : création" on public.partages_devis for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (select 1 from public.documents d where d.id = document_id and d.user_id = (select auth.uid()) and d.type = 'devis'));
create policy "partages : modification" on public.partages_devis for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "partages : suppression" on public.partages_devis for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.partages_devis from anon;

-- Lecture publique d'un devis par son lien (sans compte) : seulement ce qu'il faut pour l'afficher.
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
      'logo', e->>'logo', 'couleur', e->>'couleur'),
    'signe_at', v.signe_at, 'signataire_nom', v.signataire_nom, 'signature', v.signature,
    'expire_at', v.expire_at);
end;
$$;

-- Signature par le client : options retenues, totaux recalculés, devis passé en « accepté ».
create or replace function public.signer_devis(p_jeton text, p_nom text, p_signature text, p_options jsonb)
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
  tva numeric;
  cle text;
  si int := 0;
  li int;
  entetes jsonb;
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
      end if;
      lignes := lignes || jsonb_build_array(l);
      li := li + 1;
    end loop;
    sections := sections || jsonb_build_array(s || jsonb_build_object('lignes', lignes, 'sous_total_ht', round(st, 2)));
    ht := ht + st;
    si := si + 1;
  end loop;
  taux := coalesce((c->>'taux_tva')::numeric, 10);
  ht := round(ht, 2);
  tva := round(ht * taux / 100, 2);
  c := c || jsonb_build_object('sections', sections, 'total_ht', ht, 'montant_tva', tva, 'total_ttc', ht + tva,
    'signature_client', jsonb_build_object('nom', trim(p_nom), 'date', now()),
    'suivi', coalesce(c->'suivi', '{}'::jsonb) || jsonb_build_object('accepte', now()));

  begin
    entetes := current_setting('request.headers', true)::jsonb;
  exception when others then entetes := null;
  end;
  update public.partages_devis set
    signe_at = now(), signataire_nom = trim(p_nom), signature = p_signature, options_retenues = coalesce(p_options, '[]'::jsonb),
    contenu_signe = c,
    preuve = jsonb_build_object('ip', entetes->>'x-forwarded-for', 'navigateur', left(entetes->>'user-agent', 300), 'numero', d.numero)
  where id = v.id;
  update public.documents set contenu = c, statut = 'accepte' where id = d.id;
  return jsonb_build_object('ok', true, 'signe_at', now());
end;
$$;

revoke all on function public.devis_public(text) from public;
revoke all on function public.signer_devis(text, text, text, jsonb) from public;
grant execute on function public.devis_public(text) to anon, authenticated;
grant execute on function public.signer_devis(text, text, text, jsonb) to anon, authenticated;
