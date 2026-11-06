-- Boîte mail de l'artisan branchée sur Cagot (envoi des devis depuis sa propre adresse).
-- Le mot de passe d'application est chiffré par la fonction serveur ; aucune policy :
-- la table n'est lisible et modifiable que par les fonctions serveur (clé de service).
create table public.boites_mail (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null check (char_length(email) <= 200),
  nom_affiche text not null default '' check (char_length(nom_affiche) <= 120),
  hote text not null check (char_length(hote) <= 120),
  port int not null default 465 check (port in (465, 2465, 2525)),
  utilisateur text not null check (char_length(utilisateur) <= 200),
  mdp_chiffre text not null check (char_length(mdp_chiffre) <= 2000),
  updated_at timestamptz not null default now()
);
alter table public.boites_mail enable row level security;
revoke all on public.boites_mail from anon, authenticated;
