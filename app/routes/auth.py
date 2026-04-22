"""
routes/auth.py
    POST /api/auth/verify   → vérifie username + password (retourne valid: bool)
    PUT  /api/auth/password  → change le mot de passe [admin]
"""

from flask import Blueprint, request
from app.database import get_db
from app.middleware import success, error, admin_required
from app.repositories import ConfigRepository

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

ADMIN_USERNAME = "loafadmin"


@auth_bp.post("/verify")
def verify():
    body     = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", "")).strip()

    if not username or not password:
        return error("Champs 'username' et 'password' requis", "MISSING_FIELDS", 400)

    if username != ADMIN_USERNAME:
        return success({"valid": False})

    db = get_db()
    stored = ConfigRepository(db).get("admin_password")

    if stored is None:
        return error("Configuration introuvable", "CONFIG_ERROR", 500)

    return success({"valid": password == stored})


@auth_bp.put("/password")
@admin_required
def change_password():
    body         = request.get_json(silent=True) or {}
    new_password = str(body.get("new_password", "")).strip()

    if not new_password or len(new_password) < 4:
        return error("Le mot de passe doit faire au moins 4 caractères", "INVALID_PASSWORD", 400)

    db = get_db()
    ConfigRepository(db).set("admin_password", new_password)
    return success(message="Mot de passe modifié avec succès")
