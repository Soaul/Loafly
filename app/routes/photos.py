"""
routes/photos.py
    POST /api/photos/upload  → upload une photo vers Supabase Storage (user requis)
"""

import uuid
from flask import Blueprint, request, g
from app.database import get_db
from app.middleware import success, error, user_required

photos_bp = Blueprint("photos", __name__, url_prefix="/api/photos")

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB


@photos_bp.post("/upload")
@user_required
def upload_photo():
    if "photo" not in request.files:
        return error("Aucun fichier fourni", "MISSING_FILE", 400)

    file = request.files["photo"]
    if not file.filename:
        return error("Fichier invalide", "INVALID_FILE", 400)

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        return error("Format non supporté (jpg, png, webp)", "INVALID_FORMAT", 400)

    data = file.read()
    if len(data) > MAX_SIZE_BYTES:
        return error("Fichier trop volumineux (max 5 Mo)", "FILE_TOO_LARGE", 413)

    path = f"ratings/{g.user_id}/{uuid.uuid4()}.{ext}"
    db   = get_db()

    db.storage.from_("rating-photos").upload(
        path=path,
        file=data,
        file_options={"content-type": file.content_type or f"image/{ext}"},
    )

    url = db.storage.from_("rating-photos").get_public_url(path)
    return success({"url": url})
