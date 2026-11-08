import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Access, fingerprint, locationKey } = require('../../server/security/access');
const fixture = require('../fixtures/application.cjs');
const { publicSiteConfig } = require('../../server/publication/projections');
function documents(config = {}) {
    return structuredClone({
        permissions: fixture.stores['permissions.json'], users: fixture.users, groups: fixture.groups,
        locations: fixture.locations, types: fixture.types, timeline: fixture.timeline, planning: [], annotations: [], 'site-config': config
    });
}
const access = config => new Access(documents(config), { role: 'guest', user: null });
const note = (version, summary, extra = {}) => ({ date: '2026-01-01', title: `Version ${version} - Synthétique`, summary, ...extra });

export const mediaVisibilityTests = [
    { name: 'media follows reordered changelog entries and keeps private fields private', run() {
        const notes = [note('0.17.4', '/assets/images/four.png', { editorial: '/assets/images/secret.png' }), note('0.17.48', '/assets/images/fortyeight.png')];
        for (const changelog of [notes, [...notes].reverse()]) {
            const a = access({ changelog });
            assert(a.mediaAllowed('assets/images/four.png'));
            assert(a.mediaAllowed('assets/images/fortyeight.png'));
            assert(!a.mediaAllowed('assets/images/secret.png'));
        }
    } },
    { name: 'filtered variants are private parents; public references cannot declassify them', run() {
        const config = { changelog: [note('0.17.48', '/assets/images/old.png /assets/images/shared.png'), note('0.17.48', '/assets/images/new.png /assets/images/shared.png')] };
        const a = access(config);
        assert.equal(publicSiteConfig(config).changelog.filter(entry => entry.title.includes('0.17.48')).length, 1);
        assert(!a.mediaAllowed('assets/images/old.png'));
        assert(a.mediaAllowed('assets/images/new.png'));
        assert(!a.mediaAllowed('assets/images/shared.png'));
    } },
    { name: 'same media in hidden metadata and a visible field remains denied, including identical public variants', run() {
        const visible = note('0.17.48', '/assets/images/both.png');
        const a = access({ changelog: [{ ...visible, privateNote: '/assets/images/private.png' }, { ...visible }] });
        assert(!a.mediaAllowed('assets/images/both.png'));
        assert(!a.mediaAllowed('assets/images/private.png'));
        const b = access({ home: { metrics: [{ label: '/assets/images/public.png', value: 'Fictif', secret: '/assets/images/public.png' }, { label: '/assets/images/metric.png', value: 'Public' }] } });
        assert(!b.mediaAllowed('assets/images/public.png'));
        assert(b.mediaAllowed('assets/images/metric.png'));
    } },
    { name: 'private version metadata cannot change the provenance of an unnumbered note', run() {
        const a = access({ changelog: [
            { title: 'Archive non numérotée', summary: '/assets/images/archive.png', version: '0.17.48' },
            note('0.17.48', '/assets/images/current.png')
        ] });
        assert(a.mediaAllowed('assets/images/archive.png'));
        assert(a.mediaAllowed('assets/images/current.png'));
    } },
    { name: 'filtered location arrays compare each original record with its own projected fields', run() {
        const docs = documents();
        const place = docs.locations['Continent de test A'][0];
        place.pnjs = ['/assets/images/filtered.png', { name: 'Personnage', description: '/assets/images/visible.png', secret: '/assets/images/hidden.png' }];
        docs.permissions.resources.locations[locationKey('Continent de test A', place.name)].fingerprint = fingerprint('locations', place);
        docs.permissions.resources.locations[locationKey('Continent de test A', place.name)].categories.pnjs = { scope: 'PUBLIC' };
        const a = new Access(docs, { role: 'guest', user: null });
        assert(!a.mediaAllowed('assets/images/filtered.png'));
        assert(a.mediaAllowed('assets/images/visible.png'));
        assert(!a.mediaAllowed('assets/images/hidden.png'));
        place.pnjs.push('/assets/images/visible.png');
        docs.permissions.resources.locations[locationKey('Continent de test A', place.name)].fingerprint = fingerprint('locations', place);
        assert(!new Access(docs, { role: 'guest', user: null }).mediaAllowed('assets/images/visible.png'));
    } },
    { name: 'only projected fields in an accessible response can authorize its media', run() {
        const docs = documents();
        const user = docs.users[1];
        docs.planning = [{ id: 'synthétique', groupId: user.groups[0], title: 'Fictif', responses: { [user.id]: { status: 'available', comment: '/assets/images/comment.png', secret: '/assets/images/response-private.png' } } }];
        const a = new Access(docs, { role: 'user', user });
        assert(a.mediaAllowed('assets/images/comment.png'));
        assert(!a.mediaAllowed('assets/images/response-private.png'));
    } }
];
