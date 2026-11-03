-- Limite des e-mails envoyés par Cagot pour chaque compte (fonction « envoyer »).
create table public.envois_email (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  destinataires int not null,
  created_at timestamptz not null default now()
);
create index envois_email_user_idx on public.envois_email (user_id, created_at desc);
alter table public.envois_email enable row level security;  -- aucune policy : accès via la fonction uniquement
revoke all on public.envois_email from anon, authenticated;

-- Enregistre un envoi ; renvoie false si la limite du jour (en nombre de destinataires) est atteinte.
create or replace function public.enregistrer_envoi_email(p_destinataires int, p_limite_par_jour int default 60)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_total int;
begin
  if v_uid is null then raise exception 'non authentifié'; end if;
  if p_destinataires < 1 or p_destinataires > 5 then return false; end if;
  perform pg_advisory_xact_lock(hashtext('email' || v_uid::text));
  delete from public.envois_email where user_id = v_uid and created_at < now() - interval '2 days';
  select coalesce(sum(destinataires), 0) into v_total from public.envois_email
   where user_id = v_uid and created_at > now() - interval '1 day';
  if v_total + p_destinataires > least(greatest(p_limite_par_jour, 1), 200) then return false; end if;
  insert into public.envois_email (user_id, destinataires) values (v_uid, p_destinataires);
  return true;
end;
$$;
revoke all on function public.enregistrer_envoi_email(int, int) from public, anon;
grant execute on function public.enregistrer_envoi_email(int, int) to authenticated;
