# NOVA

Une couche d’expérience premium pour Windows 11 : un **Dock** inspiré de macOS, un **launcher** universel façon Raycast
et des **Préférences** complètes. Elle fonctionne au-dessus de Windows, sans le modifier.

> v0.1 : phases 1 à 3 de la [feuille de route](docs/ROADMAP.md). Choix techniques et limites : [architecture](docs/ARCHITECTURE.md).

## Démarrer

```bash
npm install
npm start
```

Au premier lancement, NOVA indexe vos applications, construit un Dock à partir de celles qui sont installées
et ouvre les Préférences. Ensuite, NOVA reste en arrière-plan (icône dans la zone de notification).

| Script | Rôle |
|---|---|
| `npm start` | Compile puis lance NOVA |
| `npm run dev` | Idem, avec journaux détaillés dans la console |
| `npm test` | Tests unitaires (Vitest) |
| `npm run smoke` | Lance NOVA dans un profil temporaire et vérifie les intégrations réelles (Win32, index, Dock, launcher) |
| `npm run check` | Typecheck + tests + smoke test |
| `npm run icons` | Régénère l’icône de l’application |

Options : `--nova-user-data=<dossier>` (profil isolé), `--nova-section=dock` (ouvre une page des Préférences),
`--nova-quit` (arrête proprement l’instance en cours).

## Utilisation

**Dock**
- Clic : lance l’app, la met au premier plan, ou la réduit si elle est déjà active (plusieurs fenêtres : bascule).
- Maj + clic ou clic milieu : nouvelle fenêtre. Clic droit : fenêtres ouvertes, garder / retirer, afficher dans l’Explorateur, quitter.
- Glisser une icône pour la déplacer ; la glisser hors du Dock pour la retirer.
- Déposer un fichier, un dossier, un raccourci ou un `.url` sur le Dock pour l’épingler.
- Clic droit sur le fond : masquage auto, position, ajout d’éléments.

**Launcher** — `Alt + Espace` (modifiable)

| Touche | Action |
|---|---|
| `↑` `↓` / `Tab` | Naviguer |
| `Entrée` | Action principale |
| `Ctrl + Entrée` | Action secondaire (afficher dans le dossier…) |
| `Ctrl + 1…9` | Ouvrir le n-ième résultat |
| `Ctrl + D` | Ajouter / retirer des favoris |
| `Ctrl + P` | Épingler l’application au Dock |
| `Échap` | Effacer, puis fermer |

Exemples : `spot` · `2*(3+4)^2` · `10 km en mi` · `72 f to c` · `wifi` · `verrouiller` · `gh electron` · `github.com` · `clip` (si l’historique du presse-papiers est activé).

## Sécurité et confidentialité

- Aucun droit administrateur, aucune modification du registre (sauf le démarrage auto, si vous l’activez), aucune commande arbitraire.
- Les seuls processus lancés sont les applications que vous ouvrez, le script PowerShell de lecture du Shell (`resources/helpers/shell-helper.ps1`, lecture seule) et `shutdown.exe` avec des arguments fixes, après confirmation.
- Rien n’est envoyé sur Internet. Une recherche web part vers le moteur choisi seulement quand vous la validez.
- L’historique du presse-papiers est désactivé par défaut, conservé en mémoire uniquement.

## Désinstallation

1. Préférences → Général : désactiver « Lancer NOVA à l’ouverture de session » (ou `NOVA --nova-quit`).
2. Supprimer le dossier du projet et `%APPDATA%\NOVA`.

NOVA ne laisse rien d’autre sur le système. L’espace réservé par le Dock est libéré dès que l’application s’arrête.

## Structure

```
src/shared     logique pure et testée : réglages/migrations, fuzzy, calcul, unités, modèle du Dock, i18n
src/main       processus principal : services Windows, contrôleurs des fenêtres, IPC
src/preload    pont unique et typé vers les interfaces
src/renderer   dock / launcher / settings + design system (common/)
resources      script Shell en lecture seule, icônes générées
tests          Vitest
```
