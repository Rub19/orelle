# Implementation Plan: Zone de notification et indicateur administrateur

## Overview

Ajouter une zone de notification Orelle en bas à droite lorsque la barre des
tâches Windows est masquée : réseau, volume, batterie, notifications, horloge,
état des mises à jour et flèche accessible vers la zone Windows réelle. Ajouter
aussi un indicateur explicite dans la barre supérieure lorsque Orelle tourne
avec un jeton administrateur.

## Architecture Decisions

- Réutiliser `ctx.capabilities.elevated`, déjà calculé au démarrage et utilisé
  par les services, plutôt que refaire une détection côté renderer.
- Transporter l’état avec le message existant `topbar:state` afin d’éviter un
  nouveau canal IPC ou un sondage périodique.
- Pour la zone de notification, garder les icônes et interactions des autres
  applications dans Windows : Orelle ne peut pas héberger proprement leurs
  icônes via une API publique.
- Afficher dans Orelle les états système qu'il peut lire de façon fiable
  (réseau, audio, batterie, notifications, horloge et mises à jour), puis
  déléguer les réglages détaillés à Orelle ou aux URI `ms-settings:`.
- Afficher le bouton de zone uniquement quand `taskbarMode` vaut `hidden`, afin
  de ne pas dupliquer la vraie zone de notification quand Windows est visible.

## Task List

### Phase 1: Zone de notification

- [x] Ajouter une petite fenêtre non activante en bas à droite en mode barre des
  tâches masquée.
- [x] Ajouter la flèche accessible qui bascule l’aperçu de la barre des tâches
  Windows et masque temporairement le bouton pendant cet aperçu.
- [x] Afficher réseau, volume, batterie, notifications, horloge et indicateur de
  mise à jour dans cette fenêtre.
- [x] Relayout sur changement d’écran, réglages, plein écran et arrêt propre.

### Phase 2: Indicateur visible

- [x] Ajouter `elevated` au contrat d’état de la barre supérieure et à son rendu.
- [x] Ajouter les libellés français/anglais et le style visuel accessible.
- [x] Couvrir les nouvelles traductions et vérifier typecheck, tests et build.

### Checkpoint: Zone et indicateur

- [x] L’indicateur n’apparaît pas en mode normal.
- [x] L’indicateur apparaît en mode administrateur avec un nom accessible.
- [x] La flèche n’apparaît qu’en mode barre des tâches masquée et ouvre l’aperçu Windows.
- [x] Tous les contrôles automatisés passent.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| État topbar désynchronisé | Moyen | Utiliser le snapshot déjà envoyé par le processus principal et le pousser au démarrage. |
| Indicateur peu lisible dans un thème | Faible | Utiliser les tokens existants, une icône SVG et un libellé accessible. |

## Open Questions

- Les validations UAC et interactions Windows listées dans `TODO.md` restent à
  effectuer manuellement sur une session Windows interactive ; elles ne sont
  pas remplacées par cette évolution.
