from functools import wraps
from flask import request, jsonify
from app.database import get_db


# ── Response helpers ──────────────────────────────────────────────────────────

def success(data=None, message: str | None = None, status: int = 200):
    body: dict = {}
    if data is not None:
        body["data"] = data
    if message:
        body["message"] = message
    return jsonify(body), status


def error(message: str, code: str | None = None, status: int = 400):
    body = {"error": message}
    if code:
        body["code"] = code
    return jsonify(body), status


# ── Admin PIN middleware ───────────────────────────────────────────────────────

def admin_required(f):
    """
    Décorateur pour les routes admin.
    Le client doit envoyer le header X-Admin-Pin avec le PIN correct.

    En production, remplacer par un JWT signé ou une session Flask sécurisée.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        pin = request.headers.get("X-Admin-Pin", "").strip()
        if not pin:
            return error("Header X-Admin-Pin manquant", "ADMIN_REQUIRED", 401)

        db = get_db()
        result = (
            db.table("app_config")
            .select("value")
            .eq("key", "admin_pin")
            .maybe_single()
            .execute()
        )

        if not result.data:
            return error("Configuration admin introuvable", "CONFIG_ERROR", 500)

        if result.data["value"] != pin:
            return error("PIN incorrect", "INVALID_PIN", 403)

        return f(*args, **kwargs)

    return decorated
