# Diagnostic du rejet administratif du changelog

Branche : `fix/versioning-changelog-01750`, HEAD de départ `6bdc146c98da5ee44b57e744798aadec4921935c`. Intervention locale sans commit, push, nouvelle CI ou accès VPS. Version `0.17.50` toujours en draft, date vide.

## Conclusion et niveau de certitude

**État avant le commit local autorisé : R-2 et R-3 du correctif de concurrence sont corrigés et validés localement.** Ils ne sont plus des défauts ouverts. Les limites de validation Linux et les incidents distincts ci-dessous restent ouverts.

**Un défaut de synchronisation du formulaire est démontré et corrigé : une lecture commencée avant une saisie pouvait remplacer cette saisie à son retour.** Un scénario contrôlé reproduit exactement le symptôme HTTP 200 : le titre de 201 caractères disparaît avant l'envoi, le PATCH ne contient plus que les anciennes notes valides et le serveur répond 200.

**L'attribution de ce mécanisme au flaky de la CI nº 11 reste non prouvée.** Le test historique n'effectue pas le rechargement utilisé par l'expérience contrôlée ; son journal ne contient ni le PATCH ni la trace binaire. Six répétitions instrumentées du scénario historique et son passage dans la suite complète Windows n'ont pas reproduit spontanément cet échec. Les diagnostics peuvent aussi modifier le timing observé. Le correctif porte sur le défaut effectivement reproduit, sans prétendre identifier rétroactivement l'événement Linux manquant.

**L'incident de la CI nº 11 reste ouvert.** Les incidents Firefox du planning et de la galerie média restent distincts, sans cause commune démontrée avec ce défaut de chargement.

## Parcours vérifié

1. `HomeAdminPanel.open()` déclenche `fetchAdminSiteConfig()` ; le bouton de rechargement appelle la même fonction. Sans configuration, les champs sont désactivés par `syncAdminHomeEditor()` jusqu'à leur hydratation. Avec une configuration déjà chargée, la saisie reste possible pendant une nouvelle lecture.
2. Avant correction, chaque retour de lecture affectait le modèle, effaçait `adminSiteConfigDirty` et exécutait `renderAdminSiteConfig()`, qui réécrivait notamment la propriété `value` du champ changelog.
3. Le bouton Enregistrer appelle `collectAdminSiteConfigDraft()` puis envoie son résultat en PATCH à `/api/admin/home-config`.
4. Le serveur valide le schéma, puis `applyConfigPatch()` et `appendChangelog()` dans la transaction. Une identité historique inchangée est conservée ; une nouvelle variante est contrôlée avant écriture. Un dépassement produit `ChangelogValidationError`, traduit en HTTP 400 par la route.
5. Aucune erreur de validation serveur n'a été reproduite : les titres de 201 caractères et les résumés de 4 001 caractères effectivement transmis sont refusés. Les tests d'isolation vérifient également les anciens textes longs et l'absence de modification des octets persistants après rejet.

## Expérience contrôlée avant/après

Le nouveau test `tests/ui/home-config-concurrency.spec.js` charge d'abord le vrai formulaire synthétique. Il déclenche ensuite un rechargement et retient sa réponse GET par une promesse. Il saisit le titre de 201 caractères puis libère cette réponse. Aucun délai arbitraire, serveur externe ou PATCH simulé n'est utilisé.

| Observation | Avant correction | Après correction |
| --- | --- | --- |
| Champ avant libération du GET | Anciennes notes + titre de 201 caractères | Identique |
| Champ après traitement du GET | Anciennes notes seulement | Saisie conservée |
| Longueurs des titres du PATCH unique | `[24, 24]` | `[24, 24, 201]` |
| Réponse du PATCH correspondant | HTTP 200 | HTTP 400, `E_CHANGELOG_TITLE_TOO_LONG` |
| Historique après le rejet | Pas de rejet : envoi valide | Inchangé |

La première exécution contrôlée échoue sur `200 != 400`. Son diagnostic observe une seconde écriture de `value` dont la pile passe par `renderAdminSiteConfig()` et le retour de lecture administrateur. La requête et sa réponse portent le même identifiant d'observation ; aucun autre PATCH n'est présent. Ce résultat établit le cas B pour cet entrelacement, pas le cas A ni une mauvaise corrélation du scénario historique.

Preuves locales ignorées par Git : `test-results/versioning-controlled-before.json`, `test-results/versioning-controlled-after.json`, `test-results/versioning-fixed-evidence.json`. La trace de l'échec contrôlé est conservée sous `test-results/cartehesta-test-QWoG6K/artifacts/`. Le journal CI nº 11 et son extrait restent sous `test-results/ci-linux-11/` ; aucun artefact binaire GitHub n'était disponible.

## Correction et diagnostics

`js/ui/adminHome.js` compte les révisions de saisie uniquement en mémoire. Chaque lecture mémorise la révision au départ. Si elle a changé, son retour ne remplace ni le formulaire ni son modèle. Le message de conservation apparaît seulement si aucun statut n'est déjà affiché. Une sauvegarde en cours ou une erreur affichée a priorité sur une lecture antérieure, même sans nouvelle saisie pendant cette lecture. Le contrôle couvre la lecture API, le repli et leurs erreurs. Un rechargement explicitement demandé après une saisie continue de remplir le formulaire s'il n'y a ni nouvelle saisie ni sauvegarde entre-temps. Le compteur reste utile si une sauvegarde a déjà effacé le simple indicateur Dirty.

Le test historique attend maintenant le contenu chargé attendu, vérifie la présence de la saisie, contrôle la note de 201 caractères dans le PATCH puis obtient la réponse par `request.response()`. Il vérifie l'identité de la requête, HTTP 400, le code d'erreur, le texte conservé et l'historique après l'opération. Il n'ignore pas un PATCH incorrect pour attendre silencieusement une autre requête.

`tests/support/homeConfigDiagnostics.cjs` ne fonctionne que dans un laboratoire possédant son marqueur vérifié. Il conserve des JSON synthétiques avec : configurations avant/après, événements du champ, valeur avant clic, corps des PATCH et longueurs Unicode des titres, identifiants requête/réponse, statut et corps de réponse, puis état final du formulaire. Aucun en-tête, cookie ou jeton n'est enregistré. L'observation des écritures de propriété avec leur pile est réservée au scénario contrôlé ; elle n'est pas activée dans le test historique.

Les JSON sont enregistrés sous le dossier d'artefacts propre au test et attachés au rapport Playwright sous le nom `synthetic-home-config`. Le lanceur les copie dans `test-results/cartehesta-test-*/`, ignoré par Git. Les traces restent conservées lors d'un échec selon la configuration existante.

## Validation locale de la première phase de diagnostic

Environnement : Windows 10.0.19045, Node 22.23.2, Playwright 1.56.0. Toutes les exécutions Firefox et Chromium de cette intervention utilisent `--retries=0`.

| Vérification | Résultat |
| --- | --- |
| Scénario historique instrumenté avant correction | 6/6 réussis, un PATCH par test, titre 201 transmis et HTTP 400. Pas de reproduction spontanée. |
| Suite Firefox de référence avant correction | 75/76 réussis ; versioning réussi. Échec distinct du test de galerie `tests/ui/selection.spec.js:103` (aucune vidéo trouvée), sans correction dans cette intervention. |
| Expérience contrôlée avant correction | Échec reproduit : HTTP 200, titre absent du PATCH. Trace et diagnostic conservés. |
| Première vérification après correction | 2/2 réussis. |
| Répétitions Firefox après correction | 6 exécutions indépendantes × 2 scénarios = 12/12 réussis, aucune reprise. |
| Chromium, mêmes deux scénarios | 2/2 réussis, aucune reprise. |
| API complète | 11/11 réussis, dont quatre PATCH invalides au véritable endpoint et vérification de l'état inchangé après chacun. |
| Unitaires | 33/33 réussis : limites, historique, lectures retardées, repli et lecture normale. |
| Isolation complète | 58/58 réussis, aucun ignoré ; conservation historique et contrôles des octets persistants inclus. |
| Suite Firefox finale | **76/77 réussis, aucune reprise**. Les deux scénarios de cette intervention réussissent. Échec distinct `tests/ui/planning.spec.js:218` : le statut reste `Session modifiee.` au lieu de `Session supprimee.`. Ni le planning ni ses assertions ne sont modifiés ; aucune cause commune n'est établie. |

La suite Firefox complète n'est donc **pas validée** dans cet environnement. Ses diagnostics sont conservés sous `test-results/cartehesta-test-BNo3Dm/` et le journal `test-results/versioning-final-full.tap`. La passe de référence est sous `test-results/cartehesta-test-n1uusO/`. Les six dernières répétitions ciblées sont consignées dans `versioning-fixed-1.tap` à `versioning-fixed-6.tap` ; le dernier laboratoire est `cartehesta-test-mwBSxF`. Les API, unitaires finaux et tests Chromium se trouvent respectivement dans `cartehesta-test-SiyEnp`, `cartehesta-test-Dx0rN1` et `cartehesta-test-4llmDf`.

Les contrôles de syntaxe, d'encodage et de diff sont exécutés. `release:check` réussit et `release:ready` conserve son refus attendu pour le draft. L'avertissement Node de type de module, déjà présent auparavant, ne provoque aucun échec unitaire.

Les journaux de cette passe sont `test-results/versioning-*.tap`. Aucun test Linux n'a été exécuté ici : WSL et Docker restent indisponibles. Les protections Firefox, les permissions, les dépendances, les reprises CI et la configuration Playwright sont inchangées. `MOZ_DISABLE_NONLOCAL_CONNECTIONS=1` et les deux politiques synthétiques de mise à jour restent en place.

## Reproduction et prochaine expérience Linux

    node tools/runIsolatedTests.js --project=firefox --retries=0 '--grep=rejet explicite des nouveaux textes|un rechargement en vol'
    node tools/runIsolatedTests.js --project=chromium --retries=0 '--grep=rejet explicite des nouveaux textes|un rechargement en vol'
    node tools/runIsolatedTests.js --project=api
    node tools/runIsolatedTests.js --unit
    node --test 'tests/isolation/*.test.cjs'
    node tools/runIsolatedTests.js --project=firefox --retries=0

La première expérience obtenait HTTP 200 après perte du titre, comme l'attestent les diagnostics conservés. Le test R-3 renforcé s'arrête désormais plus tôt sur la perte du brouillon, avant d'envoyer le PATCH : c'est sa preuve principale. La comparaison décrite ci-dessous remplace uniquement le module dans un laboratoire synthétique ; aucun retour de code n'est appliqué à la branche ou à des données réelles.

Après contre-revue et autorisation, répéter les scénarios sur Linux sans reprise en conservant les JSON, le rapport et les ZIP de traces même si `release:ready` refuse le draft. Un PATCH manquant le titre orientera vers les événements/écritures du formulaire ; un PATCH contenant réellement 201 caractères avec HTTP 200 orientera vers la validation serveur ; plusieurs PATCH seront distingués par leurs objets requête et leurs identifiants. Ce contrôle reste nécessaire pour attribuer et clore précisément l'incident de la CI nº 11. Aucune collecte CI ni modification du workflow n'est réalisée ici.

## Corrections finales après contre-revue — R-2 et R-3

R-2 : le message informatif de `keepNewerEdits()` pouvait remplacer le message d'un PATCH 400 ou le statut de sauvegarde en cours. Les nouveaux tests ont reproduit les deux défauts avant correction : deux échecs sur le texte du statut, tandis que le brouillon était déjà conservé. Le correctif minimal donne priorité à une sauvegarde en cours et à un statut d'erreur ; lorsque seule une saisie plus récente justifie de conserver le formulaire, le message informatif n'est écrit que si le statut est vide. Aucun contrôle serveur n'est modifié.

Le scénario HTTP 400 suit exactement cet ordre : GET retenu, saisie invalide, véritable PATCH contenant 201 caractères, réponse HTTP 400 et message d'erreur, libération du GET, résolution complète du chargement, vérification du brouillon et du message d'erreur inchangés. Un autre scénario retient le PATCH valide, libère le GET pendant la sauvegarde, vérifie le statut et le bouton désactivé, puis laisse le serveur répondre HTTP 200 et vérifie la conservation des notes précédentes. Un troisième contrôle confirme qu'un rechargement explicitement demandé après la saisie remplace normalement le brouillon non enregistré par la configuration enregistrée.

R-3 : les tests observent la résolution de la méthode existante `HomeAdminPanel.fetchAdminSiteConfig()` par une enveloppe installée uniquement dans le navigateur synthétique. Ce signal existait avant la correction et attend aussi `response.json()`, le rendu et le bloc `finally`. Il ne dépend ni du message informatif ni d'un nouveau signal ajouté au produit. Après ce signal, le premier test compare **exactement le champ au brouillon** ; le message informatif et le PATCH sont vérifiés ensuite.

La preuve négative a été exécutée sans toucher aux fichiers de la branche : le harnais crée un laboratoire vérifié, y remplace uniquement la copie de `js/ui/adminHome.js` par les octets issus de `git show 6bdc146c98da5ee44b57e744798aadec4921935c:js/ui/adminHome.js`, reconstruit ses fichiers publics sous sa racine temporaire puis exécute le test renforcé. SHA-256 du module ancien : `b11c89fda5e60d2b41be82d16f45e5efb1e4eddf864b67dacdff549f27b05d24`. Le test échoue bien sur `toHaveValue(draft)` : la ligne de 201 caractères manque. La vérification du nouveau message n'est jamais atteinte. Le script local `test-results/versioning-r3-old-code.cjs`, le journal homonyme `.tap` et les artefacts de `cartehesta-test-GBBvnp` conservent cette expérience, tous ignorés par Git. Les deux écrasements R-2 antérieurs sont conservés dans `versioning-r2-before.tap` et `cartehesta-test-C1BMDJ`.

Les tests unitaires couvrent aussi les statuts HTTP 400 et pending quand la saisie précède le départ du GET, ainsi que le rechargement normal après saisie. L'ordre de plusieurs GET simultanés sans action locale intermédiaire reste un cas distinct ; aucune gestion générale d'ordonnancement des lectures n'est ajoutée.

Validations de cet ajustement, sous Windows, sans reprise automatique des navigateurs :

| Contrôle | Résultat exécuté |
| --- | --- |
| R-2 avant correction du statut | 2 échecs reproduits et 2 réussites ; les deux statuts de sauvegarde étaient remplacés par le message informatif. |
| R-3 avec le module du HEAD de référence, laboratoire séparé | Échec attendu sur le brouillon perdu, avant le contrôle du message ; preuve négative conservée. |
| Firefox ciblé, correction finale | **6/6 réussis**, aucune reprise : quatre scénarios de concurrence/rechargement et deux scénarios existants de sauvegarde/rejet. |
| Chromium ciblé, correction finale | **6/6 réussis**, aucune reprise. |
| Unitaires | **34/34 réussis**, y compris les priorités de statut avec ou sans nouvelle saisie après le départ du GET. |
| API complète | **11/11 réussis** ; validation serveur et rejet transactionnel inchangés. |
| Isolation complète | **58/58 réussis**, aucun ignoré ; conservation de l'historique incluse. |

Journaux : `test-results/versioning-r2-firefox-final.tap`, `versioning-r2-chromium-final.tap`, `versioning-r2-unit-final.tap`, `versioning-r2-api.tap` et `versioning-r2-isolation.tap`. Les laboratoires finaux correspondants sont `cartehesta-test-kPl5T7`, `cartehesta-test-uRla5z`, `cartehesta-test-IKmYCk` et `cartehesta-test-y1UdAH` pour les quatre premiers. Les JSON de diagnostics et les résumés d'isolation sont conservés sous `test-results/`, ignoré par Git. Syntaxe, encodage, versions et diff sont vérifiés ; `release:ready` reste refusé comme attendu pour le draft.

Pour rejouer les contrôles ciblés actuels :

    node tools/runIsolatedTests.js --project=firefox --retries=0 '--grep=rechargement en vol|lecture tardive|rechargement demandé|rejet explicite des nouveaux textes|la sauvegarde admin accueil'
    node tools/runIsolatedTests.js --project=chromium --retries=0 '--grep=rechargement en vol|lecture tardive|rechargement demandé|rejet explicite des nouveaux textes|la sauvegarde admin accueil'

La suite Firefox complète n'est pas relancée pendant cet ajustement ciblé. Les résultats et incidents de la première phase restent consignés ci-dessus. La validation Linux, l'incident de la CI nº 11 et les incidents distincts planning/galerie ne sont pas déclarés résolus. Aucun commit, changement de CI ou accès VPS n'est effectué.
