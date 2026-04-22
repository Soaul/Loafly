-- Comptes utilisateurs
CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT        NOT NULL UNIQUE,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lier les boulangeries et avis aux utilisateurs
ALTER TABLE bakeries ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ratings  ADD COLUMN IF NOT EXISTS user_id    UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ratings  ADD COLUMN IF NOT EXISTS photo_url  TEXT;

CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);
CREATE INDEX IF NOT EXISTS idx_ratings_user  ON ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_bakeries_user ON bakeries(created_by);
