# Music List App

Application web légère pour gérer une collection d'albums avec intégration Discogs, listes classées, tags, statistiques visuelles et journal des opérations. Fonctionne en **SQLite (local / simple)** ou **Postgres (hébergement cloud sans disque persistant)** via une couche d'abstraction automatique.

## Fonctionnalités principales

- 🎵 Ajout d'albums par numéro de release Discogs
- 🔄 Rafraîchissement des métadonnées d'un album (ciblé) depuis Discogs
- 📚 Visualisation en grille mosaïque (overlay minimal) et filtre texte + année
- 🧾 Listes classées avec réordonnancement par glisser-déposer
- 🏷️ Tags de listes (ajout/suppression) + compteur d'utilisation
- 🗑️ Suppression protégée (impossible si l'album est dans une liste)
- 🛠️ Administration : export JSON, import, santé/rebuild de la base, journal coloré des opérations
- 🪵 Journalisation de chaque action (albums, listes, items, tags, admin) avec catégories colorées
- 📊 Page Statistiques avec graphiques (distribution annuelle, genres/styles) en Canvas
- �️ Modal plein écran sur clic pochette (détails + lien Discogs)
- 💾 Base locale SQLite (schéma auto-créé, intégrité référentielle) OU Postgres (auto-détection)
- 🎨 Thème clair/sombre avec palette acier/bleu

Fonctionnalités retirées / non présentes volontairement : ajout par artiste+titre (supprimé), rafraîchissement global massif (endpoint supprimé), pagination.

## Données persistées

Albums : `artist_name`, `album_title`, `release_year`, `genre`, `style`, `label`, `cover_image_url`, `release_id`, timestamps, usage dans listes (compteur dérivé).

Listes : `name`, `description`, items ordonnés (table séparée), tags (table relationnelle), timestamps.

Journal (`operation_logs`) : `action`, `entity_type`, `entity_id`, `info` (JSON), `created_at`.

Schéma reconstruit automatiquement si manquant (endpoint /admin/rebuild).

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

4. Démarrez l'application :
   ```bash
   npm run dev
   ```

5. Ouvrez votre navigateur sur `http://localhost:3000`

Optionnel : ajoutez `DISCOGS_TOKEN=<votre_token>` dans `.env` pour de meilleures métadonnées.

### Variables d'environnement principales

| Variable | Rôle | Exemple |
|----------|------|---------|
| PORT | Port d'écoute local | 3000 |
| DISCOGS_TOKEN | Token Discogs (optionnel) | abc123... |
| ADMIN_TOKEN | Protège les endpoints /api/admin/* | unsecretfort |
| DB_PATH | (SQLite) Chemin fichier DB | ./music_collection.db |
| PG_CONNECTION_STRING | Chaîne de connexion Postgres (prioritaire) | postgres://user:pass@host:5432/dbname |
| DATABASE_URL | Alias Heroku/Render (si PG_CONNECTION_STRING absent) | postgres://... |

Si `PG_CONNECTION_STRING` **ou** `DATABASE_URL` est défini, le driver Postgres est utilisé. Sinon, SQLite.

### Choix automatique du driver

1. Detect: si variable PG présente ⇒ driver = `pg`
2. Sinon ⇒ driver = `sqlite`
3. Le schéma est créé automatiquement dans les deux cas (tables `albums`, `lists`, `list_items`, `list_tags`, `operation_logs`).

### Import / Remapping des IDs (Postgres)

Lors d'un import JSON:
- En SQLite, les IDs réinsérés suivent et peuvent correspondre aux anciens si la séquence est alignée.
- En Postgres, les colonnes sont en `SERIAL`; les IDs sont régénérés. Le code construit donc un **mapping ancienID → nouvelID** pour:
   - `albums`
   - `lists`
   - Puis réécrit `list_items.list_id`, `list_items.album_id` et `list_tags.list_id` avant insertion.

Conséquence:
- Les IDs internes peuvent changer après migration vers Postgres, mais les relations restent cohérentes.
- Le champ `release_id` (Discogs) reste stable et peut servir d'identifiant fonctionnel.

En cas de référence introuvable durant l'import, la transaction (Postgres) est annulée et une erreur claire est renvoyée.

## Mode d'emploi rapide

1. Trouver le numéro de release Discogs (ex: URL `.../release/249504` ⇒ `249504`).
2. Saisir le numéro dans le formulaire de la colonne gauche et valider.
3. Filtrer / rechercher via la barre (texte + année exacte).
4. Passer en onglet Listes : créer une liste, ajouter des albums (auto-complétion locale ou releaseId), activer le mode édition pour réordonner.
5. Ajouter des tags de liste pour le regroupement (affichage badge + stats de tags).
6. Clic pochette ➜ modal détail + lien Discogs.
7. Onglet Statistiques ➜ visualiser graphiques (années, genres/styles) calculés côté client.
8. Onglet Administration ➜ exporter/importer JSON, vérifier ou reconstruire la base, consulter le journal.

## Scripts

- `npm start` : Démarre l'application en mode production
- `npm run dev` : Démarre l'application en mode développement avec nodemon
- `npm test` : Lance les tests (non implémentés)

## Technologies utilisées

- **Backend** : Node.js, Express.js
- **Base de données** : SQLite3
- **API** : Discogs API
- **Frontend** : HTML, CSS, JavaScript (Vanilla)
- **Autres** : Axios, CORS, dotenv

## Structure du projet

```
music-list/
├── public/
│   ├── index.html      # Interface utilisateur
│   ├── styles.css      # Styles CSS
│   └── script.js       # JavaScript côté client
├── server.js           # Serveur Express
├── package.json        # Configuration npm
├── .env.example        # Exemple de variables d'environnement
└── README.md          # Ce fichier
```

## API (vue synthétique actuelle)

Albums
- `GET /api/albums` – liste + usage counts
- `POST /api/albums` – ajout `{ releaseId }`
- `DELETE /api/albums/:id` – suppression conditionnelle
- `PATCH /api/albums/:id/refresh` – rafraîchit les métadonnées
- `GET /api/albums/search?q=...` – recherche locale (auto-complétion)

Listes
- `GET /api/lists` – listes + tags + compte items
- `POST /api/lists` – créer
- `GET /api/lists/:id` – détail + items ordonnés
- `PUT /api/lists/:id` – maj nom / description
- `DELETE /api/lists/:id` – supprimer
- `POST /api/lists/:id/items` – ajoute album existant ou via releaseId
- `PUT /api/lists/:id/items/order` – réordonner
- `DELETE /api/lists/:id/items/:itemId` – retirer

Tags
- `POST /api/lists/:id/tags` – ajouter
- `DELETE /api/lists/:id/tags/:tag` – retirer

Administration / Base
- `GET /api/status` – infos runtime (token, uptime…)
- `GET /api/admin/health` – présence / compte des tables
- `POST /api/admin/rebuild` – (re)crée le schéma si nécessaire
- `GET /api/admin/export` – export JSON complet
- `POST /api/admin/import` – import JSON (transactionnel)
- `GET /api/admin/logs?limit=N` – journal des opérations

Remarque : endpoints supprimés / non implémentés volontairement (`/api/albums/by-artist-title`, `/api/albums/refresh-all`).

## Journalisation

Chaque mutation (albums, listes, items, tags, admin) génère une ligne dans `operation_logs` avec un code d'action (`album.add`, `list_item.remove`, etc.). Le front colorise selon la catégorie et affiche le JSON contextuel.

### Sécurité / Accès Admin

Les endpoints `/api/admin/*` peuvent être protégés en définissant une variable d'environnement `ADMIN_TOKEN`. Le client inclut alors automatiquement l'en-tête `x-admin-token` s'il est stocké dans `localStorage` (clé `ml-admin-token`).

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
5. Start command: `node server.js`
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

- Authentification plus avancée (RBAC, sessions)
- Pagination / chargement progressif des logs
- Index DB (année, positions) si croissance importante
- Filtrage/tooltip interactif des charts
- Sauvegarde préférences utilisateur (vue mosaïque, etc.)
- Export partiel (sélection de listes seulement)
- Endpoint de recherche/fusion d'albums en doublon

## Contribution

Issues & PR bienvenues. Merci d'inclure reproduction / contexte et de rester concis.

## Licence

ISC