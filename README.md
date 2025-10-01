# Music List App

Application web légère pour gérer une collection d'albums avec intégration Discogs, listes classées, tags, statistiques visuelles et journal des opérations.

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
- 💾 SQLite local (schéma auto-créé, intégrité référentielle)
- 🎨 Thème clair/sombre avec palette acier/bleu

Fonctionnalités retirées / non présentes volontairement : ajout par artiste+titre (supprimé), rafraîchissement global massif, authentification (à implémenter si besoin), pagination.

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

## Améliorations possibles (TODO)

- Authentification / token admin
- Pagination / chargement progressif des logs
- Filtrage/tooltip interactif des charts
- Sauvegarde préférences utilisateur (vue mosaïque, etc.)
- Export partiel (sélection de listes seulement)

## Contribution

Issues & PR bienvenues. Merci d'inclure reproduction / contexte et de rester concis.

## Licence

ISC