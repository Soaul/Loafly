"""
services/ranking_service.py

    Logique de classement — agrégation Python sur les ratings.
    Aucune connaissance de Flask ou de HTTP ici.

    Stratégie d'agrégation :
        Pour une (boulangerie, produit), on moyenne les scores de tous les avis
        par critère, puis on fait la moyenne de ces moyennes → overall_average.

    Classement global :
        Pour chaque boulangerie, on calcule l'overall_average pour chaque produit
        noté, puis on fait la moyenne de ces moyennes produits.
"""

from __future__ import annotations
from supabase import Client
from app.repositories import (
    ProductTypeRepository,
    BakeryRepository,
    RatingRepository,
)


def _avg(values: list[float]) -> float:
    vals = [v for v in values if v > 0]
    return sum(vals) / len(vals) if vals else 0.0


def _aggregate_scores(ratings: list[dict], criteria_names: list[str]) -> dict[str, float]:
    """Moyenne par critère sur un ensemble d'avis."""
    result: dict[str, float] = {}
    for criterion in criteria_names:
        values = [r["scores"].get(criterion, 0) for r in ratings]
        result[criterion] = _avg(values)
    return result


def get_product_ranking(db: Client, product_type_id: str) -> list[dict]:
    """
    Classement des boulangeries pour un produit donné.

    Retourne une liste triée :
    [
      {
        "bakery": { id, name, neighborhood, address, created_at },
        "aggregated_scores": { "Goût": 4.2, "Croustillance": 3.8, ... },
        "overall_average": 4.0,
        "rating_count": 5,
        "rank": 1
      },
      ...
    ]
    """
    pt_repo = ProductTypeRepository(db)
    rating_repo = RatingRepository(db)

    pt = pt_repo.find_by_id(product_type_id)
    if not pt:
        return []

    criteria_names = [c["name"] for c in pt["criteria"]]
    ratings = rating_repo.find_by_product_type(product_type_id)

    if not ratings:
        return []

    # Grouper par boulangerie
    bakery_groups: dict[str, dict] = {}
    for r in ratings:
        bid = r["bakery_id"]
        if bid not in bakery_groups:
            bakery_groups[bid] = {"bakery": r["bakeries"], "ratings": []}
        bakery_groups[bid]["ratings"].append(r)

    # Calculer les scores agrégés
    ranked = []
    for bid, group in bakery_groups.items():
        agg = _aggregate_scores(group["ratings"], criteria_names)
        overall = _avg(list(agg.values()))
        ranked.append({
            "bakery":            group["bakery"],
            "aggregated_scores": agg,
            "overall_average":   round(overall, 4),
            "rating_count":      len(group["ratings"]),
        })

    ranked.sort(key=lambda x: x["overall_average"], reverse=True)
    for i, item in enumerate(ranked):
        item["rank"] = i + 1

    return ranked


def get_overall_ranking(db: Client) -> list[dict]:
    """
    Classement général — meilleure boulangerie tous produits confondus.

    Retourne une liste triée :
    [
      {
        "bakery": { ... },
        "overall_average": 4.1,
        "product_count": 2,
        "total_ratings": 8,
        "product_averages": [
          { "product_type": { id, name, emoji }, "average": 4.3, "rating_count": 5 },
          ...
        ],
        "rank": 1
      },
      ...
    ]
    """
    pt_repo     = ProductTypeRepository(db)
    bakery_repo = BakeryRepository(db)
    rating_repo = RatingRepository(db)

    bakeries     = bakery_repo.find_all()
    product_types = pt_repo.find_all()
    all_ratings  = rating_repo.find_all()

    if not bakeries or not all_ratings:
        return []

    result = []
    for bakery in bakeries:
        bakery_ratings = [r for r in all_ratings if r["bakery_id"] == bakery["id"]]
        if not bakery_ratings:
            continue

        product_avgs = []
        for pt in product_types:
            pt_ratings = [r for r in bakery_ratings if r["product_type_id"] == pt["id"]]
            if not pt_ratings:
                continue

            criteria_names = [c["name"] for c in pt["criteria"]]
            agg = _aggregate_scores(pt_ratings, criteria_names)
            pt_avg = _avg(list(agg.values()))

            if pt_avg > 0:
                product_avgs.append({
                    "product_type": {
                        "id":    pt["id"],
                        "name":  pt["name"],
                        "emoji": pt["emoji"],
                    },
                    "average":      round(pt_avg, 4),
                    "rating_count": len(pt_ratings),
                })

        if not product_avgs:
            continue

        overall = _avg([p["average"] for p in product_avgs])
        result.append({
            "bakery":          bakery,
            "overall_average": round(overall, 4),
            "product_count":   len(product_avgs),
            "total_ratings":   len(bakery_ratings),
            "product_averages": product_avgs,
        })

    result.sort(key=lambda x: x["overall_average"], reverse=True)
    for i, item in enumerate(result):
        item["rank"] = i + 1

    return result
