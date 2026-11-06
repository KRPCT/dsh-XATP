/** Exercise the installed panel through the built DSH Web profile with an isolated local workspace. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createWorkflowHost } from '../orchestration/host.mjs';
import { readWorkspace } from '../workspace.mjs';
import { createRehearsal } from '../rehearsal.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const { chromium } = createRequire(join(repo, 'apps/web/package.json'))('playwright');

async function waitForHost(child) {
  const signal = AbortSignal.timeout(30000);
  let startup = '';
  return new Promise((resolve, reject) => {
    const read = (data) => {
      startup = (startup + data).slice(-4096);
      const match = startup.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]+)\s/);
      if (match) resolve(match[1]);
    };
    signal.addEventListener('abort', () => reject(new Error('DSH Web did not start in 30 seconds')), {once:true});
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('error', reject);
    child.once('exit', code => {
      const diagnostic = startup.replace(/https?:\/\/\S+/g, '<URL>').slice(-1200);
      reject(new Error('DSH Web exited before readiness (' + code + '): ' + diagnostic));
    });
  });
}

async function openWorkspace(page, project) {
  await page.getByRole('button', {name:'Add workspace', exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'Select Workspace Directory'});
  await dialog.getByRole('button', {name:'Edit path'}).click();
  const path = dialog.getByRole('textbox', {name:'Edit path'});
  await path.fill(project);
  await path.press('Enter');
  await dialog.getByRole('button', {name:'Open', exact:true}).click();
}

test('the installed DSH right-sidebar panel reads and revises a workspace prompt', {timeout:70000}, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'xatp-native-panel-'));
  const cli = join(repo, 'apps/cli/lib/bin.js');
  const project = join(scratch, 'project');
  const plugin = join(repo, 'tooling/xatp/plugin');
  const env = {
    DEEPSEEK_API_KEY:'keyless-web-no-call', DEEPSEEK_BASE_URL:'http://127.0.0.1:9',
    PATH:process.env.PATH, TMPDIR:scratch, XDG_CACHE_HOME:join(scratch, 'cache'), XDG_CONFIG_HOME:join(scratch, 'config'),
    DSH_HOME:join(scratch, 'dsh'), DSH_AGENTS_HOME:join(scratch, 'agents'), XATP_WORKSPACE:project,
  };
  let host, browser;
  try {
    await createRehearsal(project);
    const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', scratch], {
      cwd:plugin, env, encoding:'utf8', timeout:12000,
    }))[0];
    execFileSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', join(scratch, packed.filename)], {
      cwd:scratch, env:{...env, npm_config_offline:'true'}, timeout:18000, stdio:'pipe',
    });

    host = spawn(process.execPath, [cli, 'web', '--patch', join(repo, 'apps/web/tests/pin-browse-picker.overlay.yml'),
      '--no-open', '--host', '127.0.0.1', '--port', '0'], {
      cwd:scratch, env, stdio:['ignore','pipe','pipe'], timeout:60000, killSignal:'SIGTERM',
    });
    const launch = await waitForHost(host);
    const capture = process.env.XATP_TEST_RECORDING;
    const viewport = {width:1440,height:900};
    browser = await chromium.launch({executablePath:process.env.CHROMIUM_BIN, slowMo:capture ? 180 : 0, args:['--disable-background-networking','--disable-gpu']});
    const context = await browser.newContext({viewport, locale:'en-US', recordVideo:capture ? {dir:capture,size:viewport} : undefined});
    const auth = await context.request.get(launch, {maxRedirects:0});
    assert.equal(auth.status(), 303);
    await auth.dispose();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(new URL(launch).origin);
    const notice = page.getByRole('dialog', {name:'Preview Notice'});
    await notice.getByRole('button', {name:'Continue', exact:true}).click();
    await notice.waitFor({state:'hidden'});
    await openWorkspace(page, project);
    await page.locator('[data-sidebar-right-expand]').click();
    const column = page.locator('[data-rightbar-col]');
    await column.locator('[data-sidebar-right-guide-entry="xatp"]').click();
    const panel = column.locator('[data-xatp-pane]');
    const field=panel.locator('[data-node-type="updream"] textarea');
    await field.waitFor();
    if (process.env.XATP_NATIVE_SCREENSHOT) await page.screenshot({path:process.env.XATP_NATIVE_SCREENSHOT});
    const note='同一屏幕内保留模型草稿、坐标和标签。';
    await field.fill(note);
    await panel.getByRole('button',{name:'保存工作流'}).click();
    await panel.getByRole('button',{name:'排演节点'}).click();
    await panel.locator('.xc-toast').filter({hasText:'完成 2 个节点的排演'}).waitFor();
    const workflow=createWorkflowHost(project,()=>{throw Error('unexpected browser use');}).read();
    assert.equal(workflow.plan.nodes.find(n=>n.type==='prompt').params.text,note);
    assert.equal(workflow.receipts.find(r=>r.nodeId==='updream-01').prompt,note);
    await panel.getByRole('button',{name:'素材与来源'}).click();
    await panel.locator('.x-row').filter({hasText:'锁定坐标轴'}).click();
    await panel.locator('.x-prompt-editor > button').click();
    const text = 'Keep the published axis labels and every original point.';
    await panel.locator('textarea[name=text]').fill(text);
    await panel.locator('.x-prompt-form button[type=submit]').click();
    await panel.locator('.x-kicker .x-version').filter({hasText:'v2'}).waitFor();
    const revisions = readWorkspace(project).records;
    assert.equal(revisions.find(r => r.id === 'p.plot' && r.version === 2)?.data.text, text);
    assert.equal(revisions.find(r => r.id === 'd.plot')?.stale, true);
    await context.close();
  } finally {
    try { await browser?.close(); }
    finally {
      if (host?.pid && host.exitCode === null && host.signalCode === null) {
        const exited = once(host, 'exit');
        const timer = setTimeout(() => host.kill('SIGKILL'), 1800);
        host.kill('SIGTERM');
        try { await exited; } finally { clearTimeout(timer); }
      }
      await rm(scratch, {recursive:true, force:true});
    }
  }
});
