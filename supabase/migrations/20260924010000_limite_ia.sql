-- Limite du nombre de demandes à l'IA par compte (utilisée par la fonction « discuter »).
create table public.appels_ia (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index appels_ia_user_idx on public.appels_ia (user_id, created_at desc);
alter table public.appels_ia enable row level security;  -- aucune policy : accès via la fonction uniquement
revoke all on public.appels_ia from anon, authenticated;

-- Enregistre un appel pour l'utilisateur connecté ; renvoie false si la limite horaire est atteinte.
create or replace function public.enregistrer_appel_ia(p_limite_par_heure int default 60)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_nombre int;
begin
  if v_uid is null then raise exception 'non authentifié'; end if;
  perform pg_advisory_xact_lock(hashtext(v_uid::text));
  delete from public.appels_ia where user_id = v_uid and created_at < now() - interval '1 day';
  select count(*) into v_nombre from public.appels_ia
   where user_id = v_uid and created_at > now() - interval '1 hour';
  if v_nombre >= least(greatest(p_limite_par_heure, 1), 200) then return false; end if;
  insert into public.appels_ia (user_id) values (v_uid);
  return true;
end;
$$;
revoke all on function public.enregistrer_appel_ia(int) from public, anon;
grant execute on function public.enregistrer_appel_ia(int) to authenticated;
