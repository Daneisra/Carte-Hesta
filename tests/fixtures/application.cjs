// Entirely synthetic records. Never import JSON from the application's assets/.
const DISCORD_ID = '900000000000000001';
const ADMIN_ID = `discord:${DISCORD_ID}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAYAAAA/xl1SAAABAUlEQVR4nO3SIQEAIBDAwI9EFJLQ30GMCU6cn9isfS5Upg7gbwYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIGJGVAUgYkZUBSBiRlQFIP8FZZle//p54AAAAASUVORK5CYII=', 'base64');

const locations = {
    'Continent de test A': [
        {
            name: 'Port des Tests', type: 'Town', x: 4100, y: 3000,
            description: 'Port entièrement fictif du laboratoire de test.',
            tags: ['port', 'test'], images: ['assets/images/test-port.png'],
            videos: [{ url: 'https://youtu.be/testVideo01', title: 'Vidéo fictive' }],
            audio: '', history: ['Fondation fictive du port.'], lore: ['Récit synthétique.'],
            quests: ['Quête synthétique'], pnjs: [],
            questEvents: [{ id: 'quest-fixture', questId: 'quest-test', status: 'active', note: 'Événement fictif.', locationName: 'Port des Tests' }]
        },
        {
            name: 'Fort du Laboratoire', type: 'Fortress', x: 4500, y: 3400,
            description: 'Fort fictif sans quête.', tags: ['test', 'fort'],
            images: [], videos: [], audio: '', history: [], lore: [], quests: [], pnjs: []
        }
    ],
    'Continent de test B': [
        {
            name: 'Village des Fixtures', type: 'Village', x: 3200, y: 2700,
            description: 'Village fictif.', tags: ['village'],
            images: [], videos: [], audio: '', history: [], lore: [], quests: [], pnjs: []
        }
    ]
};

const types = Object.fromEntries(['default', 'Town', 'Fortress', 'Village'].map(name => [name, {
    icon: 'assets/icons/test-icon.png', zoom: 100
}]));

const users = [
    { id: ADMIN_ID, provider: 'discord', discordId: DISCORD_ID, username: 'Test User', role: 'admin', groups: ['group-test-a'], characters: [], apiTokens: [] },
    { id: 'manual:test-player', provider: 'manual', username: 'Joueur fictif', role: 'user', groups: ['group-test-a'], characters: [], apiTokens: ['synthetic-player-token'] }
];

const groups = [
    { id: 'group-test-a', name: 'Groupe fictif A', color: '#123456', x: 4200, y: 3100 },
    { id: 'group-test-b', name: 'Groupe fictif B', color: '#654321', x: null, y: null }
];

const timeline = {
    title: 'Chronologie du laboratoire', subtitle: 'Événements entièrement fictifs.',
    entries: [
        { id: 'test-founding', year: 100, title: 'Fondation fictive', summary: 'Fondation du Port des Tests.', content: 'Récit de test.', era: 'Ère de test A', period: 'Période de test A', tags: ['port'], locationNames: ['Port des Tests'], imageUrl: '/assets/images/Frise/test-founding.png', visible: true },
        { id: 'test-expedition', year: 200, title: 'Expédition fictive', summary: 'Expédition au village.', content: 'Autre récit de test.', era: 'Ère de test B', period: 'Période de test B', tags: ['village'], locationNames: ['Village des Fixtures'], imageUrl: '/assets/images/Frise/test-expedition.png', visible: true },
        { id: 'test-return', year: 250, title: 'Retour fictif', summary: 'Retour au Port des Tests.', content: 'Fin du récit de test.', era: 'Ère de test B', period: 'Période de test B', tags: ['port'], locationNames: ['Port des Tests'], visible: true }
    ]
};

const siteConfig = {
    version: '0.17.49',
    home: { title: 'Accueil du laboratoire de test' },
    community: { proof: { mode: 'manual', guildId: '', manualCount: 0 } },
    changelog: [
        { date: '2026-01-02', title: 'Changement synthétique A', summary: 'Premier scénario de test.' },
        { date: '2026-01-01', title: 'Changement synthétique B', summary: 'Deuxième scénario de test.' }
    ]
};

// Explicit editorial decisions for fictitious places, never a migration default.
const { emptyPermissions, categories } = require('../../server/security/schema');
const { fingerprint, locationKey } = require('../../server/security/access');
const permissions = emptyPermissions();
for (const [continent, places] of Object.entries(locations)) for (const place of places) permissions.resources.locations[locationKey(continent, place.name)] = {
    rule: { scope: 'PUBLIC' }, fingerprint: fingerprint('locations', place),
    categories: Object.fromEntries(categories.filter(category => !['lore', 'pnjs', 'nobleFamilies', 'instances'].includes(category)).map(category => [category, { scope: 'PUBLIC' }]))
};
const stores = {
    'permissions.json': permissions,
    'users.json': users, 'groups.json': groups, 'locations.json': locations,
    'types.json': types, 'timeline.json': timeline, 'site-config.json': siteConfig,
    'planning.json': { sessions: [] }, 'annotations.json': [], 'logs/sessions.json': []
};

module.exports = { DISCORD_ID, ADMIN_ID, PNG, locations, types, users, groups, timeline, siteConfig, stores };
