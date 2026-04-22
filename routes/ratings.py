"""
routes/ratings.py

    POST /api/ratings   → soumettre un avis (public, sans authentification)
"""

from flask import Blueprint, request
from app.database import get_db
from app.middleware import success, error
from app.repositories import RatingRepository, BakeryRepository, ProductTypeRepository

ratings_bp = Blueprint("ratings", __name__, url_prefix="/api/ratings")


@ratings_bp.post("/")
def submit_rating():
    """
    Soumet un avis utilisateur. Accessible publiquement (pas d'auth requise).

    Body JSON :
    {
        "bakery_id":        "uuid",
        "product_type_id":  "uuid",
        "scores":           { "Goût": 4, "Croustillance": 3, ... },
        "author_name":      "Marie",    (optionnel)
        "note":             "Excellent" (optionnel)
    }

    Validations :
        - bakery_id et product_type_id doivent exister en base
        - scores doit contenir tous les critères du produit, avec des valeurs 1–5
    """
    body = request.get_json(silent=True) or {}

    bakery_id       = str(body.get("bakery_id", "")).strip()
    product_type_id = str(body.get("product_type_id", "")).strip()
    scores          = body.get("scores", {})
    author_name     = str(body.get("author_name", "Anonyme")).strip() or "Anonyme"
    note            = str(body.get("note", "")).strip()

    # ── Validation des champs requis ──────────────────────────────────────────
    if not bakery_id:
        return error("Le champ 'bakery_id' est requis", "MISSING_FIELD", 400)
    if not product_type_id:
        return error("Le champ 'product_type_id' est requis", "MISSING_FIELD", 400)
    if not isinstance(scores, dict) or not scores:
        return error("Le champ 'scores' doit être un objet non vide", "INVALID_SCORES", 400)

    db = get_db()

    # ── Vérification des entités ──────────────────────────────────────────────
    bakery = BakeryRepository(db).find_by_id(bakery_id)
    if not bakery:
        return error("Boulangerie introuvable", "NOT_FOUND", 404)

    pt = ProductTypeRepository(db).find_by_id(product_type_id)
    if not pt:
        return error("Type de produit introuvable", "NOT_FOUND", 404)

    # ── Validation des scores vs critères attendus ────────────────────────────
    expected_criteria = {c["name"] for c in pt["criteria"]}
    missing = expected_criteria - set(scores.keys())
    if missing:
        return error(
            f"Critères manquants dans 'scores' : {', '.join(sorted(missing))}",
            "MISSING_CRITERIA",
            400,
        )

    invalid = {
        k: v for k, v in scores.items()
        if k in expected_criteria and (not isinstance(v, int) or not 1 <= v <= 5)
    }
    if invalid:
        return error(
            f"Scores invalides (valeurs attendues : 1–5) : {invalid}",
            "INVALID_SCORE_VALUE",
            400,
        )

    # Garder uniquement les critères connus (ignore les extras)
    clean_scores = {k: v for k, v in scores.items() if k in expected_criteria}

    # ── Enregistrement ────────────────────────────────────────────────────────
    rating = RatingRepository(db).create(
        bakery_id=bakery_id,
        product_type_id=product_type_id,
        scores=clean_scores,
        author_name=author_name,
        note=note,
    )

    return success(rating, "Avis enregistré, merci !", 201)
