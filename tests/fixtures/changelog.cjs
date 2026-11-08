// Données intégralement synthétiques ; aucune lecture ni copie de la production.
// 47 versions + 3 notes non numérotées = 50 notes persistantes.
function representativeSiteConfig() {
    const numbered = Array.from({ length: 47 }, (_, index) => {
        const patch = 49 - index;
        return {
            date: '2026-01-15',
            title: `Version 0.17.${patch} - Note synthétique ${patch}`,
            summary: `Texte de configuration entièrement fictif pour le scénario ${patch}.`
        };
    });
    numbered.find(entry => entry.title.startsWith('Version 0.17.47 ')).summary = ' Ancien texte long fictif '.repeat(180);
    numbered.find(entry => entry.title.startsWith('Version 0.17.46 ')).title += 'X'.repeat(220);
    return {
        version: '0.17.49',
        home: { title: 'Accueil synthétique représentatif', retained: 'Métadonnée fictive conservée' },
        changelog: [...numbered,
            // Identifiant public déjà dans le code ; date et résumé entièrement fictifs.
            { date: '2026-01-03', title: 'Nouvel accueil en ligne', summary: 'Texte non numéroté fictif A.' },
            { date: '2026-01-02', title: 'Archive synthétique B', summary: 'Texte non numéroté fictif B.' },
            { date: '2026-01-01', title: '', summary: 'Archive synthétique C sans titre : aucun titre ne doit être persisté par normalisation.' }
        ]
    };
}
const correctedNote = config => ({
    ...config.changelog.find(entry => entry.title.startsWith('Version 0.17.48 ')),
    summary: 'Texte synthétique corrigé pour la version 0.17.48.'
});
const draftNote = { version: '0.17.50', status: 'draft', date: '', title: 'Version 0.17.50 - Préparation synthétique', summary: 'Date de livraison fictive non déterminée.' };
module.exports = { representativeSiteConfig, correctedNote, draftNote };
