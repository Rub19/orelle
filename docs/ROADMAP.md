# Orelle — Feuille de route

Légende : ✅ implémenté et vérifié sur Windows · 🟡 partiel · ⬜ à faire

## Fondations ✅
- ✅ Electron + TypeScript, renderers sandboxés, CSP stricte, IPC vérifié par fenêtre et par groupe de réglages
- ✅ Réglages versionnés (v5) avec migrations, validation stricte, écriture atomique, export et import de profil
- ✅ Interface FR / EN, journaux, instance unique, ligne de commande (`--orelle-open`, `--orelle-quit`)
- ✅ Identité Orelle : nom, logo (sombre, clair, monochrome, logotype), ICO, écran de démarrage, accent ambre, contraste conforme WCAG
- ✅ Migration automatique du profil, du démarrage auto et des réglages depuis l’ancien nom NOVA

## Dock ✅
- ✅ Grossissement, lancement réel (Win32 et Store, y compris réduites), indicateurs, réorganisation, dépôt de fichiers, menus contextuels
- ✅ Positions, tailles, masquage automatique, réservation d’espace (AppBar, libérée à toute sortie), masquage en plein écran
- ✅ Boutons intégrés : launcher, centre de contrôle, Fichiers, Moniteur

## Launcher ✅
- ✅ Apps, fenêtres, fichiers, Paramètres Windows, actions système et Orelle, calculs, conversions, commandes, scripts autorisés, presse-papiers, favoris, aperçu

## Centre de contrôle ✅
- ✅ Modules réordonnables, en trois tailles, masquables (mode « Personnaliser »)
- ✅ Volume et sourdine, sourdine du micro (Core Audio), luminosité (WMI), Wi-Fi, batterie, touches média, thème, barre des tâches, mini-moniteur, outils Orelle
- 🟡 Bluetooth, Ne pas déranger, éclairage nocturne, mode avion : raccourcis vers les pages `ms-settings:` exactes (aucune API publique fiable pour les piloter)
- ⬜ Changement de périphérique audio (aucune API publique : seule l’interface non documentée `IPolicyConfig` le permet)

## Widgets ✅
- ✅ 13 widgets, couche unique rattachée au bureau, mode édition, persistance
- 🟡 Multimédia sans titre du morceau ; pas d’événements de calendrier

## Fichiers ✅
- ✅ Onglets, fenêtres multiples, barre latérale (favoris, emplacements, volumes avec occupation), fil d’Ariane éditable
- ✅ Vues grille, liste et détails, tri naturel, regroupement par type ou date, filtres, fichiers masqués
- ✅ Aperçu (miniatures Windows, texte), propriétés, renommage en place, nouveau dossier ou fichier, copier, couper, coller, glisser-déposer vers et depuis d’autres apps
- ✅ Corbeille, suppression définitive confirmée, `.zip` (création) et extraction via le `tar.exe` de Windows, recherche par nom et par contenu, progression, gestion des erreurs d’accès
- ✅ Intégration réversible : option « Ouvrir les dossiers dans Orelle Fichiers » (Dock, launcher) ; aucune association Windows modifiée
- ⬜ Remplacer l’Explorateur pour `Win+E` (non prévu sans mécanisme réversible fiable)

## Moniteur d’activité ✅
- ✅ CPU, RAM, GPU (PDH), disque, réseau, avec historique et graphiques
- ✅ Processus groupés (applications, arrière-plan, Windows) : CPU, mémoire, disque, GPU par processus, état « ne répond pas »
- ✅ Fermeture d’app et arrêt forcé avec confirmation (processus essentiels protégés), ouverture de l’emplacement
- ✅ Applis au démarrage réversibles (indicateur `StartupApproved`, journal, annulation), services en lecture seule, infos matérielles, rapport TXT ou JSON
- ✅ Alertes processeur et mémoire configurables (notifications Windows)

## Barre supérieure et menu ✅
- ✅ Barre en haut de l’écran réservée par AppBar (`ABE_TOP`), masquée en plein écran, multi-écran
- ✅ Menu Orelle (recherche, épinglées et récentes, toutes les apps, profils, alimentation confirmée, accès au menu Démarrer)
- ✅ Application au premier plan avec menu de fenêtre (ancrage, dispositions, fermer), profil actif, médias, CPU, réseau, volume, batterie, notifications, recherche, centre de contrôle, aperçu de la barre des tâches, horloge ; éléments réordonnables
- ✅ Barre des tâches Windows : normale, masquage auto ou masquée (avec surveillance et aperçu de 10 s), état d’origine restauré à toute sortie, au lancement suivant après un plantage et par le désinstalleur
- ✅ Touche Windows (option) : appui seul → menu Orelle ou launcher ; `Win+lettre` intacts
- 🟡 Icônes de la zone de notification : accessibles via l’aperçu de la barre des tâches (Windows n’offre pas d’API publique pour les héberger ailleurs)

## Fenêtres ✅
- ✅ Ancrage en moitiés, quarts, tiers et deux tiers, agrandir, centrer (raccourcis `Ctrl+Alt+…`, menu de la barre, launcher)
- ✅ Dispositions : enregistrer, restaurer (lance les apps manquantes puis les place), supprimer
- ⬜ Vue d’ensemble avec miniatures (`DwmRegisterThumbnail`), bureaux virtuels (aucune API publique stable)

## Profils ✅
- ✅ Gaming, Développement, Streaming, Productivité, et profils personnalisés : thème, barre des tâches, widgets, concentration, alertes, apps à lancer, disposition ; instantané restauré à la désactivation (même après redémarrage)

## Notifications ✅
- ✅ Centre Orelle : historique local (100), non lues, calendrier, mode concentration (pas de bannière), lien vers le centre Windows
- 🟡 Notifications des autres applications : restent dans Windows (aucune API pour une application de bureau non empaquetée)

## Extensions, automatisations, IA ✅
- ✅ Extensions déclaratives (manifest.json) : pages https, dossiers, texte ; permissions affichées ; désactivées par défaut si ajoutées par l’utilisateur ; aucun code exécuté
- ✅ Automatisations : heure et jours, lancement d’une app, démarrage, raccourci → profil, disposition, thème, concentration, notification, ouverture ; « Exécuter » pour tester
- ✅ IA facultative : Claude (SDK officiel, `claude-opus-5-5`, repli serveur), OpenAI, Ollama local ; clé chiffrée (DPAPI) ; consentement explicite ; seule la question est envoyée
- 🟡 Testé sans clé réelle : la connexion à un fournisseur doit être vérifiée avec votre propre clé (bouton « Tester »)

## Distribution ✅
- ✅ Installateur NSIS par utilisateur (`npm run dist`), sans droits administrateur ; désinstallation propre (arrêt, barre des tâches, démarrage auto)
- ⬜ Signature de code, mises à jour automatiques, CI

## v0.4 ✅
- ✅ Dock initial identique à la barre des tâches Windows (UI Automation + raccourcis épinglés), bouton « Reprendre la barre des tâches »
- ✅ Mission Control : miniatures DWM en direct, recherche, regroupement, clavier
- ✅ Utilitaires : Centre audio (périphériques, applications, niveaux), Stockage (usage, gros fichiers, doublons, nettoyage), Presse-papiers (images, épingles chiffrées, exclusions, collage)
- ✅ Theme Studio : préréglages avec aperçu, arrondis, planning clair/sombre, fond d’écran réversible, fichiers de thème
- ✅ Automatisations : conditions, nouveaux déclencheurs, plusieurs actions, historique, import/export ; heures calmes ; mode sans échec
- 🟡 Bureaux virtuels : aucune API publique pour les piloter (Mission Control couvre le bureau courant)
- 🟡 Périphérique audio par défaut : réglage Windows (aucune API publique)

## v0.5 — Performances (mesuré) ✅
Mesures `npm run measure` (2ᵉ lancement, profil isolé, PC 16 Go / 12 threads, Electron 44) :

| Profil | Démarrage (Dock affiché) | Mémoire privée | RAM réelle après 50 s en arrière-plan | Réouverture du lanceur |
|---|---|---|---|---|
| Avant (v0.4) | 1,4 s | 337 Mo | ~650 Mo (rien n’était rendu) | — |
| Standard (v0.5) | 1,3 s | 341 Mo | vidée après 2 min | — |
| Léger (v0.5) | 1,3 s | 253 Mo | **71 Mo** | **22 ms** |

- ✅ Profil Léger automatique (≤ 8 Go de RAM ou ≤ 4 threads), forçable dans Préférences › Général : pas de processus GPU (−100 Mo), lanceur chargé une fois le bureau au repos, index des fichiers à la première recherche, mesures système toutes les 4 s, réindexation des applis repoussée
- ✅ Fenêtres cachées gardées chargées mais vidées de la RAM (`SetProcessWorkingSetSize`), réouverture instantanée ; tout Orelle vidé quand une autre appli est au premier plan
- ✅ Touche Windows : le menu est préparé dès l’appui, avant le relâchement
- ✅ Horloge mise à jour à la minute (et non chaque seconde) quand les secondes sont masquées

## v0.5 — Finition « pro » ✅
- ✅ Assistant de premier lancement (langue, barre des tâches, touche Windows, style, Dock repris de la barre des tâches, démarrage auto) ; rien ne modifie Windows avant la fin
- ✅ Vérification des mises à jour (GitHub Releases, 1×/jour, désactivable, aucun téléchargement automatique) — affiche « indisponible » tant que le dépôt est privé ou sans version publiée
- ✅ Rapport de diagnostic local (environnement, réglages sans secrets, mémoire, journaux ; chemins personnels masqués), rien n’est envoyé
- ✅ Auto-réparation : une fenêtre figée 10 s est relancée
- ✅ Accessibilité : taille du texte 90–150 %, focus clavier toujours visible, thèmes de contraste Windows, noms accessibles des boutons à icône
- ✅ Capture d’écran (`Ctrl+Alt+S`) : zone, fenêtre ou écran entier, enregistrée dans Images\Captures d’écran et copiée
- ✅ Diagnostic réseau (Utilitaires) : interfaces, passerelle, DNS, sonde Internet de Windows, latence, verdict en clair
- ✅ Installateur : 112,7 Mo (au lieu de 121,3), 327 Mo installé (au lieu de 374) — langues de Chromium limitées au français et à l’anglais, compression maximale
- ✅ CI GitHub Actions (Windows) : typecheck, 75 tests, build ; le smoke test (43 vérifications) se lance en local (`npm run smoke`, bureau interactif requis)

## À faire ⬜
- **Signature de code** de l’installateur (supprime l’avertissement SmartScreen) : nécessite un certificat de signature, à acheter par le propriétaire du projet
- **Mises à jour installées automatiquement** (electron-updater) : nécessite des versions publiées et un dépôt public (ou un serveur de mises à jour)
- Fusion barre supérieure + Dock dans un seul processus (≈ −30 Mo) : demande de remplacer deux fenêtres AppBar par une seule
- Menu contextuel du bureau Orelle (pas d’API sans crochet souris global), dossiers « piles » dans le Dock, capteurs de température (non exposés sans pilote), marketplace de thèmes/extensions
- Bureaux virtuels (aucune API publique pour les piloter)
