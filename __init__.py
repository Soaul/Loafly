"""
repositories/
    Couche d'accès aux données. Toutes les requêtes Supabase passent ici.
    Les méthodes retournent des dict Python bruts (pas de modèles).
    Aucune logique métier ici — uniquement SELECT / INSERT / UPDATE / DELETE.
"""

from __future__ import annotations
from supabase import Client


# ── ProductTypeRepository ─────────────────────────────────────────────────────

class ProductTypeRepository:
    def __init__(self, db: Client):
        self.db = db

    def find_all(self) -> list[dict]:
        """Tous les produits avec leurs critères triés par position."""
        result = (
            self.db.table("product_types")
            .select("*, criteria(*)")
            .order("created_at")
            .execute()
        )
        for pt in result.data:
            pt["criteria"] = sorted(pt.get("criteria", []), key=lambda c: c["position"])
        return result.data

    def find_by_id(self, product_type_id: str) -> dict | None:
        result = (
            self.db.table("product_types")
            .select("*, criteria(*)")
            .eq("id", product_type_id)
            .maybe_single()
            .execute()
        )
        if result.data:
            result.data["criteria"] = sorted(
                result.data.get("criteria", []), key=lambda c: c["position"]
            )
        return result.data

    def create(self, name: str, emoji: str) -> dict:
        result = (
            self.db.table("product_types")
            .insert({"name": name, "emoji": emoji})
            .execute()
        )
        row = result.data[0]
        row["criteria"] = []
        return row

    def delete(self, product_type_id: str) -> None:
        self.db.table("product_types").delete().eq("id", product_type_id).execute()


# ── CriterionRepository ───────────────────────────────────────────────────────

class CriterionRepository:
    def __init__(self, db: Client):
        self.db = db

    def find_by_product_type(self, product_type_id: str) -> list[dict]:
        result = (
            self.db.table("criteria")
            .select("*")
            .eq("product_type_id", product_type_id)
            .order("position")
            .execute()
        )
        return result.data

    def find_by_id(self, criterion_id: str) -> dict | None:
        result = (
            self.db.table("criteria")
            .select("*")
            .eq("id", criterion_id)
            .maybe_single()
            .execute()
        )
        return result.data

    def next_position(self, product_type_id: str) -> int:
        result = (
            self.db.table("criteria")
            .select("position")
            .eq("product_type_id", product_type_id)
            .order("position", desc=True)
            .limit(1)
            .execute()
        )
        return (result.data[0]["position"] + 1) if result.data else 0

    def create(self, product_type_id: str, name: str, position: int) -> dict:
        result = (
            self.db.table("criteria")
            .insert({"product_type_id": product_type_id, "name": name, "position": position})
            .execute()
        )
        return result.data[0]

    def delete(self, criterion_id: str) -> None:
        self.db.table("criteria").delete().eq("id", criterion_id).execute()

    def name_exists(self, product_type_id: str, name: str) -> bool:
        result = (
            self.db.table("criteria")
            .select("id")
            .eq("product_type_id", product_type_id)
            .eq("name", name)
            .execute()
        )
        return len(result.data) > 0


# ── BakeryRepository ──────────────────────────────────────────────────────────

class BakeryRepository:
    def __init__(self, db: Client):
        self.db = db

    def find_all(self) -> list[dict]:
        result = (
            self.db.table("bakeries")
            .select("*")
            .order("name")
            .execute()
        )
        return result.data

    def find_by_id(self, bakery_id: str) -> dict | None:
        result = (
            self.db.table("bakeries")
            .select("*")
            .eq("id", bakery_id)
            .maybe_single()
            .execute()
        )
        return result.data

    def create(self, name: str, neighborhood: str, address: str) -> dict:
        result = (
            self.db.table("bakeries")
            .insert({"name": name, "neighborhood": neighborhood, "address": address})
            .execute()
        )
        return result.data[0]

    def delete(self, bakery_id: str) -> None:
        self.db.table("bakeries").delete().eq("id", bakery_id).execute()


# ── RatingRepository ──────────────────────────────────────────────────────────

class RatingRepository:
    def __init__(self, db: Client):
        self.db = db

    def find_by_bakery(self, bakery_id: str) -> list[dict]:
        result = (
            self.db.table("ratings")
            .select("*, product_types(id, name, emoji)")
            .eq("bakery_id", bakery_id)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data

    def find_by_product_type(self, product_type_id: str) -> list[dict]:
        result = (
            self.db.table("ratings")
            .select("*, bakeries(*)")
            .eq("product_type_id", product_type_id)
            .execute()
        )
        return result.data

    def find_all(self) -> list[dict]:
        result = (
            self.db.table("ratings")
            .select("*")
            .execute()
        )
        return result.data

    def create(
        self,
        bakery_id: str,
        product_type_id: str,
        scores: dict,
        author_name: str,
        note: str,
    ) -> dict:
        result = (
            self.db.table("ratings")
            .insert({
                "bakery_id":       bakery_id,
                "product_type_id": product_type_id,
                "scores":          scores,
                "author_name":     author_name,
                "note":            note,
            })
            .execute()
        )
        return result.data[0]

    def delete_by_product_type(self, product_type_id: str) -> None:
        """Appelé lors de la suppression d'un product type (cascade DB le fait aussi)."""
        self.db.table("ratings").delete().eq("product_type_id", product_type_id).execute()


# ── ConfigRepository ──────────────────────────────────────────────────────────

class ConfigRepository:
    def __init__(self, db: Client):
        self.db = db

    def get(self, key: str) -> str | None:
        result = (
            self.db.table("app_config")
            .select("value")
            .eq("key", key)
            .maybe_single()
            .execute()
        )
        return result.data["value"] if result.data else None

    def set(self, key: str, value: str) -> None:
        self.db.table("app_config").upsert({"key": key, "value": value}).execute()
