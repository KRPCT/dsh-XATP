/** Browser regression for the portable panel. The separate live gate owns provider acceptance. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createRehearsal } from '../rehearsal.mjs';
import { writePreview } from '../preview.mjs';

const { chromium } = createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('playwright');

test('edit, save and rehearse an offline workflow while preserving the evidence drawers', {timeout:60000}, async t => {
  const dir = mkdtempSync(join(tmpdir(),'xatp-panel-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const project = join(dir,'project'), html = join(dir,'index.html');
  await createRehearsal(project);
  writePreview(project,html);
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN,args:['--disable-gpu','--disable-background-networking']});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1360,height:860},colorScheme:'light',locale:'zh-CN'});
  const errors=[], network=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',r=>{if(/^https?:/.test(r.url())) network.push(r.url());});
  await page.goto(pathToFileURL(html).href);
  const field=page.locator('[data-node-type="updream"] textarea');
  await field.fill('镜头验收：保留模型草稿中的刻度和注释。');
  await page.getByRole('button',{name:'保存工作流'}).click();
  await page.getByRole('button',{name:'排演节点'}).click();
  await page.getByText(/完成 2 个节点的排演/).first().waitFor();
  await page.reload();
  await field.waitFor();
  assert.equal(await field.inputValue(),'镜头验收：保留模型草稿中的刻度和注释。');
  assert.equal(await page.locator('[data-node-id]').count(),3);
  await page.getByRole('button',{name:'运行历史'}).click();
  await page.locator('.xc-receipt').first().waitFor();
  assert.equal(await page.locator('.xc-receipt').count(),2);
  await page.getByText('查看本次提示词',{exact:true}).click();
  assert.equal(await page.locator('.xc-used-prompt p').innerText(),await field.inputValue());
  await page.getByRole('button',{name:'镜头与剪辑'}).click();
  await page.locator('button[data-view="assets"]').click();
  await page.locator('.x-row').filter({hasText:'锁定坐标轴'}).click();
  await page.getByRole('button',{name:'编辑提示词',exact:true}).click();
  await page.locator('textarea[name="text"]').fill('沿草稿中的阈值顺序逐个显示工作点。');
  await page.getByRole('button',{name:'保存为新版本',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.x-detail-head .x-version')?.textContent==='v2');
  await page.locator('button[data-view="shots"]').click();
  assert.ok((await page.locator('.x-detail-head').innerText()).includes('待复核'));
  await page.locator('button[data-view="browser"]').click();
  assert.ok((await page.locator('body').innerText()).includes('离线预览未连接浏览器'));
  assert.ok((await page.locator('body').innerText()).includes('864'));
  await page.locator('button[data-view="shots"]').click();
  await page.emulateMedia({colorScheme:'dark'});
  for(const width of [760,390,320]) {
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow at '+width);
  }
  await page.getByRole('button',{name:'返回画布'}).click();
  await page.getByRole('button',{name:'添加节点'}).click();
  assert.equal(await page.locator('.xc-popup button').count(),7);
  assert.equal(await page.locator('.xc-popup button:disabled').count(),3);
  assert.deepEqual(network,[]);
  assert.deepEqual(errors,[]);
});
