// Source canonique des notes produit. Les dates historiques proviennent du code importé.
// La date de la version candidate doit être reconfirmée avant fusion et déploiement.
export const CHANGELOG = [
    {
        "version": "0.17.50",
        "status": "released",
        "date": "2026-11-08",
        "title": "Version 0.17.50 - Communauté Hesta et historique fiable",
        "summary": "Communauté : accès et soutien regroupés sur Hesta Hub, accueil simplifié, liens harmonisés entre les projets et affichage adapté aux petits écrans. Versions et changelog : numéro cohérent sur les pages, pieds de page et métadonnées ; chargement plus fiable, pagination au-delà de 50 notes et repli local en cas d’indisponibilité du service. Historique : toutes les anciennes notes et leurs variantes sont conservées ; seule la dernière correction d’une version est affichée publiquement. Administration : saisies et messages de sauvegarde préservés lors des chargements concurrents ; rejet explicite des nouveaux textes trop longs sans modifier les anciennes notes. Sécurité et fiabilité : accès aux médias vérifié selon la visibilité de tous leurs contenus de référence ; contrôles de provenance et d’intégrité des livraisons, attente de disponibilité au redémarrage et récupération du service après un échec."
    },
    {
        "date": "2026-09-25",
        "title": "Version 0.17.49 - Acces au systeme PA",
        "summary": "L accueil propose un lien direct vers l outil Systeme PA / Armures d100 dans la navigation principale.",
        "version": "0.17.49"
    },
    {
        "date": "2026-06-01",
        "title": "Version 0.17.48 - Page Geek Unchained",
        "summary": "Une page publique dediee a la Geek Unchained presente Le Monde d Hesta, ses tables JDR, la carte interactive et les infos pratiques de convention.",
        "version": "0.17.48"
    },
    {
        "date": "2026-05-26",
        "title": "Version 0.17.47 - Admin groupes et tests API",
        "summary": "L admin carte permet de mettre a jour tous les groupes JDR en une action et les tests API partageant des fichiers persistants sont serialises.",
        "version": "0.17.47"
    },
    {
        "date": "2026-05-26",
        "title": "Version 0.17.46 - Publication version et changelog",
        "summary": "La configuration servie aligne les versions affichees et publie correctement les patch notes du planning multi-date sur l accueil et le changelog.",
        "version": "0.17.46"
    },
    {
        "date": "2026-05-26",
        "title": "Version 0.17.45 - Planning multi-date",
        "summary": "Les joueurs et admins peuvent enregistrer plusieurs dates en une fois ; les syntheses hebdomadaires obsoletes ont ete retirees du planning et de l admin carte.",
        "version": "0.17.45"
    },
    {
        "date": "2026-05-20",
        "title": "Version 0.17.44 - Planning date et sessions",
        "summary": "Le planning permet de cliquer une date pour ajouter une disponibilite, retire l ancien affichage semaine type, prolonge la session Discord et harmonise les footers.",
        "version": "0.17.44"
    },
    {
        "date": "2026-05-18",
        "title": "Version 0.17.43 - Admin planning",
        "summary": "La page planning gagne une interface admin pour creer, modifier et supprimer les sessions candidates directement depuis l agenda.",
        "version": "0.17.43"
    },
    {
        "date": "2026-05-18",
        "title": "Version 0.17.42 - Disponibilites datees planning",
        "summary": "Le planning permet aux utilisateurs de declarer des disponibilites a une date et une heure precises, avec affichage direct dans l agenda.",
        "version": "0.17.42"
    },
    {
        "date": "2026-05-18",
        "title": "Version 0.17.41 - Conflits agenda planning",
        "summary": "Chaque session du planning affiche les conflits, le signal de disponibilite hebdomadaire et les meilleurs creneaux possibles.",
        "version": "0.17.41"
    },
    {
        "date": "2026-05-18",
        "title": "Version 0.17.40 - Reponses agenda planning",
        "summary": "Les sessions du planning peuvent etre creees cote API, modifiees par admin et recevoir les reponses des joueurs par date precise.",
        "version": "0.17.40"
    },
    {
        "date": "2026-05-17",
        "title": "Version 0.17.39 - Agenda planning date",
        "summary": "Le planning gagne un agenda mensuel date, une API de lecture des sessions candidates et une persistance JSON dediee.",
        "version": "0.17.39"
    },
    {
        "date": "2026-05-14",
        "title": "Version 0.17.38 - Roadmap agenda reel",
        "summary": "La roadmap distingue le socle de disponibilites du futur rework agenda/calendrier date avec sessions candidates.",
        "version": "0.17.38"
    },
    {
        "date": "2026-05-14",
        "title": "Version 0.17.37 - Vue mois planning",
        "summary": "Le planning propose une bascule semaine/mois lisible sur desktop et mobile, avec projection des disponibilites sur les prochaines semaines.",
        "version": "0.17.37"
    },
    {
        "date": "2026-05-14",
        "title": "Version 0.17.36 - Statuts planning",
        "summary": "Les disponibilites du planning gerent maintenant les statuts disponible, incertain, indisponible et non renseigne.",
        "version": "0.17.36"
    },
    {
        "date": "2026-05-14",
        "title": "Version 0.17.35 - Synthese planning",
        "summary": "Le planning affiche les meilleurs creneaux communs avec une synthese globale et des scopes de groupes JDR quand ils existent.",
        "version": "0.17.35"
    },
    {
        "date": "2026-05-14",
        "title": "Version 0.17.34 - Disponibilites planning",
        "summary": "La page planning permet aux utilisateurs connectes de cocher leurs disponibilites par jour et creneau puis de les enregistrer dans leur profil.",
        "version": "0.17.34"
    },
    {
        "date": "2026-05-14",
        "title": "Version 0.17.33 - Page planning JDR",
        "summary": "Une page dediee /planning/ pose le socle UI pour organiser les sessions et preparer les disponibilites des groupes.",
        "version": "0.17.33"
    },
    {
        "date": "2026-05-14",
        "title": "Version 0.17.32 - CI Playwright optimisee",
        "summary": "La CI utilise npm ci, cache les dependances et navigateurs, separe les projets Playwright et conserve les diagnostics en echec.",
        "version": "0.17.32"
    },
    {
        "date": "2026-05-13",
        "title": "Version 0.17.31 - Encodage UTF-8 verrouille",
        "summary": "Les conventions d encodage sont explicites via EditorConfig et le lint UTF-8 controle les fichiers texte du projet.",
        "version": "0.17.31"
    },
    {
        "date": "2026-05-13",
        "title": "Version 0.17.30 - Nettoyage legacy tests",
        "summary": "L ancien placeholder de test unitaire est retire, les compatibilites serveur utiles restent couvertes.",
        "version": "0.17.30"
    },
    {
        "date": "2026-05-13",
        "title": "Version 0.17.29 - Annotations modularisees",
        "summary": "La normalisation des annotations sort de UiController avec tests unitaires dedies.",
        "version": "0.17.29"
    },
    {
        "date": "2026-05-13",
        "title": "Version 0.17.28 - Personnages modularises",
        "summary": "La normalisation des personnages utilisateur sort de UiController avec tests unitaires dedies.",
        "version": "0.17.28"
    },
    {
        "date": "2026-05-13",
        "title": "Version 0.17.27 - Personnalisation profil modularisee",
        "summary": "La normalisation du profil utilisateur sort de UiController pour isoler le modele de donnees.",
        "version": "0.17.27"
    },
    {
        "date": "2026-05-13",
        "title": "Version 0.17.26 - Disponibilites modularisees",
        "summary": "Le modele des disponibilites sort de UiController pour reduire les dependances UI.",
        "version": "0.17.26"
    },
    {
        "date": "2026-05-12",
        "title": "Version 0.17.25 - Patch notes accueil automatises",
        "summary": "L'accueil affiche les dernieres versions depuis l API changelog avec fallback local.",
        "version": "0.17.25"
    },
    {
        "date": "2026-05-12",
        "title": "Version 0.17.24 - Changelog produit prioritaire",
        "summary": "La page changelog est accessible depuis la navigation accueil et affiche les versions produit avant l historique Git brut.",
        "version": "0.17.24"
    },
    {
        "date": "2026-05-12",
        "title": "Version 0.17.23 - Page changelog dediee",
        "summary": "Une page publique /changelog/ regroupe les versions et changements recents de la carte.",
        "version": "0.17.23"
    },
    {
        "date": "2026-05-12",
        "title": "Version 0.17.22 - Compteur Discord fiabilise",
        "summary": "Le compteur Discord de l'accueil affiche un etat live ou un fallback manuel clair quand l API Discord est indisponible.",
        "version": "0.17.22"
    },
    {
        "date": "2026-05-11",
        "title": "Version 0.17.21 - Telechargement assets fiabilise",
        "summary": "La generation d archive assets corrige le fallback tar, harmonise les exclusions et expose la taille de l archive au telechargement.",
        "version": "0.17.21"
    },
    {
        "date": "2026-05-11",
        "title": "Version 0.17.20 - Session Discord prolongee",
        "summary": "La verification de session renouvelle le cookie Discord actif afin de maintenir la connexion pendant l usage regulier.",
        "version": "0.17.20"
    },
    {
        "date": "2026-05-11",
        "title": "Version 0.17.19 - QA responsive mobile",
        "summary": "Une suite Playwright dediee verifie les pages publiques et l editeur de lieu sur telephone, avec corrections du formulaire long mobile.",
        "version": "0.17.19"
    },
    {
        "date": "2026-05-09",
        "title": "Version 0.17.18 - Admin mobile consolide",
        "summary": "Les panneaux admin accueil, chronologie et carte sont mieux adaptes au telephone avec plein ecran, scroll vertical et controles tactiles.",
        "version": "0.17.18"
    },
    {
        "date": "2026-05-09",
        "title": "Version 0.17.17 - CI chronologie Firefox stabilisee",
        "summary": "La navigation rapide par periode de la chronologie cible le bon groupe de maniere deterministe dans les tests Firefox.",
        "version": "0.17.17"
    },
    {
        "date": "2026-05-09",
        "title": "Version 0.17.16 - Chronologie mobile consolidee",
        "summary": "La chronologie mobile gagne un header compact, une navigation tactile, des filtres pleine largeur et une lightbox mieux bornee.",
        "version": "0.17.16"
    },
    {
        "date": "2026-05-09",
        "title": "Version 0.17.15 - Accueil mobile consolide",
        "summary": "L accueil mobile gagne une navigation tactile, des CTA homogenes et des blocs de soutien lisibles sans debordement horizontal.",
        "version": "0.17.15"
    },
    {
        "date": "2026-05-09",
        "title": "Version 0.17.14 - Premiere tranche mobile carte",
        "summary": "La carte gagne une barre d outils mobile compacte, un flux temps reel mieux place et un panneau lieu prioritaire sur telephone.",
        "version": "0.17.14"
    },
    {
        "date": "2026-05-09",
        "title": "Version 0.17.13 - Suppression annotations persistante",
        "summary": "La suppression des annotations cible correctement l id serveur, persiste le JSON et synchronise la carte en temps reel.",
        "version": "0.17.13"
    },
    {
        "date": "2026-05-08",
        "title": "Version 0.17.12 - Detail chronologie elargi",
        "summary": "Le detail des evenements de chronologie utilise mieux la largeur du panneau apres l ajout de l agrandissement d image.",
        "version": "0.17.12"
    },
    {
        "date": "2026-05-07",
        "title": "Version 0.17.11 - Images chronologie agrandies",
        "summary": "Les images de detail de la frise peuvent etre ouvertes en grand dans une modale plein ecran accessible.",
        "version": "0.17.11"
    },
    {
        "date": "2026-05-07",
        "title": "Version 0.17.10 - Fix theme clair carte",
        "summary": "Le bouton theme clair de la barre d outil reapplique correctement le theme, son etat accessible et la preference locale.",
        "version": "0.17.10"
    },
    {
        "date": "2026-05-06",
        "title": "Version 0.17.9 - Reordre des blocs narratifs",
        "summary": "L editeur de lieux permet de reordonner lore, historique, quetes et sections longues par glisser-deposer ou boutons accessibles.",
        "version": "0.17.9"
    },
    {
        "date": "2026-05-06",
        "title": "Version 0.17.8 - Peinture ephemere carte",
        "summary": "Un outil local permet de tracer puis effacer des schemas temporaires sur la carte sans creer d annotation persistante.",
        "version": "0.17.8"
    },
    {
        "date": "2026-05-06",
        "title": "Version 0.17.7 - Navigation libre carte",
        "summary": "La carte n est plus verrouillee aux bords afin de rendre les lieux proches des limites plus faciles a atteindre et selectionner.",
        "version": "0.17.7"
    },
    {
        "date": "2026-05-06",
        "title": "Version 0.17.6 - Polish chronologie",
        "summary": "La frise gagne en densite, en lisibilite sur les longues periodes et en transitions de lecture.",
        "version": "0.17.6"
    },
    {
        "date": "2026-05-06",
        "title": "Version 0.17.5 - Ordre chronologique public",
        "summary": "La chronologie publique et les tests UI utilisent desormais le meme ordre d evenements trie par annee.",
        "version": "0.17.5"
    },
    {
        "date": "2026-05-06",
        "title": "Version 0.17.4 - Upload images chronologie",
        "summary": "L admin chronologie permet d uploader directement une image d evenement et de remplir automatiquement l URL media.",
        "version": "0.17.4"
    },
    {
        "date": "2026-05-06",
        "title": "Version 0.17.3 - Documentation projet",
        "summary": "Documentation restructuree, version projet alignee et preparation d un suivi version/changelog a chaque commit.",
        "version": "0.17.3"
    },
    {
        "date": "2026-02-28",
        "title": "Nouvel accueil en ligne",
        "summary": "Nouvelle page d'accueil avec session, communaute, flux live, lieux mis en avant et patch notes."
    }
];
