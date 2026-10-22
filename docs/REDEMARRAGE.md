# Retour public après un redémarrage normal

Préparation locale uniquement. L'installation des deux fichiers de confiance nécessite une autorisation VPS ; un push ou Deploy ne les installe jamais comme root.

## Comportement

La gate Nginx reste `/run/cartehesta-gates/OPEN_APPROVED`. Son absence impose HTTP 503. Aucun changement de Nginx, de PM2, de Node, du contrôleur Deploy ou des règles métier n'est nécessaire.

Une seule unité oneshot, `cartehesta-public-boot.service`, démarre après Nginx et le service dédié Carte Hesta. Son ordre d'arrêt est inverse : elle termine avant eux, sans arrêter ni redémarrer aucun autre service. Elle reste active après son contrôle initial pour recevoir son `ExecStop` lors de l'arrêt normal du système.

- À l'arrêt normal, le programme invalide d'abord toute ancienne autorisation. Il enregistre une autorisation unique seulement si systemd est réellement en arrêt, si la gate publique existe et si le code, les configurations et la santé HTTPS privée sont conformes. Une maintenance volontaire reste fermée.
- L'autorisation contient l'identifiant du boot et une empreinte du code et des configurations sélectionnées, sans secret ni contenu utilisateur. Elle est atomique, synchronisée sur disque et privée root dans `/var/lib/cartehesta-boot/handoff.json`.
- Au démarrage suivant, l'autorisation est consommée **avant** les contrôles. Seule une autorisation d'arrêt propre d'un boot différent peut recréer la gate. Le code et les configurations doivent être identiques ; aucun rollback ou nouveau code ne devient public implicitement.
- Les contrôles portent sur les services, Node 22, les deux listeners loopback, TLS, `/health`, les refus sensibles, les réponses anonymes privées, les chemins médias ambigus et Range. La disponibilité HTTP est attendue pendant au plus 30 secondes, car le démarrage du daemon PM2 ne garantit pas encore celui du backend. Aucun délai fixe ni nouvelle tentative des contrôles de sécurité n'est ajouté. Aucun code applicatif n'est exécuté comme root et aucun store n'est écrit par le programme.
- Une gate de recette loopback peut être recréée pour ces contrôles ; elle n'autorise jamais l'accès public. La gate publique n'est créée qu'à la toute fin.
- État absent/corrompu, contrôle en échec, concurrence avec Deploy ou réutilisation dans le même boot : pas de nouvelle ouverture. La raison expurgée est écrite dans le journal de l'unité. Une éventuelle gate refusée est conservée sous un nom distinct dans `/run`, sans suppression de données.

Une coupure électrique sans arrêt propre laisse le site fermé au prochain boot. Après incident, corriger la cause puis effectuer une recette et une réouverture explicitement autorisées. Le retour de santé seul ne réutilise jamais une autorisation consommée. Une relance de l'unité sur un site déjà ouvert et sain conserve la gate existante ; elle ne constitue pas une nouvelle autorisation.

Le verrou noyau est le même que celui du contrôleur Deploy. Ni les reçus, ni le mécanisme de rollback, ni les médias, comptes, sessions ou permissions ne sont modifiés. Les scripts de maintenance existants qui retirent la gate restent compatibles. Pour une maintenance opérateur durable, préférer :

```sh
sudo /usr/bin/python3 -I -B /usr/local/libexec/cartehesta/boot-public.py maintenance
# Puis contrôler le HTTP 503 depuis l'extérieur.
```

## Installation ciblée, après autorisation

Les scripts root restent hors des artefacts applicatifs selon la politique figée actuelle. Il n'est pas nécessaire d'élargir les droits SSH, sudo ou le vérificateur de release. Préparer une capsule opérateur contenant exclusivement `ops/boot-public.py` et `ops/cartehesta-public-boot.service` du commit CI approuvé, avec leurs SHA-256 vérifiés indépendamment avant installation.

Depuis cette capsule revue, pendant que le site est encore ouvert et sain :

```sh
sudo install -o root -g root -m 0755 ops/boot-public.py /usr/local/libexec/cartehesta/boot-public.py
sudo install -o root -g root -m 0644 ops/cartehesta-public-boot.service /etc/systemd/system/cartehesta-public-boot.service
sudo systemd-analyze verify /etc/systemd/system/cartehesta-public-boot.service
sudo systemctl daemon-reload
sudo systemctl enable --now cartehesta-public-boot.service
sudo systemctl is-active cartehesta-public-boot.service
sudo journalctl -u cartehesta-public-boot.service --no-pager -n 10
```

Refuser une destination préexistante différente sans revue ; conserver les versions remplacées. L'installation initiale doit annoncer `AlreadyOpenValidated`, avec HTTPS public toujours 200. Elle ne redémarre ni Nginx ni Carte Hesta. Ne pas tester en redémarrant le VPS ; les scénarios de boot sont simulés par les tests synthétiques, et la syntaxe/les dépendances systemd sont vérifiées en CI Linux.

Le candidat applicatif du même commit reste déployable par le workflow manuel habituel : CI complète `push/main`, artefact exact, empreinte du manifeste, approbation de `cartehesta-production`, `reopen=false`, recette et réouverture contrôlée. Ce Deploy **ne remplace pas** l'installation opérateur des deux fichiers root. Aucun changement de workflow n'est requis.

## Arrêt du mécanisme et rollback

Pour revenir au fonctionnement manuel, désactiver uniquement cette unité : `sudo systemctl disable --now cartehesta-public-boot.service`. Un arrêt manuel n'arme pas l'autorisation ; il ne supprime pas une gate publique existante. Conserver les fichiers et l'état pour diagnostic. Si la santé est incertaine, utiliser d'abord la commande de maintenance puis vérifier le 503.

Le rollback applicatif reste celui de Deploy, limité à `app/public`. Un rollback en maintenance reste fermé au prochain boot. Ne restaurer aucune donnée pour rétablir le code et ne réutiliser aucun ancien backend vulnérable.
