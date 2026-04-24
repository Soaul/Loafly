"""
routes/ratings.py
    POST /api/ratings/   → soumettre un avis (compte utilisateur requis)
"""

from flask import Blueprint, request, g
from app.database import get_db
from app.middleware import success, error, user_required, admin_required
from app.repositories import RatingRepository, BakeryRepository, ProductTypeRepository

ratings_bp = Blueprint("ratings", __name__, url_prefix="/api/ratings")


@ratings_bp.post("/")
@user_required
def submit_rating():
    body = request.get_json(silent=True) or {}

    bakery_id       = str(body.get("bakery_id", "")).strip()
    product_type_id = str(body.get("product_type_id", "")).strip()
    scores          = body.get("scores", {})
    author_name     = str(body.get("author_name", "Anonyme")).strip() or "Anonyme"
    note            = str(body.get("note", "")).strip()
    photo_url       = str(body.get("photo_url", "")).strip() or None

    if not bakery_id:
        return error("Le champ 'bakery_id' est requis", "MISSING_FIELD", 400)
    if not product_type_id:
        return error("Le champ 'product_type_id' est requis", "MISSING_FIELD", 400)
    if not isinstance(scores, dict) or not scores:
        return error("Le champ 'scores' doit être un objet non vide", "INVALID_SCORES", 400)

    db = get_db()

    bakery = BakeryRepository(db).find_by_id(bakery_id)
    if not bakery:
        return error("Boulangerie introuvable", "NOT_FOUND", 404)

    pt = ProductTypeRepository(db).find_by_id(product_type_id)
    if not pt:
        return error("Type de produit introuvable", "NOT_FOUND", 404)

    expected_criteria = {c["name"] for c in pt["criteria"]}
    missing = expected_criteria - set(scores.keys())
    if missing:
        return error(
            f"Critères manquants dans 'scores' : {', '.join(sorted(missing))}",
            "MISSING_CRITERIA", 400,
        )

    invalid = {
        k: v for k, v in scores.items()
        if k in expected_criteria and (not isinstance(v, int) or not 1 <= v <= 5)
    }
    if invalid:
        return error(
            f"Scores invalides (valeurs attendues : 1–5) : {invalid}",
            "INVALID_SCORE_VALUE", 400,
        )

    clean_scores = {k: v for k, v in scores.items() if k in expected_criteria}

    result = (
        db.table("ratings")
        .insert({
            "bakery_id":       bakery_id,
            "product_type_id": product_type_id,
            "scores":          clean_scores,
            "author_name":     author_name,
            "note":            note,
            "photo_url":       photo_url,
            "user_id":         g.user_id,
        })
        .execute()
    )

    return success(result.data[0], "Avis enregistré, merci !", 201)


@ratings_bp.get("/mine")
@user_required
def my_ratings():
    """Avis de l'utilisateur connecté avec détails boulangerie + produit."""
    db = get_db()
    result = (
        db.table("ratings")
        .select("*, bakeries(id, name, neighborhood), product_types(id, name, emoji)")
        .eq("user_id", g.user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return success(result.data)


@ratings_bp.get("/")
@admin_required
def list_ratings():
    """Tous les avis avec détails boulangerie + produit [admin]."""
    db      = get_db()
    ratings = RatingRepository(db).find_all_detailed()
    return success(ratings)


@ratings_bp.delete("/<rating_id>")
@admin_required
def delete_rating(rating_id: str):
    """Supprime un avis [admin]."""
    db   = get_db()
    repo = RatingRepository(db)
    repo.delete_by_id(rating_id)
    return success(message="Avis supprimé")
