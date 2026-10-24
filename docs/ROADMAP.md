# Orelle — Feuille de route

Légende : ✅ implémenté et vérifié · 🟡 partiel · ⬜ à faire

## Phase 1 — Base, design system, paramètres persistants ✅
- ✅ Projet Electron + TypeScript, build esbuild, CSP, renderers sandboxés
- ✅ Design system : tokens, 5 thèmes (Sombre, Clair, Minuit, Graphite, Aurora) + Système, couleur d’accent libre, opacité du verre, 3 niveaux d’effets
- ✅ Paramètres versionnés, migrations, validation stricte, écriture atomique + .bak, export / import / réinitialisation
- ✅ Interface FR / EN (auto selon la langue du système)
- ✅ Journaux, instance unique, icône de zone de notification, démarrage auto opt-in

## Phase 2 — Dock ✅
- ✅ Dock flottant, grossissement macOS, infobulles, animations d’apparition / disparition / lancement (rebond)
- ✅ Lancement réel (Win32 + Store), indicateur « en cours », pastille d’accent pour l’app active
- ✅ Clic : lancer → focus → réduire ; plusieurs fenêtres → bascule ; Maj/clic milieu : nouvelle instance
- ✅ Apps ouvertes non épinglées, section facultative « récentes », zone facultative des fenêtres réduites
- ✅ Glisser pour réorganiser, glisser hors du Dock pour retirer, dépôt de fichiers / dossiers / raccourcis / .url
- ✅ Menus contextuels (fenêtres, nouvelle fenêtre, garder / retirer, afficher dans l’Explorateur, quitter)
- ✅ Séparateurs, dossiers, fichiers, sites web
- ✅ Position bas / gauche / droite, taille, grossissement, espacement, masquage auto, choix de l’écran
- ✅ Réservation d’espace (AppBar), masquage pendant le plein écran
- 🟡 « Mode compact / étendu » : couvert par taille + grossissement ; pas de préréglage dédié

## Phase 3 — Launcher ✅
- ✅ Raccourci global configurable (Alt+Espace par défaut), enregistreur de raccourci avec détection de conflit
- ✅ Apps, fenêtres ouvertes, fichiers & dossiers (index local + éléments récents Windows), Paramètres Windows (44 pages), actions système (confirmation pour veille / redémarrage / arrêt / déconnexion), calculatrice sûre, conversions d’unités, URL, recherche web (moteur au choix), commandes personnalisées à mot-clé, historique du presse-papiers (opt-in, mémoire seule)
- ✅ Classement fuzzy + fréquence/récence, favoris (Ctrl+D), historique, aperçu (miniatures Windows), navigation clavier complète, Ctrl+1…9, épingler au Dock (Ctrl+P)
- ✅ Scripts autorisés (.ps1 / .bat / .cmd ajoutés par l’utilisateur, mot-clé, confirmation à la première exécution et à chaque modification du fichier via SHA-256)
- ⬜ API d’extensions du launcher (→ phase 6)

## Phase 4 — Widgets, centre de contrôle ✅
- ✅ Couche de widgets unique (un seul processus de rendu), rattachée au bureau : sous les fenêtres, visible avec Win+D, click-through hors des widgets
- ✅ 13 widgets : horloge (numérique / analogique / minimale), calendrier, météo (Open-Meteo, sans clé), système (CPU, RAM, disque + courbe), réseau (débits), batterie, multimédia (touches média), notes, tâches, minuteur / chrono (notification), apps récentes, raccourcis (glisser-déposer), temps d’écran par application
- ✅ Mode édition : déplacer (grille 8 px, Alt = libre), redimensionner, opacité, style, masquer, supprimer, ajouter ; tout est persistant
- ✅ Centre de contrôle (Ctrl+Alt+C, Dock, zone de notification) : volume et sourdine réels (Core Audio en COM), périphérique de sortie, luminosité (WMI, portables), Wi-Fi (SSID, signal), batterie, touches média, thème Orelle, barre des tâches, raccourcis vers les pages `ms-settings:` exactes
- ✅ Masquage automatique de la barre des tâches (API AppBar `ABM_SETSTATE`, état d’origine restauré à la fermeture et après un plantage)
- ✅ Option « Accélération matérielle » (désactivée : ≈ 100 Mo de moins)
- 🟡 Multimédia : contrôle par touches média universelles ; le titre en cours (WinRT GSMTC) n’est pas encore affiché
- 🟡 GPU : pas de mesure d’utilisation (aucune API publique légère) ; Bluetooth et « Ne pas déranger » ouvrent les réglages (pas d’API fiable pour les piloter)
- ⬜ Événements de calendrier (nécessite l’accès WinRT aux rendez-vous)

## Phase 5 — Fenêtres, profils, barre de menus ⬜
- Exposé / vue d’ensemble avec `DwmRegisterThumbnail`, recherche parmi les fenêtres (déjà disponible dans le launcher)
- Zones de placement + raccourcis (SetWindowPos), sauvegarde / restauration de dispositions
- Profils (Gaming, Dev, Streaming, Études) = ensembles Dock + dispositions + apps à lancer
- Barre de menus supérieure en AppBar `ABE_TOP`, éléments configurables
- Bureaux virtuels : uniquement via `IVirtualDesktopManager` public (pas de faux bureaux)

## Phase 6 — Extensions, automatisations, IA ⬜
- Manifeste d’extension (permissions déclarées), exécution isolée (processus utilitaire sandboxé), activation individuelle
- Fournisseur IA configurable (aucun par défaut), consentement explicite avant tout envoi, confirmation des actions sensibles

## Phase 7 — Qualité, packaging ⬜
- 🟡 Tests : 32 tests unitaires + smoke test Electron (`npm run check`)
- ⬜ Installateur (electron-builder NSIS, installation par utilisateur, sans admin), mise à jour, signature
- ⬜ Mesures de performance automatisées (mémoire au repos, temps d’ouverture du launcher)
