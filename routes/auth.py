"""
routes/auth.py
    POST /api/auth/verify   → vérifie le PIN (retourne valid: bool)
    PUT  /api/auth/pin      → change le PIN [admin]
"""

from flask import Blueprint, request
from app.database import get_db
from app.middleware import success, error, admin_required
from app.repositories import ConfigRepository

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.post("/verify")
def verify_pin():
    """
    Vérifie si le PIN fourni est valide.
    Le frontend stocke le PIN en mémoire si la réponse est valid=true.

    Body JSON : { "pin": "1234" }
    """
    body = request.get_json(silent=True) or {}
    pin = str(body.get("pin", "")).strip()

    if not pin:
        return error("Champ 'pin' requis", "MISSING_PIN", 400)

    db = get_db()
    repo = ConfigRepository(db)
    stored_pin = repo.get("admin_pin")

    if stored_pin is None:
        return error("Configuration introuvable", "CONFIG_ERROR", 500)

    return success({"valid": pin == stored_pin})


@auth_bp.put("/pin")
@admin_required
def change_pin():
    """
    Change le PIN admin.
    Requiert le PIN actuel dans X-Admin-Pin (validé par @admin_required).

    Body JSON : { "new_pin": "5678" }
    """
    body = request.get_json(silent=True) or {}
    new_pin = str(body.get("new_pin", "")).strip()

    if not new_pin or len(new_pin) < 4:
        return error("Le nouveau PIN doit faire au moins 4 caractères", "INVALID_PIN", 400)

    db = get_db()
    ConfigRepository(db).set("admin_pin", new_pin)
    return success(message="PIN modifié avec succès")
