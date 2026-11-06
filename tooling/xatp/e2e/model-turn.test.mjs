/** Real DSH headless loop and packaged native plugin, with a deterministic loopback model response. */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {startMockLlmServer} from '../../../packages/test-support/llm-mock-server/lib/index.js';
import {createWorkflowHost} from '../orchestration/host.mjs';
import {initWorkspace} from '../workspace.mjs';

test('headless model tool call resolves prompt dependencies and records the returned rehearsal in SQLite', {timeout:40_000}, async () => {
  const staging = await mkdtemp(join(tmpdir(),'xatp-headless-'));
  const workspace = join(staging,'project');
  const root = fileURLToPath(new URL('../../../',import.meta.url));
  let model;
  try {
    initWorkspace(workspace,'Workstation test','demo');
    const patch = join(staging,'probe.json');
    await writeFile(patch,JSON.stringify([{insert:[{id:'xatp-probe',name:join(root,'tooling/xatp/plugin/dist/host.mjs')}]}]));
    model = await startMockLlmServer({host:'127.0.0.1',port:0,sequence:['tool_call_success','success'],repeatLast:true,
      toolName:'xatp_orchestration_run',toolArguments:JSON.stringify({targetId:'updream-01',mode:'dry-run'}),successText:'REHEARSAL_COMPLETE'});
    const env = {PATH:process.env.PATH,HOME:staging,DSH_HOME:join(staging,'dsh'),DSH_AGENTS_HOME:join(staging,'agents'),
      TMPDIR:staging,NO_PROXY:'127.0.0.1,localhost',XATP_WORKSPACE:workspace,
      DEEPSEEK_API_KEY:'mock-local-only',DEEPSEEK_BASE_URL:model.baseURL+'/v1'};
    const command = [join(root,'apps/cli/lib/bin.js'),'headless','--patch',patch,'Rehearse the first Updream shot with the native orchestration tool.'];
    const {stdout} = await promisify(execFile)(process.execPath,command,{env,cwd:workspace,timeout:28_000,maxBuffer:512_000});
    assert.match(stdout,/REHEARSAL_COMPLETE/);
    const messages = model.requests.flatMap(request=>request.body?.messages || []);
    const block = messages.flatMap(message=>Array.isArray(message.content) ? message.content : []).find(item=>item.type==='tool_result');
    assert.equal(block?.is_error,false,'Headless model should receive a successful native tool result');
    const received = JSON.parse(block.content[0].text);
    assert.deepEqual(received.order,['prompt-01','updream-01']);
    assert.equal(received.ok,true);
    assert.equal(received.estimates['updream-01'].credits,250);
    assert.equal(received.estimates['updream-01'].submitAllowed,false);
    const restored = createWorkflowHost(workspace,()=>assert.fail('Unexpected browser')).read();
    assert.equal(restored.receipts.length,2);
    assert.deepEqual(restored.receipts,received.receipts);
    assert.equal(restored.receipts.at(-1).prompt,restored.plan.nodes[0].params.text);
    assert.equal(restored.receipts.at(-1).status,'dry-run');
  } finally {
    await model?.close();
    await rm(staging,{recursive:true,force:true});
  }
});
