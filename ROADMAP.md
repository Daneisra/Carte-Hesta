# Orientations de Carte Hesta

Carte Hesta réunit l'exploration des lieux, les fiches narratives, les médias, la chronologie et le planning JDR.

Les évolutions doivent préserver la compatibilité des pages, l'accessibilité, les permissions côté serveur, les données persistantes et la sobriété de l'architecture HTML/JavaScript/Node.

Les propositions et anomalies sont suivies dans les [Issues](https://github.com/Daneisra/Carte-Hesta/issues). Aucun élément de cette page ne vaut autorisation de publier un contenu privé ou d'exécuter un déploiement.

## Terminé — sécurisation et exploitation

- [x] Stockage privé séparé du code et contrôle serveur des publications et médias.
- [x] Dépôt GitHub public indépendant ; ancien historique conservé en privé.
- [x] Migration, remise en production et recette des fonctionnalités essentielles.
- [x] CI Linux automatique et Deploy manuel protégé avec rollback du code.
- [x] Mécanisme systemd de redémarrage installé et premier lancement validé sans interruption.
- [ ] Observer sa restauration publique lors d'un véritable redémarrage normal du VPS.

## Prochaine grande étape — Codex, Carte et chronologie

- [ ] Reprendre le plan d'intégration et inventorier les sources actuelles des lieux, personnages, événements et de la chronologie.
- [ ] Déterminer les contenus durables à rendre canoniques dans Hesta Codex, avec leur provenance et leur visibilité.
- [ ] Définir les identifiants stables et les correspondances entre fiches, lieux et événements, sans utiliser un nom ou un slug comme identité métier implicite.
- [ ] Définir les contrats de lecture et l'articulation des permissions ; préserver les groupes et informations privées.
- [ ] Migrer progressivement sur copies vérifiées, avec compatibilité, recette et rollback ; conserver les données cartographiques et le planning dans Carte Hesta.

Aucune synchronisation, migration ni intégration Codex n'est réalisée par cette mise à jour. La [roadmap globale](https://github.com/Daneisra/Hesta-Hub/blob/main/ROADMAP.md) est tenue dans le Hub.
