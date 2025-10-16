"""Fonction serverless FastAPI minimale pour Vercel.

Définie inline pour éviter les hacks d'import liés au dossier `python-api/`.
Expose `app` (ASGI) et `handler` pour compatibilité.
"""

from datetime import datetime, UTC
import platform
from fastapi import FastAPI

app = FastAPI(title="Music List Health API", version="0.1.0")


@app.get("/health", tags=["health"], summary="Health check")
def health():
	return {
		"status": "ok",
		"time": datetime.now(UTC).isoformat(),
		"python": platform.python_version(),
		"app_version": "0.1.0",
		"deployed": True,
	}


@app.get("/", include_in_schema=False)
def root():
	return {"message": "FastAPI health: voir /health ou /docs"}


# Vercel peut utiliser handler ou app
handler = app
