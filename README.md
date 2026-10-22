# Carte Hesta

Carte interactive et outils narratifs pour l'univers d'Hesta : exploration des lieux, chronologie, planning JDR et administration des contenus.

## État de production

Le site [Carte Hesta](https://cartehesta.dannytech.fr/) est en production. Le dépôt officiel public est [Daneisra/Carte-Hesta](https://github.com/Daneisra/Carte-Hesta) ; l'historique antérieur est conservé séparément dans des archives privées, sans réimport dans ce dépôt.

La CI est automatique ; Deploy reste manuel, limité à main et soumis à approbation. Le mécanisme systemd de redémarrage est installé et actif : son premier lancement a conservé le site ouvert. Son comportement lors d'un véritable redémarrage reste à observer. Voir [Redémarrage](docs/REDEMARRAGE.md).

La communauté, Discord et le support général relèvent du Portail Hesta. Les anomalies de Carte Hesta utilisent ses propres Issues. L'intégration avec le référentiel Hesta Codex reste à développer.

## Fonctionnalités

- Carte avec recherche, filtres, favoris, fiches des lieux et médias.
- Chronologie, annotations, quêtes et liens entre les contenus.
- Planning, groupes et personnages selon les permissions du compte.
- Connexion Discord et administration des publications.
- Pages indépendantes en HTML/CSS/JavaScript et API Node.js 22.

Les publications sont explicites. Les groupes et données personnelles sont privés par défaut. Les médias partagés exigent l'accès à tous leurs contenus parents.

## Développement

Utiliser Node 22 et le lockfile. Les tests génèrent exclusivement des données synthétiques et n'utilisent aucun secret ou service de production.

    npm ci --ignore-scripts --no-audit --no-fund
    node tools/lintEncoding.js
    node tools/runIsolatedTests.js --unit
    node tools/runIsolatedTests.js --project=api

Voir [Contribution](docs/CONTRIBUTING.md) pour toutes les suites, dont Chromium et Firefox sous Linux. La CI est automatique sur push et pull request ; le déploiement reste exclusivement manuel, avec autorisation et approbation de l’environnement de production.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Stockage et permissions](docs/DATA-MANAGEMENT.md)
- [Authentification Discord](docs/OAUTH-DISCORD.md)
- [Déploiement](docs/DEPLOYMENT-VPS.md) et [transport contrôlé](docs/DEPLOY-MANUEL.md)
- [Exploitation](docs/OPS-RUNBOOK.md)
- [Orientations](ROADMAP.md)
- [Droits et ressources](docs/REDISTRIBUTION.md)

Le dépôt contient le code et des exemples synthétiques. Les données, secrets, sessions, journaux et médias du site sont provisionnés séparément et ne doivent jamais être importés dans Git.

## Écosystème et support

[Carte Hesta](https://cartehesta.dannytech.fr/) · [Portail et communauté](https://hesta.dannytech.fr/) · [Système PA](https://pahesta.dannytech.fr/) · [Hesta Codex](https://codexhesta.dannytech.fr/).

[Signaler un bug ou proposer une fonctionnalité](https://github.com/Daneisra/Carte-Hesta/issues/new/choose). Pour une vulnérabilité, suivre [SECURITY.md](SECURITY.md) sans publier de détail sensible dans une Issue.
