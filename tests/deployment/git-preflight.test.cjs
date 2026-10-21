// All cases use in-memory records or new fictional files. No repository Git mutations.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { hashPlain, gitMetadata, validateIndex, validateStaged, validatePathspec } = require('../../tools/gitCleanupPreflight');
const reference = Array.from({ length: 225 }, (_, i) => ({ path: `synthetic/file-${i}.js`, mode: '100644', object: 'a'.repeat(40), stage: 0 }));
const removed = reference.slice(0,114).map(e => e.path);
const retained = reference.slice(114);
test('before requires all 225 exact entries', () => { validateIndex(reference,reference,removed,false); assert.throws(() => validateIndex(reference.slice(1),reference,removed,false)); });
test('after requires all 111 exact retained entries', () => { validateIndex(retained,reference,removed,true); assert.throws(() => validateIndex(retained.slice(1),reference,removed,true)); });
test('same count with replaced entry is rejected', () => { const altered=structuredClone(retained); altered[0].path='synthetic/unexpected.js'; assert.throws(() => validateIndex(altered,reference,removed,true)); });
test('retained object/mode/stage changes are rejected', () => { for(const [key,value] of [['object','b'.repeat(40)],['mode','100755'],['stage',1]]) { const altered=structuredClone(retained); altered[0][key]=value; assert.throws(() => validateIndex(altered,reference,removed,true)); } });
test('before rejects any staged operation', () => { validateStaged(Buffer.alloc(0),removed,false); assert.throws(() => validateStaged(Buffer.from('D\0synthetic/file-0.js\0'),removed,false)); });
const staged = names => Buffer.from(names.flatMap(name=>['D',name]).join('\0')+'\0');
test('after requires exactly 114 deletion records', () => { validateStaged(staged(removed),removed,true); assert.throws(() => validateStaged(staged(removed.slice(1)),removed,true)); });
test('same deletion count with wrong target is rejected', () => { const altered=[...removed]; altered[0]='synthetic/wrong.js'; assert.throws(() => validateStaged(staged(altered),removed,true)); });
test('modified or added staged entry is rejected', () => { for(const tag of ['M','A','R100']) assert.throws(() => validateStaged(Buffer.from(staged(removed).toString().replace(/^D/,tag)),removed,true)); });
test('missing NUL and extra deletion are rejected', () => { assert.throws(() => validateStaged(staged(removed).subarray(0,-1),removed,true)); assert.throws(() => validateStaged(staged([...removed,'synthetic/extra.js']),removed,true)); });
test('unapproved pathspec bytes fail closed', () => { for(const bytes of [Buffer.alloc(0),Buffer.from('synthetic/file\0'),Buffer.from('synthetic/file\n')]) assert.throws(() => validatePathspec(bytes,removed)); });
const lab=fs.mkdtempSync(path.join(os.tmpdir(),'cartehesta-git-preflight-synthetic-'));
fs.writeFileSync(path.join(lab,'SYNTHETIC-ONLY.marker'),'Fictional bytes only; retained for review.');
test('opaque hash preserves main content and metadata', async () => { const file=path.join(lab,'fictional.bin');const bytes=Buffer.from('SYNTHETIC-CONTENT');fs.writeFileSync(file,bytes);const before=fs.statSync(file,{bigint:true});const result=await hashPlain(file);assert.equal(result.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(fs.statSync(file,{bigint:true}).mtimeNs,before.mtimeNs); });
test('hard-linked synthetic files are refused', async () => { const original=path.join(lab,'hardlink-original');const alias=path.join(lab,'hardlink-alias');fs.writeFileSync(original,'FAKE');fs.linkSync(original,alias);await assert.rejects(hashPlain(alias),/FILE_TYPE/); });
test('Git observation catches metadata changes and additional locks', () => { const repo=path.join(lab,'fictional-repo');fs.mkdirSync(path.join(repo,'.git'),{recursive:true});const file=path.join(repo,'.git','index');fs.writeFileSync(file,'FAKE-INDEX');const first=gitMetadata(repo);fs.writeFileSync(file,'DIFFERENT-FAKE-INDEX');assert.notEqual(gitMetadata(repo).sha256,first.sha256);fs.writeFileSync(path.join(repo,'.git','index.lock'),'SYNTHETIC');assert.throws(()=>gitMetadata(repo),/GIT_LOCK/); });
test('directories are rejected as main-content files', async () => { await assert.rejects(hashPlain(lab),/FILE_TYPE/); });

test('explicit synthetic pathspec digest is mandatory and never inferred', () => {
    const bytes=Buffer.from(removed.join('\0')+'\0');
    const digest=crypto.createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual(validatePathspec(bytes,removed,digest),removed);
    assert.throws(()=>validatePathspec(bytes,removed),/DIGEST/);
    assert.throws(()=>validatePathspec(bytes,removed,'0'.repeat(64)),/DIGEST/);
    assert.throws(()=>validatePathspec(bytes,removed.slice(1),digest),/SET/);
});
