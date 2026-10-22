# Signaler une vulnérabilité

Utiliser le [signalement privé GitHub](https://github.com/Daneisra/Carte-Hesta/security/advisories/new). Ne créer aucune Issue publique contenant un secret, cookie, identifiant personnel, export JSON ou détail permettant une exploitation.

Pour les bugs ordinaires et les propositions : [Issues](https://github.com/Daneisra/Carte-Hesta/issues/new/choose). Pour la communauté : [Portail Hesta](https://hesta.dannytech.fr/).

Les données et médias de production ne font pas partie du dépôt. Deploy accepte uniquement une CI complète réussie sur push/main du dépôt officiel, avec artefact immuable vérifié et accès SSH dédié. Les secrets restent dans l’environnement limité à main, sans Required reviewers répétitifs. Les PR, forks et CI manuelles ne déclenchent pas Deploy.
