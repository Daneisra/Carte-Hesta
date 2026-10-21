# Architecture actuelle

Carte Hesta combine des pages HTML indépendantes, des modules ES et une API Node 22 CommonJS utilisant un routeur maison. Le code public est construit selon une liste positive ; il ne contient aucun store réel.

| Racine de production | Usage |
| --- | --- |
| /srv/cartehesta/app | Backend et modules partagés, immuables pendant l'exécution |
| /srv/cartehesta/public | Artefact frontend vérifié, sans données réelles |
| /srv/cartehesta/data | Stores content/private, permissions, sessions, transactions et verrous |
| /srv/cartehesta/media-private | Médias vérifiés, y compris ceux publiables ; accès contrôlé par Node |
| /etc/cartehesta | Configuration privée et secrets, jamais servis |
| /var/log/cartehesta | Journaux applicatifs privés |

Nginx applique la gate de maintenance puis transmet les requêtes à Node sur 127.0.0.1:4173. Il ne sert pas directement le dépôt, les stores ou les médias privés. Les chemins historiques /assets/*.json autorisés sont des projections API filtrées.

Les lieux, chronologie, planning, groupes et annotations sont filtrés côté serveur selon la session et le registre de permissions. PUBLIC exige une qualification explicite ; les scopes inconnus échouent de manière sûre. Un média partagé exige l'accès à tous ses contenus parents. La résolution du fichier et l'autorisation utilisent la même représentation canonique du chemin.

Les écritures utilisent le stockage atomique, un bail d'écrivain unique et un journal de transaction ; une erreur JSON n'entraîne aucune réinitialisation. Discord assure l'authentification ; le rôle applicatif et les appartenances stockées assurent l'autorisation. Les sessions utilisent map_session et restent hors du code.

Les grands PNG/MP3 sont diffusés par blocs vérifiés, avec backpressure et HTTP Range, sans chargement intégral en mémoire. Les limites d'upload et d'archives restent distinctes.

La CI construit un candidat contenant uniquement app/public et des propositions ops. Les données, médias, secrets et journaux sont provisionnés séparément et ne doivent jamais être recopiés depuis Git. Voir [Gestion des données](DATA-MANAGEMENT.md), [Contribution](CONTRIBUTING.md) et [Déploiement](DEPLOYMENT-VPS.md).
