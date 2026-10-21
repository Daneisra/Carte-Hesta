# Consignes de contribution assistée

Le dépôt officiel est Daneisra/Carte-Hesta, branche main. Voir [Architecture](ARCHITECTURE.md) et [Contribution](CONTRIBUTING.md).

- Préserver les pages HTML indépendantes et le backend Node 22 sans chargement implicite de .env.
- Vérifier les permissions côté serveur, refuser par défaut et utiliser la même normalisation pour les fichiers et leurs autorisations.
- Conserver les administrateurs globaux, les MJ explicitement affectés et les appartenances vérifiées.
- Ne jamais importer de données réelles, médias privés, secrets ou sauvegardes comme sources ou fixtures.
- Ne pas réinitialiser un JSON corrompu, réparer silencieusement un store ou contourner un bail écrivain.
- Exécuter les tests pertinents avec le harnais isolé ; Linux, Chromium et Firefox sont nécessaires à un candidat de production.
- Un push ne vaut pas autorisation de déploiement. Les opérations externes nécessitent une autorisation explicite.

Voir [Déploiement](DEPLOYMENT-VPS.md) et [Exploitation](OPS-RUNBOOK.md).
