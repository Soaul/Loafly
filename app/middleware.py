from functools import wraps
from flask import request, jsonify, current_app, g
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from app.database import get_db


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


def make_token(user_id: str) -> str:
    s = URLSafeTimedSerializer(current_app.config["SECRET_KEY"])
    return s.dumps({"user_id": user_id})


def get_user_id() -> str | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    s = URLSafeTimedSerializer(current_app.config["SECRET_KEY"])
    try:
        data = s.loads(auth[7:], max_age=86400 * 30)
        return data.get("user_id")
    except (BadSignature, SignatureExpired):
        return None


def _check_admin() -> bool:
    password = request.headers.get("X-Admin-Password", "").strip()
    if not password:
        return False
    result = (
        get_db().table("app_config")
        .select("value")
        .eq("key", "admin_password")
        .maybe_single()
        .execute()
    )
    return bool(result.data and result.data["value"] == password)


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not _check_admin():
            return error("Accès admin requis", "ADMIN_REQUIRED", 401)
        return f(*args, **kwargs)
    return decorated


def user_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user_id = get_user_id()
        if not user_id:
            return error("Authentification requise", "AUTH_REQUIRED", 401)
        g.user_id = user_id
        return f(*args, **kwargs)
    return decorated


def user_or_admin_required(f):
    """Accepte un token utilisateur OU le header X-Admin-Password."""
    @wraps(f)
    def decorated(*args, **kwargs):
        user_id = get_user_id()
        if user_id:
            g.user_id = user_id
            g.is_admin = False
            return f(*args, **kwargs)
        if _check_admin():
            g.user_id = None
            g.is_admin = True
            return f(*args, **kwargs)
        return error("Authentification requise", "AUTH_REQUIRED", 401)
    return decorated
