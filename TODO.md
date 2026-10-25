# Orelle — ce qu’il reste à faire

État au 25 octobre 2026, version 0.7.0. Historique complet : [docs/ROADMAP.md](docs/ROADMAP.md).

## À tester en vrai
- [ ] **Mode administrateur** (Préférences › À propos) : l’invite UAC, la relance avec droits administrateur et le retour au mode normal n’ont pas encore été validés sur un vrai clic. Testé : compilation, tests, smoke test en mode standard (le bouton s’affiche, l’état « Inactif » est correct).
- [ ] En mode administrateur : forcer l’arrêt d’un processus protégé, activer/désactiver un programme au démarrage « tous les utilisateurs », nettoyer les fichiers temporaires de Windows, aimanter la fenêtre d’une appli lancée en administrateur.
- [ ] Vérifier qu’une appli ouverte depuis le Dock en mode administrateur démarre bien **sans** droits administrateur (passage par l’Explorateur).
- [ ] **Menu Orelle du bureau** (option désactivée par défaut) : jamais testé sur un vrai clic droit.

## Limites connues
- [ ] Mode administrateur : les éléments du Dock **avec arguments** démarrent avec les droits administrateur (l’Explorateur ne sait pas transmettre d’arguments).
- [ ] Mode administrateur : Windows bloque le glisser-déposer depuis l’Explorateur vers Orelle (isolation des niveaux d’intégrité).
- [ ] Mode administrateur : le retour au mode normal ne marche qu’avec la version installée (pas en développement).
- [ ] Température par cœur du processeur : impossible sans pilote noyau, qu’Orelle n’installe pas. Seules les zones thermiques ACPI sont affichées.
- [ ] Étiquettes de fichiers : elles suivent les renommages faits dans Orelle, pas ceux faits dans l’Explorateur Windows.
- [ ] Déplacer la fenêtre d’une autre appli vers un autre bureau virtuel : pas d’API publique Windows.

## Décisions du propriétaire
- [ ] **Signature de code** : acheter un certificat pour supprimer l’avertissement SmartScreen à l’installation.
- [ ] **Adresse e-mail dans les commits** : activer l’adresse « noreply » de GitHub pour les prochains commits (les anciens la gardent, sauf réécriture de l’historique).
- [ ] Option « démarrer directement en mode administrateur » (tâche planifiée, réversible) : à faire seulement si c’est voulu.

## Idées pour la suite
- [ ] Marketplace d’extensions en ligne (le format de catalogue est prêt, voir [docs/EXTENSIONS.md](docs/EXTENSIONS.md)).
- [ ] Synchroniser les étiquettes de fichiers avec les renommages externes (surveillance du dossier).
- [ ] Indicateur « mode administrateur » dans la barre du haut.
