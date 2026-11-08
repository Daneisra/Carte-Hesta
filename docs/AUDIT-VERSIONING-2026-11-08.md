# Audit et correction du versioning — 8 novembre 2026

Travail préparé sur `fix/versioning-changelog-01750`, créée depuis `origin/main` (`22a4d1f3d78aeaacea0e79992763049de0bc3319`). L'arbre de travail initial était propre. Aucun commit, push, merge, tag, release ni déploiement n'a été créé. Aucun fichier persistant réel n'a été modifié. Les tests utilisent les laboratoires synthétiques du dépôt.

La section F décrit les corrections après contre-revue Claude et les validations les plus récentes. La section D conserve les résultats de la première phase, sans les présenter comme une validation de la révision corrigée après contre-revue.

## A. Diagnostic vérifié avant correction

Les vérifications distantes ont été faites en lecture seule le 8 novembre 2026. Les pages et réponses ont été lues directement en HTTPS après l'échec du lecteur web. Le dépôt distant a été comparé par `git ls-remote` et l'API publique GitHub. Les données privées d'exploitation et les archives privées n'ont pas été consultées.

| Observation préliminaire | État vérifié |
| --- | --- |
| Version `0.17.49` | Confirmée dans package, lockfile, accueil et page changelog en production ; configuration publique également à cette version. |
| Dernière note le 25 septembre 2026 | Confirmée dans le code et dans la réponse de production. Cela documente une date de note, pas une preuve indépendante de livraison. |
| Dépôt créé le 21 octobre | Confirmé : `created_at = 2026-10-21T19:21:40Z`. Il s'agit de la création du dépôt public, pas du début du développement. |
| Neuf commits après l'import, jusqu'au 22 octobre | Neuf commits confirmés, mais jusqu'au **23 octobre**, avec deux commits de fusion et sept autres commits. |
| Aucun tag ou release | Confirmé : aucun tag distant, tableau des releases publiques vide. |
| Historique limité à 12 | Le code limite à 12 la normalisation de la configuration administrateur. La production renvoie pourtant **50 notes** : ses routes publiques lisent directement la projection de la configuration persistante. Une sauvegarde administrateur pouvait donc réduire l'historique existant. |

Sources publiques de contrôle : [dépôt](https://github.com/Daneisra/Carte-Hesta), [métadonnées GitHub](https://api.github.com/repos/Daneisra/Carte-Hesta), [releases](https://api.github.com/repos/Daneisra/Carte-Hesta/releases), [accueil](https://cartehesta.dannytech.fr/), [changelog](https://cartehesta.dannytech.fr/changelog/), [configuration publique](https://cartehesta.dannytech.fr/assets/site-config.json), [API avec limite 50](https://cartehesta.dannytech.fr/api/changelog?limit=50). Ces constats décrivent l'état observé à la date d'audit.

### Causes et risques

- `package.json` et les deux versions racine du lockfile étaient cohérents entre eux, mais isolés des valeurs utilisées par l'interface et le serveur.
- `server.js` et `js/home.js` maintenaient chacun 48 notes par défaut, avec des variantes de ponctuation et de résumé. La configuration publique en contenait 50, dont deux notes supplémentaires de février : « Panneau profil et personnages enrichis » et « Panneau admin consolide ». Ces notes ne doivent pas être perdues au profit du défaut embarqué.
- `server.js` acceptait `site-config.version` comme version prioritaire dans la normalisation administrateur. Les routes publiques `/assets/site-config.json` et `/api/changelog` utilisaient une projection de la configuration brute, différente du chemin administrateur. L'API changelog ne renvoyait aucun champ de version.
- `js/changelog.js` ne changeait les versions affichées qu'après un échec de l'API, lors du repli sur la configuration. Le chemin normal laissait les constantes HTML intactes. Son dernier repli ne contenait qu'une seule note.
- `index.html`, `changelog/index.html`, `planning/index.html` et `geek-unchained/index.html` contenaient des numéros fixes. Le planning dépendait de la configuration pour actualiser ses deux champs ; Geek Unchained conservait sa constante HTML. `js/ui/adminHome.js` possédait aussi deux replis fixes.
- La limite publique maximale de 50 n'était pas accompagnée de pagination ; la page dite complète pouvait donc rester partielle. La limite de 12 du chemin administrateur pouvait être persistée par une sauvegarde.
- Une sauvegarde complète de formulaire pouvait remplacer des champs non soumis ou inconnus de cette version de l'éditeur. Les notes longues étaient également normalisées avec une limite de résumé. Le risque principal concernait les données éditoriales, pas les lieux ou comptes.
- Les tests existants vérifiaient des constantes `0.17.49`, donc pouvaient passer malgré le défaut de chargement. Aucun contrôle CI ne liait nouvelle version et nouvelle note ni ne comparait la conservation de l'historique.
- L'architecture utilise des listes positives de fichiers publiables et de fichiers backend. Toute nouvelle dépendance devait être ajoutée à ces listes et au contexte de validation Linux ; copier seulement un nouveau fichier JS dans le dépôt n'aurait pas garanti sa présence dans l'artefact.

L'examen a inclus les six pages, les scripts d'administration, la gestion transactionnelle du stockage JSON, les projections publiques, les routes concernées, le lanceur de tests isolés, les workflows CI/Deploy et les scripts de construction, transport, redémarrage et rollback. Les références aux versions anciennes ont été recherchées dans le code et les tests. L'import initial ne permet pas de dater les développements qu'il rassemble.

## B. Corrections et fichiers

### Version

`package.json` est l'autorité. `package-lock.json` reste aligné. `server.js` et les projections exposent cette valeur, indépendamment de la version persistée. `server/publication/files.js` génère le module navigateur, les valeurs HTML et les métadonnées avant de calculer les empreintes de publication. `js/version.js` applique également cette valeur aux éléments marqués, sans requête vers GitHub ou la configuration.

L'instantané source `js/shared/appVersion.mjs` est dérivé : `tools/syncVersion.js` le régénère, `tools/checkRelease.js` le vérifie, et le build le régénère lui-même. Il sert aussi aux outils existants qui inspectent les imports des fichiers sources. Il ne constitue pas une seconde autorité éditable.

Les valeurs HTML fixes ont été remplacées par des marqueurs. Les six pages ont une métadonnée `application-version` ; les quatre pages qui affichaient un numéro gardent leurs emplacements. L'accueil et l'administration importent la valeur dérivée ; le chargement de version depuis la configuration a été retiré du planning.

### Historique

`js/shared/changelog.mjs` contient les 48 notes historiques du serveur, conservées sans modification des trois champs éditoriaux, et une préparation `0.17.50`. Les duplications de notes dans le serveur et l'accueil sont supprimées. `js/shared/changelogData.mjs` fusionne les notes canoniques et persistantes sans modifier le stockage. Après contre-revue, seule la dernière variante persistée d'une version est affichée publiquement, prioritaire sur la note canonique correspondante. Toutes les variantes restent stockées et consultables par l'administration ; les notes persistantes non numérotées restent présentes.

`js/shared/changelogClient.mjs` partage le chargement entre accueil et page complète : API, puis configuration, puis notes embarquées. Les données vides ou malformées déclenchent le repli. L'API ajoute la version du code et la pagination ; la page complète suit toutes les pages de 50. Les libellés désignent le code et la configuration, sans annoncer une synchronisation Git.

`server/siteConfigHistory.js` rend les sauvegardes additives pour les notes et conserve les champs existants non soumis, y compris inconnus. La transaction existante sérialise lecture, fusion et écriture. Les notes déjà stockées restent intégrales, métadonnées et textes longs compris ; le formulaire administrateur peut être vide sans effacer l'historique. Le comportement additif est expliqué dans le panneau. Aucune migration ni réinitialisation n'a été exécutée ou n'est requise.

La lecture ne normalise plus les titres vides ni les dates et textes historiques. Les nouvelles variantes sont validées séparément, avec rejet HTTP 400 au-delà de 200 caractères de titre ou 4 000 de résumé. Les notes longues déjà connues ne sont pas réécrites. `server/security/access.js` compare les références média avec la projection de leur propre contenu ; les tableaux publics réordonnés ne sont plus rapprochés par indice. La règle exigeant l'accès à tous les parents d'un média reste inchangée.

### Inventaire des fichiers modifiés ou ajoutés

| Ensemble | Fichiers |
| --- | --- |
| Autorité et contrôles | `package.json`, `package-lock.json`, `tools/checkRelease.js`, `tools/syncVersion.js`, `.github/workflows/ci.yml`, `.github/scripts/verify-ci-run.cjs` |
| Données et chargement partagés | `js/shared/appVersion.mjs`, `js/shared/changelog.mjs`, `js/shared/changelogData.mjs`, `js/shared/changelogClient.mjs`, `js/version.js` |
| Backend, sécurité et publication | `server.js`, `server/siteConfigHistory.js`, `server/security/access.js`, `server/publication/files.js`, `server/publication/projections.js`, `server/publication/staticFiles.js`, `tools/deployment/release.js` |
| Pages et interfaces | `index.html`, `map/index.html`, `timeline/index.html`, `planning/index.html`, `changelog/index.html`, `geek-unchained/index.html`, `js/home.js`, `js/changelog.js`, `js/planning.js`, `js/ui/adminHome.js`, `js/ui/homeAdminPanel.js` |
| Contexte Linux | `tools/verifyLinuxContext.js`, `tools/runLinuxValidation.js` |
| Tests et fixture synthétique | `tests/unit/run.mjs`, `tests/unit/releases.mjs`, `tests/unit/mediaVisibility.mjs`, `tests/fixtures/changelog.cjs`, `tests/api/changelog.spec.js`, `tests/api/planning.spec.js`, `tests/ui/versioning.spec.js`, `tests/ui/home.spec.js`, `tests/ui/changelog.spec.js`, `tests/ui/planning.spec.js`, `tests/ui/geek-unchained.spec.js`, `tests/isolation/changelog.test.cjs`, `tests/publication/publication.test.cjs`, `tests/deployment/versioning.test.cjs`, `tests/deployment/normal.test.cjs` |
| Documentation | `README.md`, `docs/VERSIONING.md`, ce rapport |

Les listes de publication incluent uniquement les nouveaux fichiers de code nécessaires. Aucun assouplissement d'accès aux données ni changement d'authentification. Le workflow Deploy et les scripts d'activation/transport/redémarrage restent inchangés. La CI ajoute la comparaison historique, une profondeur Git de deux commits et un contrôle distinct refusant une préparation sur `main` et dans les PR ciblant `main`. La preuve de provenance de la CI exige aussi la réussite de cette étape.

## C. Version proposée et reconstruction

**`0.17.50` — Communauté Hesta et suivi des versions. État : en préparation. Date réelle de livraison : à confirmer.**

Le patch proposé regroupe les corrections de cohérence et de conservation, avec des changements de parcours compatibles déjà intégrés au code. Aucun changement de schéma des données ni rupture d'API identifiée ne justifie ici un saut de minor. Le numéro n'est pas calculé à partir des commits. La production n'a pas été modifiée et n'est pas présentée comme étant déjà en `0.17.50`.

### Changements vérifiés depuis l'import public

| Commits et dates Git | Contenu vérifiable | Catégorie des notes |
| --- | --- | --- |
| `96c4f37`, 21 octobre | Déploiement manuel contrôlé après CI complète sur la révision attendue. | Technique |
| `524a023`, 22 octobre | Réouverture publique après redémarrage propre et vérifications ; unité systemd et scénarios synthétiques. | Technique |
| `3d6aba6`, 22 octobre | Attente de disponibilité HTTP avant les contrôles de sécurité de redémarrage. | Correction |
| `2f3fe41`, 22 octobre | Harmonisation des liens Hesta, accès à la communauté via le Hub, documentation de l'exploitation. | Parcours utilisateur et documentation |
| `9dd54af`, 22 octobre | Déploiement automatique après CI push/main complète ; vérification de la provenance et de l'intégrité de l'artefact, téléchargement contrôlé, récupération et réouverture après rollback sain. | Technique |
| `16500c4`, 23 octobre | Retrait des panneaux communauté et soutien de l'accueil au profit du Hub ; grille à deux colonnes et tests aux largeurs 320, 390, 768 et 1280 px. | Parcours utilisateur et responsive |
| `e5addb7`, 23 octobre | Présentation Hesta du README et badges liés au projet. | Documentation et maintenance |

Les deux commits de fusion (`5309eea`, `22a4d1f`) ne deviennent pas deux versions supplémentaires. Les dates ci-dessus sont celles des commits, jamais des dates de livraison déduites.

### Notes préparées pour 0.17.50

- **Nouveautés et parcours** : communauté, Discord et soutien centralisés sur Hesta Hub ; accueil allégé ; liens harmonisés entre les projets Hesta.
- **Corrections** : affichage de version cohérent sur les pages, pieds de page et métadonnées ; correction du chemin normal de chargement du changelog ; repli utilisable en cas de panne ou de données incomplètes ; conservation des notes au-delà de 12 et chargement complet au-delà de 50 ; adaptations responsive de l'accueil déjà présentes dans les commits vérifiés.
- **Compléments de contre-revue** : dernière variante publique unique, historique conservé, limites explicites des nouveaux textes, tri stable et autorisation média indépendante des indices des tableaux projetés ; refus d'un draft dans la CI d'une PR ciblant `main`.
- **Technique** : déploiement après validation complète, provenance et intégrité des artefacts, attente HTTP au redémarrage, récupération du service et réouverture après retour à une version saine ; contrôles CI du versioning et de la conservation des notes.
- **Documentation et maintenance** : README Hesta, badges, liens entre projets, exploitation et procédure de publication reproductible.

Ces notes décrivent le contenu du lot préparé ; elles ne prétendent pas que chacun de ces changements attend encore son premier déploiement. Les changements d'octobre sont déjà dans `main`, mais leurs déploiements exacts ne sont pas reconstitués ici.

### Limites historiques

Le dépôt public ne contient aucun commit antérieur au 21 octobre. Il est donc impossible de comparer exactement le code du 25 septembre à celui de l'import ou de prouver la livraison de toutes les anciennes notes. Les archives privées et, pour les déploiements exacts, les rapports d'exploitation seraient nécessaires. Les versions `0.17.0` à `0.17.2` ne sont pas documentées dans les sources examinées : aucune entrée ou date n'a été inventée. Les deux notes supplémentaires de production restent prises en charge depuis la configuration persistante ; elles n'ont pas été recopiées depuis des données réelles vers un fichier versionné.

## D. Validation initiale, avant contre-revue

Environnement : Windows, Node `22.23.2`, dépendances installées du lockfile. Les commandes npm ont été exécutées avec `npm.cmd` parce que la politique PowerShell refuse le lanceur `npm.ps1` ; aucune politique système n'a été changée. Les journaux Playwright et les résumés d'isolation sont conservés sous `test-results/` et sont ignorés par Git.

| Vérification exécutée | Résultat |
| --- | --- |
| `npm.cmd run lint` | Réussi, UTF-8 sans BOM. |
| `npm.cmd run release:check -- --base=origin/main` | Réussi : package/lock, instantané, pages et conservation des 48 anciennes notes ; 49 notes canoniques avec la préparation. |
| `npm.cmd run release:ready` | Refus **attendu** : date de livraison à confirmer, version encore en préparation. Ce résultat ne valide pas une livraison. |
| `npm.cmd run test:unit` | **21 réussis**, dont 7 nouveaux scénarios de versioning, repli, pagination et administration. |
| `npm.cmd run test:api` | **10 réussis**, dont les nouvelles vérifications de version, limites et sauvegarde de 65 notes complémentaires. |
| `npm.cmd run test:publication` | **22 réussis**, dont version du module, HTML, pieds de page et métadonnées dérivés au build. |
| `npm.cmd run test:storage` | **20 réussis, 1 ignoré** : vérification native POSIX non applicable sous Windows. |
| `npm.cmd run test:isolation` | **54 réussis**, y compris les trois nouveaux scénarios d'historique et configuration absente. |
| `node --test tests/deployment/*.test.cjs` | Terminé avec code **0**. Vérifications synthétiques, artefact, provenance, sauvegarde, rollback et démarrage du backend empaqueté réussis. Trois cas natifs Linux ignorés : systemd, Nginx et rsync. |
| `node --test tests/deployment/linux-context.test.cjs` | **3 réussis** : liste positive, intégrité et résolution des dépendances du contexte Linux. Cela prépare la validation Linux, sans prétendre l'avoir exécutée. |
| `npm.cmd run test:ui:chromium` | Suite complète : **73 réussis**, sans échec ni scénario ignoré. |
| Firefox ciblé : filtre `Changelog\|Versioning\|Accueil\|Geek Unchained\|Planning` | **29 réussis, 1 échec** d'un test existant du calendrier (`.planning-agenda-day`, résultat `undefined`). Les sept nouveaux scénarios de versioning réussissent. |
| Firefox ciblé de reprise : filtre `socle calendrier\|Versioning` | **8 réussis**, y compris le calendrier précédemment en échec et les sept nouveaux scénarios. Cause du premier échec non établie. |
| `npm.cmd run test:ui:firefox` complet | **Validation non acquise** : erreurs répétées dans Playwright lors de `browserContext.newPage`, avant l'exécution du code des scénarios concernés. Exécution arrêtée après 12 échecs de création de page ; les autres scénarios de cette exécution n'ont pas été exécutés. |
| `node tools/auditTrackedPaths.js --strict` | Réussi : aucun chemin historique ou interdit détecté dans l'index. Les ajouts sont séparément revus au diff et ne sont pas indexés. |
| `git diff --check` | Réussi. Revue des fichiers suivis et des nouveaux fichiers ; aucun changement de données, de permissions, d'authentification ou du workflow Deploy. |

L'échec API du premier essai ciblé venait d'une assertion comparant un texte nouvellement soumis avec son espace final à la réponse normalisée. La fixture a été corrigée pour vérifier le texte normalisé ; la suite API complète a ensuite réussi. La conservation des textes et métadonnées déjà stockés a été vérifiée indépendamment, y compris par comparaison des octets sur disque après des lectures et par comparaison des objets complets après sauvegarde.

La trace Firefox complète identifie `FFBrowserContext.doCreateNewPage` dans Playwright, avec `TypeError: Cannot read properties of undefined (reading '_page')`. Les douze scénarios concernés échouent pendant la préparation de leur page. Aucune version de Playwright, permission ou protection réseau n'a été modifiée pour contourner cette panne. La suite Firefox complète doit être exécutée dans la CI Linux prévue avant fusion ; les reprises ciblées réussies ne remplacent pas ce contrôle.

Les suites terminées via le lanceur isolé signalent l'absence de violations de frontière et l'arrêt de leurs serveurs/stubs. La dernière exécution Firefox interrompue garde ses diagnostics ; son arrêt n'est pas compté comme un test réussi. Les tests natifs Linux, `actionlint` indépendant et un vrai déploiement/redémarrage de production n'ont pas été exécutés ici. Aucune régression applicative n'a été observée dans les scénarios réussis ; la validation complète Linux/Firefox reste ouverte.

Diagnostics principaux : `test-results/cartehesta-test-4Fhwew` (unitaires), `cartehesta-test-uG2iBZ` (API), `cartehesta-test-8Kty5e` (publication), `cartehesta-test-2cLIZv` (stockage), `cartehesta-test-5yxoHv` (Chromium complet), `cartehesta-test-NrIa9g` (premier Firefox ciblé), `cartehesta-test-GI0Sly` (reprise Firefox), `cartehesta-test-x0i0tq` (panne de création de page Firefox complet). Tous ces chemins sont relatifs à `test-results/`.

## E. Publication, opérations manuelles et rollback

1. Relire le diff et confirmer le choix `0.17.50`, le texte et la **date réelle de livraison**. Passer la note de `draft` à `released`, renseigner cette date, retirer les mentions de préparation et refaire `release:check`, `release:ready` et la CI sur la révision finalisée.
2. Autoriser séparément le commit et le push de la branche. Ne pas pousser directement sur `main`. Après revue de PR et CI complète Linux réussie, effectuer la vérification et, si nécessaire, la mise à jour opérateur du vérificateur figé décrite ci-dessous, **avant d'autoriser la fusion** et son déploiement automatique. Aucun de ces actes n'a été réalisé ici.
3. Aucune opération d'édition ou de migration des données n'est requise. Conserver les sauvegardes privées et le précédent artefact sécurisé selon la procédure d'exploitation existante ; ne pas exporter ces données dans Git.
4. Après un déploiement autorisé, vérifier la révision du manifeste et les valeurs servies par l'accueil, `/changelog/`, le planning, Geek Unchained, `/assets/site-config.json` et `/api/changelog`. Vérifier les six métadonnées de version et le chargement de la dernière page de l'historique, ainsi que les fonctions d'administration en lecture. Confirmer la présence des deux notes de février propres à la production. Ne pas modifier la configuration de production pour tester sa sauvegarde.
5. Un vrai redémarrage VPS et le comportement du proxy en production restent des contrôles d'exploitation distincts ; ne pas provoquer un redémarrage pour cette seule correction.
6. Rollback : revenir ensemble à app/public d'un artefact **sécurisé**, validé et conservé, par le mécanisme existant. Conserver données, médias, comptes, permissions, sessions et secrets. Le code précédent contient encore la limite de 12 : éviter une sauvegarde de changelog avec cet ancien code. Une restauration de données est une intervention différente qui demanderait une autorisation et une sauvegarde vérifiée.

La [politique et la procédure détaillées](VERSIONING.md) distinguent commit, version applicative et déploiement. Les tags et releases GitHub sont facultatifs pour l'affichage et restent soumis à autorisation.

### Mise à jour opérateur du vérificateur figé

Le contrôleur `ops/deploy-code.py` appelle `/usr/local/lib/cartehesta-release-verifier/tools/deployment.js`, installé séparément et jamais remplacé par Deploy. Son `verify()` exige l'égalité exacte avec les listes de fichiers revues. Le vérificateur correspondant à `main` avant cette correction rejettera donc un artefact contenant les nouveaux modules. Ce refus intervient avant le remplacement d'app/public. L'état réel du vérificateur installé sur le VPS n'a pas été lu pendant cet audit.

La fermeture des dépendances de ce vérificateur ne change pas. Les trois fichiers suivants portent la politique modifiée ; aucun nouveau droit ou accès SSH/sudo n'est requis. Une capsule locale de **préparation**, non installée et ignorée par Git, contient ces trois fichiers normalisés LF et `SHA256SUMS.txt` sous `.tmp/versioning-audit/verifier-policy/`.

| Fichier revu | SHA-256 des octets LF préparés |
| --- | --- |
| `tools/deployment/release.js` | `dc60be00f097c43ef63d89503900186c2b215daee0b0b433a5ceeaeb845384bc` |
| `server/publication/files.js` | `c626a03315ef4742e293d80ba927b4e4124e201e276908bfabf8cb0f39f5f5ae` |
| `server/publication/staticFiles.js` | `b8d8e952833ab5465145ca9b5f6eca41d5bd86e60ccdb638c221e08114ff39b3` |

Procédure à autoriser et exécuter séparément par l'opérateur :

1. Après commit/revue et CI Linux, rattacher la capsule à la révision finale autorisée et recalculer/vérifier ses empreintes indépendamment. La capsule actuelle n'est pas attestée par un commit. Comparer la copie installée à la base attendue et revoir toute divergence ; ne pas supposer sa version.
2. Organiser un **gel temporaire des fusions sur `main` et des déploiements manuels** pendant toute la fenêtre de transition, puis attendre la fin des activations en cours. Consigner le SHA de `main`, la révision unique autorisée de la PR et le reçu du code actif. Conserver une copie privée vérifiée de **tout le vérificateur installé**, avec ses empreintes, propriétaire et modes ; vérifier aussi sa possibilité de restauration. Préparer un nouveau répertoire frère à partir de cette copie, sans modifier le vérificateur actif ni app/public, puis y appliquer seulement les trois fichiers revus. Ne jamais exécuter automatiquement du code du candidat comme root.
3. Vérifier que toutes les dépendances restent présentes, que les chemins sont des fichiers ordinaires sans liens et que propriétaires/modes restent conformes au vérificateur existant. Faire vérifier par cette nouvelle copie l'artefact inerte de la révision approuvée, avec sa révision complète et son empreinte de manifeste attendues, via le CLI `verify`. Les vérifications d'intégrité doivent encore refuser une altération, une entrée supplémentaire ou un fichier manquant. Les tests synthétiques de packaging ont couvert ces refus localement ; la vérification du candidat final sur le VPS reste à effectuer.
4. Exiger la CI complète Linux/Firefox et le contrôle de publication réussis sur la révision finalisée. Vérifier à nouveau que `main` et la PR n'ont pas changé, puis basculer la copie de confiance par la procédure opérateur existante, hors tout déploiement concurrent, sans toucher aux contrôleurs, clés, comptes, services ou données. Refaire la vérification du candidat et autoriser **uniquement la fusion prévue**. Suivre ensuite la CI du commit effectivement fusionné, l'artefact correspondant et son activation. Si la vérification échoue avant fusion, rétablir immédiatement la copie précédente et conserver le diagnostic ; ne pas fusionner. Toute évolution concurrente de `main` ou de la PR impose l'annulation de cet enchaînement et une nouvelle validation.
5. Conserver l'ancien vérificateur et les reçus de déploiement. Après fusion, garder le gel pendant un éventuel rollback de code et le rétablissement de la politique correspondante. Le rollback existant de `ops/deploy-code.py` vérifie les arbres app/public contre les empreintes de son reçu, sans revalider le précédent artefact avec la nouvelle liste. Il reste utilisable sous réserve de ces contrôles. Une réinstallation ultérieure d'un ancien artefact devra utiliser sa politique de vérification correspondante ; ne pas élargir la liste pour accepter arbitrairement les deux formats. Lever le gel seulement après vérification de l'état actif et de la possibilité de rollback ; conserver la maintenance selon le runbook si l'état sain ne peut pas être établi.

Il s'agit d'une mise à jour du code de vérification de confiance, pas d'une migration de données. Elle est nécessaire à la publication si le VPS utilise encore la politique antérieure, et requiert une autorisation d'exploitation distincte. Aucune installation, bascule de répertoire ou modification de permissions n'a été exécutée ici.

## F. Corrections après contre-revue indépendante Claude

La branche reste `fix/versioning-changelog-01750`, la version proposée `0.17.50`, l'entrée courante en `draft` avec `date: ''`. Les décisions de contre-revue ont été appliquées sans commit ni opération de publication, sans accès au VPS ni modification de données réelles.

### I-1 — Préparation et publication en CI

Le contrôle de préparation reste `release:check`, compatible avec une note draft. Le nouveau contrôle distinct **Release publication readiness (main and PRs targeting main)** exécute `release:ready` sur `refs/heads/main` et sur toute PR dont la base est `main`, y compris une PR draft. Il intervient après les tests et avant le packaging. Un draft peut donc être examiné, mais sa CI ciblant `main` ne peut pas être entièrement verte. Le message `E_RELEASE_NOT_READY` distingue explicitement revue de préparation et refus de publication/fusion ; `E_RELEASE_DRAFT_INVALID` identifie une préparation mal formée.

La vérification de provenance `.github/scripts/verify-ci-run.cjs` exige la réussite de cette étape. Les tests chargent le vrai workflow YAML et vérifient les conditions pour push/main, PR/main, PR/autre branche, push de fonctionnalité, validation manuelle complète et diagnostics API seuls. Ils vérifient aussi que la préparation accepte le draft et que la publication le refuse, ainsi que le refus d'une preuve CI dépourvue du contrôle ou annonçant son échec. Aucun réglage GitHub de protection de branche n'a été modifié ; la CI complète doit rester un contrôle requis avant fusion.

### I-2 et F-3 — Dernière variante publique et ordre stable

`latestVersionEntries()` retient la dernière variante d'une version selon sa **position dans le journal persistant**, jamais selon la date affichée. Elle passe avant la note canonique correspondante. Toutes les variantes restent stockées ; l'administration continue de recevoir l'historique intégral. Les notes persistantes non numérotées ne sont pas filtrées par version. Le tri public départage les dates égales par version numérique décroissante, puis conserve l'ordre des notes non numérotées à égalité.

Le scénario de correction de `0.17.48` vérifie une ancienne et une nouvelle variante stockées, une seule entrée publique corrigée, aucun doublon après une nouvelle sauvegarde sans modification et une pagination cohérente. Le repli navigateur utilise la même sélection.

### I-3 et F-5 — Lecture intégrale et validation des nouvelles variantes

La lecture administrateur conserve les valeurs historiques telles quelles, dont les dates, les espaces, les textes longs et les titres vides. Elle n'utilise plus de titre de repli susceptible d'être sauvegardé comme une nouvelle variante. Les projections publiques conservent également les textes intégraux ; les libellés de présentation sont appliqués uniquement dans l'interface.

L'écriture reconnaît les entrées déjà présentes avant de valider les nouvelles : une note longue non éditée reste inchangée. Une nouvelle variante dépassant **200 caractères Unicode de titre** ou **4 000 de résumé** produit HTTP 400 et un code explicite (`E_CHANGELOG_TITLE_TOO_LONG` / `E_CHANGELOG_SUMMARY_TOO_LONG`). Aucun autre champ de la transaction n'est alors enregistré. Les plafonds comptent les points de code Unicode, et les tests utilisent aussi des accents et emoji. L'éditeur affiche le message serveur. La sauvegarde additive, la conservation des métadonnées historiques et le verrou transactionnel existants sont préservés.

### F-2 — Visibilité réelle des références média

Le risque était confirmé dans `mediaParents()` : la présence d'une valeur projetée à un même indice ne prouvait pas qu'elle provenait du contenu brut correspondant. Cela pouvait mal classer une référence après filtrage ou tri.

La comparaison ne rapproche plus les tableaux par indice. Les objets partiellement projetés sont associés à leur propre projection avant tout tri. Pour le changelog, la sélection de la dernière variante opère sur les champs publics projetés et conserve l'identité de ces projections ; une métadonnée privée `version` ne peut pas fausser cette association. Les champs privés et variantes masquées sont toujours parcourus comme parents privés. Les tableaux partiellement filtrés des lieux et des métriques sont traités par entrée d'origine ; les réponses du planning ne publient pas leurs champs inconnus. Les membres de groupes calculés depuis les comptes ne peuvent pas autoriser des références placées dans un champ brut `group.members`.

`mediaAllowed()` conserve la règle **tous les parents doivent être lisibles**. Une référence publique ne neutralise jamais une référence privée. Les tests couvrent les notes réordonnées, les anciennes variantes filtrées, les champs privés, les médias légitimement publics, des variantes dont les champs publics sont identiques, des références mixtes publiques/privées et des tableaux de lieux filtrés. Un test HTTP complet vérifie aussi les réponses 200/404 sur de vrais fichiers PNG synthétiques publiés et le maintien de l'accès administrateur.

Conséquence assumée de cette règle : un média encore référencé par une ancienne variante désormais masquée peut rester refusé publiquement même si une variante visible le cite aussi. Aucune déclassification automatique n'est ajoutée.

### F-1 — Fixture représentative et parcours complet

`tests/fixtures/changelog.cjs` fabrique 50 notes persistantes : 47 versions et trois notes non numérotées, avec dates et textes fictifs différents du code, un ancien résumé dépassant 4 000 caractères, un ancien titre dépassant 200 et une note au titre vide. Un titre non numéroté public du code sert uniquement d'identifiant de rapprochement ; aucun stockage réel n'a été copié. La fixture fournit aussi une préparation sans date et une correction synthétique de `0.17.48`. La note de préparation du code est vérifiée dans le parcours HTTP.

Le test exécute successivement : lecture publique paginée, lecture administrateur, sauvegarde sans changement, nouvelle lecture, correction de `0.17.48`, contrôle du journal et nouvelle sauvegarde. Il vérifie les 50 notes initiales intactes, puis 51 notes stockées après correction, et toujours 51 entrées publiques comprenant la préparation, avec une seule `0.17.48` corrigée et les trois notes non numérotées. Les textes longs sont comparés intégralement. Les opérations refusées sont contrôlées par comparaison des octets du fichier avant/après.

### I-4 — Transition du vérificateur

La procédure VPS et `docs/VERSIONING.md` imposent désormais : vérification de l'état réellement installé, sauvegarde complète vérifiée, gel temporaire des fusions sur `main` et des activations concurrentes, validation du nouvel artefact par une copie de confiance, vérification des SHA de PR/main avant bascule, fusion réservée au seul candidat prévu, suivi de l'artefact du commit réellement fusionné et maintien du gel jusqu'à validation ou rollback. Le retour arrière couvre séparément le code actif et la politique du vérificateur, sans restaurer les données. Aucune de ces opérations n'a été réalisée.

### Validations après contre-revue

| Commande ou suite exécutée | Résultat de cette phase |
| --- | --- |
| `npm.cmd run test:unit` | **30 réussis**, dont neuf contrôles supplémentaires de variantes, limites, ordre et visibilité média. |
| `npm.cmd run test:api` | **10 réussis**. |
| `npm.cmd run test:publication` | **22 réussis**. |
| `npm.cmd run test:storage` | **20 réussis, 1 ignoré** sous Windows (permissions POSIX). |
| `npm.cmd run test:isolation` | **57 réussis**, dont les six scénarios HTTP/historique du fichier changelog ; les contrôles de permissions et médias existants passent aussi. |
| `node --test tests/deployment/*.test.cjs` | **86 réussis, 3 ignorés** (systemd, Nginx, rsync natifs Linux), aucun échec. Inclut les sept tests de conditions CI et les tests de provenance. |
| Chromium ciblé, filtre `Changelog\|Versioning\|Accueil\|Geek Unchained\|Planning\|Points d` | **47 réussis**, dont les deux nouveaux scénarios UI de dernière variante et de rejet explicite des textes trop longs. |
| Chromium complémentaire, lanceur Node avec filtre `permissions.spec.js\|post-ouverture` | **7 réussis** : publication/retrait, révocation, invalidations, portraits, miniatures et lecteurs audio. Deux scénarios recoupent la sélection précédente ; les résultats ne sont pas additionnés comme 54 tests distincts. |
| Firefox ciblé, filtre `Changelog\|Versioning\|Accueil\|Geek Unchained\|Planning` | **31 réussis, 1 échec** d'un test existant du planning : fermeture de la page/contexte pendant `locator.fill`. Tous les nouveaux scénarios passent. |
| Reprise Firefox, filtre `peut renseigner une disponibilite datee` | **1 réussi**. Le premier échec n'est pas effacé du bilan ; la cause de fermeture de page reste non établie. |
| `release:check -- --base=origin/main` | Réussi en conservant le draft et les 48 notes historiques du code. |
| `release:ready` | **Refus attendu**, `E_RELEASE_NOT_READY` : aucun statut de livraison définitif n'est déclaré. |
| Encodage, syntaxe, contrôle de chemins et revue du diff | Réalisés avant arrêt du travail, dont `node --check` sur les **37 fichiers JS/MJS/CJS** modifiés ou ajoutés ; aucun changement de données réelles, du workflow Deploy, des schémas de permissions ou de l'authentification. Le fichier d'accès média et la preuve de provenance CI sont modifiés pour les corrections décrites. |

Les premiers essais ont signalé deux erreurs de fixture : une note canonique non numérotée supplémentaire n'était pas rapprochée dans les attentes, et un test de média dit public utilisait une catégorie PNJ non publiée dans le laboratoire. La fixture a été alignée sur le rapprochement attendu et la publication du PNJ a été décidée explicitement dans ce seul test synthétique. Les suites unitaires et d'isolation ont ensuite réussi. Aucune permission réelle n'a été élargie.

Diagnostics de cette phase : `test-results/cartehesta-test-994M9j` et `cartehesta-test-1rLbEr` (unitaires), `cartehesta-test-FXwWIH` (API), `cartehesta-test-MOe8Rz` (publication), `cartehesta-test-VY8XYa` (stockage), `cartehesta-test-QMSpVb` (Chromium ciblé), `cartehesta-test-xwJVvL` (Chromium médias/permissions), `cartehesta-test-gjH40G` (Firefox ciblé et trace de fermeture), `cartehesta-test-cLUrHK` (reprise Firefox). Une tentative du filtre complémentaire via `npm.cmd` avait échoué au passage des arguments avant le lancement des tests ; elle n'est pas comptée comme réussie. Le lanceur Node du dépôt a ensuite exécuté les sept scénarios. Les journaux complets d'isolation et de déploiement sont `test-results/counter-review-isolation.tap` et `test-results/counter-review-deployment.tap`. Ils restent ignorés par Git.

### Verdict de contre-revue et limites restantes

**La branche est apte à recevoir un commit de préparation, après autorisation explicite. Aucun commit n'est créé ici.** Les décisions I-1/I-2/I-3/F-2/F-1/F-3/F-5 sont couvertes par les corrections et tests décrits ; I-4 est préparé dans la documentation sans intervention VPS. Le diff reste limité au versioning, au changelog, à la visibilité média dépendante de ces projections, aux contrôles et à leur documentation.

**Elle n'est pas prête à être fusionnée ni publiée** : la note reste volontairement en draft sans date définitive ; la validation complète Firefox/Linux reste obligatoire sur la révision finale ; les vérifications natives Linux ignorées ici ne sont pas réputées réussies ; l'état du vérificateur VPS doit être contrôlé et sa transition éventuellement autorisée et exécutée pendant la fenêtre de gel. L'incident Firefox local reste documenté malgré la reprise réussie. Aucun secret, store réel, compte, groupe, personnage ou média de production n'a été modifié.

## Diagnostic Firefox après la Draft PR nº 3 — 8 novembre 2026

Cette intervention reste locale, sur `fix/versioning-changelog-01750`, à partir de `40359f96ae166b41d23d8813313a16d82f6a4928`. Aucun nouveau commit, push, changement de PR, tag, déploiement ou accès VPS. `0.17.50` reste en `draft`, avec une date vide.

### Preuves disponibles et limites du diagnostic

Le journal de la [CI Linux nº 10](https://github.com/Daneisra/Carte-Hesta/actions/runs/42489869670) a été relu, notamment les deux échecs initiaux et leurs reprises. Les ZIP de traces sont annoncés dans ce journal mais ne figurent pas parmi les artefacts conservés : aucun artefact n'a été publié après le refus attendu de `release:ready`. Ils n'ont donc pas pu être analysés localement.

- **Chronologie, clic à la ligne 166** : le journal identifie Firefox **PID 7445** et un arrêt fatal de `MOZ_DISABLE_NONLOCAL_CONNECTIONS` après une tentative vers `aus5.mozilla.org (151.101.73.91)`. La fermeture est bien liée au garde réseau natif. Les avertissements GPU, audio, espace de noms et Juggler ne suffisent pas à établir une autre cause.
- **Isolation, navigation à la ligne 6** : fermeture de la page/contexte signalée, sans PID ni journal natif associé dans les éléments conservés. Sa cause demeure indéterminée ; lui attribuer le même arrêt réseau serait une hypothèse.
- **Reproduction locale avant correction** : le diagnostic minimal ne réussit aucune création de page (0/2 réussis, erreurs lors de `newPage`), puis un essai UI échoue de même. Les processus Firefox **22200** et **13084** signalent `Failed to launch tab subprocess`, restent connectés côté Playwright puis quittent avec le code 0 lors de leur fermeture explicite. Ce symptôme Windows de création de sous-processus est distinct d'un arrêt réseau fatal ; son mécanisme système exact n'a pas été déterminé.
- Le même harnais synthétique exécuté hors du bac à sable d'exécution restreint de l'outil peut créer les pages. Un essai de lecture de `about:policies` via Playwright rencontre des erreurs internes Juggler (`SimpleChannel` redéclaré), puis reproduit le refus natif d'AUS après environ 30 secondes : Firefox **PID 9440**, code de sortie Windows **2147483651**. Ce test d'inspection n'est pas ajouté à la CI.

Toutes les exécutions de navigateur restent soumises aux frontières du projet, à son environnement synthétique et à `MOZ_DISABLE_NONLOCAL_CONNECTIONS=1`. Aucun réglage de permission système ni de bac à sable Firefox n'a été modifié pour les faire passer.

### Politique retenue et vérification effective

Mozilla décrit [DisableSystemAddonUpdate](https://firefox-admin-docs.mozilla.org/reference/policies/disablesystemaddonupdate/) séparément de `DisableAppUpdate`. La [documentation des extensions système](https://firefox-source-docs.mozilla.org/toolkit/mozapps/extensions/addon-manager/SystemAddons.html) décrit leur manifeste AUS, dont le chemin contient `/update/3/SystemAddons/`.

Le code livré avec le Firefox installé de Playwright 1.56.0 a été examiné en lecture seule : `Policies.sys.mjs` interdit la fonctionnalité `SysAddonUpdate` ; `AddonManager.sys.mjs` consulte cette interdiction avant de déclencher les mises à jour des extensions système. Aucun fichier du navigateur installé n'a été modifié.

La correction ajoute uniquement `DisableSystemAddonUpdate: true` au JSON éphémère généré par `tests/support/sandbox.cjs`. Les politiques existantes, l'URL de mise à jour applicative locale, l'écriture exclusive, le contrôle de chemin et les frontières réseau sont conservés.

Deux vérifications complètent l'inspection du code :

1. Une capture native de `about:policies`, produite avec un profil jetable et la politique synthétique, affiche dans **Active** les deux valeurs `DisableAppUpdate: true`, `DisableSystemAddonUpdate: true`, ainsi que l'URL applicative locale. Cette lecture utilise la capture native de Firefox, sans dépendre de l'évaluation de la page par Juggler.
2. Une comparaison de deux laboratoires redirige **uniquement dans ces profils de diagnostic** `extensions.systemAddon.update.url` vers leur serveur local. Chaque observation dure 40 secondes après navigation. Sans la nouvelle politique, le serveur reçoit une requête `/system-addons.xml` ; avec elle, aucune requête vers ce manifeste. Les deux navigateurs restent utilisables et quittent normalement. Les autres réglages sont identiques ; aucune connexion distante n'est autorisée pour ce contrôle.

L'effet sur ce mécanisme est donc démontré. Le journal Linux initial ne fournit toutefois pas le chemin complet de la requête AUS ni la pile de son initiateur : l'identification de ce mécanisme comme initiateur exact de l'incident Linux reste une inférence étayée, pas une preuve de pile d'appel. L'élimination de toutes les instabilités Firefox/Linux n'est pas établie.

### Tests ajoutés et résultats exécutés

Les tests d'isolation vérifient la nouvelle politique dans le fichier autonome et dans celui du serveur synthétique, le maintien du garde natif et le refus explicite d'AUS par le routage. Un nouveau test UI tente AUS puis une autre origine externe, vérifie leur interception et prouve qu'une navigation locale reste possible. Il s'ajoute aux scénarios existants, sans les remplacer.

Le lanceur accepte `--retries=0`, sans accepter de valeur supérieure. `--firefox-diagnostics` active facultativement l'observateur de processus/protocole existant, exclusivement avec `--project=firefox`. Un test vérifie le refus d'une augmentation des reprises et de l'application de cet observateur à Chromium. La configuration Playwright, les reprises CI par défaut et les dépendances restent inchangées.

Environnement local : Windows 10.0.19045, Node 22.23.2, Playwright 1.56.0, Firefox du cache `firefox-1495`. Les suites complètes ci-dessous utilisent toutes **zéro reprise automatique**.

| Vérification | Résultat réellement observé |
| --- | --- |
| Diagnostic minimal après correction | **3/3 réussis**, PID Firefox 22104, sortie normale. |
| Firefox complet, première validation, observateur actif | **75/75 réussis au premier essai**, PID 4024, sortie normale ; avant l'ajout du nouveau test UI. |
| Firefox complet avec le nouveau test, observateur actif | **75/76 réussis**, **1 échec du planning**, aucune reprise. PID 22684 puis 18936 après remplacement du worker ; sorties normales, aucun arrêt fatal réseau dans les événements collectés. |
| Firefox complet répété, sans observateur | **76/76 réussis au premier essai**, aucune reprise. |
| Isolation complète après les derniers ajouts | **58/58 réussis**, aucun ignoré. Une première exécution précédant le dernier ajout avait réussi 57/57. |
| Unitaires dans le harnais isolé | **30/30 réussis** ; avertissement Node de type de module déjà existant, sans échec. |
| API dans le harnais isolé | **10/10 réussis**. |
| Chromium, nouveau test UI de refus réseau | **1/1 réussi au premier essai**, aucune reprise. La suite Chromium complète n'a pas été relancée pour cette intervention ciblée. |
| Contrôle natif négatif après correction | Refus fatal attendu d'une connexion vers l'adresse de documentation `192.0.2.1`, avec les deux politiques actives et le garde à 1 ; code natif 2147483651. L'assertion de refus réussit. |
| Comparaison du manifeste local et capture des politiques | Comparaison réussie ; les deux politiques sont visibles actives dans la capture native. |
| Préparation et vérification du contexte Linux `--e1` | Réussies : 186 fichiers, 347 dépendances locales contrôlées, aucune donnée de production copiée. **Ce n'est pas une exécution Linux.** |
| `release:check` | Réussi : 0.17.50, 49 notes, draft cohérent et historique conservé. |
| `release:ready` | **Refus attendu** `E_RELEASE_NOT_READY`. Aucun contournement. |
| Revue finale | Diff complet et statut examinés ; encodage, `node --check` des cinq fichiers de code modifiés, `git diff --check` et contrôle strict des chemins réussis. Aucun résultat de test, profil, donnée réelle ou secret ajouté au diff. |

L'échec intermédiaire concerne `tests/ui/planning.spec.js:207` : après le clic sur la sauvegarde, le statut reste `Edition de "Session admin test".` au lieu de `Session modifiee.` pendant 10 secondes. La trace contient la création POST mais aucune modification PATCH. Le navigateur continue les scénarios suivants ; aucun message fatal réseau n'est enregistré. La capture montre toujours le formulaire et les deux sessions. Un clic pendant le défilement animé du formulaire est une piste, mais sa cause n'est pas confirmée. Aucun changement du planning, délai, reprise automatique, assertion ou permission n'a été introduit pour masquer ce résultat. Le succès de l'exécution suivante ne l'efface pas.

Les deux suites complètes entièrement réussies ne constituent pas une preuve de stabilité absolue : sur trois exécutions, une comporte cet échec distinct. La cause du premier incident Linux reste inconnue. Linux n'est pas disponible ici : WSL n'est pas installé et aucun moteur Docker n'est accessible ; aucune installation ni nouvelle exécution GitHub Actions n'a été déclenchée. La validation complète Firefox/Linux de la révision corrigée reste nécessaire avant fusion.

Diagnostics ignorés par Git : `test-results/cartehesta-test-9zUMAc` et `cartehesta-test-HExW5z` (création de page Windows), `cartehesta-test-ik02bp` (reproduction AUS), `cartehesta-test-D1wmgn` (minimal corrigé), `cartehesta-test-VRmccv` (75/75), `cartehesta-test-2PVqFl` (75/76 et trace planning), `cartehesta-test-FCkqkQ` (76/76), `cartehesta-test-r5JVfk` (unitaires), `cartehesta-test-c6yfOm` (API), `firefox-isolation-final.tap` et `firefox-system-addon-ab.json`. Les profils natifs jetables `cartehesta-test-52cCaD` (capture), `cartehesta-test-V6Kfg3` (refus natif), `cartehesta-test-U0Mtmj` et `cartehesta-test-RccX1c` (comparaison) se trouvent uniquement sous le répertoire temporaire système. Aucun de ces profils, journaux ou résultats n'est destiné au commit.

### Ajustement après la contre-revue Firefox

R-3 : le nouveau test UI est renommé « le routage Playwright bloque les deux URL externes testées puis permet une navigation locale ». Seul son intitulé change : il vérifie le routage de deux navigations, sans prétendre exercer le mécanisme natif des extensions système ni toutes les origines externes. Sa logique reste identique. Les remarques R-1 et R-2 restent des points de validation avant publication ; cet ajustement ne les déclare pas levées. Les limites et l'échec intermédiaire du planning restent conservés ci-dessus.

Avant le commit Firefox autorisé, les dernières vérifications locales réussissent : 30 tests unitaires, 58 tests d'isolation et les trois scénarios UI d'isolation sous chacun des deux navigateurs, sans reprise. Syntaxe, encodage, chemins indexés et cohérence de version sont vérifiés ; `release:ready` conserve son refus attendu. Les journaux de cette dernière passe restent dans `test-results/firefox-precommit-*.tap`, ignorés par Git. Cette passe ciblée prépare une nouvelle validation Linux complète ; elle ne préjuge pas de son résultat.
