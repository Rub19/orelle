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

## À faire ⬜
- Capture d’écran, gestionnaire audio détaillé, gestionnaire d’applications (désinstallation via `ms-settings:appsfeatures`)
- Vue d’ensemble des fenêtres, espaces de travail
