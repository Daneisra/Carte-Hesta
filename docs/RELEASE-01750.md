# Candidat de publication Carte Hesta 0.17.50

## État et fenêtre visée

Date prévue de fusion et de livraison : **9 novembre 2026**, heure de Varsovie.
Le report du 8 au 9 novembre est lié à la fin des contrôles VPS à l’approche de minuit ; le changement de date impose une nouvelle CI complète avant fusion.
La note du candidat utilise `status: 'released'` pour les contrôles de publication ;
ce statut dans la branche ne constitue pas une preuve de déploiement. La PR nº 3
reste en Draft. Avant fusion, reconfirmer cette date et la possibilité de terminer
la livraison le même jour. Si la fenêtre change, modifier la date de la note et
refaire les validations de la révision, y compris la CI.

La référence de départ est `4636a3092558ce408ca38c0b86b1f75755fe07d0` ; `main`
reste à `22a4d1f3d78aeaacea0e79992763049de0bc3319` lors de la préparation.
La CI Linux nº 12 valide le code de départ : 34 unitaires, 21 stockage,
22 publication, 58 isolation, 108 déploiement/provenance, 11 API, 80 Chromium
et 80 Firefox, aucun flaky ni reprise. Son seul refus était celui du draft.
La candidate finalisée exige une nouvelle CI complète et un candidat vérifié.

## Contenu produit

La note canonique est dans `js/shared/changelog.mjs` : communauté et soutien
sur Hesta Hub, accueil et navigation harmonisés, version centralisée, chargement
et pagination du changelog, conservation intégrale de l'historique, administration
résistante aux lectures concurrentes, limites explicites des nouveaux textes,
visibilité des médias et fiabilité des livraisons. Les changements d'octobre
déjà présents dans main appartiennent à ce lot documentaire ; aucune nouvelle
fonctionnalité n'est déduite d'une date de commit. Les 48 anciennes notes restent
inchangées. Package, lockfile et version navigateur restent `0.17.50`.

## Vérificateur VPS : contrôlé et actualisé le 8 novembre 2026

Au début de l’audit, l’accès distant n’était pas disponible pour le relecteur.
L’opérateur a ensuite contrôlé le VPS avec son accès SSH habituel, sans utiliser
la clé de transport restreinte : vérificateur initial root:root (répertoire 700,
fichiers de politique 644), Node dédié v22.23.2, service PM2 actif et espace
disponible. Les trois politiques installées correspondaient par empreintes à
celles de `main` avant la PR. Le code actif app/public et les deux copies de
retour arrière du reçu `deployment-9f6x2ks1` correspondaient à leurs manifestes
de tailles, modes et SHA-256 ; aucun rollback de ce reçu n’était commencé.

Le contrôleur du dépôt appelle le Node dédié
`/opt/node-v22.23.2-linux-x64/bin/node` et le vérificateur figé
`/usr/local/lib/cartehesta-release-verifier/tools/deployment.js`. La politique
de `main` initialement observée refusait le nouveau format d’artefact ; elle
a été remplacée sur le VPS, avec autorisation, par la copie validée des trois
politiques ci-dessous. Le code applicatif actif est inchangé.

Les trois fichiers de politique installés et contrôlés sont :

| Fichier | SHA-256 des octets LF du candidat |
| --- | --- |
| `tools/deployment/release.js` | `dc60be00f097c43ef63d89503900186c2b215daee0b0b433a5ceeaeb845384bc` |
| `server/publication/files.js` | `c626a03315ef4742e293d80ba927b4e4124e201e276908bfabf8cb0f39f5f5ae` |
| `server/publication/staticFiles.js` | `b8d8e952833ab5465145ca9b5f6eca41d5bd86e60ccdb638c221e08114ff39b3` |

Ces empreintes ont été recalculées dans la capsule de préparation, puis vérifiées
sur la copie sœur et sur le répertoire actif après bascule. Une sauvegarde
intégrale privée root et l’ancien répertoire du vérificateur sont conservés.
Seuls les trois fichiers de politique diffèrent ; aucun contrôleur, compte,
secret, service ni fichier app/public n’a été remplacé.

L’artefact code-only de la CI Linux nº 13 (révision synthétique PR
`852a970c9b91db50ed023bb31c9bf28577d69ed6`, ZIP SHA-256
`f6f81b05d4bf650827c407e97be857c22d50a20ba2daa4e5991f8a6c3d80fa34`)
a été téléchargé, vérifié puis extrait de manière bornée sur le VPS. Le
vérificateur indépendant puis le vérificateur actif ont validé son manifeste
(110 fichiers), tandis que trois copies modifiées ont été refusées :
altération, ajout et suppression. La bascule a tenu le verrou de déploiement,
conservé l’ancien répertoire et laissé `pm2-cartehesta.service` actif. Il
reste à valider la nouvelle révision datée du 9 novembre par CI avant fusion.

## Contrôles opérateur en lecture seule (effectués le 8 novembre)

Le protocole appliqué avant la bascule couvrait les étapes suivantes :

1. Vérifier l'identité SSH contre la clé d'hôte déjà approuvée. Relever le chemin
   réel du vérificateur, les liens éventuels, propriétaires et modes de ses
   répertoires et fichiers. Lire son éventuelle référence de révision, puis calculer
   les empreintes de tous ses fichiers ordinaires et des trois politiques ci-dessus.
   Ne pas lire `.env`, données, sessions ou secrets applicatifs.
2. Comparer les octets à une révision de confiance et contrôler la fermeture des
   dépendances de `tools/deployment.js`. L'absence de référence Git ne permet pas
   d'inventer un SHA : consigner alors les empreintes et l'écart exact.
3. Confirmer le Node dédié, le service `pm2-cartehesta.service`, la révision active
   et le reçu de rollback correspondant. Relever seulement les états nécessaires,
   jamais l'environnement du service ou le contenu des stores.
4. Vérifier qu'aucun déploiement n'est actif et identifier la procédure de sauvegarde
   privée et de restauration du vérificateur. Vérifier les capacités de stockage,
   les sauvegardes existantes et la cohérence app/public du code actif.

Si un contrôle n'est pas autorisé ou possible, s'arrêter et demander le relevé
opérateur correspondant. Ne pas élargir les droits du compte de transport.

## Transition contrôlée et autorisations restantes

Les étapes de sauvegarde, copie sœur, validation de l’artefact et bascule du
vérificateur (2 à 5) ont été effectuées le 8 novembre. Le gel des opérations
concurrentes, la nouvelle CI après report de date, la fusion et le déploiement
restent soumis à leurs contrôles et autorisations distincts.

1. **Geler les fusions sur main et les déploiements manuels** pendant toute la
   fenêtre. Attendre la fin des activations en cours et consigner le main attendu,
   le HEAD approuvé de PR et la révision/reçu du code actif. Annuler l'enchaînement
   si une référence change ou si la date prévue ne correspond plus à la fenêtre.
2. **Sauvegarder et vérifier** tout le vérificateur installé dans un emplacement
   privé root, avec inventaire, empreintes, propriétaires et modes. Comparer cette
   copie à l'original et valider sa restauration avant bascule. Conserver le code
   sécurisé actif et son reçu de rollback. Aucun snapshot ou retour arrière des
   stores, médias, sessions, comptes ou secrets n'est nécessaire à cette livraison.
3. **Préparer une copie sœur** du vérificateur de confiance, sans modifier l'actif.
   Y appliquer uniquement les trois fichiers revus en LF, vérifier leurs empreintes,
   l'ensemble des dépendances et les modes/propriétaires. Ne jamais exécuter du code
   arbitraire de l'artefact candidat en root.
4. **Valider l'artefact inerte** de la CI finale avec cette copie. Le CLI existant est :

       /opt/node-v22.23.2-linux-x64/bin/node CHEMIN_COPIE/tools/deployment.js verify CHEMIN_ARTEFACT SHA_COMPLET SHA256_MANIFESTE

   Vérifier auparavant le SHA-256 ZIP officiel GitHub et l'extraction bornée ; utiliser
   le SHA et le manifeste de cet artefact exact. Sur des copies jetables uniquement,
   confirmer les refus d'altération, d'ajout ou de suppression. L'artefact de PR sert
   à la vérification de compatibilité ; il ne satisfait pas la provenance push/main
   requise pour activer la production.
5. **Après autorisation**, pendant le gel et sans activation concurrente, conserver
   l'ancien répertoire de vérificateur et mettre en place la copie validée par
   renommages de répertoires sur le même système de fichiers. Ne pas introduire de
   lien symbolique. Si la mise en place ou la revérification échoue, rétablir le
   répertoire précédent avant toute fusion. Aucun redémarrage de service n'est
   nécessaire pour cette seule mise à jour du vérificateur.
6. Vérifier à nouveau les références et la date, puis fusionner uniquement la PR
   autorisée. Laisser la CI complète du **nouveau commit main** produire son propre
   artefact ; conserver la provenance, le digest et les contrôles d'activation du
   workflow Deploy. Ne pas réutiliser l'artefact PR comme artefact de production.
7. Garder le gel jusqu'à la validation de la révision active, des pages, métadonnées,
   API de version, pagination et médias autorisés/refusés. Tester l'administration
   en lecture, sans sauvegarde de configuration de production.

## Retour arrière

Avant fusion : toute vérification échouée impose le rétablissement du vérificateur
sauvegardé et l'annulation de la fusion. Après fusion : maintenir le gel ; le
contrôleur existant restaure ensemble app/public contre son reçu si l'activation
échoue, puis n'autorise la réouverture qu'après vérifications. Un rollback manuel
exige la révision et le reçu exacts, une autorisation distincte et les contrôles
du [runbook](OPS-RUNBOOK.md). Rétablir ensuite la politique de confiance adaptée
à l'état retenu. **Aucune restauration de données.** Éviter toute sauvegarde du
changelog avec l'ancien code, qui conserve la limite historique de 12 notes.
Si l'état sain ou le rollback ne peut pas être vérifié, conserver la maintenance.

La préparation du code et la bascule du vérificateur sont achevées. La fusion
et la livraison restent des actes distincts non autorisés à ce stade ; aucun
tag ni release GitHub n’est demandé.
