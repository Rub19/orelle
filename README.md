<p align="center"><img src="resources/brand/png/wordmark-dark-800.png" alt="Orelle" width="360"></p>

**Orelle** est une couche d’expérience premium pour Windows 11. Elle combine un Dock inspiré de macOS, un launcher universel, des widgets de bureau, un centre de contrôle et ses propres applications (Fichiers, Moniteur d’activité). Elle fonctionne au-dessus de Windows, sans le remplacer ni le modifier de façon irréversible.

> Le nom vient d’*oriel*, une fenêtre en baie qui s’avance hors de la façade : une meilleure fenêtre sur Windows.
> Feuille de route : [docs/ROADMAP.md](docs/ROADMAP.md) · Choix techniques et limites : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Démarrer

```bash
npm install
npm start
```

Au premier lancement, Orelle indexe vos applications, construit un Dock à partir de celles qui sont installées, place deux widgets et ouvre les Préférences. Ensuite, Orelle reste en arrière-plan, avec une icône dans la zone de notification.

| Script | Rôle |
|---|---|
| `npm start` | Compile puis lance Orelle |
| `npm run dev` | Idem, avec journaux détaillés dans la console |
| `npm test` | Tests unitaires (Vitest) |
| `npm run smoke` | Lance Orelle dans un profil temporaire et vérifie 21 intégrations réelles (Win32, Core Audio, PDH, Dock, launcher, widgets, Fichiers, Moniteur…) |
| `npm run check` | Typecheck + tests + smoke test |
| `npm run brand` | Régénère toutes les ressources graphiques depuis `resources/brand/*.svg` |

Options de ligne de commande :
- `--orelle-open=files[:chemin]`, `--orelle-open=monitor[:onglet]`, `--orelle-open=control`, `--orelle-open=launcher` : ouvrent une surface.
- `--orelle-section=dock` : ouvre une page des Préférences.
- `--orelle-quit` : arrête proprement l’instance en cours.
- `--orelle-user-data=<dossier>` : utilise un profil isolé.

## Ce que contient Orelle

| Module | Accès | Points clés |
|---|---|---|
| **Dock** | toujours visible | Grossissement, lancement réel, indicateurs, réorganisation par glisser, dépôt de fichiers, menus contextuels, réservation d’espace, masquage automatique, masquage en plein écran |
| **Launcher** | `Alt+Espace` | Apps, fenêtres, fichiers, Paramètres Windows, calculs, conversions, commandes, scripts autorisés, presse-papiers, favoris |
| **Centre de contrôle** | `Ctrl+Alt+C`, Dock, zone de notification | Volume réel (Core Audio), micro, luminosité, Wi-Fi, batterie, médias, thème, barre des tâches, modules réordonnables |
| **Widgets** | bureau (visibles avec Win+D) | 13 widgets, mode édition, opacité, persistance |
| **Fichiers** | Dock, launcher, centre de contrôle | Onglets, favoris, 3 vues, aperçu, tri, regroupement, filtres, recherche par nom et par contenu, Corbeille, archives `.zip` |
| **Moniteur d’activité** | launcher, centre de contrôle, Fichiers | CPU, RAM, GPU, disque, réseau avec historique ; processus ; démarrage réversible ; services ; rapport de diagnostic |
| **Préférences** | Dock, zone de notification | Tous les réglages, thèmes, raccourcis, export et import de profil |

### Raccourcis

**Launcher** : `↑ ↓` naviguer · `Entrée` ouvrir · `Ctrl+Entrée` action secondaire · `Ctrl+1…9` · `Ctrl+D` favori · `Ctrl+P` épingler au Dock · `Échap` fermer.

**Fichiers** :
- `Ctrl+T` / `Ctrl+W` : nouvel onglet / fermer l’onglet · `Ctrl+N` : nouvelle fenêtre.
- `Ctrl+Maj+N` : nouveau dossier · `F2` : renommer · `Suppr` : Corbeille · `Maj+Suppr` : suppression définitive (avec confirmation).
- `Ctrl+C/X/V` : copier, couper, coller · `Espace` : aperçu · `Ctrl+1/2/3` : vues · `Ctrl+H` : fichiers masqués.
- `Ctrl+F` : filtrer (`Entrée` cherche récursivement, `Alt+Entrée` cherche aussi dans le contenu) · `Ctrl+L` : saisir un chemin.
- `Alt+←/→/↑` : précédent, suivant, dossier parent · `F5` : actualiser · taper des lettres sélectionne l’élément correspondant.

## Sécurité et confidentialité

- Aucun droit administrateur, aucune donnée envoyée à un service externe, sauf la météo (Open-Meteo, coordonnées de la ville choisie) et les recherches web que vous validez.
- Orelle ne modifie la configuration de Windows que sur votre demande, toujours de façon réversible :
  - démarrage automatique : clé Run de votre compte ;
  - masquage auto de la barre des tâches : API AppBar, état d’origine restauré ;
  - applis au démarrage : même indicateur que Windows, avec un journal des changements pour tout annuler.
- Suppression de fichiers : Corbeille par défaut. La suppression définitive demande une confirmation explicite.
- Arrêt de processus : confirmation obligatoire, et refus pour les processus essentiels de Windows.
- Scripts : uniquement ceux que vous ajoutez, avec confirmation à la première exécution et après chaque modification (SHA-256).

## Désinstallation

1. Dans Préférences › Général, désactivez « Lancer Orelle à l’ouverture de session » et « Masquer automatiquement la barre des tâches ».
2. Dans Moniteur › Démarrage, cliquez sur « Annuler mes modifications » si vous en avez fait.
3. Quittez Orelle, puis supprimez le dossier du projet et `%APPDATA%\Orelle`.

## Identité visuelle

Les sources se trouvent dans `resources/brand` : icône sombre et claire, symbole couleur et monochrome, logotypes. `npm run brand` génère les PNG et l’ICO Windows dans `resources/icons` et `resources/brand/png`.
