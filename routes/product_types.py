"""
routes/product_types.py

    GET    /api/product-types                        → liste complète avec critères
    POST   /api/product-types                        → créer un produit [admin]
    DELETE /api/product-types/<id>                   → supprimer [admin]
    POST   /api/product-types/<id>/criteria          → ajouter un critère [admin]
    DELETE /api/product-types/<id>/criteria/<crit_id> → supprimer un critère [admin]
"""

from flask import Blueprint, request
from app.database import get_db
from app.middleware import success, error, admin_required
from app.repositories import ProductTypeRepository, CriterionRepository

product_types_bp = Blueprint("product_types", __name__, url_prefix="/api/product-types")


@product_types_bp.get("/")
def list_product_types():
    """Retourne tous les types de produits avec leurs critères."""
    db = get_db()
    data = ProductTypeRepository(db).find_all()
    return success(data)


@product_types_bp.post("/")
@admin_required
def create_product_type():
    """
    Crée un nouveau type de produit.
    Body JSON : { "name": "Pain de campagne", "emoji": "🍞" }
    """
    body = request.get_json(silent=True) or {}
    name  = str(body.get("name", "")).strip()
    emoji = str(body.get("emoji", "🍞")).strip() or "🍞"

    if not name:
        return error("Le champ 'name' est requis", "MISSING_NAME", 400)

    db = get_db()
    pt = ProductTypeRepository(db).create(name=name, emoji=emoji)
    return success(pt, "Produit créé", 201)


@product_types_bp.delete("/<product_type_id>")
@admin_required
def delete_product_type(product_type_id: str):
    """
    Supprime un type de produit et en cascade : ses critères et tous ses avis
    (gérés par ON DELETE CASCADE en base).
    """
    db = get_db()
    repo = ProductTypeRepository(db)

    if not repo.find_by_id(product_type_id):
        return error("Produit introuvable", "NOT_FOUND", 404)

    repo.delete(product_type_id)
    return success(message="Produit supprimé")


@product_types_bp.post("/<product_type_id>/criteria")
@admin_required
def add_criterion(product_type_id: str):
    """
    Ajoute un critère à un type de produit.
    Body JSON : { "name": "Croustillance" }
    """
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()

    if not name:
        return error("Le champ 'name' est requis", "MISSING_NAME", 400)

    db = get_db()
    pt_repo   = ProductTypeRepository(db)
    crit_repo = CriterionRepository(db)

    if not pt_repo.find_by_id(product_type_id):
        return error("Produit introuvable", "NOT_FOUND", 404)

    if crit_repo.name_exists(product_type_id, name):
        return error(f"Le critère '{name}' existe déjà pour ce produit", "DUPLICATE", 409)

    position = crit_repo.next_position(product_type_id)
    criterion = crit_repo.create(product_type_id=product_type_id, name=name, position=position)
    return success(criterion, "Critère ajouté", 201)


@product_types_bp.delete("/<product_type_id>/criteria/<criterion_id>")
@admin_required
def delete_criterion(product_type_id: str, criterion_id: str):
    """
    Supprime un critère.
    Note : les scores référençant ce critère dans les ratings (JSONB) sont
    laissés en place par cohérence historique — le frontend les ignorera
    puisque le critère n'est plus dans la liste du produit.
    """
    db = get_db()
    crit_repo = CriterionRepository(db)

    criterion = crit_repo.find_by_id(criterion_id)
    if not criterion or criterion["product_type_id"] != product_type_id:
        return error("Critère introuvable", "NOT_FOUND", 404)

    crit_repo.delete(criterion_id)
    return success(message="Critère supprimé")
