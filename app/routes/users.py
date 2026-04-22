"""
routes/users.py
    POST /api/users/signup  → créer un compte
    POST /api/users/login   → connexion → token
    GET  /api/users/me      → profil (token requis)
"""

from flask import Blueprint, request, g
from werkzeug.security import generate_password_hash, check_password_hash
from app.database import get_db
from app.middleware import success, error, make_token, user_required

users_bp = Blueprint("users", __name__, url_prefix="/api/users")


@users_bp.post("/signup")
def signup():
    body     = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip()
    email    = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", "")).strip()

    if not username or not email or not password:
        return error("Champs 'username', 'email' et 'password' requis", "MISSING_FIELDS", 400)
    if len(password) < 6:
        return error("Le mot de passe doit faire au moins 6 caractères", "INVALID_PASSWORD", 400)

    db = get_db()
    existing = (
        db.table("users").select("id")
        .or_(f"username.eq.{username},email.eq.{email}")
        .execute()
    )
    if existing.data:
        return error("Nom d'utilisateur ou email déjà utilisé", "DUPLICATE", 409)

    result = db.table("users").insert({
        "username": username,
        "email":    email,
        "password_hash": generate_password_hash(password),
    }).execute()

    user  = result.data[0]
    token = make_token(str(user["id"]))
    return success({"token": token, "username": user["username"]}, "Compte créé !", 201)


@users_bp.post("/login")
def login():
    body     = request.get_json(silent=True) or {}
    email    = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", "")).strip()

    if not email or not password:
        return error("Champs 'email' et 'password' requis", "MISSING_FIELDS", 400)

    db     = get_db()
    result = db.table("users").select("*").eq("email", email).maybe_single().execute()

    if not result.data or not check_password_hash(result.data["password_hash"], password):
        return error("Email ou mot de passe incorrect", "INVALID_CREDENTIALS", 401)

    user  = result.data
    token = make_token(str(user["id"]))
    return success({"token": token, "username": user["username"]})


@users_bp.get("/me")
@user_required
def me():
    db     = get_db()
    result = db.table("users").select("id, username, email, created_at").eq("id", g.user_id).maybe_single().execute()
    if not result.data:
        return error("Utilisateur introuvable", "NOT_FOUND", 404)
    return success(result.data)
