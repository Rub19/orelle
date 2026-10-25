<p align="center"><img src="resources/brand/png/wordmark-dark-800.png" alt="Orelle" width="360"></p>

**Orelle** est une couche d’expérience premium pour Windows 11. Elle combine une barre supérieure et un Dock inspirés de macOS, un menu Orelle, un launcher universel (avec IA facultative), des widgets, un centre de contrôle et de notifications, la gestion des fenêtres, des profils d’activité, des extensions, des automatisations et ses propres applications (Fichiers, Moniteur d’activité). Elle fonctionne au-dessus de Windows, sans le remplacer ni le modifier de façon irréversible.

> Le nom vient d’*oriel*, une fenêtre en baie qui s’avance hors de la façade : une meilleure fenêtre sur Windows.
> Feuille de route : [docs/ROADMAP.md](docs/ROADMAP.md) · Choix techniques et limites : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Démarrer

```bash
npm install
npm start
```

Au premier lancement, Orelle indexe vos applications, construit un Dock identique à votre barre des tâches Windows (mêmes applications épinglées, même ordre), place deux widgets et ouvre les Préférences. Ensuite, Orelle reste en arrière-plan, avec une icône dans la zone de notification.

| Script | Rôle |
|---|---|
| `npm start` | Compile puis lance Orelle |
| `npm run dev` | Idem, avec journaux détaillés dans la console |
| `npm test` | Tests unitaires (Vitest) |
| `npm run smoke` | Lance Orelle dans un profil temporaire et vérifie 43 intégrations réelles (Win32, Core Audio, PDH, AppBar, miniatures DWM, Dock, barre supérieure, menu, notifications, launcher, extensions, profils, stockage, Fichiers, Moniteur…) |
| `npm run check` | Typecheck + tests + smoke test |
| `npm run measure` | Démarre Orelle dans un profil isolé et mesure le démarrage, la mémoire par fenêtre et la réouverture (`--orelle-idle=<s>`) |
| `npm run dist` | Construit l’installateur Windows par utilisateur (`release/Orelle Setup <version>.exe`, sans droits administrateur) |
| `npm run brand` | Régénère toutes les ressources graphiques depuis `resources/brand/*.svg` |

Options de ligne de commande :
- `--orelle-open=files[:chemin]`, `--orelle-open=monitor[:onglet]`, `--orelle-open=control`, `--orelle-open=launcher`, `--orelle-open=menu`, `--orelle-open=notifications` : ouvrent une surface.
- `--orelle-section=dock` : ouvre une page des Préférences.
- `--orelle-quit` : arrête proprement l’instance en cours.
- `--orelle-restore-taskbar` : remet la barre des tâches Windows dans son état d’origine (utilisé par le désinstalleur).
- `--orelle-user-data=<dossier>` : utilise un profil isolé.

## Ce que contient Orelle

| Module | Accès | Points clés |
|---|---|---|
| **Barre supérieure** | haut de l’écran | Menu Orelle, application au premier plan avec actions de fenêtre et dispositions, profil actif, médias, CPU, réseau, volume (molette), batterie, notifications, recherche, centre de contrôle, aperçu de la barre des tâches, horloge — éléments réordonnables |
| **Menu Orelle** | logo de la barre, touche Windows (option) | Recherche, apps épinglées et récentes, toutes les applications A–Z, profils, verrouiller / veille / redémarrer / arrêter (confirmés), accès au vrai menu Démarrer |
| **Notifications** | horloge ou cloche de la barre | Historique local des notifications Orelle, calendrier mensuel, mode concentration, lien vers le centre Windows |
| **Dock** | toujours visible | Identique à votre barre des tâches au premier lancement, piles de dossiers, Grossissement, lancement réel, indicateurs, réorganisation par glisser, dépôt de fichiers, menus contextuels, réservation d’espace, masquage automatique, masquage en plein écran |
| **Launcher** | `Alt+Espace` | Apps, fenêtres, fichiers, Paramètres Windows, calculs, conversions, commandes, scripts autorisés, presse-papiers, favoris |
| **Centre de contrôle** | `Ctrl+Alt+C`, Dock, zone de notification | Volume réel (Core Audio), micro, luminosité, Wi-Fi, batterie, médias, thème, barre des tâches, modules réordonnables |
| **Widgets** | bureau (visibles avec Win+D) | 13 widgets, mode édition, opacité, persistance |
| **Fichiers** | Dock, launcher, centre de contrôle | Onglets, double panneau, favoris, étiquettes de couleur, 3 vues avec taille d’icônes réglable, aperçu redimensionnable, renommage par lot, tri, regroupement, filtres, recherche par nom et par contenu, Corbeille, archives `.zip` |
| **Moniteur d’activité** | launcher, centre de contrôle, Fichiers | CPU, RAM, GPU, disque, réseau avec historique ; processus ; démarrage réversible ; services ; rapport de diagnostic |
| **Mission Control** | `Ctrl+Alt+O`, barre supérieure, menu, launcher | Toutes les fenêtres avec aperçus en direct (DWM), recherche, regroupement par app, clavier, fermeture polie |
| **Utilitaires** | launcher (« audio », « stockage », « presse-papiers »), `Ctrl+Alt+V` | Centre audio (volume et sourdine par périphérique et par application, niveaux en direct) ; Stockage (espace par dossier, gros fichiers, doublons SHA-256, nettoyage confirmé vers la Corbeille) ; Presse-papiers (texte et images, recherche, épingles chiffrées, collage dans la fenêtre précédente) ; Réseau (passerelle, DNS, Internet, latence) |
| **Capture d’écran** | `Ctrl+Alt+S`, menu, launcher | Zone, fenêtre ou écran entier ; enregistrée et copiée |
| **Theme Studio** | Préférences | Préréglages (Minimal, Professionnel, Gaming, Créatif, inspiration macOS) avec aperçu avant application, arrondis, clair/sombre selon l’heure, fond d’écran, import/export de thèmes |
| **Fenêtres** | `Ctrl+Alt+flèches`, menu de l’app, launcher | Moitiés, quarts, tiers, agrandir, centrer ; dispositions enregistrées et restaurées (lance les apps manquantes) |
| **Profils** | barre, menu, launcher, automatisations | Gaming, Développement, Streaming, Productivité (modifiables) : thème, barre des tâches, widgets, concentration, alertes, apps à lancer, disposition ; tout est rétabli à la désactivation |
| **Extensions** | launcher | Manifestes JSON déclaratifs (pages web, dossiers, texte) ; aucun code tiers exécuté ; permissions affichées ; deux extensions fournies |
| **Automatisations** | Préférences | Déclencheurs (heure, app lancée, démarrage, raccourci, batterie faible, secteur/batterie, écran branché, profil activé), conditions (plage horaire, jours, alimentation, profil), plusieurs actions, historique d’exécution, import/export |
| **Assistant IA** | launcher : `?` + question | Facultatif, désactivé par défaut : Claude (Anthropic), OpenAI ou Ollama local ; votre clé, chiffrée ; consentement explicite |
| **Préférences** | Dock, zone de notification | Tous les réglages, thèmes, raccourcis, export et import de profil |

### Raccourcis

**Fenêtres** : `Ctrl+Alt+←/→/↑/↓` moitiés · `Ctrl+Alt+U/I/J/K` quarts · `Ctrl+Alt+D/F/G` tiers · `Ctrl+Alt+Entrée` agrandir · `Ctrl+Alt+Home` centrer · `Ctrl+Alt+O` Mission Control.

**Touche Windows** (option, Préférences › Général) : un appui seul ouvre le menu Orelle ou le launcher ; `Win+lettre` reste inchangé et le vrai menu Démarrer reste accessible depuis le menu Orelle.

**Launcher** : `↑ ↓` naviguer · `Entrée` ouvrir · `Ctrl+Entrée` action secondaire · `Ctrl+1…9` · `Ctrl+D` favori · `Ctrl+P` épingler au Dock · `Échap` fermer.

**Fichiers** : `F3` double panneau · `Tab` change de panneau · `Maj+F5` / `Maj+F6` copier / déplacer vers l’autre panneau · `Ctrl+molette` ou `Ctrl+ +/−` taille des icônes · `F2` sur plusieurs éléments : renommage par lot.

- `Ctrl+T` / `Ctrl+W` : nouvel onglet / fermer l’onglet · `Ctrl+N` : nouvelle fenêtre.
- `Ctrl+Maj+N` : nouveau dossier · `F2` : renommer · `Suppr` : Corbeille · `Maj+Suppr` : suppression définitive (avec confirmation).
- `Ctrl+C/X/V` : copier, couper, coller · `Espace` : aperçu · `Ctrl+1/2/3` : vues · `Ctrl+H` : fichiers masqués.
- `Ctrl+F` : filtrer (`Entrée` cherche récursivement, `Alt+Entrée` cherche aussi dans le contenu) · `Ctrl+L` : saisir un chemin.
- `Alt+←/→/↑` : précédent, suivant, dossier parent · `F5` : actualiser · taper des lettres sélectionne l’élément correspondant.

## Performances

Orelle choisit tout seul le profil **Léger** sur les PC modestes (8 Go de RAM ou moins, ou 4 threads ou moins) ; on peut le forcer dans Préférences › Général. Mesures (`npm run measure`) :

| Profil | Mémoire privée | RAM réelle après 50 s en arrière-plan | Réouverture du lanceur |
|---|---|---|---|
| Standard | 258 Mo | vidée après 2 min | 19 ms |
| Léger | 181 Mo | 17 Mo | 22 ms |

Les fenêtres fermées restent chargées mais leur mémoire est rendue à Windows : elles rouvrent instantanément (touche Windows, raccourcis), et le menu est préparé dès l’appui sur la touche Windows.

## Sécurité et confidentialité

- Aucun droit administrateur, aucune donnée envoyée à un service externe, sauf la météo (Open-Meteo, coordonnées de la ville choisie), les recherches web que vous validez et, si vous l’activez avec votre consentement explicite, les questions posées à l’assistant IA (rien d’autre que la question).
- Clé d’API de l’IA chiffrée avec la protection de données de Windows (DPAPI, `safeStorage`), jamais exportée. Avec Claude, le repli côté serveur d’Anthropic est activé (`fallbacks: "default"`) : une demande refusée peut être relancée sur le modèle de repli, facturé à son tarif.
- Touche Windows : crochet clavier de bas niveau installé uniquement si l’option est activée ; il n’agit que sur l’appui seul de la touche Windows et laisse passer toutes les autres touches sans les lire.
- Orelle ne modifie la configuration de Windows que sur votre demande, toujours de façon réversible :
  - démarrage automatique : clé Run de votre compte ;
  - barre des tâches Windows (normale, masquage auto, masquée) : API AppBar et visibilité de la fenêtre, rien dans le registre ; l’état d’origine est restauré à la fermeture, après un plantage au lancement suivant, et par le désinstalleur ;
  - applis au démarrage : même indicateur que Windows, avec un journal des changements pour tout annuler.
- Presse-papiers : historique en mémoire uniquement (désactivé par défaut) ; les copies marquées privées par les gestionnaires de mots de passe et celles des applications exclues ne sont jamais enregistrées ; seuls les éléments épinglés sont écrits sur le disque, chiffrés (DPAPI).
- Stockage : jamais de suppression automatique ; dossiers Windows, programmes et racines du profil protégés ; Corbeille par défaut.
- Fond d’écran : appliqué par l’API Windows documentée ; l’original est mémorisé et rétabli à la demande.
- Mises à jour : vérification une fois par jour (GitHub Releases, désactivable) ; le téléchargement ne démarre que sur votre clic, l’empreinte SHA-512 est vérifiée et l’installation (par utilisateur, sans droits administrateur) a lieu au redémarrage.
- Capteurs : seulement ce que Windows laisse lire sans droits administrateur ; rien d’inventé.
- Menu du bureau (option) : crochet souris installé seulement si l’option est activée.
- Rapport de diagnostic : créé localement à votre demande, chemins personnels masqués, jamais envoyé.
- Mode sans échec : après deux arrêts anormaux de suite (ou `--orelle-safe-mode`), Orelle démarre sans masquer la barre des tâches, sans crochet clavier, sans automatisations ni extensions.
- Suppression de fichiers : Corbeille par défaut. La suppression définitive demande une confirmation explicite.
- Arrêt de processus : confirmation obligatoire, et refus pour les processus essentiels de Windows.
- Scripts : uniquement ceux que vous ajoutez, avec confirmation à la première exécution et après chaque modification (SHA-256).
- Extensions : déclaratives, sans code ; celles que vous ajoutez restent désactivées tant que vous ne les activez pas après avoir lu leurs permissions. Elles ne peuvent ouvrir que des pages `https`, des dossiers (jamais un programme) ou copier un texte.
- Automatisations : aucune ligne de commande interprétée ; seules les fonctions d’Orelle et les cibles que vous avez saisies.

## Installation et désinstallation

`npm run dist` produit un installateur NSIS **par utilisateur** (installé dans `%LOCALAPPDATA%\Programs\Orelle`, aucun droit administrateur demandé). Le désinstalleur (Paramètres Windows › Applications) :
1. arrête Orelle proprement (`--orelle-quit`), ce qui libère l’espace réservé à l’écran et rétablit la barre des tâches ;
2. rétablit la barre des tâches même après un plantage (`--orelle-restore-taskbar`) ;
3. supprime l’entrée « Orelle » de démarrage automatique de votre compte.

Vos réglages restent dans `%APPDATA%\Orelle` (supprimez ce dossier pour tout effacer). Pensez aussi à Moniteur › Démarrage › « Annuler mes modifications » si vous avez désactivé des applis au démarrage.

L’installateur n’est pas signé numériquement : Windows SmartScreen peut afficher un avertissement au premier lancement.

## Identité visuelle

Les sources se trouvent dans `resources/brand` : icône sombre et claire, symbole couleur et monochrome, logotypes. `npm run brand` génère les PNG et l’ICO Windows dans `resources/icons` et `resources/brand/png`.
