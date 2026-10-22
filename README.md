<div align="center">
  <strong>HESTA</strong><br>
  <em>Un univers, plusieurs outils.</em><br>
  <a href="https://hesta.dannytech.fr/">Portail Hesta</a> ·
  <a href="https://cartehesta.dannytech.fr/">Carte Hesta</a> ·
  <a href="https://pahesta.dannytech.fr/">Système PA</a> ·
  <a href="https://codexhesta.dannytech.fr/">Hesta Codex</a>
</div>

# Carte Hesta

[![Production](https://img.shields.io/badge/HESTA-en_ligne-c8aa67)](https://cartehesta.dannytech.fr/) ![Version](https://img.shields.io/github/package-json/v/Daneisra/Carte-Hesta?color=4f78a8) [![CI](https://github.com/Daneisra/Carte-Hesta/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Daneisra/Carte-Hesta/actions/workflows/ci.yml) [![Déploiement](https://github.com/Daneisra/Carte-Hesta/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/Daneisra/Carte-Hesta/actions/workflows/deploy.yml) ![Node.js 22](https://img.shields.io/badge/Node.js-22-43853d) ![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-f7df1e) ![Leaflet 1.9](https://img.shields.io/badge/Leaflet-1.9-199900)

Carte interactive et outils narratifs pour l'univers d'Hesta : exploration des lieux, chronologie, planning JDR et administration des contenus.

## État de production

Le site [Carte Hesta](https://cartehesta.dannytech.fr/) est en production. Le dépôt officiel public est [Daneisra/Carte-Hesta](https://github.com/Daneisra/Carte-Hesta) ; l'historique antérieur est conservé séparément dans des archives privées, sans réimport dans ce dépôt.

Un push sur main déclenche la CI complète puis Deploy automatiquement après réussite, avec artefact et origine vérifiés. Les secrets restent dans l’environnement de production limité à main, sans approbation répétée. Le mécanisme systemd de redémarrage est installé et actif ; son comportement lors d'un véritable redémarrage reste à observer. Voir [Redémarrage](docs/REDEMARRAGE.md).

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

Voir [Contribution](docs/CONTRIBUTING.md) pour toutes les suites, dont Chromium et Firefox sous Linux. Les PR et CI manuelles ne déclenchent aucun déploiement. [Deploy](docs/DEPLOY-MANUEL.md) conserve un déclenchement manuel pour les interventions exceptionnelles.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Stockage et permissions](docs/DATA-MANAGEMENT.md)
- [Authentification Discord](docs/OAUTH-DISCORD.md)
- [Déploiement](docs/DEPLOYMENT-VPS.md) et [transport contrôlé](docs/DEPLOY-MANUEL.md)
- [Exploitation](docs/OPS-RUNBOOK.md)
- [Orientations](ROADMAP.md)
- [Droits et ressources](docs/REDISTRIBUTION.md)

Le dépôt contient le code et des exemples synthétiques. Les données, secrets, sessions, journaux et médias du site sont provisionnés séparément et ne doivent jamais être importés dans Git.

## Écosystème Hesta

| Application | Rôle | URL publique |
| --- | --- | --- |
| Hesta Hub | Portail central, communauté et support général | [hesta.dannytech.fr](https://hesta.dannytech.fr/) |
| Carte Hesta — ce projet | Carte interactive, lieux, chronologie, planning et administration | [cartehesta.dannytech.fr](https://cartehesta.dannytech.fr/) |
| Système PA | Armures, règles et calculs | [pahesta.dannytech.fr](https://pahesta.dannytech.fr/) |
| Hesta Codex | Encyclopédie, lore, relations éditoriales et provenance | [codexhesta.dannytech.fr](https://codexhesta.dannytech.fr/) |

### Support

[Signaler un bug ou proposer une fonctionnalité](https://github.com/Daneisra/Carte-Hesta/issues/new/choose). Pour une vulnérabilité, suivre [SECURITY.md](SECURITY.md) sans publier de détail sensible dans une Issue.
