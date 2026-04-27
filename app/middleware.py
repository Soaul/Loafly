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


def _get_user_role(user_id: str) -> str | None:
    result = (
        get_db().table("users")
        .select("role")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    return result.data.get("role") if result.data else None


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user_id = get_user_id()
        if not user_id:
            return error("Authentification requise", "AUTH_REQUIRED", 401)
        if _get_user_role(user_id) != "admin":
            return error("Accès admin requis", "ADMIN_REQUIRED", 403)
        g.user_id = user_id
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
