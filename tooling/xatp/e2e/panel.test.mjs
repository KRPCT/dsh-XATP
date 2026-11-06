/** Browser regression for the portable panel. The separate live gate owns provider acceptance. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writePreview } from '../preview.mjs';

const { chromium } = createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('playwright');

test('inspect a real local film, trace records, edit a prompt and inspect read-only observations', {timeout:60000}, async t => {
  const dir = mkdtempSync(join(tmpdir(),'xatp-panel-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const project = join(dir,'project'), html = join(dir,'index.html');
  execFileSync(process.execPath,[new URL('../rehearsal-video.mjs',import.meta.url).pathname,project],{timeout:35000});
  writePreview(project,html);
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN,args:['--disable-gpu','--disable-background-networking']});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1360,height:860},colorScheme:'light',locale:'zh-CN'});
  const errors=[], network=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',r=>{if(/^https?:/.test(r.url())) network.push(r.url());});
  await page.goto(pathToFileURL(html).href);
  const film=page.locator('video');
  await film.waitFor({timeout:5000});
  await page.waitForFunction(()=>document.querySelector('video')?.duration===6);
  assert.equal(await film.evaluate(v=>v.videoWidth),720);
  assert.ok(await film.getAttribute('poster'));
  await film.evaluate(async v=>{await v.play();v.currentTime=3.5;});
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime>=3.5);
  await film.evaluate(v=>v.pause());
  await page.locator('.x-ref').filter({hasText:'如何解释分类阈值'}).press('Enter');
  assert.equal(await page.locator('.x-title').innerText(),'如何解释分类阈值？');
  await page.locator('.x-ref').filter({hasText:'An introduction to ROC analysis'}).press('Enter');
  await page.getByText('记录详情',{exact:true}).click();
  assert.ok((await page.locator('body').innerText()).includes('10.1016/j.patrec.2005.10.010'));
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
  await page.locator('button[data-view="shots"]').press('ArrowRight');
  assert.equal(await page.locator('.x-canvas').count(),1);
  assert.deepEqual(network,[]);
  assert.deepEqual(errors,[]);
});
