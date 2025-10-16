from datetime import datetime, UTC
import platform
from fastapi import FastAPI

app = FastAPI(
	title="Music List Health API",
	description="API minimale ne fournissant qu'un endpoint de healthcheck.",
	version="0.1.0",
)


@app.get("/health", summary="Health check", tags=["health"])
def health():
	"""Retourne l'état basique de l'application.

	Réponse:
	- status: 'ok' si l'application est joignable
	- time: horodatage UTC ISO8601
	- python: version de Python
	- app_version: version déclarée de l'application
	"""
	return {
		"status": "ok",
		"time": datetime.now(UTC).isoformat(),
		"python": platform.python_version(),
		"app_version": "0.1.0",
	}


# Optionnel: endpoint racine pour signaler l'existence de l'API
@app.get("/", include_in_schema=False)
def root():
	return {"message": "Health API: voir /health ou /docs"}

