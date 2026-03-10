# Audit WinCatalog (mis à jour)

**Date** : 2026-03-10  
**Stack** : Tauri 2.x (Rust/rusqlite) + React 18 + Mantine 7 + Vite

---

## 1. État actuel (résumé)

### Fonctionnalités principales en place
- Volumes : CRUD + statut online/offline.
- Explorer : navigation arborescente, tri, recherche locale + FTS, tags, panneau inspecteur.
- Scan : wizard complet (source, options, lancement, progression, résultats).
- Doublons : détection par hash + workflow de suppression vers corbeille.
- Jobs : runner fond, pause/reprise, annulation job courant.
- Dashboard : stats globales, top dossiers, activité récente.
- Settings, tags/collections, export JSON/CSV/SQLite.

### Validation technique récente
- `npm run build` : OK.
- `cargo check` (src-tauri) : OK après installation/config `clang`.

---

## 2. Correctifs réalisés depuis l’audit initial

### Backend / Rust
1. **Annulation réelle scan/hash**
- Ajout d’état partagé des canaux d’annulation dans `AppState`.
- Nouvelles commandes Tauri : `cancel_scan`, `cancel_hash`.
- Garde-fous : refus de démarrer un 2e scan/hash concurrent.

2. **Perf dashboard : stats globales**
- `get_global_kind_stats` optimisé pour lire `volume_kind_stats` (snapshot par volume) au lieu d’un `GROUP BY` direct sur `entries`.
- Fallback conservé vers ancienne requête si snapshots absents.

3. **Pool DB lecture**
- Le pool lecteur existe et a été amélioré : taille auto-dimensionnée selon CPU + surcharge possible via `WINCAT_DB_READERS`.

4. **Build toolchain C fiable**
- Ajout `.cargo/config.toml` pour pointer `CC/CXX` sur `clang`.

### Frontend / React
1. **Scan UI : annulation réelle**
- Bouton « Annuler le scan » pendant l’exécution.
- État `canceled` distinct de l’état `error`.
- Messages utilisateur cohérents après annulation.

2. **StatusBar : réduction du polling inutile**
- Polling adaptatif jobs (actif vs idle).
- Volumes rafraîchis majoritairement par événements, avec fallback lent.

3. **Explorer : pagination et fluidité**
- Pagination fonctionnelle au-delà de 200 entrées.
- Chargement automatique au scroll (liste virtualisée + grille).
- Chargement des tags en batch sur les entrées paginées (pas limité à 100).

4. **Theme clair : retouches ciblées**
- Suppression de hover inline au profit de classes CSS.
- `index.html` ajusté pour mieux respecter `color-scheme` et éviter un fallback sombre forcé en clair.

### CI
1. **Ajout d’un workflow Windows**
- Installation LLVM/clang.
- Build frontend + `cargo check` backend.

---

## 3. Risques / dettes restantes (réalistes)

1. **Encodage de textes UI**
- Plusieurs chaînes FR affichent encore des artefacts (`Ã©`, `â€¦`) selon fichiers/sources.
- Impact : qualité perçue, lisibilité, crédibilité produit.

2. **Theme clair : homogénéité fine**
- Le gros est stabilisé, mais un passage final écran par écran est encore nécessaire (tooltips/chips/libellés spécifiques).

3. **CI incomplète (plateformes)**
- Workflow Windows ajouté, mais pas encore de matrice Linux/macOS ni de tests UI/e2e.

---

## 4. Améliorations fonctionnelles proposées (priorisées)

### P1 (impact utilisateur direct)
1. **Recherche contextuelle Explorer (FTS avec scope dossier courant)**
- Permettre la recherche plein texte limitée au volume/path courant.
- Bénéfice : résultats pertinents, workflow exploration plus rapide.

2. **Confirmations et preview pour actions destructives**
- Standardiser confirmations (doublons/tags/reset DB) avec aperçu des impacts.
- Bénéfice : baisse du risque d’erreur utilisateur.

3. **Feedback utilisateur unifié (toasts succès/erreur)**
- Ajouter toasts systématiques sur actions longues et sensibles.
- Bénéfice : meilleure compréhension de l’état de l’app.

### P2 (productivité et ergonomie)
4. **Navigation clavier avancée dans Explorer**
- Flèches, Enter, Backspace déjà partiels : finaliser Home/End/PageUp/PageDown, multi-sélection clavier.
- Bénéfice : usage power-user.

5. **Rapports enrichis orientés usage**
- Templates avec filtres temporels, périmètre multi-volumes et export direct depuis dashboard.
- Bénéfice : valeur métier plus claire pour les rapports.

6. **Actions batch Explorer**
- Sélection multiple + opérations groupées (tags, corbeille, collection, export).
- Bénéfice : gain de temps sur gros volumes.

### P3 (évolution produit)
7. **IA réellement exploitable en production**
- Finaliser intégration API (timeouts, retries, quotas, gestion erreurs utilisateur).
- Bénéfice : fonctions IA réellement utilisables, pas seulement “stub”.

8. **Watch mode orienté UX**
- Historique de changements en quasi temps réel + badges de nouveautés par dossier.
- Bénéfice : positionnement plus fort en “catalogue vivant”.

---

## 5. Plan recommandé (court terme)

1. **Sprint 1**
- Nettoyage encodage UI FR.
- Stabilisation finale thème clair.
- Standardisation feedback toasts.

2. **Sprint 2**
- Recherche contextuelle Explorer.
- Confirmations destructives + previews.
- Actions batch Explorer.

3. **Sprint 3**
- Compléter CI multi-plateforme.
- Durcir IA/watcher en production.

---

## 6. Notes d’exploitation

- `clang` est requis uniquement au **build-time**, pas à livrer avec l’exécutable final.
- Paramètre utile perf DB : `WINCAT_DB_READERS` (pool de connexions lecture).
