# Orelle — Feuille de route

Légende : ✅ implémenté et vérifié sur Windows · 🟡 partiel · ⬜ à faire

## Fondations ✅
- ✅ Electron + TypeScript, renderers sandboxés, CSP stricte, IPC vérifié par fenêtre et par groupe de réglages
- ✅ Réglages versionnés (v4) avec migrations, validation stricte, écriture atomique, export et import de profil
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

## À faire ⬜
- Barre supérieure (AppBar `ABE_TOP`), gestion des fenêtres (zones, raccourcis de placement, vue d’ensemble avec `DwmRegisterThumbnail`), espaces de travail et profils (Gaming, Dev, Streaming, Productivité)
- Centre de notifications Orelle, capture d’écran, gestionnaire audio détaillé, gestionnaire d’applications (désinstallation via `ms-settings:appsfeatures`)
- Extensions déclaratives, automatisations, IA facultative (consentement explicite, aucun fournisseur par défaut)
- Installateur NSIS par utilisateur, mises à jour, CI
