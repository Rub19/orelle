# Extensions Orelle — API et modèle de sécurité

Une extension Orelle est **déclarative** : un fichier `manifest.json`, sans code. Orelle ne charge et n’exécute jamais de script venant d’une extension. Ce choix rend les extensions sûres par construction : une extension ne peut faire que ce que son manifeste décrit visiblement, et les permissions affichées à l’utilisateur sont calculées à partir de ce manifeste.

## Installer, activer, supprimer

- **Préférences › Extensions › Installer une extension…** : choisir un `manifest.json`. Seul le manifeste validé est copié dans `%APPDATA%\Orelle\extensions\<id>\`.
- Une extension installée par l’utilisateur est **désactivée** tant qu’il ne l’active pas après avoir lu ses permissions. Les extensions fournies avec Orelle sont activées par défaut et peuvent être désactivées.
- Une extension ajoutée par l’utilisateur peut être supprimée (bouton ✕). Une extension intégrée peut seulement être désactivée.

## Format du manifeste

```json
{
  "id": "moi.recherches",
  "name": "Mes recherches",
  "version": "1.0.0",
  "author": "Moi",
  "description": "Mots-clés de recherche pour mes sites.",
  "commands": [
    { "id": "wiki", "title": "Wikipédia", "keyword": "wiki", "url": "https://fr.wikipedia.org/w/index.php?search={query}" },
    { "id": "dl", "title": "Téléchargements", "keyword": "dl", "path": "%USERPROFILE%\\Downloads" },
    { "id": "mail", "title": "Mon adresse", "keyword": "mail", "copy": "moi@example.com" }
  ]
}
```

| Champ | Règle |
|---|---|
| `id` | 1 à 64 caractères `a-z 0-9 . _ -`, unique ; ne peut pas reprendre l’id d’une extension intégrée |
| `name`, `version`, `author`, `description` | texte (60 / 20 / 60 / 300 caractères max.) |
| `commands` | 1 à 50 commandes ; chaque commande a un `id`, un `title`, un `keyword` facultatif et **une seule** action : |
| `url` | page **https** uniquement ; `{query}` est remplacé par le texte tapé après le mot-clé (encodé) |
| `path` | **dossier** absolu (variables autorisées : `%USERPROFILE%`, `%APPDATA%`, `%LOCALAPPDATA%`, `%ONEDRIVE%`, `%PUBLIC%`, `%HOMEDRIVE%`) ; un fichier ou un programme est refusé à l’exécution ; la recherche ne peut jamais modifier ce chemin |
| `copy` | texte copié dans le presse-papiers (`{query}` autorisé) |

Toute commande qui ne respecte pas ces règles est ignorée ; un manifeste sans commande valide est refusé.

## Permissions affichées

Calculées à partir du manifeste (`permissionsOf`, `src/shared/extensionModel.ts`) : domaines web ouverts, dossiers ouverts, accès en écriture au presse-papiers.

## Catalogue (base d’une future marketplace)

Un catalogue est un JSON public listant des manifestes vérifiables. Orelle ne télécharge rien aujourd’hui ; le format est fixé pour que les extensions et thèmes publiés restent compatibles :

```json
{
  "format": "orelle-catalog",
  "version": 1,
  "items": [
    {
      "kind": "extension",
      "id": "moi.recherches",
      "name": "Mes recherches",
      "version": "1.0.0",
      "url": "https://exemple.org/moi.recherches/manifest.json",
      "sha256": "…empreinte du fichier…"
    },
    {
      "kind": "theme",
      "id": "moi.nuit",
      "name": "Nuit",
      "url": "https://exemple.org/nuit.orelle-theme.json",
      "sha256": "…"
    }
  ]
}
```

Règles prévues pour l’installation depuis un catalogue : téléchargement en https uniquement, vérification SHA-256 avant toute lecture, validation par les mêmes fonctions que l’installation locale (`parseManifest`, `parseTheme`), extension installée désactivée, permissions affichées avant activation.

## Thèmes

Les thèmes utilisent le format `orelle-theme` (Theme Studio › Exporter / Importer) : couleurs, transparence, effets, arrondis et apparence du Dock, validés par `parseTheme` (`src/shared/themeModel.ts`). Aucune donnée personnelle.
