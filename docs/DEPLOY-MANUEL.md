# Deploy manuel contrôlé

Le workflow est préparé et testé, mais reste administrativement désactivé avec deux if:false. Aucun push ni changement de visibilité ne l'active. CI reste automatique sur push et PR, avec uniquement des données synthétiques.

## Paramètres GitHub exacts

Environnement : cartehesta-production, limité à main et avec approbation humaine lorsque le forfait le permet. Les secrets doivent appartenir à cet environnement, jamais au job CI ou à un workflow de PR.

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

Ces opérations et la génération de la clé réelle ne sont pas effectuées pendant la préparation locale. Ne jamais utiliser ssh-keyscan seul comme preuve d'identité d'hôte. Ne rien copier depuis les secrets applicatifs vers GitHub.

## Déroulement du workflow

1. Dispatch manuel sur main, confirmation DEPLOY CARTE HESTA, révision complète, run CI complet sur push/main pour cette révision et SHA-256 du manifeste approuvé. Les runs de PR, diagnostics API, artefacts expirés/ambigus et validations incomplètes sont refusés.
2. Téléchargement de l'artefact CI exact, vérification de chaque fichier puis préparation d'un tar de code app/public/ops. Les données, médias, sessions, secrets et journaux sont exclus. Aucun rebuild de substitution au candidat testé.
3. Après approbation de l'environnement, transport SSH strict avec clé d'hôte épinglée. La commande forcée reçoit uniquement un flux borné et des références validées. Elle crée un nouveau ticket privé à chaque tentative explicite, conserve le tar, vérifie son SHA-256 et extrait uniquement des fichiers/répertoires ordinaires ; liens, traversées, doublons et tailles excessives sont refusés. Aucun écrasement ni retry automatique.
4. Le contrôleur root prend un verrou exclusif, recopie dans une capsule privée et vérifie le manifeste avec la copie de confiance figée hors de app/public. Il ferme la gate publique, arrête seulement pm2-cartehesta.service, remplace ensemble app/public et démarre le service. Les données et les permissions existantes restent en place ; les fichiers ops reçus ne remplacent jamais automatiquement Nginx ou PM2.
5. Santé locale bornée. En cas d'échec, rollback automatique du code, conservation des échecs et maintien HTTP 503. Les reçus et empreintes du code permettent aussi un seul rollback explicite après échec extérieur, avec refus si le code a changé entre-temps.
6. reopen=false par défaut : maintenance conservée pour le premier essai et sa recette privée. Avec autorisation explicite, reopen=true restitue uniquement une gate déjà présente avant le déploiement ; un site initialement fermé ne devient jamais public implicitement.
7. Vérification extérieure TLS, santé, accueil et refus sensibles ; un échec après activation déclenche le rollback code seul et conserve la maintenance. Une coupure SSH ne provoque aucun redéploiement automatique ; si le résultat est inconnu, examiner le reçu serveur avant toute nouvelle action.

## Premier essai et limites

Après autorisation VPS, installer les accès dédiés et tester la commande forcée avec des données fictives avant activation du workflow. Le premier déploiement reste manuel, avec reopen=false. Réutiliser la recette privée existante pour Discord, médias privés, Range, publications et permissions ; aucun cookie ou identifiant de média privé ne va dans les logs Actions. Une nouvelle autorisation permettra la réouverture et le retrait des deux verrous de workflow. Aucun déclencheur push/workflow_run de déploiement n'est ajouté.

Le rollback ne restaure jamais un store, une session, un média, un secret ou une ancienne configuration par-dessus l'état courant. Un verrou métier ou une erreur de transaction demande un diagnostic explicite, pas un déverrouillage automatique.

Après redémarrage du VPS, /run reste éphémère et l'absence de gate maintient HTTP 503. Suivre le [Runbook](OPS-RUNBOOK.md) pour une réouverture contrôlée ; ne jamais ajouter un touch inconditionnel au boot.

Références : [environnements et protection GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
