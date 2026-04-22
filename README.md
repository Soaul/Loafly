# Boulangeries Montréal — Backend Flask + Supabase

API REST pour l'application de comparaison de boulangeries montréalaises.

## Stack

| Couche       | Technologie               |
|-------------|--------------------------|
| Backend      | Python 3.11+ / Flask 3   |
| Base de données | Supabase (PostgreSQL) |
| Client DB    | supabase-py v2            |
| Auth admin   | PIN dans `app_config`     |
| CORS         | flask-cors                |

## Structure du projet

```
boulangeries-mtl/
├── migrations/
│   └── 001_init.sql          ← schéma + seed à exécuter dans Supabase
├── app/
│   ├── __init__.py           ← factory Flask
│   ├── config.py             ← variables d'environnement
│   ├── database.py           ← client Supabase (singleton par requête)
│   ├── middleware.py         ← helpers HTTP + décorateur @admin_required
│   ├── repositories/
│   │   └── __init__.py       ← accès DB : ProductType, Criteria, Bakery, Rating, Config
│   ├── services/
│   │   ├── __init__.py
│   │   └── ranking_service.py ← agrégation des classements (Python)
│   └── routes/
│       ├── __init__.py       ← enregistrement des blueprints
│       ├── auth.py           ← /api/auth/*
│       ├── product_types.py  ← /api/product-types/*
│       ├── bakeries.py       ← /api/bakeries/*
│       ├── ratings.py        ← /api/ratings
│       └── rankings.py       ← /api/rankings/*
├── .env.example
├── requirements.txt
└── run.py
```

---

## 1. Configurer Supabase

### 1.1 Exécuter le schéma

Dans ton dashboard Supabase → **SQL Editor** → coller et exécuter le contenu de `migrations/001_init.sql`.

Cela crée les tables et insère les données par défaut (produits, critères, PIN admin `1234`).

### 1.2 Récupérer les clés

Settings → API :

| Variable              | Où la trouver                          |
|-----------------------|----------------------------------------|
| `SUPABASE_URL`        | Project URL                            |
| `SUPABASE_SERVICE_KEY`| Project API keys → **service_role**    |

> ⚠️ Utilise **service_role**, pas anon. Le backend gère lui-même l'authentification.

---

## 2. Installer et lancer le backend

```bash
# Cloner / se placer dans le dossier
cd boulangeries-mtl

# Environnement virtuel
python -m venv .venv
source .venv/bin/activate     # Linux/Mac
.venv\Scripts\activate        # Windows

# Dépendances
pip install -r requirements.txt

# Variables d'environnement
cp .env.example .env
# → Éditer .env avec tes clés Supabase

# Lancer
python run.py
```

Le serveur démarre sur `http://localhost:5000`.

---

## 3. Référence API

### Authentification admin

Les routes protégées requièrent le header :
```
X-Admin-Pin: 1234
```

### Health check
```
GET /api/health
→ { "status": "ok" }
```

---

### Auth

| Méthode | Route              | Auth  | Description           |
|---------|--------------------|-------|-----------------------|
| POST    | `/api/auth/verify` | —     | Vérifier un PIN       |
| PUT     | `/api/auth/pin`    | Admin | Changer le PIN admin  |

**POST /api/auth/verify**
```json
// Body
{ "pin": "1234" }

// Réponse
{ "data": { "valid": true } }
```

**PUT /api/auth/pin**
```json
// Body
{ "new_pin": "5678" }
```

---

### Produits

| Méthode | Route                                          | Auth  | Description              |
|---------|------------------------------------------------|-------|--------------------------|
| GET     | `/api/product-types/`                          | —     | Liste + critères         |
| POST    | `/api/product-types/`                          | Admin | Créer un produit         |
| DELETE  | `/api/product-types/<id>`                      | Admin | Supprimer un produit     |
| POST    | `/api/product-types/<id>/criteria`             | Admin | Ajouter un critère       |
| DELETE  | `/api/product-types/<id>/criteria/<crit_id>`   | Admin | Supprimer un critère     |

**GET /api/product-types/**
```json
{
  "data": [
    {
      "id": "a0000000-...",
      "name": "Baguette",
      "emoji": "🥖",
      "criteria": [
        { "id": "...", "name": "Goût", "position": 0 },
        { "id": "...", "name": "Croustillance", "position": 1 }
      ]
    }
  ]
}
```

**POST /api/product-types/**
```json
// Body
{ "name": "Pain de campagne", "emoji": "🍞" }
```

**POST /api/product-types/<id>/criteria**
```json
// Body
{ "name": "Croustillance" }
```

---

### Boulangeries

| Méthode | Route                  | Auth  | Description                           |
|---------|------------------------|-------|---------------------------------------|
| GET     | `/api/bakeries/`       | —     | Liste + nombre d'avis                 |
| POST    | `/api/bakeries/`       | Admin | Créer une boulangerie                 |
| GET     | `/api/bakeries/<id>`   | —     | Détail + avis regroupés par produit   |
| DELETE  | `/api/bakeries/<id>`   | Admin | Supprimer une boulangerie             |

**POST /api/bakeries/**
```json
// Body
{ "name": "Première Moisson", "neighborhood": "Plateau-Mont-Royal", "address": "1234 rue Saint-Denis" }
```

---

### Avis (public)

| Méthode | Route          | Auth | Description           |
|---------|----------------|------|-----------------------|
| POST    | `/api/ratings` | —    | Soumettre un avis     |

**POST /api/ratings**
```json
// Body
{
  "bakery_id":       "uuid-de-la-boulangerie",
  "product_type_id": "uuid-du-produit",
  "scores":          { "Goût": 4, "Croustillance": 3, "Mie moelleuse": 5, "Cuisson": 4 },
  "author_name":     "Marie",
  "note":            "Excellente baguette !"
}
```

Validations :
- Tous les critères du produit doivent être présents dans `scores`
- Valeurs autorisées : entiers de 1 à 5

---

### Classements

| Méthode | Route                              | Auth | Description                              |
|---------|------------------------------------|------|------------------------------------------|
| GET     | `/api/rankings/product/<pt_id>`    | —    | Classement des boulangeries pour 1 produit |
| GET     | `/api/rankings/overall`            | —    | Classement général tous produits         |

**GET /api/rankings/product/<id>**
```json
{
  "data": [
    {
      "rank": 1,
      "bakery": { "id": "...", "name": "Première Moisson", "neighborhood": "Plateau" },
      "aggregated_scores": { "Goût": 4.5, "Croustillance": 4.0, "Mie moelleuse": 4.3, "Cuisson": 4.2 },
      "overall_average": 4.25,
      "rating_count": 5
    }
  ]
}
```

**GET /api/rankings/overall**
```json
{
  "data": [
    {
      "rank": 1,
      "bakery": { "id": "...", "name": "Première Moisson", ... },
      "overall_average": 4.3,
      "product_count": 2,
      "total_ratings": 8,
      "product_averages": [
        { "product_type": { "name": "Baguette", "emoji": "🥖" }, "average": 4.5, "rating_count": 5 },
        { "product_type": { "name": "Croissant", "emoji": "🥐" }, "average": 4.1, "rating_count": 3 }
      ]
    }
  ]
}
```

---

## 4. Format des erreurs

Toutes les erreurs suivent ce format :
```json
{
  "error": "Message lisible",
  "code":  "ERROR_CODE"
}
```

Codes HTTP utilisés : `400` validation, `401` auth manquante, `403` PIN incorrect, `404` entité introuvable, `409` doublon, `500` erreur serveur.

---

## 5. Ce qui manque pour la production

| Manque                     | Impact          | Solution recommandée                         |
|---------------------------|-----------------|----------------------------------------------|
| PIN en clair dans les headers | Sécurité ⚠️ | JWT signé (PyJWT) ou session Flask chiffrée  |
| Pas de rate limiting       | DDoS, spam      | Flask-Limiter + Redis                        |
| Agrégation en Python       | Perf à l'échelle | Vue PostgreSQL ou fonction Supabase RPC      |
| Pas de pagination          | Charge mémoire  | Ajouter `?limit=&offset=` sur les listes     |
| Pas de logs structurés     | Observabilité   | python-json-logger + export Loki/Datadog     |
| HTTPS                      | Sécurité        | Derrière un reverse proxy (Nginx, Caddy)     |
| Tests                      | Fiabilité       | pytest + pytest-flask, mocks Supabase        |

---

## 6. Connecter le frontend React

Le frontend React (artifact Claude) doit remplacer `window.storage` par des appels `fetch` vers cette API.

Variable d'environnement Vite à créer dans le frontend :
```
VITE_API_URL=http://localhost:5000/api
```

Voir le fichier `frontend/api-client.js` pour le client fetch prêt à l'emploi.
