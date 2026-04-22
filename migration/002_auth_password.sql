-- Remplace le PIN par un mot de passe admin
-- Mot de passe par défaut : Loafly2024!  (à changer après la première connexion)

INSERT INTO app_config (key, value)
VALUES ('admin_password', 'Loafly2024!')
ON CONFLICT (key) DO NOTHING;
