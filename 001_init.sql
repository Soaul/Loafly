-- =============================================================================
--  Boulangeries MTL — Schéma initial
--  À exécuter dans l'éditeur SQL de Supabase (une seule fois)
-- =============================================================================

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_types (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    emoji       TEXT        NOT NULL DEFAULT '🍞',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS criteria (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_type_id UUID        NOT NULL REFERENCES product_types(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    position        SMALLINT    NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(product_type_id, name)
);

CREATE TABLE IF NOT EXISTS bakeries (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    neighborhood TEXT        NOT NULL DEFAULT '',
    address      TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ratings (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    bakery_id       UUID        NOT NULL REFERENCES bakeries(id) ON DELETE CASCADE,
    product_type_id UUID        NOT NULL REFERENCES product_types(id) ON DELETE CASCADE,
    -- scores stocké en JSONB : { "Goût": 4, "Croustillance": 3, ... }
    scores          JSONB       NOT NULL DEFAULT '{}',
    author_name     TEXT        NOT NULL DEFAULT 'Anonyme',
    note            TEXT        NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ── Index utiles ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_criteria_product_type   ON criteria(product_type_id);
CREATE INDEX IF NOT EXISTS idx_ratings_bakery          ON ratings(bakery_id);
CREATE INDEX IF NOT EXISTS idx_ratings_product_type    ON ratings(product_type_id);
CREATE INDEX IF NOT EXISTS idx_ratings_bakery_product  ON ratings(bakery_id, product_type_id);

-- ── Données initiales ─────────────────────────────────────────────────────────

-- PIN admin par défaut (à changer via l'API)
INSERT INTO app_config (key, value)
VALUES ('admin_pin', '1234')
ON CONFLICT (key) DO NOTHING;

-- Types de produits par défaut (UUIDs fixes pour les critères)
INSERT INTO product_types (id, name, emoji) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Baguette',        '🥖'),
    ('a0000000-0000-0000-0000-000000000002', 'Croissant',       '🥐'),
    ('a0000000-0000-0000-0000-000000000003', 'Tarte au citron', '🍋')
ON CONFLICT DO NOTHING;

-- Critères d'évaluation par défaut
INSERT INTO criteria (product_type_id, name, position) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Goût',          0),
    ('a0000000-0000-0000-0000-000000000001', 'Croustillance',  1),
    ('a0000000-0000-0000-0000-000000000001', 'Mie moelleuse',  2),
    ('a0000000-0000-0000-0000-000000000001', 'Cuisson',        3),
    ('a0000000-0000-0000-0000-000000000002', 'Goût',          0),
    ('a0000000-0000-0000-0000-000000000002', 'Feuilletage',    1),
    ('a0000000-0000-0000-0000-000000000002', 'Beurre',         2),
    ('a0000000-0000-0000-0000-000000000002', 'Dorure',         3),
    ('a0000000-0000-0000-0000-000000000003', 'Goût',          0),
    ('a0000000-0000-0000-0000-000000000003', 'Acidité',        1),
    ('a0000000-0000-0000-0000-000000000003', 'Pâte sablée',   2),
    ('a0000000-0000-0000-0000-000000000003', 'Présentation',   3)
ON CONFLICT DO NOTHING;

-- =============================================================================
--  RLS (Row Level Security)
--  Le backend Flask utilise la SERVICE ROLE KEY → RLS bypassé côté serveur.
--  Ces politiques sont là pour documenter l'intention si tu passes au client Supabase direct.
-- =============================================================================

-- ALTER TABLE product_types ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE criteria       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE bakeries       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ratings        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE app_config     ENABLE ROW LEVEL SECURITY;

-- Lecture publique
-- CREATE POLICY "Public read" ON product_types FOR SELECT USING (true);
-- CREATE POLICY "Public read" ON criteria       FOR SELECT USING (true);
-- CREATE POLICY "Public read" ON bakeries       FOR SELECT USING (true);
-- CREATE POLICY "Public read" ON ratings        FOR SELECT USING (true);
-- Écriture uniquement via le backend (service role)
