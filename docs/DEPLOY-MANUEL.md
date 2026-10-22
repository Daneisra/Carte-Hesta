# Deploy après CI et interventions manuelles

Un push sur main déclenche la CI complète, puis Deploy automatiquement uniquement après sa réussite. CI utilise des données synthétiques et aucun secret de production. Les interventions exceptionnelles restent possibles par workflow_dispatch sur main avec confirmation DEPLOY CARTE HESTA et références explicites.

## Paramètres GitHub exacts

Environnement : cartehesta-production, limité à main, sans Required reviewers pour les mises à jour ordinaires. Les secrets restent dans cet environnement, jamais dans CI ou un workflow de PR. Les restrictions de branche sont conservées.

| Type | Nom | Valeur à fournir |
| --- | --- | --- |
| Secret | CARTE_DEPLOY_SSH_KEY | Nouvelle clé privée Ed25519 dédiée au compte cartehesta-deploy ; jamais une clé personnelle existante |
| Secret protégé pour intégrité | CARTE_DEPLOY_KNOWN_HOSTS | Entrée known_hosts exacte, vérifiée à partir de la clé d'hôte déjà approuvée ; aucune acceptation automatique de clé |
| Variable | CARTE_DEPLOY_HOST | Hôte SSH vérifié, IPv4 ou nom DNS |
| Variable | CARTE_DEPLOY_PORT | Port SSH, 22 par défaut |

GITHUB_TOKEN est fourni automatiquement : contents:read et actions:read seulement. Aucun PAT supplémentaire, SESSION_SECRET, secret Discord ou fichier .env n'est nécessaire dans GitHub. La clé SSH ne donne accès ni aux autres applications ni aux secrets du VPS.

## Installation serveur à autoriser séparément

Créer le compte cartehesta-deploy avec mot de passe verrouillé, sans groupe privilégié ni clé interactive. Son unique clé autorisée doit utiliser restrict et la commande forcée /usr/bin/python3 -I -B /usr/local/libexec/cartehesta/receive-deploy.py. Aucun shell général, SFTP, SCP, PTY, agent ou port forwarding n'est autorisé par cette clé. Les fichiers authorized_keys et scripts doivent être contrôlés par root, sans écriture du compte de transport. Vérifier aussi la configuration SSH effective du compte ; ne pas lui donner d'autres clés ou modes de connexion.

Installer après revue des empreintes :

- ops/receive-deploy.py vers /usr/local/libexec/cartehesta/receive-deploy.py, root:root, non modifiable par cartehesta-deploy.
- ops/deploy-code.py vers /usr/local/sbin/cartehesta-deploy-reviewed, root:root, exécutable uniquement via le sudo ciblé.
- /srv/cartehesta-incoming privé mode 0700 appartenant au compte de transport, hors app/public/data.
- Une règle sudo NOPASSWD limitée à /usr/local/sbin/cartehesta-deploy-reviewed. Aucune permission sudo sur Python général, shell, systemctl, rsync, copie, Git ou PM2. Le contrôleur valide strictement tous ses arguments et n'exécute aucun shell.

Vérifier les chemins root, app/public non modifiables par le compte applicatif, Node 22 dédié et pm2-cartehesta.service avant installation. Installer aussi une copie revue du vérificateur et de ses dépendances de code dans /usr/local/lib/cartehesta-release-verifier, root:root, non modifiable par les comptes applicatif et de transport. Cette copie est figée hors de app/public et ne peut jamais être mise à jour par Deploy. Un changement de politique de release nécessite une mise à jour opérateur distincte. Aucun code du candidat n'est exécuté comme root. Le backend reste exécuté sous son compte applicatif.

Le transport dédié est installé et son premier essai GitHub Actions a réussi. Les commandes de cette section documentent le provisionnement, à ne pas répéter sans nécessité et autorisation. Ne jamais utiliser ssh-keyscan seul comme preuve d'identité d'hôte. Ne rien copier depuis les secrets applicatifs vers GitHub.

## Déroulement du workflow

1. workflow_run accepte uniquement CI isolated security réussie, event push, branche main, dépôt et source Daneisra/Carte-Hesta. Le SHA doit encore correspondre à main. PR, forks, CI manuelles, diagnostics API et validations incomplètes sont refusés. Les déploiements sont sérialisés, sans annulation d'une activation en cours.
2. Téléchargement de l'artefact immuable du run exact, vérification obligatoire du SHA-256 ZIP fourni par GitHub, extraction bornée puis vérification du manifeste et de chaque fichier. Le manifeste provient de cet artefact, jamais d'une ancienne recette. En dispatch manuel, son empreinte doit aussi correspondre à l'empreinte fournie. Les données, médias, sessions, secrets et journaux sont exclus. Aucun rebuild de substitution.
3. Nouvelle vérification de main et de la CI avant transport SSH strict avec clé d'hôte épinglée. La commande forcée reçoit uniquement un flux borné et des références validées. Elle crée un nouveau ticket privé, conserve le tar et refuse liens, traversées, doublons et tailles excessives. Aucun retry automatique.
4. Le contrôleur root prend un verrou exclusif, recopie dans une capsule privée et vérifie le manifeste avec la copie de confiance figée hors de app/public. Il ferme la gate publique, arrête seulement pm2-cartehesta.service, remplace ensemble app/public et démarre le service. Les données et les permissions existantes restent en place ; les fichiers ops reçus ne remplacent jamais automatiquement Nginx ou PM2.
5. La référence before.private.json décrit exactement le code présent avant cette opération. Le candidat est comparé au manifeste vérifié, puis aux empreintes de son installation. Santé privée bornée : Node 22, service dédié, ports loopback, TLS, refus sensibles, isolation des API, chemins médias et Range. Le contrôle de santé root provient du script systemd installé hors du candidat.
6. En automatique, la gate précédemment présente est restaurée après validation. Un site volontairement fermé reste fermé. En manuel, reopen=false conserve une maintenance de recette. Le mécanisme systemd et son verrou commun restent compatibles.
7. En cas d'échec, une seule restauration du code antérieur est tentée et comparée au reçu immédiat. Si ce code et ses contrôles privés puis extérieurs sont sains, l'autorisation publique préservée est restaurée. Le workflow signale néanmoins l'échec du candidat. Si le rollback ou les contrôles extérieurs échouent, la commande restreinte maintenance ferme uniquement cette gate et le site reste à 503. Pas de boucle de déploiement, ni restauration de données. Une coupure SSH demande l'inspection du reçu avant toute nouvelle tentative.

## Interventions et limites

Le compte, la clé dédiée et le vérificateur figé sont conservés. Les changements de contrôleur root nécessitent une installation opérateur vérifiée, hors Deploy. Aucun cookie, identifiant de média privé ou secret applicatif ne va dans les logs Actions. Un run échoué reste visible même après retour à une version saine ; une nouvelle tentative exige une intervention explicite ou un nouveau changement validé par CI.

Le rollback ne restaure jamais un store, une session, un média, un secret ou une ancienne configuration par-dessus l'état courant. Un verrou métier ou une erreur de transaction demande un diagnostic explicite, pas un déverrouillage automatique.

Après redémarrage du VPS, /run reste éphémère et l'absence de gate maintient HTTP 503. La restauration vérifiée après arrêt normal est installée et décrite dans [REDEMARRAGE.md](REDEMARRAGE.md). Deploy ne modifie jamais implicitement ces deux fichiers root.

Références : [environnements et protection GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
