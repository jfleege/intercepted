import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import process from 'node:process';
const origin='http://127.0.0.1:4174/intercepted/';
const slate=JSON.parse(await readFile('public/predictions.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});
let activePage;
const errors=[],reports=[];await mkdir('qa/polish',{recursive:true});
try{
 for(const width of [375,650,900,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage(),requests=new Map();activePage=page;page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.layoutShift=0;window.layoutSources=[];new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput){window.layoutShift+=e.value;window.layoutSources.push({value:e.value,nodes:e.sources.map(s=>s.node?.className)});}}).observe({type:'layout-shift',buffered:true});});
  await page.route('**/*',async route=>{
   const req=route.request(),url=req.url();if(url.startsWith('http://127.0.0.1:4174')){
    const name=new URL(url).pathname.split('/').at(-1);requests.set(name,(requests.get(name)||0)+1);
    if(name==='player_intelligence.json')await new Promise(r=>setTimeout(r,500));
    return route.continue();
   }
   if(req.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
   return route.fulfill({json:{events:[]}});
  });
  await page.goto(origin);await page.locator('.ud-game').first().waitFor();await page.locator('.dp-player-card').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  const navigation=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return {domContentLoadedMs:n.domContentLoadedEventEnd,startupJsBytes:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js')).reduce((a,r)=>a+r.decodedBodySize,0),layoutShift:window.layoutShift,layoutSources:window.layoutSources};});
  assert.ok(navigation.startupJsBytes<350000,`Initial JS budget exceeded: ${navigation.startupJsBytes}`);
  assert.equal(requests.get('predictions.json'),1);assert.equal(requests.get('players_watch.json'),1);
  assert.equal(await page.title(),'Intercepted');assert.ok(await page.locator('meta[name="description"]').getAttribute('content'));
  await page.locator('.dash-nav a[href="#players"]').click();
  await page.getByRole('status',{name:'Loading player research',exact:true}).waitFor();
  await page.screenshot({path:`qa/polish/${width}-loading.png`});
  const players=page.locator('[data-page="players"]');await players.locator('.pi-player-row').first().waitFor();
  assert.equal(await page.title(),'Players | Intercepted');
  await players.getByRole('button',{name:'QB',exact:true}).click();
  await players.getByLabel('Player team',{exact:true}).selectOption('CHI');
  await page.evaluate(()=>window.scrollTo({top:400,behavior:'instant'}));await page.waitForTimeout(80);
  const savedScroll=await page.evaluate(()=>scrollY);
  await page.locator('.dash-nav a[href="#markets"]').click();const markets=page.locator('[data-page="markets"]');await markets.locator('.mb-offer').first().waitFor();
  assert.ok(await page.evaluate(()=>scrollY<30));
  assert.equal(await players.isVisible(),false);
  assert.equal(await markets.locator('.mb-combinations').count(),0);
  await markets.getByLabel('Market game',{exact:true}).selectOption(slate.games[0].game_id);
  await markets.getByRole('button',{name:'Player yards',exact:true}).click();
  const target=markets.locator('.mb-target input').first();if(await target.count()){
   await target.fill('');assert.equal(await target.getAttribute('aria-invalid'),'true');
   assert.ok(await markets.getByText('Enter a target of zero or greater.',{exact:false}).count());await target.fill('55.5');assert.equal(await target.getAttribute('aria-invalid'),'false');
  }
  assert.equal(await markets.getByLabel('Paper stake ($)',{exact:true}).count(),0);
  assert.equal(await markets.getByLabel('Manual combined American price',{exact:true}).count(),0);
  await markets.locator('.lm-lab>summary').click();await markets.getByLabel('Probability reduction',{exact:true}).fill('8');
  await markets.locator('.mb-advanced>summary').click();await markets.getByLabel('Probability profile',{exact:true}).selectOption('unscored');
  await page.locator('.dash-nav a[href="#players"]').click();
  assert.equal(await players.getByLabel('Player team',{exact:true}).inputValue(),'CHI');assert.equal(await players.getByRole('button',{name:'QB',exact:true}).getAttribute('aria-pressed'),'true');
  await page.waitForTimeout(100);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-savedScroll)<20,`Scroll restoration: saved ${savedScroll}, actual ${await page.evaluate(()=>scrollY)}`);
  assert.equal(requests.get('player_intelligence.json'),1);
  await page.locator('.dash-nav a[href="#markets"]').click();assert.equal(await markets.getByLabel('Market game',{exact:true}).inputValue(),slate.games[0].game_id);assert.equal(await markets.getByLabel('Probability profile',{exact:true}).inputValue(),'unscored');
  assert.equal(await markets.getByLabel('Probability reduction',{exact:true}).inputValue(),'8');
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(width<=650)assert.ok(await page.locator('.dash-search').evaluate(e=>e.getBoundingClientRect().width>innerWidth-60));
  assert.equal(requests.get('predictions.json'),1);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
  reports.push({width,navigation,violations:axe.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))});
  const severe=axe.violations.filter(v=>v.impact==='critical');assert.deepEqual(severe.map(v=>v.id),[]);
  await page.screenshot({path:`qa/polish/${width}-markets.png`});
  await page.locator('.dash-nav a[href="#dashboard"]').click();await page.getByRole('button',{name:'Full matchup analysis',exact:false}).click();
  await page.getByRole('dialog').waitFor();assert.equal(await page.locator('main').getAttribute('inert'),'');
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.locator('main').getAttribute('inert'),null);
  assert.ok(await page.getByRole('button',{name:'Full matchup analysis',exact:false}).evaluate(e=>e===document.activeElement));
  await page.emulateMedia({reducedMotion:'no-preference'});const arc=await page.locator('.ud-winner-arc').elementHandle();await page.locator('.ud-game').nth(1).click();assert.ok(await page.locator('.ud-winner-arc').evaluate((e,old)=>e===old,arc));
  assert.equal(await page.locator('.ud-winner-arc').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.ud-winner-arc').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  await page.goto(origin+'404.html');assert.equal(await page.title(),'Page not found | Intercepted');await page.getByRole('link',{name:'Back to dashboard'}).click();await page.locator('.ud-game').first().waitFor();
  await context.close();console.log(`PASS ${width}px cache/state/scroll, loading, controls, validation, modal, metadata/404, motion, accessibility`);
 }
 assert.deepEqual(errors,[]);
}finally{if(activePage&&!activePage.isClosed())await activePage.screenshot({path:'qa/polish/failure.png'});await writeFile('qa/polish/report.json',JSON.stringify(reports,null,2));await browser.close();}
