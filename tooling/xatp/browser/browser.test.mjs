/** Exercises live Chromium against isolated local pages. No platform login or network dependency. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {createBrowserAdapter} from './index.mjs';
import {withPage} from './cdp.mjs';

const fixture = `<!doctype html><title>Local adapter fixture</title>
<form id="clip" name="research"><label>Keywords<input></label><button disabled>Generate (paid)</button></form>
<input type="password" aria-label="Private field" value="dummy-secret">
<a href="/clip.mp4">Public clip</a><a href="/private.mp4?token=test-signed">/private.mp4?token=test-signed</a>
<a href="https://attacker.invalid/private.mp4">Foreign asset</a>
<a href="https://doi.org/10.1000/fixture">Original article</a>
<a href="https://doi.org/10.1000/signed?token=test-signed">Signed citation</a>
<video width="32" height="32" preload="none" src="/render.mp4?token=test-signed"></video>
<button id="live">Original control</button><div tabindex="0" role="grid">Timeline</div>
<iframe srcdoc="<button>Private frame</button>"></iframe>`;

async function until(probe) {
  const deadline = Date.now() + 7000;
  do {
    const result = await probe();
    if (result) return result;
    await delay(70);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for local Chromium.');
}

test('discovers live controls, limits reads, and rejects stale selections', {timeout:25000}, async t => {
  const server = createServer((_req, res) => {res.writeHead(200, {'Content-Type':'text/html'}); res.end(fixture);});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const dir = await mkdtemp(join(tmpdir(),'xatp-chromium-'));
  const child = spawn(process.env.CHROMIUM_BIN || 'chromium', [
    '--headless','--no-sandbox','--disable-background-networking','--disable-component-update','--disable-gpu','--no-first-run',
    '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir=' + dir, origin + '/fixture?token=test-signed',
  ], {stdio:['ignore','ignore','pipe'],detached:true});
  let diagnostics = '';
  child.stderr.on('data', data => { diagnostics = (diagnostics + data.toString()).slice(-6000); });
  const exited = new Promise(resolve => {child.once('exit',resolve); child.once('error',resolve);});
  t.after(async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await Promise.race([exited, delay(1000)]);
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        await exited;
      }
    }
    await rm(dir, {recursive:true,force:true,maxRetries:4,retryDelay:80});
  });
  const port = await until(async () => {
    const match = diagnostics.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (match) return match[1];
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) throw new Error('Chromium startup failed: ' + diagnostics.slice(-1000));
    return null;
  });
  const endpoint = 'http://127.0.0.1:' + port;
  const providers = [{id:'fixture',origins:[origin],pathPrefix:'/fixture',resourceOrigins:['https://doi.org'],capabilities:['inspect','read_link','collect_assets','collect_citations']}];
  const adapter = createBrowserAdapter({endpoint,providers});
  const tab = await until(async () => (await adapter.listTabs())[0]);
  assert.equal(tab.providerId,'fixture');
  assert.equal(tab.url,origin + '/fixture');
  const snapshot = await adapter.discover(tab);
  const invoke = (toolId, operation) => adapter.invoke({...tab,documentId:snapshot.documentId,toolId,operation});
  const named = n => snapshot.tools.find(x => x.name === n);
  assert.equal(named('Keywords').form.id,'clip');
  assert.equal(named('Generate (paid)').disabled,true);
  assert.equal(named('Private field'),undefined);
  assert.equal(named('Private frame'),undefined);
  assert.equal(snapshot.unsupported.childFrames,1);
  assert.ok(snapshot.unsupported.unmappedControls >= 1);
  assert.doesNotMatch(JSON.stringify(snapshot),/test-signed|dummy-secret/);
  assert.deepEqual(await invoke(named('Public clip').toolId,'read_link'),{url:origin + '/clip.mp4'});
  assert.equal((await invoke(named('Keywords').toolId,'inspect')).role,'textbox');
  await assert.rejects(() => invoke(named('Generate (paid)').toolId,'click'),{code:'operation_blocked'});
  await assert.rejects(() => invoke(named('Foreign asset').toolId,'read_link'),{code:'operation_blocked'});
  const assets = await invoke('page','collect_assets');
  assert.deepEqual(assets.items.map(x => x.url),[origin + '/clip.mp4']);
  assert.ok(assets.media.some(x => x.kind === 'video' && x.hostname === '127.0.0.1'));
  assert.doesNotMatch(JSON.stringify(assets),/test-signed/);
  const refs = await invoke('page','collect_citations');
  assert.deepEqual(refs.items.map(x => x.url),['https://doi.org/10.1000/fixture']);
  async function modifyFixture(expression) {
    await withPage(new URL(endpoint),{id:tab.tabId},AbortSignal.timeout(2000),send => send('Runtime.evaluate',{expression}));
  }
  await modifyFixture("document.getElementById('live').outerHTML = '<button id=live>New control</button>'");
  await assert.rejects(() => invoke(named('Original control').toolId,'inspect'),{code:'stale_tool'});
  assert.ok((await adapter.discover(tab)).tools.some(x => x.name === 'New control'));
  await modifyFixture("history.pushState(null,'','/fixture/second')");
  await assert.rejects(() => invoke('page','collect_assets'),{code:'stale_document'});
  const second = await adapter.discover(tab);
  await modifyFixture('location.reload()');
  await until(async () => {
    if (!(await adapter.listTabs()).some(t => t.tabId === tab.tabId)) return false;
    try { return (await adapter.discover(tab)).documentId !== second.documentId; }
    catch (error) { if (!['stale_document','origin_mismatch','cdp_command_failed'].includes(error.code)) throw error; return false; }
  });
  await assert.rejects(() => adapter.invoke({...tab,documentId:second.documentId,toolId:'page',operation:'collect_assets'}),{code:'stale_document'});
  for (const pathname of ['/science/article/pii/123','/fixture-foreign','/login']) {
    await modifyFixture('history.replaceState(null,"",' + JSON.stringify(pathname) + ')');
    assert.deepEqual(await adapter.listTabs(),[]);
    await assert.rejects(() => adapter.discover(tab),{code:'origin_mismatch'});
  }
});
