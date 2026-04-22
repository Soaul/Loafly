from flask import Flask


def register_routes(app: Flask) -> None:
    from app.routes.auth import auth_bp
    from app.routes.bakeries import bakeries_bp
    from app.routes.photos import photos_bp
    from app.routes.product_types import product_types_bp
    from app.routes.rankings import rankings_bp
    from app.routes.ratings import ratings_bp
    from app.routes.users import users_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(bakeries_bp)
    app.register_blueprint(photos_bp)
    app.register_blueprint(product_types_bp)
    app.register_blueprint(rankings_bp)
    app.register_blueprint(ratings_bp)
    app.register_blueprint(users_bp)
