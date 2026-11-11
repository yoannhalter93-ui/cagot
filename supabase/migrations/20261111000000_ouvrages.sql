-- Ouvrages : un prix de la grille peut être détaillé (matériaux + main-d'œuvre + marge).
-- Le prix de vente reste dans « prix » (calculé par l'appli), le détail dans « composition ».
alter table public.tarifs add column if not exists composition jsonb
  check (composition is null or (jsonb_typeof(composition) = 'object' and pg_column_size(composition) < 20000));
