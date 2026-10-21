# Déploiement Carte Hesta

## Architecture de déploiement

Le service dédié est pm2-cartehesta.service. Il utilise son propre PM2_HOME et Node 22, sans toucher au daemon PM2 des autres applications. Les secrets, données, sessions, médias et journaux restent hors app/public ; voir [Architecture](ARCHITECTURE.md).

## Chaîne CI et déploiement manuel

CI s'exécute sur push main et pull_request, avec fixtures synthétiques et sans secret de production. Elle valide Linux, les deux navigateurs et le gate strict, puis produit un artefact identifié par le commit et un manifeste SHA-256.

Le nouveau workflow Deploy n'a qu'un déclencheur manuel. Ses jobs exigent le dépôt officiel et main ; le transport exige l’approbation de l’environnement de production. Un push ne déclenche jamais Deploy. Il sélectionne un run complet CI sur push main, dans ce dépôt et sur la révision exacte ; une validation API seule ou un run de PR ne convient pas. L'artefact existant est téléchargé et vérifié, jamais reconstruit comme substitut à celui testé.

Le contrôleur proposé ops/deploy-code.py prépare une copie privée, vérifie le manifeste avec un vérificateur root figé hors de app/public, ferme la gate publique, arrête uniquement le service dédié et remplace ensemble app/public. Il conserve le code précédent et les échecs. Un échec d'activation ou de santé entraîne un rollback du code et maintient HTTP 503 ; aucune donnée n'est restaurée automatiquement.

Le transport SSH par commande forcée est implémenté et testé sur fichiers synthétiques. Le contrôleur et le compte de transport ne sont PAS installés par un push. Voir [procédure et conditions d'activation](DEPLOY-MANUEL.md). Aucun changement Nginx, DNS, callback Discord, secret ou schéma n'est inclus dans cette mise à jour.

## Réouverture et retour arrière

Une réouverture exige des contrôles privés réussis puis une vérification extérieure. Le contrôleur ne recrée jamais une gate absente avant l'opération ; même une option explicite de réouverture ne suffit pas à publier un site précédemment fermé.

En cas d'échec extérieur, rétablir immédiatement la maintenance selon le runbook puis revenir uniquement au code sécurisé conservé, sans écraser données ni sessions. Ne jamais revenir à l'ancien backend vulnérable. Conserver les versions et rapports privés.

Le renouvellement normal des sauvegardes reste une opération d'exploitation distincte. L'archive ZIP applicative n'est pas une sauvegarde native des grands médias.
