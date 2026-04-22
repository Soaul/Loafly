"""
routes/rankings.py

    GET /api/rankings/product/<product_type_id>   → classement pour un produit
    GET /api/rankings/overall                      → classement général
"""

from flask import Blueprint
from app.database import get_db
from app.middleware import success, error
from app.repositories import ProductTypeRepository
from app.services import get_product_ranking, get_overall_ranking

rankings_bp = Blueprint("rankings", __name__, url_prefix="/api/rankings")


@rankings_bp.get("/product/<product_type_id>")
def product_ranking(product_type_id: str):
    """
    Classement des boulangeries pour un type de produit donné.
    Les scores sont agrégés sur tous les avis (moyenne par critère).

    Exemple de réponse :
    {
      "data": [
        {
          "rank": 1,
          "bakery": { "id": "...", "name": "Première Moisson", ... },
          "aggregated_scores": { "Goût": 4.5, "Croustillance": 4.0, ... },
          "overall_average": 4.25,
          "rating_count": 3
        },
        ...
      ]
    }
    """
    db = get_db()

    if not ProductTypeRepository(db).find_by_id(product_type_id):
        return error("Type de produit introuvable", "NOT_FOUND", 404)

    ranked = get_product_ranking(db, product_type_id)
    return success(ranked)


@rankings_bp.get("/overall")
def overall_ranking():
    """
    Classement général des boulangeries.
    Chaque boulangerie est notée sur la moyenne de ses moyennes produits.
    Seules les boulangeries ayant au moins un avis apparaissent.

    Exemple de réponse :
    {
      "data": [
        {
          "rank": 1,
          "bakery": { "id": "...", "name": "...", ... },
          "overall_average": 4.3,
          "product_count": 2,
          "total_ratings": 7,
          "product_averages": [
            { "product_type": { "id": "...", "name": "Baguette", "emoji": "🥖" }, "average": 4.5, "rating_count": 4 },
            { "product_type": { "id": "...", "name": "Croissant", "emoji": "🥐" }, "average": 4.1, "rating_count": 3 }
          ]
        },
        ...
      ]
    }
    """
    db = get_db()
    ranked = get_overall_ranking(db)
    return success(ranked)
