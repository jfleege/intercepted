import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import process from 'node:process';
const origin='http://127.0.0.1:4174/intercepted/';
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});
const errors=[],reports=[];
await mkdir('qa/footer',{recursive:true});
try {
 for(const width of [375,650,900,1440]) {
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4174')?r.continue():r.fulfill(r.request().resourceType()==='image'?{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}:{json:{events:[]}}));
  await page.goto(origin);await page.locator('.ud-game').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  const footer=page.locator('.site-footer');
  assert.ok((await footer.textContent()).includes(`© ${new Date().getFullYear()} Intercepted.`));
  assert.equal(await footer.locator('a[href="https://github.com/jfleege/intercepted/issues/new"]').count(),1);
  assert.equal(await footer.locator('a[href="#privacy"]').count(),1);
  assert.equal(await footer.locator('a[href="#terms"]').count(),1);
  assert.ok(await footer.locator('a,button').evaluateAll(els=>els.every(e=>e.scrollWidth<=e.clientWidth+1)));
  assert.equal(await page.getByRole('contentinfo').count(),1);
  await footer.screenshot({path:`qa/footer/${width}-footer.png`});
  await footer.getByRole('button',{name:'Data status',exact:true}).click();
  assert.equal(await page.locator('#refresh-status').getAttribute('open'),'');
  assert.equal(new URL(page.url()).hash,'');
  assert.ok(await page.locator('#refresh-status > summary').evaluate(e=>e===document.activeElement));
  await page.getByRole('button',{name:'Full matchup analysis',exact:false}).click();
  await page.getByRole('dialog').waitFor();assert.equal(await footer.getAttribute('inert'),'');
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await footer.getAttribute('inert'),null);
  // Preserve research controls while visiting information pages.
  await page.locator('.dash-nav a[href="#players"]').click();
  const players=page.locator('[data-page="players"]');await players.locator('.pi-player-row').first().waitFor();
  await players.getByRole('button',{name:'QB',exact:true}).click();
  await players.getByLabel('Player team',{exact:true}).selectOption('CHI');
  for(const [route,title] of [['privacy','Privacy'],['terms','Terms'],['methodology','Models & data sources']]) {
   await footer.locator(`a[href="#${route}"]`).click();
   const article=page.locator(`[data-page="${route}"] .info-page`);await article.waitFor();
   assert.equal(await page.title(),`${title} | Intercepted`);
   assert.ok(await article.locator('h1').evaluate(e=>e===document.activeElement));
   assert.equal(await page.locator('.dash-search').count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   assert.ok(await article.locator('.info-section').evaluateAll(els=>els.every(e=>e.scrollWidth<=e.clientWidth+1)));
   const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
   reports.push({width,route,violations:audit.violations});
   assert.deepEqual(audit.violations.map(v=>v.id),[]);
   await page.screenshot({path:`qa/footer/${width}-${route}.png`});
  }
  await page.goBack();await page.locator('[data-page="terms"] .info-page').waitFor();
  assert.equal(await page.title(),'Terms | Intercepted');
  await page.goForward();await page.locator('[data-page="methodology"] .info-page').waitFor();
  await page.locator('.dash-nav a[href="#players"]').click();
  assert.equal(await players.getByRole('button',{name:'QB',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await players.getByLabel('Player team',{exact:true}).inputValue(),'CHI');
  await page.goto(origin+'#privacy');await page.locator('[data-page="privacy"] .info-page').waitFor();
  assert.equal(await page.title(),'Privacy | Intercepted');
  assert.ok(await page.getByRole('heading',{name:'Hosting & third-party requests',exact:true}).count());
  assert.equal(await page.locator('a[href="https://www.nfl.com/legal/privacy/"]').count(),1);
  await page.reload();await page.locator('[data-page="privacy"] .info-page').waitFor();
  assert.equal(await page.title(),'Privacy | Intercepted');
  await page.locator('.info-back').click();await page.locator('.ud-hero').waitFor();
  assert.equal(await page.title(),'Intercepted');
  assert.equal(await page.locator('.hp-player').count(),11);
  await context.close();console.log(`PASS footer ${width}px: links, direct routes/reload/back/forward, titles/focus, status shortcut, retained player state, hero, zero accessibility violations, no overflow.`);
 }
 assert.deepEqual(errors,[]);
}finally{await writeFile('qa/footer/accessibility.json',JSON.stringify(reports,null,2));await browser.close();}
