# Mini API FastAPI (Health)

API Python minimale intégrée au projet `music-list` pour fournir un point de contrôle santé et un exemple de déploiement serverless sur Vercel.

## Objectifs
- Endpoint rapide `/health` (statut, timestamp, version, version Python).
- Documentation OpenAPI / Swagger accessible via `/docs` et `/openapi.json`.
- Démonstration d'intégration dans une fonction serverless Vercel (dossier racine `api/`).
- Base pour étendre vers des endpoints supplémentaires sans impacter l'API Node existante.

## Structure
```
python-api/
  app/
    __init__.py
    main.py        # Application FastAPI, endpoints /health et /
  tests/
    test_health.py # Test pytest du endpoint
  requirements.txt # Dépendances Python (FastAPI, Uvicorn, httpx, pytest)
  README.md        # Ce fichier
api/
  index.py         # Entrypoint Vercel (serverless) important l'app via sys.path
vercel.json        # Configuration Vercel (racine du repo, pas dans python-api/)
requirements.txt   # Copie racine des dépendances pour Vercel
```
Note: Le dossier `python-api` contient un tiret, rendant l'import direct `import python-api.app.main` impossible. L'entrypoint `api/index.py` ajoute donc dynamiquement son chemin au `sys.path`.

## Installation locale
```bash
python3 -m venv python-api/.venv
source python-api/.venv/bin/activate
pip install -r python-api/requirements.txt
```

## Démarrage local
```bash
uvicorn python-api.app.main:app --reload --port 8010
```
Accès:
- Health: http://localhost:8010/health
- Docs: http://localhost:8010/docs
- OpenAPI JSON: http://localhost:8010/openapi.json

Test rapide:
```bash
curl -s http://localhost:8010/health | jq
```
(Si `jq` n'est pas installé, afficher brut.)

## Tests
```bash
source python-api/.venv/bin/activate
pytest -q python-api/tests/test_health.py
```
Sortie attendue: `1 passed`.

## Déploiement sur Vercel
1. Le dossier racine `api/` est détecté automatiquement par Vercel (Serverless Functions). `api/index.py` expose `handler = app`.
2. Le fichier `vercel.json` (à la racine) spécifie le runtime Python et la commande d'installation: `pip install -r requirements.txt` (dépendances copiées à la racine).
3. Un push sur la branche principale déclenche le build Vercel. L'URL résultante fournit:
   - `/api/health`
   - `/api/docs`
   - `/api/openapi.json`

### Exemple d'URL déployée
```
https://<votre-projet-vercel>.vercel.app/api/health
```

## Personnalisation
Pour ajouter des endpoints:
1. Créez un nouveau module (ex: `python-api/app/routers/metrics.py`).
2. Déclarez un `APIRouter()` puis incluez-le dans `main.py` via `app.include_router(...)`.
3. Ajoutez des tests dans `python-api/tests/`.

## Améliorations possibles
- Remplacer `datetime.utcnow()` par `datetime.now(datetime.UTC)` (élimine warning de dépréciation).
- Ajouter un middleware de log / trace (ex: `LoggingMiddleware`).
- Intégrer `pydantic` pour des modèles de réponse plus stricts.
- Ajouter authentification (JWT / API Key) sur certains endpoints.
- Définir un script GitHub Actions séparé pour tester la partie Python.

## Sécurité
Actuellement aucun mécanisme d'authentification, car l'API est purement informative. Ne pas exposer de données sensibles sans ajout de contrôle.

## Licence
Se conforme à la licence du projet parent (voir `../LICENSE` ou badge README principal).

## Support / Contact
Utilisez les issues GitHub du repo principal pour toute question ou proposition.

---
Bon hack !
