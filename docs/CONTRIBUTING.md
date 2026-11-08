# Contribution et vérifications locales

Dépôt officiel : Daneisra/Carte-Hesta, branche main. Utiliser un clone indépendant et des données exclusivement synthétiques.

## Installation

Node 22 est requis (22.23.2 dans la CI). Depuis un clone sans configuration npm privée, utiliser le lockfile :

    npm ci --ignore-scripts --no-audit --no-fund
    node node_modules/playwright/cli.js install chromium firefox

Si votre compte possède une configuration npm privée, définir NPM_CONFIG_USERCONFIG et NPM_CONFIG_GLOBALCONFIG vers deux fichiers vides distincts situés hors dépôt avant l'installation. Ne jamais importer un .env réel. Aucun service externe n'est requis par les tests.

## Vérifications

    node tools/lintEncoding.js
    node tools/runIsolatedTests.js --unit
    node tools/runIsolatedTests.js --storage
    node tools/runIsolatedTests.js --publication
    node --test tests/isolation/*.test.cjs
    node --test tests/deployment/*.test.cjs
    node tools/runIsolatedTests.js --project=api
    node tools/runIsolatedTests.js --project=chromium
    node tools/runIsolatedTests.js --project=firefox

Les lanceurs génèrent leurs stores, secrets fictifs, ports, processus et profils de navigateur. Ils refusent de réutiliser un serveur existant et bloquent les connexions distantes. Les deux navigateurs restent obligatoires dans la CI Linux. Un défaut d'outillage Windows doit être documenté, pas masqué par une exclusion.

### Diagnostic Firefox sans reprise

    node tools/runIsolatedTests.js --project=firefox --retries=0
    node tools/runIsolatedTests.js --project=firefox --retries=0 --firefox-diagnostics

La seconde commande active l'observateur de processus/protocole déjà utilisé par `tools/diagnoseFirefox.js`. Les événements, PID, sorties natives et rapports restent dans `test-results/`, ignoré par Git. Cette instrumentation est facultative ; elle ne change ni les assertions ni le résultat des méthodes Playwright. `--retries=0` peut seulement supprimer les reprises ; aucune valeur supérieure n'est autorisée par le lanceur. Les valeurs par défaut de la CI restent inchangées.

Le fichier de politiques appartient exclusivement au laboratoire temporaire. `DisableAppUpdate` et son URL locale concernent les mises à jour de Firefox ; `DisableSystemAddonUpdate` désactive séparément les mises à jour des extensions système. Ne pas installer cette politique dans un navigateur personnel ou de production. `MOZ_DISABLE_NONLOCAL_CONNECTIONS=1`, le proxy local et les refus de frontière restent obligatoires. Un refus natif fatal n'est pas un défaut à contourner par une autorisation de domaine. Le test UI de refus vérifie l'interception des navigations ; il ne remplace pas le garde natif des services internes du navigateur.

Le gate strict vérifie les chemins indexés : node tools/auditTrackedPaths.js --strict. Il refuse tout store, média historique, secret ou artefact interdit. Les dépendances du contexte Linux sont contrôlées par tools/prepareFirefoxLinuxContext.js --e1.

Le build de production passe par tools/deployment.js package avec trois arguments explicites : source absolue, nouvelle destination absolue, révision complète. Ne jamais copier globalement le dépôt vers app/public. Les nouveaux tests de déploiement exigent Python 3 ; Nginx et rsync sont vérifiés dans la CI Linux.

## Cycle normal

Préparer le changement sur une branche distincte, exécuter les tests pertinents et ouvrir une PR. Après fusion ou push sur main, la CI Linux complète valide cette révision puis Deploy utilise automatiquement son artefact exact. La CI de PR ne déploie jamais. Les déploiements sont sérialisés ; un rollback sain peut rouvrir le site et aucun échec ne déclenche une boucle de tentatives. Le dispatch manuel reste disponible pour les interventions exceptionnelles. Les bugs et propositions utilisent les Issues de Carte-Hesta ; la communauté et le support général restent sur le Portail.

Les JSON de production, sessions et médias ne sont jamais des sources ni des fixtures. Ne pas récupérer ces fichiers dans Git, y compris pour changer une version. Les archives historiques et les sauvegardes sont conservées sans modification.
