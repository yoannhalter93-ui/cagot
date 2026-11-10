-- Agenda : rendez-vous et jours de chantier de l'artisan, éventuellement liés à un chantier.
-- + un lien d'abonnement secret (agenda_jetons) pour voir ce planning dans l'agenda du téléphone
--   (Google Agenda, iPhone, Outlook) via la fonction « agenda » (format iCalendar).
create table public.rendez_vous (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  chantier_id uuid references public.chantiers (id) on delete set null,
  type text not null default 'rdv' check (type in ('visite', 'travaux', 'rdv', 'autre')),
  titre text not null check (char_length(titre) between 1 and 200),
  debut timestamptz not null,
  fin timestamptz not null,
  journee boolean not null default false,
  lieu text not null default '' check (char_length(lieu) <= 300),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fin >= debut),
  check (fin - debut <= interval '366 days')
);
create index rendez_vous_user_idx on public.rendez_vous (user_id, debut);
create index rendez_vous_chantier_idx on public.rendez_vous (chantier_id);
alter table public.rendez_vous enable row level security;
create policy "rendez-vous : lecture" on public.rendez_vous for select to authenticated using ((select auth.uid()) = user_id);
create policy "rendez-vous : création" on public.rendez_vous for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "rendez-vous : modification" on public.rendez_vous for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "rendez-vous : suppression" on public.rendez_vous for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.rendez_vous from anon;

create table public.agenda_jetons (
  user_id uuid primary key references auth.users (id) on delete cascade,
  jeton text not null unique check (char_length(jeton) >= 60),
  created_at timestamptz not null default now()
);
alter table public.agenda_jetons enable row level security;
revoke all on public.agenda_jetons from anon, authenticated;

-- Lien d'abonnement de l'artisan connecté (créé au besoin ; p_nouveau = true invalide l'ancien lien).
create or replace function public.lien_agenda(p_nouveau boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_jeton text;
begin
  if v_uid is null then raise exception 'non authentifié'; end if;
  select jeton into v_jeton from public.agenda_jetons where user_id = v_uid;
  if v_jeton is null or p_nouveau then
    v_jeton := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.agenda_jetons (user_id, jeton) values (v_uid, v_jeton)
      on conflict (user_id) do update set jeton = excluded.jeton, created_at = now();
  end if;
  return v_jeton;
end;
$$;
revoke all on function public.lien_agenda(boolean) from public, anon;
grant execute on function public.lien_agenda(boolean) to authenticated;
