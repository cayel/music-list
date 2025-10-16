from app.main import app  # import du FastAPI app défini dans python-api/app/main.py

# Pour Vercel (runtime Python), l'objet ASGI peut être exposé sous le nom 'app' ou 'handler'.
# On fournit les deux pour compatibilité.
handler = app