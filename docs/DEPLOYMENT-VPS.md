# Déploiement Carte Hesta

## Architecture de déploiement

Le service dédié est pm2-cartehesta.service. Il utilise son propre PM2_HOME et Node 22, sans toucher au daemon PM2 des autres applications. Les secrets, données, sessions, médias et journaux restent hors app/public ; voir [Architecture](ARCHITECTURE.md).

## Chaîne CI et déploiement automatique contrôlé

CI s'exécute sur push main et pull_request, avec fixtures synthétiques et sans secret de production. Elle valide Linux, les deux navigateurs et le gate strict, puis produit un artefact identifié par le commit et un manifeste SHA-256.

Deploy se déclenche après réussite de la CI complète sur push/main du dépôt officiel. Ses jobs vérifient le SHA courant, l’origine du run et le SHA-256 de l’artefact exact. Les secrets restent dans l’environnement limité à main, sans approbation humaine répétée. Une validation API seule, une CI manuelle, un fork ou un run de PR ne convient pas. L'artefact est vérifié, jamais reconstruit comme substitut à celui testé. workflow_dispatch reste disponible pour les interventions exceptionnelles.

Le contrôleur installé, issu de ops/deploy-code.py, prépare une copie privée, vérifie le manifeste avec un vérificateur root figé hors de app/public, ferme la gate publique, arrête uniquement le service dédié et remplace ensemble app/public. Il conserve le code précédent et les échecs. Un échec d'activation ou de santé entraîne un rollback du code et maintient HTTP 503 ; aucune donnée n'est restaurée automatiquement.

Le transport SSH par commande forcée est installé et le premier Deploy GitHub Actions a été validé en production. Le contrôleur et le compte de transport ne sont PAS installés par un push. Voir [procédure et conditions d'activation](DEPLOY-MANUEL.md). Le mécanisme systemd de redémarrage est installé séparément ; voir [son état et sa procédure](REDEMARRAGE.md). Aucun de ces composants système n'est modifié implicitement par Deploy.

## Réouverture et retour arrière

Une réouverture exige des contrôles privés réussis puis une vérification extérieure. Le contrôleur ne recrée jamais une gate absente avant l'opération ; même une option explicite de réouverture ne suffit pas à publier un site précédemment fermé.

En cas d'échec extérieur, rétablir immédiatement la maintenance selon le runbook puis revenir uniquement au code sécurisé conservé, sans écraser données ni sessions. Ne jamais revenir à l'ancien backend vulnérable. Conserver les versions et rapports privés.

Le renouvellement normal des sauvegardes reste une opération d'exploitation distincte. L'archive ZIP applicative n'est pas une sauvegarde native des grands médias.
