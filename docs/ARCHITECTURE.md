# NOVA — Architecture

## 1. Choix de la stack

Environnement constaté au démarrage du projet : Windows 11 (build 26300), Node.js 24, **ni .NET SDK, ni Rust/MSVC**.

| Critère | WinUI 3 / .NET 8 | Tauri 2 (Rust + WebView2) | **Electron + FFI Win32 (retenu)** |
|---|---|---|---|
| Fenêtres sans bordure, transparentes, toujours au-dessus | Oui, mais transparence par pixel laborieuse en WinUI 3 | Oui | Oui (natif) |
| Mica / Acrylic | Natif | Plugin `window-vibrancy` | `backgroundMaterial` (Win11 22H2+) |
| Raccourcis globaux | P/Invoke `RegisterHotKey` | Plugin | `globalShortcut` |
| Accès Win32 (EnumWindows, AppBar, WinEvent hooks…) | P/Invoke | FFI Rust | **koffi** (FFI N-API précompilé, aucun compilateur) |
| Animations UI riches (grossissement du Dock) | Composition API, plus coûteux à écrire | CSS/JS | CSS/JS |
| Prérequis de build sur ce poste | .NET SDK à installer | Rust + Build Tools MSVC (~6 Go, admin) | **Aucun : Node déjà présent** |
| Empreinte mémoire | ★★★ | ★★★ | ★★ (≈ 150–250 Mo pour 3 surfaces) |

**Décision.** Electron 44 + TypeScript, avec les intégrations système faites en Win32 direct via koffi.
C’est la seule option qui permettait de livrer et *tester* une application fonctionnelle immédiatement sur ce poste,
sans installation lourde ni droits administrateur. Le coût est la mémoire. Tout le code métier est isolé
(`src/shared`, `src/main/services`), ce qui permet un portage vers Tauri plus tard si l’empreinte devient prioritaire.

WebView2 n’est pas utilisé séparément : Chromium est embarqué par Electron.

## 2. Processus et surfaces

```
main process (Node)                                  renderers (sandboxés, contextIsolation)
├─ SettingsService   settings.json (atomique, .bak)  ├─ dock      fenêtre transparente, non activable,
├─ UsageService      usage.json (fréquence/récence)  │            click-through hors du Dock
├─ AppIndex          shell:AppsFolder (PowerShell)   ├─ launcher  fenêtre Acrylic pré-créée, cachée
├─ IconService       icônes 128 px → nova-icon://    └─ settings  fenêtre Mica, barre de titre native
├─ WindowTracker     WinEvent hooks (sans polling)
├─ FileIndex         fs.watch récursif (sans polling)        preload.ts = unique pont (API typée `window.nova`)
├─ ClipboardHistory  WM_CLIPBOARDUPDATE (opt-in, RAM)
├─ SearchService     fournisseurs du launcher
└─ Dock/Launcher/SettingsController + Hotkeys + Tray
```

- Chaque handler IPC vérifie **quelle fenêtre** l’appelle (`e.sender`) : le Dock ne peut pas exporter un profil, le launcher ne peut pas modifier les réglages, etc.
- Les renderers n’ont ni Node ni `require` ; CSP stricte (`script-src 'self'`).
- Le protocole `nova-icon://` ne sert que des fichiers `^[a-f0-9]{40}\.png$` du cache d’icônes.

## 3. Intégration Windows : ce qui est fait et comment

| Fonction | Mécanisme | Notes / limites |
|---|---|---|
| Liste des applications | `Shell.Application` → `shell:AppsFolder` (même liste que le menu Démarrer, apps Win32 + Store) | Script PowerShell en lecture seule `resources/helpers/shell-helper.ps1`. |
| Icônes HD | `IShellItemImageFactory::GetImage` 128 px avec alpha | Extraites à la demande, prioritaires pour le Dock, mises en cache. |
| Lancement | `explorer.exe shell:AppsFolder\<AUMID>` ou exécutable / `shell.openPath` | Conserve l’identité de l’app (regroupement, listes de raccourcis). |
| Fenêtres ouvertes | `EnumWindows` + filtre « type Alt+Tab » (visible, non masquée par DWM, sans propriétaire, pas de fenêtre d’outil) | Rafraîchi uniquement sur événements `SetWinEventHook` (création, destruction, premier plan, réduction, cloak). |
| Apps UWP / Store | Fenêtre `ApplicationFrameWindow` → processus du `CoreWindow` enfant ; si l’app est réduite (enfant détaché) → AUMID lu dans le magasin de propriétés de la fenêtre (`SHGetPropertyStoreForWindow`, COM via FFI) | Corrigé et vérifié avec la Calculatrice. |
| Focus / réduction / fermeture | `SetForegroundWindow` (+ contournement documenté du verrou de premier plan), `ShowWindow`, `WM_CLOSE` | `WM_CLOSE` laisse l’app proposer d’enregistrer. |
| Réservation d’espace | AppBar `SHAppBarMessage` (ABM_NEW / QUERYPOS / SETPOS / REMOVE) | Les fenêtres maximisées s’arrêtent au-dessus du Dock. Retirée à la fermeture ; Windows la libère aussi si le processus est tué. |
| Plein écran | Fenêtre au premier plan couvrant tout son moniteur | Le Dock se masque pendant jeux / vidéos. |
| Raccourci global | `RegisterHotKey` (via `globalShortcut`) | Conflit détecté et signalé ; ré-enregistré après veille / déverrouillage. |
| Démarrage auto | `app.setLoginItemSettings` (clé Run de l’utilisateur) | Opt-in, réversible, aucun droit admin. |

### Limites techniques assumées

- **Flou réel derrière le Dock** : DWM ne floute que des fenêtres rectangulaires. Le Dock (forme libre + zone de grossissement)
  utilise donc un verre teinté + grain, opacité réglable. Le launcher et les Préférences, rectangulaires, utilisent le vrai Acrylic / Mica.
- **Barre des tâches** : NOVA ne la masque pas et ne touche pas au registre. Un raccourci ouvre `ms-settings:taskbar`.
- **Bureaux virtuels** (phase 5) : l’API publique `IVirtualDesktopManager` permet seulement de savoir/déplacer une fenêtre ;
  la création/le basculement de bureaux n’ont pas d’API publique stable. NOVA n’en simulera pas.
- **Aperçus de fenêtres** (phase 5) : prévus via `DwmRegisterThumbnail`, non implémentés en v0.1.

## 4. Données et persistance

`%APPDATA%\NOVA\` (ou `--nova-user-data=<dir>` pour un profil isolé)

| Fichier | Contenu |
|---|---|
| `settings.json` (+ `.bak`) | Réglages versionnés (`version`), écriture atomique tmp → rename. Fichier illisible = mis en quarantaine (`.corrupt-*`), jamais écrasé en silence. |
| `usage.json` | Compteurs fréquence/récence (classement du launcher, apps récentes du Dock). Effaçable dans Confidentialité. |
| `apps.json` | Cache de l’index des applications (démarrage instantané). |
| `icon-cache/*.png` | Icônes extraites. |
| `logs/nova-YYYY-MM-DD.log` | Journaux, 7 jours de rétention. |

**Migrations** : `src/shared/settings.ts` → `MIGRATIONS[n]` transforme la version *n* en *n+1* ; puis `normalizeSettings`
borne et valide chaque champ (aucune valeur importée ne peut casser l’app). Couvert par `tests/settings.test.ts`.

## 5. Performance

- Aucune boucle de polling : fenêtres (WinEvent hooks), fichiers (`fs.watch`), presse-papiers (`WM_CLIPBOARDUPDATE`).
- Rafales d’événements fusionnées (`schedule()` du tracker) ; une énumération coûte quelques ms.
- Le launcher est pré-créé : l’affichage = repositionnement + `show()`.
- Le grossissement n’écrit que des tailles via `requestAnimationFrame`, seulement quand le pointeur bouge sur le Dock.
- Niveaux d’effets *Complets / Réduits / Désactivés* (désactivés = aucune animation, aucun matériau).

## 6. Robustesse

- Renderer du Dock planté → rechargé ; launcher planté → recréé.
- `uncaughtException` / `unhandledRejection` journalisés sans tuer l’app.
- Instance unique ; `NOVA --nova-quit` arrête proprement l’instance en cours (scripts, désinstalleur).
- Reprise après veille / déverrouillage : raccourci ré-enregistré, fenêtres ré-énumérées, Dock repositionné.
- Changements d’écran (ajout, retrait, DPI) : Dock repositionné (coordonnées DIP ↔ physiques via l’API `screen`).
