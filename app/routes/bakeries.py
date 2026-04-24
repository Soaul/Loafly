"""
routes/bakeries.py

    GET    /api/bakeries          → liste de toutes les boulangeries
    POST   /api/bakeries          → créer [admin]
    GET    /api/bakeries/<id>     → détail + avis regroupés par produit
    DELETE /api/bakeries/<id>     → supprimer [admin]
"""

from flask import Blueprint, request, g
from app.database import get_db
from app.middleware import success, error, admin_required, user_or_admin_required
from app.repositories import BakeryRepository, RatingRepository, ProductTypeRepository



bakeries_bp = Blueprint("bakeries", __name__, url_prefix="/api/bakeries")


@bakeries_bp.get("/")
def list_bakeries():
    """Liste toutes les boulangeries, avec le nombre d'avis par boulangerie."""
    db = get_db()
    bakeries = BakeryRepository(db).find_all()
    all_ratings = RatingRepository(db).find_all()

    rating_counts = {}
    for r in all_ratings:
        rating_counts[r["bakery_id"]] = rating_counts.get(r["bakery_id"], 0) + 1

    for b in bakeries:
        b["rating_count"] = rating_counts.get(b["id"], 0)
        # Normalise les noms de colonnes : latitude/longitude → lat/lng
        if b.get("lat") is None and b.get("latitude") is not None:
            b["lat"] = b["latitude"]
        if b.get("lng") is None and b.get("longitude") is not None:
            b["lng"] = b["longitude"]

    return success(bakeries)


@bakeries_bp.post("/")
@user_or_admin_required
def create_bakery():
    """
    Crée une boulangerie.
    Accessible aux utilisateurs connectés et aux admins.
    Body JSON : { "name": "...", "neighborhood": "...", "address": "..." }
    """
    body         = request.get_json(silent=True) or {}
    name         = str(body.get("name", "")).strip()
    neighborhood = str(body.get("neighborhood", "")).strip()
    address      = str(body.get("address", "")).strip()
    lat          = body.get("lat")
    lng          = body.get("lng")

    if not name:
        return error("Le champ 'name' est requis", "MISSING_NAME", 400)
    if not neighborhood:
        return error("Le champ 'neighborhood' est requis", "MISSING_NEIGHBORHOOD", 400)
    if not address:
        return error("Le champ 'address' est requis", "MISSING_ADDRESS", 400)

    db     = get_db()
    bakery = BakeryRepository(db).create(
        name=name, neighborhood=neighborhood, address=address,
        created_by=g.user_id, lat=lat, lng=lng,
    )
    return success(bakery, "Boulangerie créée", 201)


@bakeries_bp.get("/<bakery_id>")
def get_bakery(bakery_id: str):
    """
    Détail d'une boulangerie : infos + avis regroupés par type de produit,
    avec les scores agrégés calculés côté service.
    """
    db = get_db()
    bakery = BakeryRepository(db).find_by_id(bakery_id)
    if not bakery:
        return error("Boulangerie introuvable", "NOT_FOUND", 404)
    if bakery.get("lat") is None and bakery.get("latitude") is not None:
        bakery["lat"] = bakery["latitude"]
    if bakery.get("lng") is None and bakery.get("longitude") is not None:
        bakery["lng"] = bakery["longitude"]

    ratings      = RatingRepository(db).find_by_bakery(bakery_id)
    product_types = ProductTypeRepository(db).find_all()
    pt_map = {pt["id"]: pt for pt in product_types}

    # Grouper par produit
    by_product: dict[str, list] = {}
    for r in ratings:
        pid = r["product_type_id"]
        by_product.setdefault(pid, []).append(r)

    products_summary = []
    for pid, pt_ratings in by_product.items():
        pt = pt_map.get(pid)
        if not pt:
            continue
        criteria_names = [c["name"] for c in pt["criteria"]]

        agg: dict[str, float] = {}
        for criterion in criteria_names:
            vals = [r["scores"].get(criterion, 0) for r in pt_ratings if r["scores"].get(criterion, 0) > 0]
            agg[criterion] = round(sum(vals) / len(vals), 4) if vals else 0.0

        all_vals = [v for v in agg.values() if v > 0]
        overall = round(sum(all_vals) / len(all_vals), 4) if all_vals else 0.0

        products_summary.append({
            "product_type":      {"id": pt["id"], "name": pt["name"], "emoji": pt["emoji"]},
            "aggregated_scores": agg,
            "overall_average":   overall,
            "rating_count":      len(pt_ratings),
            "individual_ratings": [
                {
                    "id":          r["id"],
                    "author_name": r["author_name"],
                    "scores":      r["scores"],
                    "note":        r["note"],
                    "created_at":  r["created_at"],
                }
                for r in sorted(pt_ratings, key=lambda x: x["created_at"], reverse=True)
            ],
        })

    return success({
        **bakery,
        "products": products_summary,
        "total_ratings": len(ratings),
    })


@bakeries_bp.put("/<bakery_id>")
@admin_required
def update_bakery(bakery_id: str):
    """Met à jour les informations d'une boulangerie [admin]."""
    db   = get_db()
    repo = BakeryRepository(db)

    if not repo.find_by_id(bakery_id):
        return error("Boulangerie introuvable", "NOT_FOUND", 404)

    body  = request.get_json(silent=True) or {}
    fields = {}
    for key in ("name", "neighborhood", "address"):
        val = str(body.get(key, "")).strip()
        if val:
            fields[key] = val
    for key in ("lat", "lng"):
        if body.get(key) is not None:
            fields[key] = body[key]

    if not fields:
        return error("Aucun champ à mettre à jour", "NO_FIELDS", 400)

    bakery = repo.update(bakery_id, **fields)
    return success(bakery, "Boulangerie mise à jour")


@bakeries_bp.delete("/<bakery_id>")
@admin_required
def delete_bakery(bakery_id: str):
    """Supprime une boulangerie et tous ses avis (ON DELETE CASCADE)."""
    db = get_db()
    repo = BakeryRepository(db)

    if not repo.find_by_id(bakery_id):
        return error("Boulangerie introuvable", "NOT_FOUND", 404)

    repo.delete(bakery_id)
    return success(message="Boulangerie supprimée")
