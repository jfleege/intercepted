import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import process from 'node:process';
const origin='http://127.0.0.1:4174/intercepted/';
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});
const errors=[], reports=[];
await mkdir('qa/glass',{recursive:true});
try {
 for(const width of [375,650,900,1440]) {
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'no-preference'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  let release;const pending=new Promise(resolve=>{release=resolve;});
  await page.route('**/*',async r=>{
   const req=r.request(),url=req.url();
   if(url.startsWith('http://127.0.0.1:4174')){
    if(new URL(url).pathname.endsWith('/predictions.json'))await pending;
    return r.continue();
   }
   return r.fulfill(req.resourceType()==='image'?{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}:{json:{events:[]}});
  });
  await page.goto(origin);
  const loading=page.getByRole('status',{name:'Loading predictions',exact:true});
  await loading.waitFor();
  assert.equal(await loading.getAttribute('aria-busy'),'true');
  assert.equal(await page.locator('.loading-game').count(),5);
  assert.equal(await page.locator('.loading-wheel').count(),1);
  assert.equal(await loading.evaluate(e=>getComputedStyle(e,'::after').animationName),'glass-loading');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`qa/glass/${width}-loading.png`,fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await loading.evaluate(e=>getComputedStyle(e,'::after').animationName),'none');
  release();await page.locator('.ud-game').first().waitFor();await loading.waitFor({state:'hidden'});
  await page.locator('.dp-player-card').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.hp-player').count(),11);
  assert.equal(await page.locator('.ud-hero').evaluate(e=>getComputedStyle(e).borderRadius),'18px');
  assert.equal(await page.locator('.ud-panel').first().evaluate(e=>getComputedStyle(e).borderRadius),'16px');
  assert.equal(await page.locator('.ud-matchup-grid').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.screenshot({path:`qa/glass/${width}-dashboard.png`,fullPage:true});
  await page.locator('.ud-hero').screenshot({path:`qa/glass/${width}-hero.png`});
  await page.getByRole('button',{name:'Full matchup analysis',exact:false}).click();await page.getByRole('dialog').waitFor();
  await page.screenshot({path:`qa/glass/${width}-modal.png`});
  assert.equal(await page.locator('main').getAttribute('inert'),'');
  const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
  reports.push({width,page:'modal',violations:results.violations});
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('main').getAttribute('inert'),null);
  for(const [route,selector] of [['players','.pi-player-row'],['matchups','.mx-panel'],['performance','.ph-toolbar'],['markets','.mb-panel']]) {
   await page.locator(`.dash-nav a[href="#${route}"]`).click();
   const panel=page.locator(`[data-page="${route}"]`);await panel.locator(selector).first().waitFor();
   await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} overflow at ${width}`);
   await page.screenshot({path:`qa/glass/${width}-${route}.png`});
   const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
   reports.push({width,page:route,violations:audit.violations});
  }
  await context.close();console.log(`PASS glass ${width}px: matched skeletons, reduced motion, original hero, all pages, modal, no overflow.`);
 }
 assert.deepEqual(errors,[]);
 const violations=reports.flatMap(r=>r.violations.map(v=>({width:r.width,page:r.page,id:v.id,impact:v.impact})));
 assert.deepEqual(violations,[]);
}finally{await writeFile('qa/glass/accessibility.json',JSON.stringify(reports,null,2));await browser.close();}
