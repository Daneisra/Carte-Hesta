import { extractYoutubeId } from '../../js/ui/youtube.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renderMarkdown } from '../../js/ui/markdown.mjs';
import {
    AVAILABILITY_DAYS,
    AVAILABILITY_SLOTS,
    AVAILABILITY_STATUS,
    createAvailabilityMatrix,
    createAvailabilityStatusMatrix,
    normalizeAvailabilityPayload,
    normalizeAvailabilityStatusPayload
} from '../../js/ui/availability.mjs';
import {
    isValidAccentColor,
    normalizeProfileCustomization,
    normalizeProfileUrl
} from '../../js/ui/profileCustomization.mjs';
import {
    enforceSingleActiveCharacter,
    normalizeCharacterList
} from '../../js/ui/characterModel.mjs';
import {
    normalizeAnnotationColor,
    normalizeAnnotationId
} from '../../js/ui/annotationModel.mjs';

const require = createRequire(import.meta.url);
const { validRule } = require('../../server/security/schema');
const {
    buildZipArgs,
    buildTarArgs,
    getArchiveDescriptor
} = require('../../server/utils/assetsArchive');

const tests = [
    {
        name: 'YouTube IDs use exact trusted hosts and complete video IDs',
        run: () => {
            for (const url of ['https://youtu.be/testVideo01?si=synthetic', 'https://www.youtube.com/watch?v=testVideo01&t=15', 'https://m.youtube.com/watch?v=testVideo01', 'https://www.youtube.com/embed/testVideo01', 'https://youtube.com/shorts/testVideo01', 'https://youtube.com/live/testVideo01', 'https://www.youtube-nocookie.com/embed/testVideo01']) assert.equal(extractYoutubeId(url), 'testVideo01');
            for (const url of ['https://notyoutube.com/watch?v=testVideo01', 'https://youtube.com.evil.invalid/watch?v=testVideo01', 'https://evil.invalid/?v=testVideo01', 'javascript:youtu.be/testVideo01', 'https://youtu.be/short', 'https://youtu.be/testVideo012', 'https://user@youtube.com/watch?v=testVideo01', 'https://youtube.com/playlist?list=testVideo01', 'https://youtube.com/embed/%22testVideo01']) assert.equal(extractYoutubeId(url), null);
            assert.equal(extractYoutubeId(null), null);
        }
    },
    {
        name: 'renders basic paragraphs with inline formatting',
        run: () => {
            const html = renderMarkdown('Hello **world**');
            assert.equal(html, '<p>Hello <strong>world</strong></p>');
        }
    },
    {
        name: 'converts new lines into <br> elements',
        run: () => {
            const html = renderMarkdown('First line\nSecond line');
            assert.equal(html, '<p>First line<br>Second line</p>');
        }
    },
    {
        name: 'sanitizes dangerous links',
        run: () => {
            const html = renderMarkdown('[click me](javascript:evil)');
            assert.equal(html, '<p><a href="#" target="_blank" rel="noopener noreferrer">click me</a></p>');
        }
    },
    {
        name: 'supports fenced code blocks',
        run: () => {
            const html = renderMarkdown('```\nconst answer = 42;\n```');
            assert.equal(html, '<pre><code>const answer = 42;</code></pre>');
        }
    },
    {
        name: 'renders unordered lists',
        run: () => {
            const html = renderMarkdown('- Item one\n- Item two');
            assert.equal(html, '<ul><li>Item one</li><li>Item two</li></ul>');
        }
    },
    {
        name: 'normalizes availability payloads with a stable weekly matrix',
        run: () => {
            const normalized = normalizeAvailabilityPayload({
                timezone: 'Europe/Warsaw',
                slots: [
                    [true, false, true],
                    [0, 1, '', 'yes']
                ]
            });
            assert.equal(normalized.timezone, 'Europe/Warsaw');
            assert.equal(normalized.slots.length, AVAILABILITY_DAYS.length);
            assert.equal(normalized.slots[0].length, AVAILABILITY_SLOTS.length);
            assert.deepEqual(normalized.slots[0], [true, false, true, false]);
            assert.deepEqual(normalized.slots[1], [false, true, false, true]);
            assert.deepEqual(normalized.slots[6], [false, false, false, false]);
        }
    },
    {
        name: 'creates independent availability matrices',
        run: () => {
            const first = createAvailabilityMatrix();
            const second = createAvailabilityMatrix();
            first[0][0] = true;
            assert.equal(second[0][0], false);
        }
    },
    {
        name: 'normalizes availability status payloads without breaking booleans',
        run: () => {
            const normalized = normalizeAvailabilityStatusPayload({
                timezone: 'Europe/Warsaw',
                slots: [
                    [true, 'maybe', 'busy', false],
                    ['available', 'incertain', 'indisponible', '']
                ]
            });
            assert.deepEqual(normalized.slots[0], [AVAILABILITY_STATUS.AVAILABLE, AVAILABILITY_STATUS.MAYBE, AVAILABILITY_STATUS.BUSY, null]);
            assert.deepEqual(normalized.slots[1], [AVAILABILITY_STATUS.AVAILABLE, AVAILABILITY_STATUS.MAYBE, AVAILABILITY_STATUS.BUSY, null]);
            const first = createAvailabilityStatusMatrix();
            const second = createAvailabilityStatusMatrix();
            first[0][0] = AVAILABILITY_STATUS.BUSY;
            assert.equal(second[0][0], null);
        }
    },
    {
        name: 'normalizes profile customization URLs and social links',
        run: () => {
            assert.equal(normalizeProfileUrl('/assets/banner.jpg'), '/assets/banner.jpg');
            assert.equal(normalizeProfileUrl('https://example.com/profile'), 'https://example.com/profile');
            assert.equal(normalizeProfileUrl('javascript:alert(1)'), null);
            assert.equal(isValidAccentColor('#60a5fa'), true);
            assert.equal(isValidAccentColor('#bad'), false);
            const profile = normalizeProfileCustomization({
                banner: 'https://example.com/banner.jpg',
                accentColor: '#60a5fa',
                bio: ` ${'x'.repeat(6100)} `,
                socials: {
                    website: 'https://example.com',
                    twitch: 'ftp://invalid.example'
                }
            });
            assert.equal(profile.banner, 'https://example.com/banner.jpg');
            assert.equal(profile.accentColor, '#60a5fa');
            assert.equal(profile.bio.length, 6000);
            assert.deepEqual(profile.socials, { website: 'https://example.com' });
        }
    },
    {
        name: 'normalizes character lists and keeps a single active character',
        run: () => {
            let nextId = 1;
            const characters = normalizeCharacterList([
                { id: ' hero ', name: '  Danny ', active: true, group: ' main ' },
                { id: 'hero', name: 'Duplicate without assign' },
                { name: ' Alienor ', avatar: ' /assets/alienor.png ', active: true },
                null,
                { id: 'empty' }
            ], {
                assignIds: true,
                createId: () => `char_test_${nextId++}`
            });
            assert.deepEqual(characters, [
                {
                    id: 'hero',
                    name: 'Danny',
                    bio: null,
                    avatar: null,
                    groupId: 'main',
                    active: true
                },
                {
                    id: 'char_test_1',
                    name: 'Duplicate without assign',
                    bio: null,
                    avatar: null,
                    groupId: null,
                    active: false
                },
                {
                    id: 'char_test_2',
                    name: 'Alienor',
                    bio: null,
                    avatar: '/assets/alienor.png',
                    groupId: null,
                    active: false
                }
            ]);
            assert.deepEqual(enforceSingleActiveCharacter([
                { id: 'a', active: true },
                { id: 'b', active: true }
            ]), [
                { id: 'a', active: true },
                { id: 'b', active: false }
            ]);
        }
    },
    {
        name: 'normalizes annotation ids and colors',
        run: () => {
            assert.equal(normalizeAnnotationId('  abc  '), 'abc');
            assert.equal(normalizeAnnotationId(null), '');
            assert.equal(normalizeAnnotationColor(''), '#ff8a00');
            assert.equal(normalizeAnnotationColor('f80'), '#f80');
            assert.equal(normalizeAnnotationColor('ff8800'), '#ff8800');
            assert.equal(normalizeAnnotationColor('#abc'), '#abc');
            assert.equal(normalizeAnnotationColor('not-a-color'), '#ff8a00');
        }
    },
    {
        name: 'rejects legacy, unknown and unqualified annotation access rules',
        run: () => {
            for (const rule of [{ scope: 'party' }, { scope: 'public' }, {}, { scope: 'PRIVATE' }, { scope: 'GROUP' }, { scope: 'GM' }, { scope: 'PLAYERS', userIds: [] }, { scope: 'PUBLIC', ownerId: 'invented' }]) assert.equal(validRule(rule), false);
            assert.equal(validRule({ scope: 'PRIVATE', ownerId: 'synthetic-owner' }), true);
            assert.equal(validRule({ scope: 'GROUP', groupId: 'synthetic-group' }), true);
        }
    },
    {
        name: 'builds asset archive commands with consistent exclusions',
        run: () => {
            assert.deepEqual(getArchiveDescriptor('zip'), {
                filename: 'assets.zip',
                contentType: 'application/zip'
            });
            assert.deepEqual(getArchiveDescriptor('tar'), {
                filename: 'assets.tar.gz',
                contentType: 'application/gzip'
            });
            assert.deepEqual(buildZipArgs('/tmp/assets.zip'), [
                '-r',
                '/tmp/assets.zip',
                '.',
                '-x',
                'logs/*',
                '-x',
                'icons/README.md'
            ]);
            assert.deepEqual(buildTarArgs('/tmp/assets.tar.gz'), [
                '-czf',
                '/tmp/assets.tar.gz',
                '--exclude=logs',
                '--exclude=icons/README.md',
                '.'
            ]);
        }
    }
];

let failed = false;

for (const test of tests) {
    try {
        await test.run();
        console.log(`ok - ${test.name}`);
    } catch (error) {
        failed = true;
        console.error(`not ok - ${test.name}`);
        console.error(error);
    }
}

if (failed) {
    process.exitCode = 1;
}
