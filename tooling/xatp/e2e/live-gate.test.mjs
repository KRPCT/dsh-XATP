/** A plausible receipt and a ready environment cannot authorize a live acceptance result. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {finalReport} from './live-gate.mjs';

const executable = fileURLToPath(new URL('./live-gate.mjs',import.meta.url));

test('ready preflight leaves each hosted transaction and release gate blocked', () => {
  const report = finalReport({ready:true,dsh:'host_challenge_observed',deepseek_environment_key:'present_unverified',
    browser:{cdp:'reachable',updream:'document_observed',leapspace:'document_observed'}});
  assert.equal(report.status,'blocked');
  assert.equal(report.transaction_attempted,false);
  assert.equal(report.gates.find(x => x.id === 'updream_generation').status,'adapter_missing');
  assert.ok(report.gates.every(x => ['adapter_missing','unverified'].includes(x.status)));
});

test('rejects a supplied success file and ignores success flags', t => {
  const dir = mkdtempSync(join(tmpdir(),'xatp-reject-demo-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const filename = join(dir,'verified-live-receipt.json');
  writeFileSync(filename,JSON.stringify({status:'passed',providerJobId:'mock',verified:true}));
  const env = {DEEPSEEK_API_KEY:'demo-secret-do-not-log',XATP_LIVE_VERIFIED:'1',XATP_LIVE_EVIDENCE:filename};
  function run(args) {
    const child = spawnSync(process.execPath,[executable,...args],{env,timeout:5000,encoding:'utf8'});
    assert.equal(child.error,undefined);
    assert.doesNotMatch(child.stdout + child.stderr,/demo-secret-do-not-log|verified-live-receipt/);
    return {code:child.status,report:JSON.parse(child.stdout)};
  }
  const live = run(['live']);
  assert.equal(live.code,2);
  assert.equal(live.report.status,'blocked');
  assert.equal(live.report.preflight.deepseek_environment_key,'present_unverified');
  const injected = run(['--evidence',filename]);
  assert.equal(injected.code,64);
  assert.equal(injected.report.reason,'unsupported_input');
});
