const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { download, unpackZip, verifyIdentity, replaceBundle } = require('../src/macos/installer');
const { verifyPackage } = require('../src/services/update-verification');
async function temp(t) { const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'amu-installer-test-'))); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
function zipEntry(name, data, mode = 0o100644) {
  const bytes = Buffer.from(data), filename = Buffer.from(name);
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt32LE(crc,14); local.writeUInt32LE(bytes.length,18); local.writeUInt32LE(bytes.length,22); local.writeUInt16LE(filename.length,26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314,4); central.writeUInt16LE(20,6); central.writeUInt32LE(crc,16); central.writeUInt32LE(bytes.length,20); central.writeUInt32LE(bytes.length,24); central.writeUInt16LE(filename.length,28); central.writeUInt32LE((mode * 65536) >>> 0,38);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(local.length+filename.length+bytes.length,16);
  return Buffer.concat([local,filename,bytes,central,filename,end]);
}
test('ZIP extraction preserves executables and rejects traversal or escaping symlinks', async t => {
  const dir=await temp(t), archive=path.join(dir,'payload.zip'), out=path.join(dir,'out'); await fs.mkdir(out);
  await fs.writeFile(archive,zipEntry('App.app/Contents/MacOS/app','binary',0o100755));
  await unpackZip(archive,out);
  assert.equal(await fs.readFile(path.join(out,'App.app/Contents/MacOS/app'),'utf8'),'binary');
  assert.equal((await fs.stat(path.join(out,'App.app/Contents/MacOS/app'))).mode & 0o111,0o111);
  for(const [name,content,mode] of [['../escape','bad',0o100644],['App.app/link','../../escape',0o120777]]) {
    await fs.writeFile(archive,zipEntry(name,content,mode)); await assert.rejects(unpackZip(archive,out));
  }
  await assert.rejects(fs.stat(path.join(dir,'escape')), {code:'ENOENT'});
});
test('atomic replacement restores the original app when installed verification fails', async t => {
  const dir=await temp(t), destination=path.join(dir,'App.app'), staged=path.join(dir,'staged.app');
  await fs.mkdir(destination);await fs.writeFile(path.join(destination,'version'),'old');
  await fs.mkdir(staged);await fs.writeFile(path.join(staged,'version'),'new');
  await assert.rejects(replaceBundle(staged,destination,async()=>{throw new Error('bad signature');}),/bad signature/);
  assert.equal(await fs.readFile(path.join(destination,'version'),'utf8'),'old');
});
test('replacement rename failure restores the original app', async t => {
  const dir=await temp(t), destination=path.join(dir,'App.app');await fs.mkdir(destination);
  await fs.writeFile(path.join(destination,'version'),'old');
  await assert.rejects(replaceBundle(path.join(dir,'missing.app'),destination,async()=>{}));
  assert.equal(await fs.readFile(path.join(destination,'version'),'utf8'),'old');
});
test('download rejects insecure redirects, cancellation and incomplete payloads', async t => {
  const dir=await temp(t), target=path.join(dir,'download.zip');
  await assert.rejects(download('https://vendor.example/app',target,{fetcher:async()=>new Response(null,{status:302,headers:{location:'http://vendor.example/app'}})}),/HTTPS/);
  await assert.rejects(download('https://vendor.example/app',target,{fetcher:async()=>new Response('short',{headers:{'content-length':'100'}})}),/不完整/);
  await fs.rm(target);
  const controller=new AbortController();controller.abort();
  await assert.rejects(download('https://vendor.example/app',target,{signal:controller.signal,fetcher:async()=>new Response('bytes')}));
});
test('identity verification rejects wrong app, stale target and downgrade', () => {
  const pkg={bundleId:'com.vendor.app',availableBuild:'12'}, old={CFBundleIdentifier:pkg.bundleId,CFBundleVersion:'11'}, fresh={...old,CFBundleVersion:'12'};
  verifyIdentity(fresh,old,pkg);
  assert.throws(()=>verifyIdentity({...fresh,CFBundleIdentifier:'com.other'},old,pkg),/身份/);
  assert.throws(()=>verifyIdentity({...fresh,CFBundleVersion:'13'},old,pkg),/所选更新/);
  assert.throws(()=>verifyIdentity(fresh,fresh,pkg),/已变化/);
});
test('Mac verification reads installed builds even if network update rows disappear', () => {
  const pkg={appPath:'/Applications/App.app',bundleId:'com.vendor.app',availableBuild:'12'};
  const result={status:'ready',snapshot:{status:'ready',snapshotId:'new',packages:[],installations:[{...pkg,build:'11'}]}};
  assert.equal(verifyPackage(pkg,result,'old'),'pending');
  result.snapshot.installations[0].build='12';assert.equal(verifyPackage(pkg,result,'old'),'updated');
  result.snapshot.installations=[];assert.equal(verifyPackage(pkg,result,'old'),'unknown');
});
for (const mismatchedTeam of [false, true]) test(`Mac installer ${mismatchedTeam ? 'rejects a different developer without changing the app' : 'downloads, stages, verifies and replaces an app'}`, async t => {
  const { MacInstaller } = require('../src/macos/installer');
  const dir = await temp(t), destination = path.join(dir, 'Example.app');
  const info = { CFBundleIdentifier: 'com.vendor.example', CFBundleVersion: '11', CFBundleExecutable: 'Example' };
  async function bundle(target, build) {
    await fs.mkdir(path.join(target, 'Contents/MacOS'), { recursive: true });
    await fs.writeFile(path.join(target, 'Contents/Info.plist'), JSON.stringify({ ...info, CFBundleVersion: build }));
    await fs.writeFile(path.join(target, 'Contents/MacOS/Example'), build, { mode: 0o755 });
  }
  await bundle(destination, '11');
  let downloads = 0, assessed = 0;
  const run = async (command, args) => {
    if (command.endsWith('/plutil')) return { stdout: await fs.readFile(args.at(-1), 'utf8') };
    if (command.endsWith('/hdiutil') && args[0] === 'attach') await bundle(path.join(args.at(-1), 'Example.app'), '12');
    if (command.endsWith('/ditto')) await fs.cp(args[0], args[1], { recursive: true });
    if (command.endsWith('/codesign') && args[0] === '-dv') return { stdout: '', stderr: `TeamIdentifier=${mismatchedTeam && args.at(-1) !== destination ? 'OTHER123' : 'VENDOR123'}\n` };
    if (command.endsWith('/spctl')) assessed++;
    return { stdout: command.endsWith('/lipo') ? 'arm64 x86_64' : '', stderr: '' };
  };
  const installer = new MacInstaller({ run, fetcher: async () => { downloads++; return new Response('disk image'); } });
  const pkg = { bundleId: info.CFBundleIdentifier, appPath: destination, availableBuild: '12', updateMode: 'automatic', downloadFormat: 'dmg', downloadUrl: 'https://vendor.example/app.dmg' };
  const stages = [];
  const operation = installer.update(pkg, { onProgress: p => stages.push(p.stage) });
  if (mismatchedTeam) await assert.rejects(operation, /签名不匹配/);
  else assert.equal((await operation).ok, true);
  assert.equal(downloads, 1);
  assert.equal(assessed, mismatchedTeam ? 0 : 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(destination, 'Contents/Info.plist'))).CFBundleVersion, mismatchedTeam ? '11' : '12');
  assert.deepEqual(await fs.readdir(dir), ['Example.app']);
  if (!mismatchedTeam) assert.ok(stages.includes('正在安装'));
});
test('native macOS ZIP preserves Unicode names and chained Framework symlinks', { skip: process.platform !== 'darwin' }, async t => {
  const run = require('node:util').promisify(require('node:child_process').execFile);
  const dir = await temp(t), source = path.join(dir, 'source/示例.app/Contents/Frameworks/Kit.framework'), out = path.join(dir, 'out');
  await fs.mkdir(path.join(source, 'Versions/A'), { recursive: true });
  await fs.writeFile(path.join(source, 'Versions/A/Kit'), 'payload', { mode: 0o755 });
  await fs.symlink('A', path.join(source, 'Versions/Current'));
  await fs.symlink('Versions/Current/Kit', path.join(source, 'Kit'));
  await fs.mkdir(out);
  await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', path.join(dir, 'source/示例.app'), path.join(dir, 'test.zip')]);
  await unpackZip(path.join(dir, 'test.zip'), out);
  const target = path.join(out, '示例.app/Contents/Frameworks/Kit.framework/Kit');
  assert.equal(await fs.readFile(target, 'utf8'), 'payload');
  assert.equal((await fs.stat(target)).mode & 0o111, 0o111);
});
