# Exploitation Carte Hesta

## Service et maintenance

Les commandes ci-dessous concernent exclusivement Carte Hesta et nécessitent une autorisation d'exploitation ; elles ne sont pas exécutées par les tests ou par un push.

- Service dédié : pm2-cartehesta.service, Node 22, un seul écrivain, sans cluster ni reload simultané.
- Backend : 127.0.0.1:4173 ; recette HTTPS locale : 127.0.0.1:4181.
- Gate publique : /run/cartehesta-gates/OPEN_APPROVED ; son absence maintient HTTP 503.
- Gate de recette : /run/cartehesta-gates/RECIPE_ALLOWED ; elle n'ouvre pas le site public.
- Données et sessions restent dans data ; médias dans media-private. Les noms d'URL publics ne sont pas des chemins statiques à exposer dans Nginx.

Pour fermer le site, déplacer la gate publique dans un nouveau nom conservé au sein de /run/cartehesta-gates ; ne pas déplacer un fichier de /run vers /srv avec rename (systèmes de fichiers distincts). Vérifier HTTP 503 depuis l'extérieur. Ne jamais supprimer les données ou restaurer automatiquement un ancien store pour résoudre une erreur.

## Après redémarrage du VPS

/run est éphémère : le retour à HTTP 503 est le comportement sûr prévu. Le démarrage du service seul ne vaut pas approbation de publication. Ne pas ajouter un touch OPEN_APPROVED inconditionnel dans systemd.

Stratégie initiale : conserver la réouverture manuelle contrôlée. Vérifier le service dédié sous Node 22, son port loopback, /health, le manifeste de code actif, les permissions et l'absence d'erreur de stockage ; tester les refus sensibles par le canal de recette puis contrôler Nginx/TLS. Recréer la gate seulement avec autorisation de réouverture, puis vérifier depuis l'extérieur. En cas d'échec, retirer l'accès public en conservant le fichier de gate et les journaux.

Une automatisation de réouverture au boot demanderait une autorisation distincte et une preuve persistante liée à la révision et aux contrôles de permissions. Preuve absente, périmée ou invalide : HTTP 503. Elle ne doit modifier ni Nginx ni les données. Aucune unité supplémentaire n'est installée dans cette préparation.

## Erreurs de stockage

Un writer.lock existant ou une transaction incomplète exige un diagnostic explicite ; aucun déverrouillage automatique ni réinitialisation JSON. Préserver les fichiers et les journaux. Arrêter uniquement le service dédié si l'intégrité est en cause.

## Rollback

Le rollback normal remplace uniquement app/public par une version sécurisée cohérente et vérifiée, service dédié arrêté. Les données, sessions, secrets, médias et configurations restent en place. Une restauration de données est une opération différente, autorisée séparément sur une copie vérifiée. Ne jamais redémarrer le backend historique vulnérable.
