# Tests UI isolés

Les tests Playwright utilisent uniquement les stores synthétiques, ports, processus et profils de navigateur créés par le harnais. Aucun serveur existant ni fichier .env réel n'est réutilisé ; les connexions distantes sont bloquées.

    node tools/runIsolatedTests.js --project=chromium
    node tools/runIsolatedTests.js --project=firefox

Les deux navigateurs sont obligatoires en CI Linux. Les parcours couvrent les pages, formulaires, permissions et médias. Voir [Contribution](../../docs/CONTRIBUTING.md) pour les dépendances et les autres suites.
