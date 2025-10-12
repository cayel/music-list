# Music List App

<!-- Badges -->
[![CI](https://github.com/cayel/music-list/actions/workflows/ci.yml/badge.svg)](https://github.com/cayel/music-list/actions/workflows/ci.yml)
![Node Version](https://img.shields.io/badge/node-18.x-green?logo=node.js)
[![API Render](https://img.shields.io/badge/API-Render-blueviolet?logo=render)](https://music-list-1.onrender.com/api/status)
[![Front Vercel](https://img.shields.io/badge/Front-Vercel-black?logo=vercel)](https://music-list.vercel.app)
![License](https://img.shields.io/badge/license-ISC-lightgrey)


Application web légère pour gérer une collection d'albums avec intégration Discogs, listes classées, tags, statistiques visuelles et journal des opérations. Fonctionne en **SQLite (local / simple)** ou **Postgres (hébergement cloud sans disque persistant)** via une couche d'abstraction automatique.

## Fonctionnalités principales

- 🎵 Ajout d'albums par identifiant master Discogs (champ master_id unique)
- 🔄 Rafraîchissement ciblé des métadonnées d'un album depuis Discogs (via master + main_release pour labels)
- 📚 Grille mosaïque responsive (filtre texte + année exacte) + vue compacte
- 🧾 Listes classées avec réordonnancement par glisser-déposer (algorithmes adaptés SQLite / Postgres)
- 🤖 Listes intelligentes dynamiques (critères genres/styles IN/OUT, années min/max, limite) recalculées à l'ouverture
- 🏷️ Tags de listes (ajout / suppression) + compteur d'utilisation consolidé
- 🗑️ Suppression protégée (refus si l'album apparaît dans au moins une liste)
- 🛠️ Administration : export JSON, import transactionnel (remapping IDs + skip doublons), rebuild, santé, panneau statut système
- 🪵 Journalisation structurée (albums, listes, items, tags, admin) avec coloration par catégorie
- 📊 Statistiques (distribution des années, genres/styles) générées côté client
- 🖼️ Modal plein écran enrichi (zoom pochette, détails, IDs master & artiste, lien Discogs master)
- 🩺 Panneau Système : métriques process, taille DB, counts, version + hash git (/api/admin/system)
- 💾 Multi-base : SQLite (local) OU Postgres (auto-détection + migration facile)
- 🔐 Protection optionnelle des endpoints admin par jeton
- 🏷️ Badges d'environnement & version (package.json + hash git courts) en header / footer
- 🎨 Thème clair/sombre acier/bleu

Fonctionnalités retirées / non présentes volontairement : ajout par artiste+titre, ajout direct par numéro de release, bouton copier release ID, section outils de recherche Discogs, endpoint de rafraîchissement global massif, pagination, outil de migration (devenu inutile après adoption totale de master_id).

## Données persistées

Albums : `master_id` (unique), `artist_id`, `artist_name`, `album_title`, `release_year`, `genre`, `style`, `label`, `cover_image_url`, timestamps, usage dans listes (compteur dérivé). (Ancien champ `release_id` considéré obsolète si encore présent physiquement.)

Listes : `name`, `description`, items ordonnés (table séparée), tags (table relationnelle), timestamps.

Journal (`operation_logs`) : `action`, `entity_type`, `entity_id`, `info` (JSON), `created_at`.

Schéma reconstruit automatiquement si manquant (endpoint /admin/rebuild). Les listes et items sont toujours cohérents via clés étrangères; les positions sont normalisées par les algorithmes de réordonnancement (voir plus bas).

## Installation & démarrage

1. Clonez ce repository
2. Installez les dépendances :
   ```bash
   npm install
   ```

3. Copiez le fichier d'environnement :
   ```bash
   cp .env.example .env
   ```

4. Démarrez selon votre besoin :
   ```bash
   # API seule (Express + DB + CORS)
   npm run dev:api

   # Client React (Vite) seul (utilise VITE_API_BASE si défini)
   npm run dev:client

   # API + Client en parallèle (développement complet)
   npm run dev:full
   ```

5. Accès :
   - API : http://localhost:3000 (port de base, auto-incrément si occupé)
   - Client : http://localhost:5173

Optionnel : ajoutez `DISCOGS_TOKEN=<votre_token>` dans `.env` pour de meilleures métadonnées.

### Documentation API (Swagger / OpenAPI)

Disponible après démarrage :

- UI : `http://localhost:<PORT>/api/docs`
- JSON : `http://localhost:<PORT>/api/openapi.json`

Source : `server/openapi.yaml` (le port effectif est injecté dynamiquement au lancement).

### Variables d'environnement principales

| Variable | Rôle | Exemple |
|----------|------|---------|
| PORT | Port d'écoute API | 3000 |
| FRONT_ORIGIN | Origine CORS autorisée (client) | http://localhost:5173 |
| DISCOGS_TOKEN | Token Discogs (optionnel) | abc123... |
| ADMIN_TOKEN | Protège les endpoints /api/admin/* | unsecretfort |
| DB_PATH | (SQLite) Fichier DB local | ./music_collection.db |
| PG_CONNECTION_STRING | Chaîne connexion Postgres (prioritaire) | postgres://user:pass@host:5432/dbname |
| DATABASE_URL | Alias Heroku/Render (si PG_CONNECTION_STRING absent) | postgres://... |
| VITE_API_BASE | Base URL API pour le client (dev séparé) | http://localhost:3000 |
| ENV_NAME | Nom lisible d'environnement (badge UI) | local |

Si `PG_CONNECTION_STRING` **ou** `DATABASE_URL` est défini, le driver Postgres est utilisé. Sinon, SQLite.

### Choix automatique du driver

1. Detect: si variable PG présente ⇒ driver = `pg`
2. Sinon ⇒ driver = `sqlite`
3. Le schéma est créé automatiquement dans les deux cas (tables `albums`, `lists`, `list_items`, `list_tags`, `operation_logs`).

### Import / Remapping des IDs (Postgres) + déduplication

Lors d'un import JSON:
- En SQLite, les IDs réinsérés suivent et peuvent correspondre aux anciens si la séquence est alignée.
- En Postgres, les colonnes sont en `SERIAL`; les IDs sont régénérés. Le code construit donc un **mapping ancienID → nouvelID** pour:
   - `albums`
   - `lists`
   - Puis réécrit `list_items.list_id`, `list_items.album_id` et `list_tags.list_id` avant insertion.

Conséquence:
- Les IDs internes peuvent changer après migration vers Postgres, mais les relations restent cohérentes.

Lors de l'import, si un album avec le même `release_id` existe déjà, il est **ignoré proprement** (skipped) pour éviter les violations d'unicité, et les items/tags associés pointent vers l'album existant (mise à jour du mapping). En cas de référence introuvable durant l'import, la transaction (Postgres) est annulée et une erreur claire est renvoyée.

### Réordonnancement (Listes)

Deux stratégies afin d'assurer un ordre stable sans collisions :

1. Postgres : mise à jour atomique par CTE + `unnest()` générant un `UPDATE ... FROM` unique avec `CASE` implicite (évite les contraintes uniques temporaires et garantit isolation).
2. SQLite : approche en deux phases – assignation temporaire de positions négatives (décale l'espace), puis réécriture séquentielle positive normalisée. Gère les réordonnancements partiels et les doublons d'IDs fournis par erreur.

L'API accepte donc un sous-ensemble d'IDs; les éléments omis conservent leur ordre relatif après ceux spécifiés.

## Mode d'emploi rapide

1. Trouver l'identifiant master Discogs (ex: URL `.../master/249504` ⇒ `249504`).
2. Saisir cet identifiant dans le formulaire (champ masterId) et valider.
3. Filtrer / rechercher via la barre (texte + année exacte).
4. Passer en onglet Listes : créer une liste, ajouter des albums (auto-complétion locale ou releaseId), activer le mode édition pour réordonner.
5. Ajouter des tags de liste pour le regroupement (affichage badge + stats de tags).
6. Clic pochette ➜ modal détail + lien Discogs master.
   - Zoom : clic sur l'image agrandit / réduit (classe CSS `.zoomed`).
   - Visualisation des IDs : master_id (cliquable vers Discogs) et artist_id.
   - Lien direct Discogs master (nouvel onglet).
7. Onglet Statistiques ➜ visualiser graphiques (années, genres/styles) calculés côté client.
8. Onglet Administration ➜ exporter/importer JSON, vérifier ou reconstruire la base, consulter le journal.

## Scripts

- `npm start` : Démarre l'API (production) après build éventuel du client
- `npm run dev:api` : API Express en watch (nodemon)
- `npm run dev:client` : Client React (Vite) seul
- `npm run dev:full` : API + Client en parallèle
- `npm run build:client` : Build production du client
- `npm run preview:client` : Prévisualiser le build client localement
- `npm test` : (placeholder) tests non implémentés

## Technologies utilisées

- **Backend** : Node.js, Express.js
- **Base de données** : SQLite3 (ou Postgres via abstraction)
- **API** : Discogs API
- **Frontend (actuel)** : React + Vite + TypeScript + Material UI (thème custom)
- **Frontend (legacy - supprimé)** : HTML/CSS/JS Vanilla (retiré : `public/script.js`, `public/styles.css`)
- **Autres** : Axios (Discogs), CORS, dotenv

## Structure du projet

```
music-list/
├── public/                      # Fichiers statiques (favicon, index minimal)
├── client/                      # Frontend React (Vite + TS + MUI)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts               # Helper central (VITE_API_BASE)
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── theme.ts
│   └── index.html
├── server/
│   ├── index.js                 # Bootstrap Express + routes + Swagger (/api/docs)
│   ├── db.js                    # Abstraction SQLite/Postgres (auto schema)
│   ├── lib/
│   │   └── discogs.js           # Intégration Discogs centralisée
│   └── routes/                  # Découpage (albums, lists, smartLists, generate)
├── .env.example
├── package.json
├── README.md
└── music_collection.db*         # Fichier SQLite (si driver local)
```

Legacy retiré : `public/script.js`, `public/styles.css`, anciens `server.js` & `db.js` racine.

## Architecture (vue d'ensemble)

```
[ Client React (Vite) ] --(fetch JSON via api.ts)--> [ Express (server/index.js) ] --(axios)--> [ Discogs API ]
                             |\
                             | \--(server/db.js)--> [ SQLite ] / [ Postgres ]
                             |--(logging)--> operation_logs
                             |--(status/health)--> /api/status /api/admin/*
```

### Couches
- Présentation : fichiers statiques dans `public/` servis par Express.
- API REST : routes définies dans `server/index.js` (albums, listes, smart lists, tags, admin, système) ou via modules `server/routes/*`.
- Accès Données : module `db.js` unifie SQLite / Postgres (conversion placeholders `?` → `$n`, création schéma, helpers `run/get/all`).
- Intégration Externe : Discogs via `axios` (ajout / rafraîchissement d'albums). Cache côté DB uniquement (pas de layer mémoire pour rester stateless).
- Journal & Observabilité : table `operation_logs`, endpoints `/api/status`, `/api/admin/health`, `/api/admin/system`.

### Flux principaux

1. Ajout d'un album
   1. Front envoie `POST /api/albums { masterId }`.
   2. Serveur vérifie présence locale (unicité `master_id`).
   3. Si absent : requête Discogs master + main_release (token si disponible) → normalisation (genres/styles concaténés + labels).
   4. Insertion + ligne de log `album.add`.
   5. Réponse JSON (album enrichi) → rendu dynamique.

2. Réordonnancement d'une liste
   - Reçoit tableau partiel d'IDs (ordre utilisateur). 
   - Postgres : update unique via CTE + `unnest()`.
   - SQLite : phase négative (libère contraintes) puis réindexation séquentielle.
   - Log `list_items.reorder` (optionnel selon implémentation actuelle).

3. Import JSON
   - Parse → préparation mapping.
   - Précharge les identifiants d'albums existants pour éviter les doublons (skip + mapping).
   - Postgres : transaction complète (albums → lists → list_items/tags remappés). Rollback sur incohérence.
   - SQLite : séquence d'inserts (pas de transaction globale volontaire pour simplicité, mais cohérence assurée par remapping et contraintes FK).
   - Logs agrégés (compteurs d'ajout). 

4. Panneau Système
   - `GET /api/admin/system` collecte : version app, hash git, process (RSS, heap), uptime, counts entités, taille DB (fichier ou pg_relation_size agrégée), volume logs 24h.

### Modèle de données (résumé)
```
albums(id, master_id UNIQUE, artist_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, created_at, updated_at)
lists(id, name, description, created_at)
list_items(id, list_id FK, album_id FK, position INT, created_at)
list_tags(id, list_id FK, tag TEXT, created_at)
operation_logs(id, action, entity_type, entity_id, info JSON, created_at)
```
Index implicites : clés primaires + unique master_id (+ index unique release_id hérités si présents). (Indices supplémentaires à ajouter si croissance.)

### Stratégie de positions
Assure séquence compacte (1…N) :
- Postgres : update atomique évitant collisions.
- SQLite : repositionnement temporaire négatif puis normalisation ascendante.
Gère : envoi partiel, doublons d'IDs fournis, grands déplacements.

### Gestion erreurs & codes
- Unicité (release déjà présent ou item dupliqué dans une liste) → 409.
- Entrée invalide / format import → 400.
- Discogs injoignable → 502 (ou 500 fallback minimaliste si non distingué selon version).
- Ressource absente → 404.

### Journalisation
Chaque mutation écrit une ligne contextualisée (info JSON compacte). Permet audit, diagnostics post-mortem et métriques simples (compte actions sur 24h).

### Sécurité
- Admin protégés via header `x-admin-token` si `ADMIN_TOKEN` défini.

### Endpoints Admin (rappel)

| Méthode | URL | Description | Notes |
|---------|-----|-------------|-------|
| GET | /api/admin/health | Présence tables + counts | Vérifie existence et compte chaque table principale |
| GET | /api/admin/system | Métriques process + version + hash git + taille DB | Taille DB (SQLite fichier, Postgres pas encore détaillée) |
| GET | /api/admin/logs?limit=N | Logs récents (ordre décroissant) | `limit` par défaut 100, max 500 |
| GET | /api/admin/export | Export JSON complet (toutes tables) | À protéger — contient potentiellement beaucoup de données |
| POST | /api/admin/import | Import JSON (albums, lists, items, tags, smart_lists) | Remapping + dédup master_id / release_id |
| POST | /api/admin/rebuild | (Re)création / ajout colonnes manquantes | Relance init schéma |

Quand `ADMIN_TOKEN` est défini, ajouter le header :

```
curl -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3000/api/admin/health
```

Exemples rapides :

```
# Export
curl -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3000/api/admin/export -o export.json

# Import
curl -H "x-admin-token: $ADMIN_TOKEN" -X POST -H 'Content-Type: application/json' --data @export.json http://localhost:3000/api/admin/import

# Logs (200 derniers)
curl -H "x-admin-token: $ADMIN_TOKEN" 'http://localhost:3000/api/admin/logs?limit=200'
```

Structure simplifiée de quelques objets renvoyés :

```
Health: { ok:boolean, tables:{albums:boolean,...}, counts:{albums:number,...}, timestamp }
System: { process:{pid,memory,uptime,node}, environment, app:{version,git}, db:{driver,sizeBytes?}, counts }
Log: { id, action, entity_type, entity_id, info, created_at }
```
- Pas d'auth utilisateur finale (use-case collection personnelle). Extension possible : ajouter table `users` + scope tokens.

### Version & Environnement
- Version lit `package.json` + hash git court (commande synchrone). Exposés dans `/api/status` puis affichés en badges UI.
- Détection driver DB à chaque démarrage (variable d'environnement prioritaire).

### Performance & Scalabilité légère
- Aucune stateful session côté serveur (stateless HTTP). 
- Disques : SQLite pour usage local simple; Postgres recommandé dès déploiement cloud.
- Import volumineux optimisé : préchargement des identifiants d'albums existants en un seul `SELECT`.
- Réordonnancement O(N) avec une seule requête Postgres ou deux passes SQLite.

### Extensibilité
Pour ajouter une nouvelle entité :
1. Étendre schéma (ajout table dans création automatique).
2. Ajouter endpoints REST (CRUD minimal) + log actions.
3. Mettre à jour export/import (order logique d'insertion + mapping si dépendances FK).
4. Ajouter rendu front (zones dynamiques et update du cache local).

### Diagrammes de séquence (textuels)
Ajout album : `Client → POST /api/albums → (Fetch Discogs) → Insert album + log → 200 (payload)`
Import : `Client → POST /api/admin/import → (Parse + mapping + inserts/transaction) → Log(s) → 200 (compteurs)`
Réorder : `Client → PUT /api/lists/:id/items/order → (Algorithme spécifique driver) → 200`

### Limitations actuelles d'architecture
- Pas de cache HTTP / ETag (coût faible pour le use-case).
- Pas de pagination sur grands jeux (logs, albums) – charge front potentielle si >5k éléments.
- Pas de tests automatisés (à introduire pour sécuriser réécritures futures).

### Surveillabilité future
Idées : compteur d'erreurs agrégé, histogramme latences (wrap `db.run`), endpoint `/api/admin/metrics` Prometheus, budgets de latence.

---

## API (vue synthétique actuelle)

Albums
- `GET /api/albums` – liste + usage counts (renvoie master_id)
- `POST /api/albums` – ajout `{ masterId }`
- `DELETE /api/albums/:id` – suppression conditionnelle
- `PATCH /api/albums/:id/refresh` – rafraîchit les métadonnées via master
- `GET /api/albums/search?q=...` – recherche locale (auto-complétion)

Listes
- `GET /api/lists` – listes + tags + compte items
- `POST /api/lists` – créer
- `POST /api/lists/generate/studio` – génère automatiquement une liste "Album Studio <Artiste>" à partir des albums LOCAUX existants (filtrés studio, tri année croissante)
- `GET /api/lists/:id` – détail + items ordonnés
- `PUT /api/lists/:id` – maj nom / description
- `DELETE /api/lists/:id` – supprimer
- `POST /api/lists/:id/items` – ajoute album existant ou via masterId (création implicite si absent)
- `PUT /api/lists/:id/items/order` – réordonner
- `DELETE /api/lists/:id/items/:itemId` – retirer

Tags
- `POST /api/lists/:id/tags` – ajouter
- `DELETE /api/lists/:id/tags/:tag` – retirer

Administration / Base
- `GET /api/status` – infos runtime (token, uptime…)
- `GET /api/admin/health` – présence / compte des tables
- `GET /api/admin/system` – métriques système & base (process, taille DB, version, logs 24h)
- `POST /api/admin/rebuild` – (re)crée le schéma si nécessaire
- `GET /api/admin/export` – export JSON complet
- `POST /api/admin/import` – import JSON (transactionnel)
- `GET /api/admin/logs?limit=N` – journal des opérations

Remarque : endpoints supprimés / non implémentés volontairement (`/api/albums/by-artist-title`, `/api/albums/refresh-all`, `/api/discogs/search`, `/api/admin/migrate/masters`).

### Note historique
Une ancienne phase de migration interne (release_id → master_id) a existé puis a été supprimée. Tout le code associé (endpoint, badges, UI) a été retiré après finalisation : la collection est désormais exclusivement adressée par `master_id`.

## Journalisation

Chaque mutation (albums, listes, items, tags, admin) génère une ligne dans `operation_logs` avec un code d'action (`album.add`, `list_item.remove`, etc.). Le front colorise selon la catégorie et affiche le JSON contextuel.

### Sécurité / Accès Admin

Les endpoints `/api/admin/*` peuvent être protégés en définissant une variable d'environnement `ADMIN_TOKEN`.

Intégration front : le helper `client/src/api.ts` ajoute automatiquement l'en-tête `x-admin-token` si `localStorage.ml-admin-token` est défini.

Pour activer côté navigateur, exécuter dans la console :
```js
localStorage.setItem('ml-admin-token', 'VOTRE_TOKEN');
```
Puis recharger la page.

### Déploiement sur Render

Deux approches :

1. (Ancien) SQLite + disque persistant (payant au-delà du free tier) – non recommandé désormais.
2. (Recommandé) Postgres managé (gratuit sur certains tiers) + import JSON.

#### Option Postgres (recommandée)

1. Créer une base Postgres (Render, Neon, Supabase...).
2. Récupérer la chaîne de connexion (ex: `postgres://user:pass@host:5432/dbname`).
3. Dans Render (service Web Node) définir les variables:
   - `PG_CONNECTION_STRING=<votre_url>`
   - `DISCOGS_TOKEN=<token>` (optionnel)
   - `ADMIN_TOKEN=<secret>` (fortement conseillé)
4. Build command: `npm install`
5. Start command: `node server/index.js`
6. Déployer : le schéma est créé automatiquement.
7. (Migration) Depuis l'ancienne instance: `GET /api/admin/export` puis `POST /api/admin/import` sur la nouvelle (remapping auto des IDs).

Avantages: pas de disque à gérer, scalabilité plus simple, pas de corruption possible en cas de restart.

#### Option SQLite (legacy / local)

1. Conserver `DB_PATH` (ou laisser par défaut `./music_collection.db`).
2. Pour Render: nécessiterait un disque persistant défini dans `render.yaml` (voir version précédente). Non indispensable si passage à Postgres.

#### SSL Postgres

Le code active automatiquement `ssl: { rejectUnauthorized: false }` pour certaines plateformes (Render, Neon, Supabase) si la chaîne contient leur domaine.

### Migration rapide SQLite → Postgres

1. Sur l'ancienne instance (SQLite) : Télécharger l'export via `/api/admin/export`.
2. Déployer la nouvelle instance avec `PG_CONNECTION_STRING`.
3. Ouvrir l'onglet Administration et importer le JSON.
4. Vérifier `/api/admin/health` et l'intégrité des listes.
5. Optionnel: supprimer l'ancien service/disque.

### Limitations actuelles

- Pas de conservation stricte des IDs d'origine en Postgres (design volontaire pour éviter collisions/séquence).
- Pas encore d'index spécifiques sur `release_year` ou `list_items(list_id, position)` (suffisant pour volume modéré < ~50k entrées). Ajouter si besoin.

### Améliorations possibles (TODO)

### Centralisation des appels API (front)

Le fichier `client/src/api.ts` fournit :

- `apiFetch(path, init?)`
- `postJson / putJson / patchJson / deleteReq`
- Résolution `VITE_API_BASE` + ajout automatique du token admin.

En cas d'erreur HTTP, une exception avec `error` (payload JSON) est levée.

### Améliorations possibles (TODO)

- Authentification plus avancée (RBAC, sessions)
- Pagination / chargement progressif des logs & albums
- Index DB supplémentaires (année, (list_id, position)) si croissance importante
- Filtrage/tooltip interactif des charts
- Sauvegarde préférences utilisateur (vue mosaïque, etc.)
- Export partiel (sélection de listes seulement)
- Détection doublons potentiels (normalisation artiste + titre)
- Rafraîchissement programmatique d'une liste entière (batch contrôlé)
- Tests automatisés (unitaires + intégration)
- Métriques Prometheus / endpoint `/api/admin/metrics`

## Contribution

Issues & PR bienvenues. Merci d'inclure reproduction / contexte et de rester concis.

## Licence

ISC