# Migration UI vers Material UI (MUI)

Ce document décrit une stratégie incrémentale pour remplacer l'UI actuelle (HTML + CSS custom) par une interface React + MUI sans bloquer l'application existante.

## Objectifs
- Moderniser l'ergonomie et la cohérence visuelle.
- Introduire composants accessibles (modals, menus, listes virtuelles) fournis par MUI.
- Minimiser l'interruption fonctionnelle : cohabitation progressive.

## Stratégie par étapes
1. **Bootstrapping** : Ajouter React + Vite (ou CRA) côté `client/` servant les assets via Express statique (proxy API `/api/*`).
2. **Design System** : Définir un thème MUI (palette, typographie, breakpoints) reflétant l'identité (accent bleu #3A6EA5).
3. **Composants fondamentaux** : AppBar / Drawer (navigation), Layout responsive, Card Album, Snackbar, Dialog générique.
4. **Migration feature par feature**:
   - Phase 1: Navigation + Page Albums (lecture seule) + Modal album.
   - Phase 2: Listes classées (CRUD) avec DataGrid ou List + Drag & Drop (MUI + dnd-kit).
   - Phase 3: Listes intelligentes (édition critères + rendu grille) + chips filtrage.
   - Phase 4: Statistiques (Charts -> `@mui/x-charts` ou Recharts).
   - Phase 5: Admin (health, export) dans un onglet séparé.
5. **Retrait du CSS legacy** : remplacer progressivement les blocs `.card`, `.albums-grid`.
6. **Optimisations** : Code splitting, Suspense pour chargement, memoisation.

## Détails techniques
- **Stack**: React 18 + Vite + TypeScript (optionnel mais recommandé) + MUI v5.
- **Theming**: Palette primaire = accent, secondaire dérivée. Mode clair/sombre géré par `createTheme` + localStorage.
- **State**: React Query pour cache des endpoints `/api/*` (simplifie refresh et invalidations) + Zustand pour UI ephemeral state.
- **Routing**: React Router (onglets = routes). Exemple: `/albums`, `/lists`, `/smart-lists`, `/stats`, `/admin`.
- **Build**: Vite construit dans `public/app` (ou `dist/` servi statiquement). Express continue d'exposer `/api`.

## Plan d'intégration Express
1. Ajouter script `"client:dev": "vite --port 5173"` et proxy dans `vite.config.js` vers `http://localhost:3000` pour `/api`.
2. Production: Build (`vite build`) et servir `dist` via `app.use(express.static('dist'))` avant la route catch-all.

## Découpage composant initial
```
client/
  src/
    main.tsx
    App.tsx
    theme.ts
    components/
      AppLayout.tsx
      Navigation.tsx
      AlbumCard.tsx
      AlbumGrid.tsx
      AlbumModal.tsx
      ListEditor/
      SmartLists/
    pages/
      AlbumsPage.tsx
      ListsPage.tsx
      SmartListsPage.tsx
      StatsPage.tsx
      AdminPage.tsx
    api/
      client.ts (axios instance + interceptors)
      hooks/
        useAlbums.ts
        useLists.ts
        useSmartLists.ts
```

## Migration progressive
- Tant que tout n'est pas migré, conserver `public/index.html` (legacy) et ajouter un lien "Nouvelle interface (beta)" pointant vers `/app`.
- Une fois stable, inverser (nouvelle UI par défaut, l'ancienne derrière `/legacy`).

## Étapes suivantes
1. Ajouter dépendances (React, MUI, Vite) + config.
2. Créer squelette layout + navigation MUI.
3. Reprendre la logique fetch actuelle dans des hooks.
4. Tester performance (grille 200+ albums).

---
Ce fichier peut être enrichi pendant la migration.
