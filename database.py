from supabase import create_client, Client
from flask import current_app, g


def get_db() -> Client:
    """
    Retourne le client Supabase attaché au contexte de la requête Flask.
    Utilise la SERVICE ROLE KEY → bypass RLS, réservé au backend uniquement.
    """
    if "db" not in g:
        g.db = create_client(
            current_app.config["SUPABASE_URL"],
            current_app.config["SUPABASE_SERVICE_KEY"],
        )
    return g.db
