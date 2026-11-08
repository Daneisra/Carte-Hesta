# Diagnostics des validations CI Linux

Modification locale préparée sur `fix/versioning-changelog-01750`, à partir de
`e4d1839f5662076c113858d915184fc63f07ae2e`. Aucun commit, push, déclenchement
GitHub Actions ou accès VPS pendant cette intervention. La version reste
`0.17.50`, `draft`, avec une date vide.

## Diagnostic et dépendances

Auparavant, une seule étape Bash exécutait Chromium puis Firefox. Avec `-e`,
un échec Chromium empêchait Firefox de démarrer. La configuration Playwright
autorisait une reprise en CI. Seul l'artefact de code, après `release:ready`,
était conservé : un refus attendu du draft empêchait donc toute archive.

Le job unique `Full Linux validation`, ses permissions `contents: read`, son
runner, ses installations et ses contrôles préalables sont conservés. Après
les contrôles d'isolation et l'installation des navigateurs :

1. L'API, Chromium et Firefox ont des étapes identifiables.
2. Firefox reçoit explicitement `--retries=0`. Le parent vérifie aussi dans le
   rapport réel la configuration zéro reprise, l'absence de tentative `retry > 0`
   et de test flaky. Un rapport absent ou vide échoue ; aucune reprise n'est ajoutée.
3. Les étapes navigateur utilisent `!cancelled()` et exigent le succès des
   prérequis isolation et installation. Firefox peut donc démarrer après un
   échec Chromium ou API ; un échec d'isolation empêche son démarrage.
4. `release:ready` garde son refus obligatoire sur main et les PR ciblant main,
   y compris une Draft PR. Il peut s'exécuter après un échec fonctionnel si
   l'outillage et le contrôle strict des chemins ont réussi.
5. La collecte et l'upload des diagnostics restent possibles après un échec de
   test ou `E_RELEASE_NOT_READY`. Aucun `continue-on-error` n'est ajouté.
6. Le résumé du job distingue les résultats API, Chromium, Firefox et publication,
   puis les réussites immédiates, flaky et tentatives supplémentaires de chaque
   rapport. Chromium conserve sa politique existante ; une étape verte après
   reprise n'est pas présentée comme une stabilité au premier essai.
7. Construction et conservation du candidat de code gardent leur condition
   implicite de succès global. Un échec fonctionnel, de collecte ou de préparation
   à la publication interdit ce candidat.

Ces conditions suivent les [règles des expressions GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions)
et la [syntaxe des workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
Une annulation, une expiration du job ou un arrêt brutal avant la fin du parent
peut empêcher la collecte. Aucun repli vers une archive brute n'est prévu.

## Sélection et traitement des diagnostics

Le lanceur reconnaît `--ci-diagnostics` uniquement avec un projet explicite
`api`, `chromium` ou `firefox`. Cette option interne n'est pas transmise à
Playwright. Le parent vérifie le laboratoire synthétique existant, conserve un
reçu en mémoire, puis produit un manifeste SHA-256 des résultats sélectionnés et
un pointeur exclusif `test-results/ci-<projet>.json`. Le reçu survit à la suppression
normale du laboratoire réussi ; ni son marqueur ni son jeton ne sont exportés.

La collecte vérifie ce manifeste et les empreintes, refuse liens symboliques,
liens physiques, traversées et fichiers altérés. Les pointeurs ne permettent pas
de parcourir les autres résultats locaux. Ils ne sont pas une attestation contre
du code de PR malveillant ; les contrôles de confiance du déploiement restent
distincts. Le job ne reçoit aucun secret de production.

Seuls les chemins suivants peuvent être sélectionnés dans les résultats du
laboratoire vérifié :

- `results.json` : projection des résultats, erreurs, tentatives et compteurs,
  sans environnement, stdout brut, configuration complète ou pièces jointes embarquées ;
- `isolation-summary.json` : code de sortie, arguments, noms des journaux de
  violations, arrêt des processus et état de conservation du laboratoire ;
- `artifacts/<scénario>/synthetic-home-config.json` : diagnostic synthétique du formulaire ;
- `artifacts/<scénario>/test-failed-<nombre>.png`, `video.webm`, `trace.zip`.

Pas de dossier HTML brut, profil navigateur, stockage applicatif, sauvegarde,
copie de code, fichier d'environnement ou journal brut. Une trace brute peut
contenir des cookies même dans ces tests synthétiques : elle n'est pas uploadée.
Le collecteur reconstruit les ZIP : événements structurés trace/réseau/piles,
réponses JSON et images de pages reconnues. Il écarte sources embarquées, corps
HTML/JS/CSS et contenus binaires inconnus. Les appels cookies/état d'authentification
sont retirés ; champs sensibles, en-têtes, paramètres OAuth et valeurs connues
d'authentification sont masqués, y compris lorsqu'ils apparaissent dans une erreur
ou une assertion. Les chemins absolus sont masqués. Les limites de taille et les
noms des membres ZIP sont vérifiés ; doublons et traversées sont refusés.

Les images/vidéos ne subissent pas d'analyse OCR : leur sûreté repose sur leur
provenance exclusivement synthétique, leurs signatures et la sélection fermée.
Aucun scénario utilisant des comptes réels ou des données privées ne doit être
introduit dans ces laboratoires. Le traitement n'est pas un outil général
d'anonymisation de traces de production.

Le résultat est un répertoire neuf `$RUNNER_TEMP/cartehesta-test-diagnostics`,
avec un manifeste d'export et un résumé. Une erreur de collecte interdit l'upload
de ce répertoire, même partiellement rempli. L'artefact s'appelle
`cartehesta-tests-<SHA>-<tentative>` et expire après **deux jours**. Les fichiers
cachés sont exclus et une sélection vide côté upload est une erreur. L'action
[upload-artifact reste épinglée](https://github.com/actions/upload-artifact/tree/ea165f8d65b6e75b540449e92b4886f43607fa02).
Tous les résultats locaux restent sous `test-results/`, déjà ignoré par Git.

Les ZIP sont volontairement réduits : les événements et captures servent au
diagnostic, mais la relecture des snapshots DOM peut être incomplète sans les
ressources supprimées. Les SHA-1 internes des ressources conservent leurs noms
pour les références de la trace ; le manifeste SHA-256 de l'export décrit les
octets effectivement nettoyés. Le format ZIP utilisé provient du Playwright
déjà verrouillé à 1.56.0 ; aucune dépendance n'est modifiée.

## Provenance et sécurité de publication

`verify-ci-run.cjs` exige désormais les **deux** noms d'étape navigateur en succès.
L'ancien nom combiné n'est pas accepté comme substitut. Les exigences dépôt,
workflow, push/main, SHA égal au main courant, job unique complet, publication
autorisée, cardinalités, identité/digest/taille/expiration de l'artefact de code
restent identiques. L'artefact de diagnostic ne peut pas servir de candidat.
`deploy.yml`, les scripts de transport, les permissions et les mécanismes VPS
ne sont pas modifiés.

La préparation du contexte Linux inclut le nouveau collecteur. Son vérificateur
statique reconnaît aussi un import navigateur déjà présent dans les tests R-3 :
une URL littérale `/js/...`, figurant dans la liste statique publique, à l'intérieur
du premier callback inline de `page.evaluate`. Il n'exécute pas cet import et
vérifie la présence du fichier. Imports absolus Node, URL externes, fichiers
privés et imports dans les arguments évalués côté Node restent refusés.

`MOZ_DISABLE_NONLOCAL_CONNECTIONS=1`, les politiques Firefox synthétiques,
le garde Node, le proxy, les restrictions de navigation et le stockage jetable
restent inchangés. Ni timeout, assertion fonctionnelle, version de dépendance
ni test du planning ou de la galerie n'est modifié.

## Première phase de vérifications, avant contre-revue du collecteur

Les résultats ci-dessous proviennent de Windows, Node 22.23.2 / Playwright 1.56.0.
Ils ne constituent pas une validation Linux ou un upload réel GitHub.

| Contrôle exécuté | Résultat |
| --- | --- |
| Déploiement/provenance/workflow/contexte, dernière suite complète | 101 réussites, 3 ignorés natifs Windows, aucun échec |
| Contexte et collecte après le dernier resserrement AST | 13/13 réussis |
| Collecte, ajout des ZIP malformés/doublons | 10/10 réussis |
| Isolation complète | 58/58 réussis |
| Unitaires via le lanceur | 34/34 réussis ; avertissement Node de type de module déjà existant |
| API avec le mode de diagnostics réel | 11/11 réussis |
| Chromium, scénario de routage externe/local | 1/1 réussi, zéro reprise |
| Firefox ciblé, concurrence/rejet administratif/routage | 6/6 réussis, zéro reprise |
| Échec Firefox contrôlé, ancienne copie du module administrateur | 1 échec attendu sur la perte du brouillon, zéro reprise, capture/vidéo/ZIP/JSON produits |
| Collecte sur ces trois laboratoires réels | 10 fichiers sélectionnés exportés, ZIP valides ; aucune des 7 valeurs synthétiques d'authentification recherchées retrouvée dans les exports textuels |
| Syntaxe JavaScript, encodage UTF-8 sans BOM, diff et chemins stricts | Réussis |
| Cohérence de version et historique | Réussie : 0.17.50, 49 notes, draft |
| Publication `release:ready` | Refus attendu `E_RELEASE_NOT_READY`, non contourné |

La première passe complète de tests de déploiement avait 98 réussites, 1 échec et
3 ignorés : le vérificateur statique refusait l'import navigateur du test R-3
déjà committé. Après sa correction ciblée, une passe réussit 100 tests avec
3 ignorés, puis la dernière passe incluant le test ZIP supplémentaire réussit
101 tests avec 3 ignorés. Les trois contrôles
natifs ignorés nécessitent Linux (systemd, nginx et rsync).

L'échec contrôlé ne modifie que la copie de `adminHome.js` d'un laboratoire
vérifié, à partir des octets du commit `6bdc146`. La branche garde le correctif
de concurrence. Son script et sa trace sont sous `test-results/`, jamais dans Git.
Cette expérience valide la collecte d'un échec, pas la cause du flaky CI nº 11.
Les premiers essais de nettoyage ont révélé des valeurs synthétiques résiduelles
dans les assertions et les paramètres OAuth ; le nettoyage transversal et les
tests correspondants ont été ajoutés avant la dernière collecte. Aucun export
n'a été envoyé sur GitHub.

Journaux ignorés de cette phase : `test-results/ci-diagnostics-*.tap`. Son export
`test-results/ci-sanitized-diagnostics-final/` présentait encore les défauts B-1/R-1
constatés ensuite ; il ne doit pas servir de référence corrigée. Les anciennes
sorties de mise au point locales ne sont pas destinées à l'upload. Le mode CI utilise un checkout
neuf ; ses pointeurs exclusifs refusent une seconde exportation du même projet
dans le même checkout au lieu de réutiliser silencieusement un ancien rapport.

## Corrections après contre-revue du collecteur : B-1, R-1 et R-3

B-1 était confirmé : le motif `[A-Za-z]:[\\/]` trouvait `p:/` dans `http://`.
`scrub()` consomme maintenant les URL HTTP/HTTPS avant les alternatives de chemins
locaux et impose une frontière au préfixe de lecteur Windows. Les vrais chemins
Windows, UNC et chemins locaux `/home/`, `/Users/`, `/tmp/` restent masqués.
Le masquage OAuth est effectué avant cette protection des URL. Les tests vérifient
les valeurs complètes conservées, pas seulement l'absence de secrets :

- `http://127.0.0.1:41234/api/admin/home-config?x=1` inchangé ;
- `https://example.test/path` inchangé ;
- `renderAdminSiteConfig@http://127.0.0.1:41234/js/ui/adminHome.js:450:12` inchangé ;
- l'URL de callback garde son adresse et ses paramètres non sensibles, tandis que
  `code` et `state` deviennent `[redacted]` ;
- les chemins locaux fictifs Windows, UNC et Unix deviennent `<absolute-path>`.

R-1 était également confirmé : traiter `session` et `state` comme des secrets
universels détruisait les données fonctionnelles. `sensitive()`, `scrub()` et
`secretValues()` propagent maintenant le contexte des champs. Un objet de session
fonctionnelle est parcouru récursivement : identifiant, titre, état et code métier
restent lisibles ; `access_token`, mot de passe et autres champs sensibles restent
masqués. `params.state: 'visible'` est préservé. `state`, `code` et `session` sont
masqués dans les contextes explicites OAuth/authentification et les paramètres
de requête, y compris les objets JSON sérialisés et imbriqués. Les paramètres
sensibles des URL restent masqués quel que soit le chemin de la requête.

Les valeurs d'authentification reconnues sont aussi recherchées dans les erreurs
et assertions sans contexte. La découverte distingue les valeurs privées des
métadonnées : le domaine d'un cookie ne devient pas un secret à remplacer dans
toutes les adresses réseau. Ce dernier cas a été détecté sur le véritable export
pendant cette correction, puis ajouté au test représentatif. Les valeurs connues
de huit caractères ou plus peuvent être remplacées transversalement ; les valeurs
plus courtes restent masquées dans leurs champs/contextes reconnus, sans promesse
de les reconnaître dans un texte libre arbitraire.

R-3 : `collect()` écrit toujours les trois lignes de projet dans son résumé.
Un rapport manquant est signalé « rapport absent (attendu) », avec des compteurs
inconnus, jamais une réussite implicite. En mode manuel API seul, le workflow
transmet uniquement ce mode au collecteur : Chromium et Firefox apparaissent
« non exécuté (non attendu) ». Ce signal ne change aucun contrôle de publication.
Les tests couvrent l'absence du pointeur et l'absence du rapport malgré un
manifeste synthétique valide, ainsi que le mode API seul.

Les seuls fichiers réajustés pendant cette contre-revue sont le collecteur,
ses tests, l'indication de mode dans l'étape de collecte du workflow, ce rapport
et son renvoi dans l'audit. Les onze fichiers de la première phase sont conservés.

### Confidentialité et utilité effectivement vérifiées

Un export de fixture représentative place **six valeurs distinctes** dans un
cookie, un en-tête d'autorisation, les paramètres OAuth `code` et `state`, un
jeton dans une réponse JSON et un message d'erreur marqué `Authorization`.
Les cinq premières sont également copiées dans une assertion sans contexte :
aucune ne subsiste dans les rapports ou les événements/ressources du ZIP exporté.
La fixture affirme simultanément l'intégrité d'un objet `session` du planning,
du paramètre Playwright `state: 'visible'`, d'une URL publique, de la pile
`adminHome.js:450:12`, de la méthode `PATCH` et du statut `400`. Ce sont des
événements construits synthétiquement, pas une observation d'un nouveau test
fonctionnel du planning. Aucun test ou code du planning/galerie n'est modifié.

Le collecteur a aussi été relancé sur les résultats réels des trois laboratoires
synthétiques conservés, dont l'échec Firefox contrôlé `cartehesta-test-PRooME` :
**10 fichiers** exportés dans `test-results/ci-sanitized-diagnostics-review-v2/`.
Le ZIP Firefox est valide et contient **44 requêtes** (`GET` ; 42 statuts 200 et
2 statuts 302), ainsi que **20 références** à des modules JavaScript publics avec
leurs lignes. Exemples effectivement relus :

    http://127.0.0.1:61147/api/admin/home-config
    renderAdminSiteConfig@http://127.0.0.1:61147/js/ui/adminHome.js:314:44

Les **sept valeurs d'authentification synthétiques recherchées dans la trace
brute** sont absentes de l'ensemble des exports textuels, y compris le ZIP et
les rapports. La conservation des URL et des modules est vérifiée séparément.
Les images/vidéos proviennent exclusivement de ces laboratoires vérifiés avec
les fixtures du dépôt ; elles ne sont pas nettoyées par OCR. Aucune donnée de
production n'a été utilisée et aucun export n'a été envoyé sur GitHub.

### Lecture réelle dans Trace Viewer

La trace corrigée a été ouverte avec le **Trace Viewer local de Playwright 1.56.0**
dans Chromium natif sous Windows, avec un nouveau profil synthétique, le garde
Node existant, le proxy local de refus et le routage réseau du projet. Le garde
Firefox reste à 1 dans l'environnement ; aucune politique n'est modifiée.
Le premier essai a expiré sur un sélecteur `.tree-item` absent du viewer. Après
correction de ce seul script expérimental ignoré par Git vers le rôle `treeitem`,
deux lectures réussissent. Il ne s'agit pas de reprises d'un test applicatif CI.

Observations réelles, avec captures examinées :

- 21 actions affichées, chronologie et film fixe de captures visibles ;
- onglet Network : 44 requêtes ; détail d'un `GET /api/admin/home-config` avec
  URL complète, `200 OK` et `cookie: [redacted]` ;
- onglet Errors : échec `toHaveValue` lisible et fichier/ligne du test conservés ;
- snapshot DOM de l'accueil lisible, mais sans les feuilles de style ni certaines
  images supprimées : la restitution visuelle est partielle ;
- onglet Source vide, car les fichiers source embarqués ne sont pas exportés ;
- aucune erreur JavaScript du viewer, aucun refus du routage, aucune violation
  du garde de frontière pendant les lectures réussies.

Les pièces jointes vidéo/JSON sont conservées dans les fichiers sélectionnés,
mais leur ouverture depuis l'onglet Attachments du ZIP n'est pas validée : leurs
ressources brutes embarquées ne sont pas toutes conservées dans le ZIP. Il ne
s'agit donc pas d'une relecture intégrale de tous les éléments de la trace.

Script de reproduction local ignoré : `test-results/ci-collector-trace-viewer.cjs`.
Dernier résultat et captures : `test-results/ci-collector-viewer-v3/`. Ces pièces
de vérification locale ne font pas partie de la sélection d'upload CI. Pour une
lecture manuelle, utiliser le CLI local avec le chemin du ZIP nettoyé, suivant
la [documentation Trace Viewer](https://playwright.dev/docs/trace-viewer), sans
fournir une trace brute à un service externe.

### Dernières validations de cette contre-revue, sous Windows

| Contrôle exécuté | Résultat |
| --- | --- |
| Tests du collecteur, positifs/négatifs et export représentatif | 14/14 réussis |
| Suite complète déploiement, provenance, workflows et contexte Linux | 105 réussis, 3 ignorés natifs Linux, aucun échec |
| Isolation complète | 58/58 réussis, aucun ignoré |
| Export réel des laboratoires conservés | 10 fichiers, ZIP valide, adresses/piles lisibles et 7 valeurs recherchées absentes |
| Trace Viewer local, vérification finale | Réussie, 21 actions/44 requêtes, zéro violation de frontière |
| Syntaxe JavaScript, encodage, diff et chemins stricts | Réussis |
| Cohérence de version / préparation à publier | 0.17.50 draft cohérent ; `E_RELEASE_NOT_READY` attendu |

Journaux : `test-results/ci-collector-review-*.tap` et
`test-results/ci-collector-trace-viewer-v3.tap`. Les politiques de reprises API et
Chromium, les dépendances, les timeouts et la sécurité de déploiement sont inchangés.
La validation GitHub Actions/Linux de cette révision reste à réaliser.

### Risques conservés : N-1, R-2, R-4 et R-6

N-1 : un chemin local intégré à une URL HTTP/HTTPS peut rester visible. Le
collecteur protège ces URL jusqu'au premier espace ou guillemet pour conserver
leur utilité diagnostique. Par exemple, avec un utilisateur entièrement fictif :

    http://127.0.0.1/?f=C:/Users/SyntheticUser/s.txt
    http://127.0.0.1/a.js:1:2)/home/runner/b

Le comportement est démontré en mémoire par la contre-revue, mais aucune source
réaliste n'a été identifiée dans l'application ni aucun cas correspondant dans
les exports réels examinés. La contre-revue n'y relève aucun marqueur
`<absolute-path>` ; aucune fuite réelle n'est démontrée. Les racines connues du
dépôt et du laboratoire sont masquées avant ce traitement, et les protections
OAuth/d'authentification restent actives. Ce risque résiduel est accepté comme
non bloquant dans le contexte actuel des laboratoires synthétiques. Une
amélioration séparée devra masquer les chemins locaux dans les paramètres d'URL
ou accolés à une référence HTTP sans détruire l'URL. Aucun changement du
collecteur n'est effectué pour N-1 dans ce lot.

R-2 : `recordRun()` dans le `finally` peut faire échouer une étape dont les tests
ont réussi (taille, lien physique, pointeur déjà présent). Collecte ou upload en
échec peut aussi bloquer le candidat sur main. C'est un refus sécurisé conservé
par décision explicite. Distinguer les résultats fonctionnels du rapport et
l'erreur de collecte/étape ; une étape rouge ne suffit pas à attribuer un défaut
au produit. Ne pas rendre ces erreurs non bloquantes pour publier.

R-4 : à la limite globale de 30 minutes, l'annulation peut empêcher l'export à
cause de `!cancelled()`. La recommandation est d'envisager ultérieurement un
timeout par étape navigateur inférieur au délai global, puis d'en vérifier
l'effet réel sur GitHub Actions. Aucun timeout n'est changé ici.

R-6 : seul Firefox impose zéro reprise. Chromium et l'API conservent leur
politique ; une suite verte après reprise peut satisfaire la provenance actuelle.
Les compteurs rendent ces reprises visibles. Une éventuelle exigence zéro flaky
pour toutes les suites demande une décision distincte ; elle n'est pas appliquée.

## Prochaine validation GitHub, après contre-revue et autorisation

1. Autoriser séparément commit puis push de la branche dédiée ; la PR nº 3 reste
   en brouillon. Aucun changement de statut/date de la version.
2. Vérifier le SHA exécuté et les étapes distinctes API, Chromium, Firefox, natives
   Linux et publication. Exiger Firefox sans aucun retry ni flaky ; lire les
   compteurs du résumé et du JSON, pas uniquement la couleur du job.
3. Constater `E_RELEASE_NOT_READY` obligatoire. Le job reste rouge ; aucune
   construction/conservation du candidat déployable n'est autorisée.
4. Télécharger l'artefact `cartehesta-tests-...` dans les deux jours, y compris
   après refus du draft ou échec fonctionnel. Vérifier sélection, manifeste,
   absence de données d'authentification et utilité des ZIP/captures/JSON.
5. Si un navigateur échoue, conserver les diagnostics et demander la décision
   suivante avant toute correction fonctionnelle. Les incidents versioning CI nº 11,
   sauvegarde/suppression planning et galerie restent **distincts et ouverts**.
6. Confirmer les conditions réelles Actions et les trois contrôles natifs sur
   Ubuntu. La suite Firefox Linux complète et l'upload/expiration GitHub ne sont
   pas exécutés ici. La relecture partielle dans Trace Viewer est validée sous
   Windows ci-dessus et reste à vérifier sur les futurs échecs Linux. Le parseur
   YAML et les tests de conditions sont exécutés localement ; `actionlint` n'est
   pas installé et n'est pas déclaré exécuté.

Avant publication ultérieure : finaliser la note et sa date réelle, obtenir
une CI complète verte et la validation Firefox/Linux sans reprise, puis suivre
la procédure existante de publication/VPS. Le présent changement ne publie rien.
