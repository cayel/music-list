"""Entrypoint Serverless Vercel pour FastAPI.

Ce fichier est à la racine `api/` (convention Vercel). On doit importer l'app FastAPI
définie dans `python-api/app/main.py`. Comme le dossier contient un tiret, on ne peut pas
utiliser un import direct par nom de package. On ajoute le chemin au sys.path et on importe.
"""

import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "python-api"
sys.path.append(str(root))

from app.main import app  # type: ignore  # noqa: E402

# Exposition pour Vercel
handler = app
