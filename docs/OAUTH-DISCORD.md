# OAuth Discord et sessions

Les routes restent /auth/session, /auth/discord/login, /auth/discord/callback et /auth/logout. Nginx transmet l'URI originale et le cookie sans cache, en conservant le préfixe /auth. La redirection doit correspondre exactement à l'URI HTTPS approuvée dans Discord Developer Portal.

Les valeurs SESSION_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI et les éventuels tokens administratifs restent dans un stockage privé. Le fichier optionnel est chargé uniquement par CARTE_ENV_FILE, hors code/public/data/media/logs, en mode 0600. Aucune découverte implicite de .env. Les variables du processus ont priorité. La syntaxe est KEY=value sans guillemets ni interpolation ; CARTE_* et NODE_OPTIONS ne sont pas autorisés dans ce fichier.

La clé de signature doit avoir au moins 32 octets ; aucune valeur de secours. Une configuration partielle ou invalide refuse les opérations protégées. Ne pas régénérer les clés pendant une migration sans décision explicite : conserver les valeurs approuvées évite d'invalider implicitement les sessions existantes.

Les comptes et rôles proviennent de data/private/users.json ; les sessions signées résident dans data/private/sessions.json. Le cookie map_session est HttpOnly, SameSite=Lax, avec Secure en production HTTPS. Le backend ne renouvelle pas la session lors des seuls contrôles SSE. Les autorisations sont rechargées depuis les comptes persistés.

DISCORD_ADMIN_IDS n'accorde plus automatiquement le rôle administrateur. Aucun modérateur Discord ne devient administrateur de Carte Hesta. Les administrateurs existants sont conservés ; les MJ sont limités aux groupes explicitement affectés. Le bootstrap explicite tools/storage.js est réservé à une installation réellement vierge sans utilisateur et ne fait pas partie d'une migration de comptes existants.

Les tests automatisés OAuth utilisent uniquement le faux serveur Discord du harnais isolé : aucun login, secret ou profil réel n'est consulté. Les opérations suivent le [Runbook](OPS-RUNBOOK.md), sans réutiliser de cookie réel dans la CI.
