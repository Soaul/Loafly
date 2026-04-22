from flask import Flask, jsonify
from flask_cors import CORS
from app.config import Config
from app.routes import register_routes


def create_app(config: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config)

    # CORS — autorise uniquement les origines déclarées dans .env
    CORS(app, origins=config.CORS_ORIGINS, supports_credentials=False)

    # Blueprints
    register_routes(app)

    # ── Handlers d'erreurs globaux ────────────────────────────────────────────

    @app.errorhandler(404)
    def not_found(_):
        return jsonify({"error": "Route introuvable", "code": "NOT_FOUND"}), 404

    @app.errorhandler(405)
    def method_not_allowed(_):
        return jsonify({"error": "Méthode non autorisée", "code": "METHOD_NOT_ALLOWED"}), 405

    @app.errorhandler(500)
    def internal_error(e):
        app.logger.error(f"Internal error: {e}")
        return jsonify({"error": "Erreur serveur interne", "code": "INTERNAL_ERROR"}), 500

    # ── Health check ──────────────────────────────────────────────────────────

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "service": "boulangeries-mtl"})

    return app
