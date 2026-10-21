# Stockage et permissions

Le stockage persistant est physiquement séparé du code et des fichiers publics. Les chemins sont absolus et explicitement configurés ; aucun JSON réel n'est fourni par le dépôt.

| Racine | Contenu |
| --- | --- |
| CARTE_DATA_DIR/private | Comptes, groupes, planning, annotations, sessions et permissions |
| CARTE_DATA_DIR/content | Lieux, types, chronologie et configuration éditoriale |
| CARTE_DATA_DIR/locks et transactions | Bail écrivain et reprise des transactions |
| CARTE_MEDIA_DIR | Médias et index technique contrôlés par Node |
| CARTE_PUBLIC_DIR | Liste positive de code public vérifié |
| CARTE_LOG_DIR | Journaux et audit privés |

Les URL compatibles /assets/locations.json et similaires sont des projections API filtrées. Aucun accès statique aux stores n'est autorisé.

Les administrateurs sont globaux. Les MJ gèrent uniquement les groupes explicitement attribués. L'appartenance n'est jamais déduite d'un personnage. Une publication nécessite une qualification explicite ; les annotations sans attribution fiable restent administratives. Un média partagé exige l'autorisation sur tous ses contenus parents.

Les écritures sont atomiques avec un seul écrivain et un journal de transaction. Une erreur JSON ne réinitialise jamais le store. Ne pas déverrouiller ou réparer automatiquement une source inconnue.

Les tests utilisent tests/fixtures/application.cjs et des répertoires temporaires. Les exemples sous assets/fixtures sont documentaires. Le gate strict refuse les données réelles, secrets, médias et artefacts dans Git ; son registre de dette historique est vide dans ce dépôt.

Voir [Architecture](ARCHITECTURE.md), [Contribution](CONTRIBUTING.md) et [Exploitation](OPS-RUNBOOK.md).
