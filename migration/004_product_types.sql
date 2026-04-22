-- 004_product_types.sql
-- Produits typiques de boulangerie artisanale avec critères d'évaluation intelligents
-- À exécuter dans Supabase SQL Editor

-- Baguette
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Baguette', '🥖') RETURNING id
), c(name, pos) AS (
  VALUES ('Croûte', 0), ('Mie', 1), ('Cuisson', 2), ('Saveur', 3), ('Conservation', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Croissant
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Croissant', '🥐') RETURNING id
), c(name, pos) AS (
  VALUES ('Feuilletage', 0), ('Croustillant', 1), ('Beurre', 2), ('Cuisson', 3), ('Légèreté', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Pain au chocolat
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Pain au chocolat', '🍫') RETURNING id
), c(name, pos) AS (
  VALUES ('Feuilletage', 0), ('Chocolat', 1), ('Croustillant', 2), ('Cuisson', 3), ('Équilibre', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Pain de campagne
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Pain de campagne', '🍞') RETURNING id
), c(name, pos) AS (
  VALUES ('Croûte', 0), ('Mie', 1), ('Saveur', 2), ('Fermentation', 3), ('Conservation', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Brioche
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Brioche', '🧈') RETURNING id
), c(name, pos) AS (
  VALUES ('Moelleux', 0), ('Beurre', 1), ('Dorure', 2), ('Légèreté', 3), ('Saveur', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Pain aux raisins
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Pain aux raisins', '🌀') RETURNING id
), c(name, pos) AS (
  VALUES ('Feuilletage', 0), ('Crème pâtissière', 1), ('Raisins', 2), ('Cuisson', 3), ('Saveur', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Éclair
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Éclair', '⚡') RETURNING id
), c(name, pos) AS (
  VALUES ('Pâte à choux', 0), ('Crème', 1), ('Glaçage', 2), ('Équilibre', 3), ('Fraîcheur', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Tarte
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Tarte', '🥧') RETURNING id
), c(name, pos) AS (
  VALUES ('Pâte', 0), ('Garniture', 1), ('Équilibre sucré', 2), ('Fraîcheur', 3), ('Présentation', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Cookie
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Cookie', '🍪') RETURNING id
), c(name, pos) AS (
  VALUES ('Moelleux', 0), ('Garniture', 1), ('Cuisson', 2), ('Saveur', 3), ('Générosité', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Bagel
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Bagel', '🥯') RETURNING id
), c(name, pos) AS (
  VALUES ('Moelleux', 0), ('Croûte', 1), ('Saveur', 2), ('Garnitures', 3), ('Fraîcheur', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Muffin
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Muffin', '🫐') RETURNING id
), c(name, pos) AS (
  VALUES ('Moelleux', 0), ('Garniture', 1), ('Cuisson', 2), ('Saveur', 3), ('Humidité', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Macaron
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Macaron', '🫠') RETURNING id
), c(name, pos) AS (
  VALUES ('Coques', 0), ('Ganache', 1), ('Collerette', 2), ('Saveur', 3), ('Texture', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;

-- Financier
WITH pt AS (
  INSERT INTO product_types (name, emoji) VALUES ('Financier', '🟡') RETURNING id
), c(name, pos) AS (
  VALUES ('Moelleux', 0), ('Beurre noisette', 1), ('Cuisson', 2), ('Saveur', 3), ('Croûte', 4)
)
INSERT INTO criteria (product_type_id, name, position) SELECT pt.id, c.name, c.pos FROM pt, c;
