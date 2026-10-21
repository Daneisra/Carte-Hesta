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

Le gate strict vérifie les chemins indexés : node tools/auditTrackedPaths.js --strict. Il refuse tout store, média historique, secret ou artefact interdit. Les dépendances du contexte Linux sont contrôlées par tools/prepareFirefoxLinuxContext.js --e1.

Le build de production passe par tools/deployment.js package avec trois arguments explicites : source absolue, nouvelle destination absolue, révision complète. Ne jamais copier globalement le dépôt vers app/public. Les nouveaux tests de déploiement exigent Python 3 ; Nginx et rsync sont vérifiés dans la CI Linux.

## Cycle normal

Changement ciblé, tests pertinents, revue du diff indexé, commit puis push vers main déclenchent CI. Un candidat n'est déployable qu'après validation Linux complète sur cette même révision. Deploy reste désactivé jusqu'à autorisation et configuration séparées. Les bugs et propositions utilisent les Issues de Carte-Hesta ; la communauté reste sur le Portail.

Les JSON de production, sessions et médias ne sont jamais des sources ni des fixtures. Ne pas récupérer ces fichiers dans Git, y compris pour changer une version. Les archives historiques et les sauvegardes sont conservées sans modification.
