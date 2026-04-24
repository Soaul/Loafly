"""
routes/requests.py

    POST /api/requests          → soumettre une demande [user]
    GET  /api/requests          → lister toutes les demandes [admin]
    PUT  /api/requests/<id>     → mettre à jour le statut [admin]
"""

from flask import Blueprint, request, g
from app.database import get_db
from app.middleware import success, error, user_required, admin_required

requests_bp = Blueprint("requests", __name__, url_prefix="/api/requests")

VALID_TYPES   = ("suggestion", "bug", "autre")
VALID_STATUSES = ("pending", "processed", "rejected")


@requests_bp.post("/")
@user_required
def create_request():
    body        = request.get_json(silent=True) or {}
    type_       = body.get("type", "suggestion")
    subject     = str(body.get("subject", "")).strip()
    message     = str(body.get("message", "")).strip()
    author_name = str(body.get("author_name", "")).strip()

    if type_ not in VALID_TYPES:
        return error("Type invalide", "INVALID_TYPE", 400)
    if not subject:
        return error("Le champ 'subject' est requis", "MISSING_SUBJECT", 400)
    if not message:
        return error("Le champ 'message' est requis", "MISSING_MESSAGE", 400)

    db = get_db()
    result = db.table("requests").insert({
        "user_id":     g.user_id,
        "author_name": author_name,
        "type":        type_,
        "subject":     subject,
        "message":     message,
        "status":      "pending",
    }).execute()

    return success(result.data[0], "Demande envoyée", 201)


@requests_bp.get("/")
@admin_required
def list_requests():
    db = get_db()
    result = (
        db.table("requests")
        .select("*")
        .order("created_at", desc=True)
        .execute()
    )
    return success(result.data)


@requests_bp.put("/<req_id>")
@admin_required
def update_request(req_id: str):
    body   = request.get_json(silent=True) or {}
    status = body.get("status")

    if status not in VALID_STATUSES:
        return error("Statut invalide (pending | processed | rejected)", "INVALID_STATUS", 400)

    db = get_db()
    result = (
        db.table("requests")
        .update({"status": status})
        .eq("id", req_id)
        .execute()
    )
    if not result.data:
        return error("Demande introuvable", "NOT_FOUND", 404)

    return success(result.data[0], "Statut mis à jour")
