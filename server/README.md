# Music List – Serveur API

Backend Express fournissant une API REST pour la gestion d'albums (Discogs), listes classées, listes intelligentes, tags, génération automatique et administration (export / import / santé / journal).

---
## Sommaire
- [Caractéristiques](#caractéristiques)
- [Démarrage rapide](#démarrage-rapide)
- [Variables d'environnement](#variables-denvironnement)
- [Choix automatique du driver DB](#choix-automatique-du-driver-db)
- [Schéma de base de données](#schéma-de-base-de-données)
- [Architecture interne](#architecture-interne)
- [Flux principaux](#flux-principaux)
- [Endpoints](#endpoints)
  - [Albums](#albums)
  - [Listes classées](#listes-classées)
  - [Listes intelligentes (smart lists)](#listes-intelligentes-smart-lists)
  - [Génération](#génération)
  - [Administration](#administration)
  - [Divers / statut](#divers--statut)
- [Réordonnancement (algorithmes)](#réordonnancement-algorithmes)
- [Import / Export & Remapping](#import--export--remapping)
- [Journalisation](#journalisation)
- [Sécurité & Auth admin](#sécurité--auth-admin)
- [Erreurs & Codes](#erreurs--codes)
- [Guidelines contribution](#guidelines-contribution)

---
## Caractéristiques
- Express 4, JSON pur (aucun rendu HTML ici)
- CORS configurable (`FRONT_ORIGIN`)
- Discogs (masters + release pour labels) avec User-Agent dédié & token optionnel
- Abstraction DB unifiée (`server/db.js`) : SQLite (par défaut) OU Postgres (auto)
- Listes classées + réordonnancement robuste (double stratégie selon driver)
- Listes intelligentes dynamiques (critères filtrant la table `albums`)
- Génération automatique de liste "Album Studio <Artiste>" basée sur la collection locale
- Export / Import JSON complet avec remapping des IDs (Postgres) + déduplication d'albums
- Journalisation fine de toutes les mutations (`operation_logs`)
- Endpoints système: statut, rebuild schéma, métriques, logs
- Self-healing / création de schéma au démarrage et via `/api/admin/rebuild`

---
## Démarrage rapide
```bash
# Installer dépendances à la racine du monorepo
npm install

# Copier et ajuster les variables
cp .env.example .env

# Lancer le serveur uniquement
npm run dev:api
# (Ou en prod)
npm start
```
Par défaut l'API écoute sur `PORT` (3000). Un mécanisme de fallback essaie les ports suivants si occupés.

---
## Variables d'environnement
(Seules celles pertinentes côté serveur)

| Variable | Description | Défaut |
|----------|-------------|--------|
| PORT | Port HTTP initial | 3000 |
| FRONT_ORIGIN | Origine CORS autorisée (`*` = toutes) | * |
| DISCOGS_TOKEN | Token Discogs pour quotas augmentés | (vide) |
| ADMIN_TOKEN | Active auth admin via header `x-admin-token` | (vide) |
| DB_PATH | Fichier SQLite | ./music_collection.db |
| PG_CONNECTION_STRING | Chaîne Postgres prioritaire | (vide) |
| DATABASE_URL | Alias (Heroku/Render) si PG_CONNECTION_STRING absent | (vide) |
| ENV_NAME | Nom d'environnement (badges / status) | NODE_ENV |

> Pour le client en dev séparé : `VITE_API_BASE` (géré côté frontend).

---
## Choix automatique du driver DB
1. Si `PG_CONNECTION_STRING` ou `DATABASE_URL` défini → driver `pg`
2. Sinon → SQLite
3. Création / migration minimale des tables à chaque lancement (ajout colonnes manquantes `master_id`, `artist_id`, conversion auto smart_lists si besoin)

SSL Postgres auto: attaches `ssl: { rejectUnauthorized:false }` pour domaines Render / Neon / Supabase.

---
## Schéma de base de données
```
albums(id PK, release_id UNIQUE?, master_id UNIQUE, artist_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, created_at, updated_at)
lists(id PK, name, description, created_at)
list_items(id PK, list_id FK, album_id FK, position, UNIQUE(list_id, album_id), UNIQUE(list_id, position))
list_tags(id PK, list_id FK, tag, UNIQUE(list_id, tag))
smart_lists(id PK, name, description, criteria_json, created_at)
operation_logs(id PK, action, entity_type, entity_id, info JSON (texte), created_at)
```
Indexes supplémentaires créés: `idx_albums_master_id`, `idx_albums_artist_id`.

---
## Architecture interne
```
server/
  index.js          # Bootstrap, middlewares, endpoints centralisés (statut) ou legacy
  db.js             # Abstraction SQLite / Postgres (run/get/all + placeholder ? → $n)
  lib/discogs.js    # Appels & mapping Discogs
  routes/           # Modules spécialisés
    albums.js
    lists.js
    smartLists.js
    generate.js
```
Les modules de `routes/` reçoivent `(app, logOperation, helpers/driver)` et enregistrent leurs endpoints. `logOperation()` insère dans `operation_logs` de manière non bloquante.

---
## Flux principaux
### Ajout album
1. `POST /api/albums { masterId }`
2. Récupération master Discogs + (optionnel) release principale → labels
3. Insertion `albums` (unicité master)
4. Log `album.add`

### Ajout album dans liste
- Vérification duplicat, insertion avec `position = MAX(position)+1`, log `list_item.add`

### Réordonnancement liste
- Client envoie tableau partiel d'IDs list_items
- Algorithme spécifique (voir section dédiée)
- Log `list_item.reorder`

### Smart list
- Critères JSON stockés dans `criteria_json`
- À la consultation: construction dynamique WHERE + limit clamp (≤1000)

### Génération studio
- Filtre heuristique (exclusions live / remix / compilations...) sur albums locaux d'un artiste → création liste + tag "albums studio".

---
## Endpoints
### Documentation (Swagger / OpenAPI)
- UI : `/api/docs`
- JSON : `/api/openapi.json`

La spécification est définie dans `server/openapi.yaml` et chargée au démarrage : le premier serveur voit son URL ajustée selon le port effectif.
### Albums
| Méthode | URL | Description |
|---------|-----|-------------|
| GET | /api/albums | Liste + compteur d'usage dans listes |
| POST | /api/albums | Ajout via `masterId` |
| DELETE | /api/albums/:id | Suppression (refus si utilisé) |
| PATCH | /api/albums/:id/refresh | Rafraîchit métadonnées Discogs |
| GET | /api/albums/search?q= | Recherche (artiste, titre ou année exacte AAAA) |

### Listes classées
| Méthode | URL | Description |
|---------|-----|-------------|
| GET | /api/lists | Liste + tags + item_count |
| POST | /api/lists | Créer |
| GET | /api/lists/:id | Détails + items ordonnés + tags |
| PUT | /api/lists/:id | Met à jour nom / description |
| DELETE | /api/lists/:id | Supprime |
| POST | /api/lists/:id/items | Ajoute album existant ou par masterId |
| PUT | /api/lists/:id/items/order | Réordonner (partiel accepté) |
| DELETE | /api/lists/:id/items/:itemId | Retirer item |
| POST | /api/lists/:id/tags | Ajouter tag |
| DELETE | /api/lists/:id/tags/:tag | Supprimer tag |

### Listes intelligentes (smart lists)
| Méthode | URL | Description |
|---------|-----|-------------|
| GET | /api/smart-lists | Liste des smart lists |
| POST | /api/smart-lists | Créer (critères) |
| GET | /api/smart-lists/:id | Détails + résultats calculés |
| PUT | /api/smart-lists/:id | Met à jour (nom, description, critères) |
| DELETE | /api/smart-lists/:id | Supprime |

Critères supportés: `genreIncludes[]`, `genreExcludes[]`, `styleIncludes[]`, `styleExcludes[]`, `yearMin`, `yearMax`, `limit`.

### Génération
| Méthode | URL | Description |
|---------|-----|-------------|
| POST | /api/lists/generate/studio | Crée une discographie studio locale d'un artiste |

### Administration
| Méthode | URL | Description |
|---------|-----|-------------|
| GET | /api/admin/health | Présence tables + counts |
| GET | /api/admin/system | Métriques process + version + taille DB |
| POST | /api/admin/rebuild | (Re)création schéma manquants |
| GET | /api/admin/export | Export JSON complet |
| POST | /api/admin/import | Import JSON (transaction PG) |
| GET | /api/admin/logs?limit=N | Logs récents |

### Divers / statut
| Méthode | URL | Description |
|---------|-----|-------------|
| GET | /api/status | Uptime, version, driver DB, env |
| GET | / | Réponse JSON simple (service ok) |

---
## Réordonnancement (algorithmes)
Objectif: produire une séquence compacte 1..N sans collisions et tolérer un sous-ensemble d'IDs.

- Postgres: un `UPDATE` unique via CTE + `unnest($1)` → positions réécrites en une passe (O(N)).
- SQLite: stratégie en deux phases: 
  1. Appliquer positions négatives temporaires ( -index )
  2. Réécrire positions positives normalisées

Entrées:
- `order`: tableau (pouvant être incomplet ou contenir des doublons). Les doublons sont dédupliqués, l'ordre relatif des non mentionnés est conservé en queue.

Sorties:
- JSON `{ partial:boolean, dedup:boolean, items: [...] }`.

---
## Import / Export & Remapping
- Export (`/api/admin/export`): Dump brut des tables.
- Import: 
  - Postgres: transaction complète; remapping ancien→nouvel ID pour `albums`, `lists`, puis réécriture des références dans `list_items` / `list_tags`.
  - SQLite: insertion séquentielle (mapping moins critique car IDs suivis).
- Déduplication albums: si même `release_id` (hérité) déjà présent → entrée ignorée proprement, relations redirigées.

---
## Journalisation
Table `operation_logs`.

Champs clés d'action (non exhaustif):
- `album.add`, `album.delete`, `album.refresh`
- `list.add`, `list.update`, `list.delete`
- `list_item.add`, `list_item.delete`, `list_item.reorder`
- `tag.add`, `tag.delete`
- `smart_list.add`, `smart_list.update`, `smart_list.delete`
- `list.generate.studio`

Chaque log enregistre un JSON compact (tronqué à ~5000 chars).

---
## Sécurité & Auth admin
Si `ADMIN_TOKEN` est défini :
- Toute route `/api/admin/*` exige header `x-admin-token: <valeur>` (ou query `?admin_token=` fallback).
- Sans token: 401.

Aucun mécanisme d'auth utilisateur final (usage mono-utilisateur). Extensible via ajout table `users` & middleware.

CORS: si `FRONT_ORIGIN="*"` en dev; en production restreindre (ex: domaine du client).

---
## Erreurs & Codes
| Code | Cas |
|------|-----|
| 400 | Paramètre manquant / invalide (ex: `masterId` absent, critère non numérique) |
| 401 | Auth admin manquante / incorrecte |
| 404 | Ressource inexistante (album, liste, smart list, item...) |
| 409 | Conflit d'unicité (album déjà présent, item déjà dans liste, tag dupliqué) |
| 500 | Erreur interne DB / Discogs / import |
| 502 | (Optionnel) Passerelle Discogs indisponible (selon gestion future) |

Payload erreur standard: `{ error: "message" }`.

---
## Guidelines contribution
1. Ajouter un endpoint: créer un module dans `routes/` ou étendre un existant.
2. Centraliser logique réutilisable (Discogs, parsing) dans `lib/`.
3. Instrumenter via `logOperation(action, type, id, info)` pour chaque mutation.
4. Respecter usage placeholders `?` dans SQL (conversion auto vers `$n` pour Postgres).
5. Limiter taille des réponses (pagination à prévoir si >5k entrées).
6. Tests (à introduire) pour: import, réordonnancement, critères smart list.

---
## Roadmap technique (suggestions)
- Pagination / tri serveur (albums, logs)
- Index supplémentaires (année, (list_id, position)) à volume élevé
- Endpoint /api/admin/metrics (Prometheus format)
- Mise en cache Discogs (invalidation TTL) 
- Validation plus stricte (zod ou celebrate) côté entrées
- Tests unitaires & d'intégration

---
Bonne exploration 👋
