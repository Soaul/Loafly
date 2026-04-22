-- 005_bakeries_coords.sql
-- Ajoute les coordonnées GPS aux boulangeries pour l'affichage sur la carte

ALTER TABLE bakeries
  ADD COLUMN IF NOT EXISTS lat  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng  DOUBLE PRECISION;
