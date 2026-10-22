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

/run est éphémère : sans autorisation persistante vérifiée, le retour à HTTP 503 reste le comportement sûr. La restauration après un arrêt normal est installée et décrite dans [REDEMARRAGE.md](REDEMARRAGE.md) : une autorisation à usage unique, des contrôles HTTPS privés et une unité dédiée. Son premier démarrage a conservé le HTTPS 200 ; son comportement lors d'un véritable redémarrage reste à observer. Toute réinstallation nécessite une autorisation distincte ; aucun touch OPEN_APPROVED inconditionnel n'est ajouté.

Maintenance volontaire, incident ou état incertain : conserver le 503. Après réparation, une recette et une réouverture explicitement autorisées sont nécessaires ; la simple reprise de santé ne suffit pas.

## Erreurs de stockage

Un writer.lock existant ou une transaction incomplète exige un diagnostic explicite ; aucun déverrouillage automatique ni réinitialisation JSON. Préserver les fichiers et les journaux. Arrêter uniquement le service dédié si l'intégrité est en cause.

## Rollback

Le rollback normal remplace uniquement app/public par une version sécurisée cohérente et vérifiée, service dédié arrêté. Les données, sessions, secrets, médias et configurations restent en place. Une restauration de données est une opération différente, autorisée séparément sur une copie vérifiée. Ne jamais redémarrer le backend historique vulnérable.
