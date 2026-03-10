# Audit complet de WinCatalog

**Date** : 2026-03-10
**Stack** : Tauri 2.0 (Rust/rusqlite) + React 18 + Mantine 7 + Recharts + Vite

---

## 1. Fonctions implementees

### Backend Rust (58 commandes Tauri)

| Module | Fonctions |
|--------|-----------|
| **Volumes** | `list_volumes`, `get_volume`, `add_volume`, `update_volume`, `update_volume_space`, `delete_volume`, `check_all_volumes` |
| **Explorer** | `list_entries`, `get_entry`, `search` (FTS5), `search_content` |
| **Scanner** | `run_scan` (3 phases : walk/delta/finalize), `start_parallel_scan`, watcher filesystem |
| **Jobs** | `list_active_jobs`, `pause_jobs`, `resume_jobs`, `cancel_current_job`, `wake_job_runner` |
| **Hash** | `start_hash`, `quick_hash_file`, `full_hash_file` |
| **Doublons** | `find_duplicates`, `get_duplicate_group` |
| **Corbeille** | `trash_entry`, `list_trash`, `restore_entry`, `purge_expired`, `trash_summary` |
| **Tags** | `create_tag`, `list_tags`, `update_tag`, `delete_tag`, `tag_entry`, `untag_entry`, `get_entry_tags` |
| **Collections** | CRUD complet + `add_to`/`remove_from`/`get_entries` |
| **Champs perso** | `list_custom_fields`, `create_custom_field`, `delete_custom_field`, `get/set_entry_custom_value` |
| **Renommage** | `preview_rename`, `apply_rename` (patterns avec tokens) |
| **Export** | `export_catalogue` (SQLite/JSON/CSV) |
| **IA** | `ai_classify`, `ai_summarize`, `ai_analyze_image` (stubs non fonctionnels) |
| **Regles** | `list_rules`, `save_rules`, execution post-scan |
| **Thumbnails** | Generation image/video/audio/document/ebook/office |
| **Extracteurs** | Metadonnees EXIF, ID3, FLAC, ffprobe, PDF |
| **Dashboard** | `get_volume_kind_stats`, `get_global_kind_stats`, `get_recent_scan_log`, `get_top_folders`, `get_volume_snapshots` |
| **Watch** | `start_watch`, `stop_watch`, `list_watched_volumes` |

### Frontend React (13 ecrans/vues)

| Ecran | Description |
|-------|-------------|
| **Dashboard** | Cartes volumes avec RingProgress, PieChart distribution, BarChart top dossiers, activite recente |
| **Explorer** | Navigation arborescente, tri, vue liste/grille, panneau inspecteur, filtres avances |
| **Scan** | Wizard 4 etapes : source, options, recap, progression live |
| **Doublons** | 3 colonnes : groupes, comparaison, details, auto-selection |
| **Tags** | 3 onglets : Tags CRUD, Collections, Auto-regles |
| **Settings** | 8 onglets : General, Scan, Cache, Hash, Corbeille, IA, Champs perso, Avance |
| **CommandPalette** | Ctrl+K : recherche FTS5 + navigation |
| **QuickLook** | Previsualisation (Espace) |
| **ImageViewer** | Visionneuse plein ecran avec zoom/pan/filmstrip/slideshow |
| **Drawers** | Activite, Filtres, Renommage batch, Rapports |

---

## 2. BUG CRITIQUE : Theme clair casse

### Cause racine

L'app est codee en dur pour le mode sombre. Il y a ~100+ occurrences de `var(--mantine-color-dark-*)` dans tous les fichiers — ces variables ne s'adaptent PAS au color scheme.

### Problemes specifiques

| Probleme | Impact |
|----------|--------|
| `index.html` : `background-color: #1a1b1e` code en dur | Body toujours noir en mode clair |
| AppShell : `dark-8` (main), `dark-7` (header/navbar/footer) | Structure entiere reste sombre |
| Sidebar : texte `dark-1` (gris clair) sur fond blanc = invisible | Navigation inutilisable |
| Tous les bordures : `dark-5` | Bordures trop foncees en mode clair |
| Tous les drawers/modals : bg `dark-7` | Drawers sombres avec contenu clair |
| ImageViewer : bg litteral `#2a2a2e` | Toujours noir |
| Recharts tooltips : bg `dark-7` | Tooltips graphiques illisibles |
| ~20 handlers `onMouseEnter` inline mettant bg `dark-6` | Taches sombres au survol |

### Correction recommandee

- `dark-7`/`dark-8` -> `var(--mantine-color-body)` ou `var(--mantine-color-default)`
- `dark-5` (bordures) -> `var(--mantine-color-default-border)`
- `dark-6` (hover) -> `var(--mantine-color-default-hover)`
- Utiliser `light-dark()` CSS ou `useMantineColorScheme` pour les cas restants
- Fixer le `index.html` avec `color-scheme: dark light` conditionnel

---

## 3. Bugs backend (Rust)

| Severite | Fichier | Bug |
|----------|---------|-----|
| **Critique** | `main.rs` | `VolumeWatcher` droppe immediatement dans setup -> le thread de surveillance volumes s'arrete au demarrage |
| **Critique** | `ai/mod.rs` | `&text[..2000]` — panic sur caracteres multi-octets UTF-8 (accents francais !) |
| **Critique** | `commands/mod.rs` | `_cancel_tx` droppe -> scans/hash non annulables |
| **Haut** | `jobs/mod.rs` | `execute_hash_job` corrompt le flag cancel partage -> jobs suivants potentiellement annules |
| **Haut** | `parallel.rs` | Threads watcher de cancel fuient et tournent en boucle indefiniment |
| **Haut** | `queries.rs` | `get_recent_scan_log` : binding parametre decale quand `(None, Some)` -> resultats faux |
| **Haut** | `thumbs/mod.rs` | Fichiers sauves en JPEG mais nommes `.webp` avec MIME `image/webp` |
| **Moyen** | `rules/mod.rs` | `PathContains` verifie le nom, pas le chemin complet |
| **Moyen** | `extractors/mod.rs` | `extract_flac` : `s[..4]` panic si DATE < 4 chars |
| **Moyen** | `rename/mod.rs` | Renommage non atomique — crash partiel laisse un etat incoherent |
| **Moyen** | `export/mod.rs` | Race condition entre WAL checkpoint et copie fichier |
| **Bas** | `tauri.conf.json` | CSP desactive (`null`) — risque XSS |

---

## 4. Bugs frontend (React/TS)

| Severite | Fichier | Bug |
|----------|---------|-----|
| **Critique** | `AudioWaveform.tsx` | Import `Stack` manquant -> crash runtime |
| **Haut** | `DoublonsScreen.tsx` | Comparaison par reference `g !== activeGroup` -> stale closure |
| **Haut** | `Inspector.tsx` | Champ custom declanche un appel API a chaque frappe clavier (pas de debounce) |
| **Haut** | `ExplorerScreen.tsx` | Tags construits depuis les entrees visibles au lieu d'utiliser `tagApi.list()` |
| **Moyen** | `ScanScreen.tsx` | Options scan (depth, thumbs, hash) configurees mais jamais envoyees au backend |
| **Moyen** | `ReportsDrawer.tsx` | Export = `setTimeout` + `console.log` — ne fait rien |
| **Moyen** | `TagsScreen.tsx` | Aucun try/catch sur les appels API -> rejections non gerees |
| **Bas** | `ExplorerScreen.tsx` | 100 appels API tags sans annulation au changement de dossier |

---

## 5. Problemes de performance

| Fichier | Probleme | Impact |
|---------|----------|--------|
| `db/mod.rs` | 1 seule connexion lecteur derriere un Mutex | Lectures serialisees |
| `queries.rs` | `get_global_kind_stats` = full table scan GROUP BY | Lent sur gros catalogues |
| `extractors/mod.rs` | 5000 `db.write()` individuels (pas de batch) | Extraction metadonnees tres lente |
| `scanner/mod.rs` | HashMap de toutes les entrees en memoire | ~100 MB+ pour 1M fichiers |
| `ExplorerScreen.tsx` | Pas de virtualisation liste + 100 appels tags sequentiels | UI laggy |
| `DoublonsScreen.tsx` | Chargement sequentiel de tous les groupes | Blocage UI long |
| `StatusBar.tsx` | Polling toutes les 2s meme au repos | Charge CPU/IPC inutile |
| `App.tsx` | `renderScreen()` dans le render -> unmount/remount complet a chaque changement d'onglet | Perte d'etat |

---

## 6. Suggestions d'ameliorations

### Fonctionnelles
1. Pagination / scroll infini dans l'Explorer (actuellement tronque a 200 entrees)
2. Confirmations avant actions destructives (suppression doublons, tags, reinitialisation DB)
3. Recherche contextuelle — le filtre Explorer devrait pouvoir utiliser FTS5
4. IA fonctionnelle — implementer `call_ai_api` avec reqwest
5. Navigation clavier dans l'Explorer (fleches, Entree pour ouvrir)
6. Drag-and-drop pour reordonner les widgets dashboard (le grip handle existe mais ne fait rien)
7. Rapports reels — connecter ReportsDrawer a `exportApi.catalogue()`
8. Options scan effectives — passer maxDepth/thumbs/hash au backend

### Esthetiques
1. Corriger le theme clair (priorite absolue, ~100 corrections)
2. Remplacer les `onMouseEnter`/`onMouseLeave` inline par du CSS `:hover`
3. StatusBar trop petite (28px) — overflow avec plusieurs jobs/volumes
4. Etats vides plus utiles avec des actions suggerees contextuelles
5. Feedback visuel apres actions (toasts de succes/erreur)
6. Memoiser les sous-composants du Dashboard avec `React.memo`
7. Conserver les ecrans montes au lieu de les detruire/recreer a chaque changement d'onglet
