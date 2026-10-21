// Retained fictional repositories only. No git add/commit, remote, app or real dataset.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),cp=require('node:child_process');
const assert=require('node:assert/strict');
const {parseIndex,auditIndex}=require('../../tools/auditTrackedPaths');
const {hashPlain,gitMetadata,validateIndex,validateStaged}=require('../../tools/gitCleanupPreflight');
const [mode,root,output]=process.argv.slice(2);
const lab=path.dirname(root);
assert(path.isAbsolute(root)&&!root.toLowerCase().startsWith(path.resolve(__dirname,'../..').toLowerCase()+path.sep));
assert(path.basename(lab).startsWith('cartehesta-cleanup-execution-synthetic-'));
assert(fs.readFileSync(path.join(lab,'SYNTHETIC-ONLY.marker'),'utf8')==='FICTIONAL-ONLY');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_')));
Object.assign(env,{GIT_OPTIONAL_LOCKS:'0',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL'});
const git=args=>cp.execFileSync('git',['-c','core.fsmonitor=false',...args],{cwd:root,env});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const write=(p,b)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b,{flag:'wx'});};
const stateFile=path.join(lab,'fixture-state.json');
function obj(type,b){const bytes=Buffer.concat([Buffer.from(`${type} ${b.length}\0`),b]);const id=crypto.createHash('sha1').update(bytes).digest('hex');const p=path.join(root,'.git/objects',id.slice(0,2),id.slice(2));if(!fs.existsSync(p))write(p,zlib.deflateSync(bytes));return id;}
function tree(dir){const names=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.name!=='.git');names.sort((a,b)=>Buffer.compare(Buffer.from(a.name+(a.isDirectory()?'/':'')),Buffer.from(b.name+(b.isDirectory()?'/':''))));return obj('tree',Buffer.concat(names.map(e=>{const p=path.join(dir,e.name),id=e.isDirectory()?tree(p):obj('blob',fs.readFileSync(p));return Buffer.concat([Buffer.from(`${e.isDirectory()?'40000':'100644'} ${e.name}\0`),Buffer.from(id,'hex')]);})));}
async function main(){
 if(mode==='init'){
  fs.mkdirSync(root);fs.mkdirSync(path.join(root,'.git/objects'),{recursive:true});fs.mkdirSync(path.join(root,'.git/refs/heads'),{recursive:true});
  write(path.join(root,'.git/HEAD'),'ref: refs/heads/synthetic\n');write(path.join(root,'.git/config'),'[core]\n repositoryformatversion = 0\n bare = false\n filemode = false\n');
  const removed=Array.from({length:114},(_,i)=>`assets/images/fictional-cleanup-${i}.png`);
  for(let i=0;i<removed.length;i++)write(path.join(root,removed[i]),Buffer.from('SYNTHETIC-MAIN-'+i));
  write(path.join(root,'.gitignore'),'/assets/*\n/new/\n');for(let i=0;i<110;i++)write(path.join(root,`src/kept-${i}.js`),`// FICTIONAL ${i}\n`);
  const treeId=tree(root);const commit=obj('commit',Buffer.from(`tree ${treeId}\nauthor Synthetic <synthetic@example.invalid> 1 +0000\ncommitter Synthetic <synthetic@example.invalid> 1 +0000\n\nFictional baseline only\n`));
  write(path.join(root,'.git/refs/heads/synthetic'),commit+'\n');git(['read-tree','HEAD']);
  for(let i=0;i<29;i++)write(path.join(root,`new/source-${i}.js`),`// FICTIONAL NEW ${i}\n`);
  fs.writeFileSync(path.join(root,removed[0])+':synthetic',Buffer.from('SYNTHETIC-ADS'));
  const reference=parseIndex(git(['ls-files','--stage','-z']));assert.equal(reference.length,225);
  const files={};for(const name of removed)files[name]=await hashPlain(path.join(root,name));
  write(stateFile,JSON.stringify({reference,removed,files},null,2));
  write(path.join(lab,'paths.nul'),Buffer.from(removed.join('\0')+'\0'));
  write(path.join(lab,'fake-proof.txt'),'SYNTHETIC-BACKUP-PROOF\n');
  console.log(JSON.stringify({entries:225,removed:114,retained:111,untracked:29}));return;
 }
 const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 if(mode==='metadata'){console.log(JSON.stringify(gitMetadata(root)));return;}
 if(mode==='gate'){const a=auditIndex(parseIndex(git(['ls-files','--stage','-z'])));assert(a.cleanForRelease);console.log(JSON.stringify(a));return;}
 const after=mode==='after';assert(after||mode==='before');
 const entries=parseIndex(git(['ls-files','--stage','-z']));validateIndex(entries,saved.reference,saved.removed,after);validateStaged(git(['diff','--cached','--no-renames','--name-status','-z']),saved.removed,after);
 assert.equal(sha(fs.readFileSync(path.join(lab,'paths.nul'))),sha(Buffer.from(saved.removed.join('\0')+'\0')));
 assert.equal(fs.readFileSync(path.join(lab,'fake-proof.txt'),'utf8'),'SYNTHETIC-BACKUP-PROOF\n');
 for(const name of saved.removed)assert.deepEqual(await hashPlain(path.join(root,name)),saved.files[name]);
 for(let i=0;i<29;i++){const name=`new/source-${i}.js`;assert(fs.statSync(path.join(root,name)).isFile());assert(!entries.some(e=>e.path===name));}
 const result={entries:entries.length,historicalCoverage:114,retained:111,stagedChanges:after?114:0,requiredUntracked:29,gitMetadata:gitMetadata(root)};
 if(output)write(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.code||'E_SYNTHETIC_FIXTURE_CHECK');process.exitCode=1;});
