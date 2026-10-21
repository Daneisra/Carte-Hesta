const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
test('forced-command transport, hostile archives, external rollback and code receipts use synthetic files only', () => {
  const program = String.raw`
import hashlib, importlib.util, io, json, os, pathlib, sys, tarfile, tempfile
def load(name, file):
  spec=importlib.util.spec_from_file_location(name,file); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
receiver,client,controller=[load('module'+str(i),p) for i,p in enumerate(sys.argv[1:])]
rev='a'*40; digest='b'*64; checks=0
def rejects(call):
  global checks
  try: call()
  except Exception: checks+=1; return
  raise AssertionError('expected refusal')
def archive(extra=None):
  b=io.BytesIO()
  with tarfile.open(fileobj=b,mode='w') as t:
    for name in ('app','public','ops'):
      x=tarfile.TarInfo(name); x.type=tarfile.DIRTYPE; t.addfile(x)
    for name in ('app/code.txt','public/code.txt','ops/proposal.txt','release-manifest.json'):
      data=b'synthetic'; x=tarfile.TarInfo(name); x.size=len(data); t.addfile(x,io.BytesIO(data))
    if extra:
      x,data=extra
      t.addfile(x,io.BytesIO(data) if data is not None else None)
  return b.getvalue()
with tempfile.TemporaryDirectory(prefix='cartehesta-ssh-synthetic-') as directory:
  root=pathlib.Path(directory); data=archive(); sha=hashlib.sha256(data).hexdigest()
  result=receiver.receive(io.BytesIO(data),root/'good',sha)
  assert (result/'app/code.txt').read_bytes()==b'synthetic' and (root/'good/.transport.tar').is_file(); checks+=1
  rejects(lambda:receiver.receive(io.BytesIO(data),root/'good',sha))
  rejects(lambda:receiver.receive(io.BytesIO(data),root/'bad-digest','0'*64))
  for n,name in enumerate(('../outside','/outside','public/../outside','public//x','public/./x',r'public\x','private/users.json')):
    x=tarfile.TarInfo(name); x.size=1; b=archive((x,b'x'))
    rejects(lambda b=b,n=n:receiver.receive(io.BytesIO(b),root/('path-'+str(n)),hashlib.sha256(b).hexdigest()))
  for n,kind in enumerate((tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.FIFOTYPE,tarfile.CHRTYPE)):
    x=tarfile.TarInfo('public/link'); x.type=kind; x.linkname='/private'; b=archive((x,None))
    rejects(lambda b=b,n=n:receiver.receive(io.BytesIO(b),root/('type-'+str(n)),hashlib.sha256(b).hexdigest()))
  x=tarfile.TarInfo('app/code.txt'); x.size=1; b=archive((x,b'x'))
  rejects(lambda:receiver.receive(io.BytesIO(b),root/'duplicate',hashlib.sha256(b).hexdigest()))
  x=tarfile.TarInfo('app/huge'); x.size=33*1024*1024; b=x.tobuf()+b'\0'*10240
  rejects(lambda:receiver.receive(io.BytesIO(b),root/'huge',hashlib.sha256(b).hexdigest()))
  for text in ('sh','deploy '+rev+' '+digest+' '+digest+' reopen; id','rollback '+rev+' ../../x','deploy '+rev+' '+digest+' '+digest+' other'):
    rejects(lambda text=text:receiver.command(text))
  assert receiver.command('deploy '+rev+' '+digest+' '+digest+' closed')[0]=='deploy'; checks+=1
  cfg={'DEPLOY_HOST':'example.invalid','DEPLOY_PORT':'22','DEPLOY_SSH_KEY':'synthetic-key-not-a-credential','DEPLOY_KNOWN_HOSTS':'example.invalid ssh-ed25519 synthetic-host-key',
       'REVISION':rev,'MANIFEST_SHA256':digest,'ARCHIVE_SHA256':sha,'REOPEN':'false'}
  assert client.settings(cfg)['DEPLOY_PORT']=='22'; checks+=1
  for k,v in (('DEPLOY_HOST','-oProxyCommand=id'),('DEPLOY_PORT','0'),('REVISION',rev+';id'),('DEPLOY_KNOWN_HOSTS','* ssh-ed25519 fake'),('DEPLOY_SSH_KEY','')):
    rejects(lambda k=k,v=v:client.settings({**cfg,k:v}))
  keydir=root/'keys'; keydir.mkdir(mode=0o700); args=client.connection(cfg,keydir)
  assert 'StrictHostKeyChecking=yes' in args and 'IdentitiesOnly=yes' in args and '-T' in args and 'ForwardAgent=no' in args; checks+=1
  code=root/'code.tar'; code.write_bytes(data)
  calls=[]
  def run(args,source):
    calls.append(args[-1]); return json.dumps({'status':'RolledBackMaintenance' if args[-1].startswith('rollback ') else 'Activated','revision':rev,'receipt':'deployment-abcdefgh','publicReopened':False}).encode()
  result=client.deploy(cfg,code,['synthetic-ssh'],run,lambda opened: None)
  assert result['status']=='Activated' and len(calls)==1; checks+=1
  calls.clear()
  def failed_health(_): raise RuntimeError('synthetic external failure')
  rejects(lambda:client.deploy(cfg,code,['synthetic-ssh'],run,failed_health))
  assert len(calls)==2 and calls[1]=='rollback '+rev+' deployment-abcdefgh'; checks+=1
  calls.clear(); rejects(lambda:client.deploy({**cfg,'ARCHIVE_SHA256':'0'*64},code,['synthetic-ssh'],run,failed_health)); assert not calls
  base=root/'base'; gates=root/'gates'; incoming=root/'incoming'
  for p in (base,gates,incoming): p.mkdir()
  candidate=incoming/rev; candidate.mkdir()
  for name in ('app','public'):
    (base/name).mkdir(); (base/name/'code').write_text('old')
    (candidate/name).mkdir(); (candidate/name/'code').write_text('new')
  (base/'data').mkdir(); (base/'data/private').write_text('synthetic-user'); private=controller.tree(base/'data')
  (gates/'OPEN_APPROVED').touch(); commands=[]
  d=controller.Deployment(base,gates,incoming,lambda action: commands.append(action),lambda:None,lambda *a:None)
  activated=d.execute(rev,digest,True); rolled=d.rollback(rev,activated['receipt'])
  assert rolled['status']=='RolledBackMaintenance' and not (gates/'OPEN_APPROVED').exists()
  assert all((base/n/'code').read_text()=='old' for n in ('app','public'))
  assert controller.tree(base/'data')==private and commands==['stop','start','stop','start']; checks+=1
  rejects(lambda:d.rollback(rev,activated['receipt']))
  rejects(lambda:d.rollback(rev,'../../outside'))
  # A second application deployment must not acquire root execution through the
  # previous application's verifier. Execute a harmless frozen stand-in twice.
  frozen=root/'frozen-verifier'; (frozen/'tools').mkdir(parents=True)
  trusted=frozen/'tools/deployment.js'
  trusted.write_text("from pathlib import Path\nPath(__file__).with_name('trusted-ran').write_text('trusted')\n")
  (candidate/'tools').mkdir(); poison=candidate/'tools/deployment.js'
  poison.write_text("raise RuntimeError('candidate verifier must never execute')\n")
  controller.NODE=sys.executable; controller.VERIFIER=frozen
  controller.verify_release(candidate,rev,digest)
  poison.write_text("raise RuntimeError('changed application verifier must never execute')\n")
  controller.verify_release(candidate,rev,digest)
  assert (frozen/'tools/trusted-ran').read_text()=='trusted'; checks+=1
print(json.dumps({'syntheticChecks':checks,'realNetworkCalls':0,'productionWrites':0}))
`;
  const result = JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', '-B', '-c', program,
    path.resolve(__dirname, '../../ops/receive-deploy.py'), path.resolve(__dirname, '../../.github/scripts/transport-deploy.py'),
    path.resolve(__dirname, '../../ops/deploy-code.py')], { encoding: 'utf8', windowsHide: true }));
  assert(result.syntheticChecks >= 30); assert.equal(result.realNetworkCalls, 0); assert.equal(result.productionWrites, 0);
});
