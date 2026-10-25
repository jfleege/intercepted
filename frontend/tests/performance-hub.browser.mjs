import process from 'node:process';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const origin='http://127.0.0.1:4174/intercepted/';
const payload=JSON.parse(await readFile('public/research_performance.json','utf8'));
const legacy=JSON.parse(await readFile('public/performance.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});const errors=[];
const fmt=(v,d)=>v==null?'—':v.toFixed(d),pct=v=>v==null?'—':`${(v*100).toFixed(1)}%`;
try{
 await mkdir('qa/performance',{recursive:true});
 for(const width of [375,650,900,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4174')?r.continue():r.fulfill(r.request().resourceType()==='image'?{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'}:{json:{events:[]}}));
  await page.goto(origin+'#performance');await page.locator('.ph-audit').waitFor();await page.evaluate(()=>document.fonts.ready);
  const groups=payload.datasets.verified.groups.filter(g=>g.version==='all');const g=t=>groups.find(g=>g.target===t);
  assert.deepEqual(await page.locator('.ph-kpi strong').allTextContents(),[pct((g('winner:v5_qb_plus')??g('winner:v4_qb_plus'))?.accuracy),fmt(g('total')?.error,1),fmt(g('receiving')?.error,1),fmt(g('any_td')?.error,4)]);
  assert.equal(await page.locator('.ph-health-item').count(),['winner:v5_qb_plus','total','margin','passing','rushing','receiving','any_td','pass_td'].filter(t=>g(t)).length);
  const bg=await page.locator('.ph-panel').first().evaluate(e=>getComputedStyle(e).backgroundColor);assert.equal(bg,'rgb(16, 38, 49)');
  await page.screenshot({path:`qa/performance/${width}-overview.png`,fullPage:true});
  await page.getByRole('button',{name:'Scoring',exact:true}).click();await page.getByLabel('Research forecast',{exact:true}).selectOption('margin');
  assert.equal(await page.locator('.ph-kpi strong').nth(1).textContent(),fmt(g('margin')?.error,1));
  await page.getByRole('button',{name:'Player yards',exact:true}).click();await page.getByLabel('Research forecast',{exact:true}).selectOption('receiving');
  assert.equal(await page.locator('.ph-kpi strong').nth(1).textContent(),fmt(g('receiving')?.error,1));
  const versions=await page.getByLabel('Weight version',{exact:true}).locator('option').evaluateAll(opts=>opts.map(o=>o.value));
  if(versions.length>1){await page.getByLabel('Weight version',{exact:true}).selectOption(versions[1]);assert.ok(!(await page.locator('.ph-health').textContent()).includes('version mixed'));await page.getByLabel('Weight version',{exact:true}).selectOption('all');}
  await page.getByRole('button',{name:'Touchdowns',exact:true}).click();await page.getByLabel('Research forecast',{exact:true}).selectOption('pass_td');
  assert.equal(await page.locator('.ph-kpi strong').nth(1).textContent(),fmt(g('pass_td')?.error,4));
  await page.getByRole('button',{name:'Late / unverified',exact:true}).click();assert.equal(await page.locator('.ph-health').count(),0);
  await page.getByRole('button',{name:'Historical benchmark',exact:true}).click();assert.ok(await page.getByRole('heading',{name:'Retrospective research benchmark',exact:true}).count());assert.equal(await page.locator('.ph-health').count(),0);
  await page.getByRole('button',{name:'Winners',exact:true}).click();await page.locator('.performance-page .review-draft').filter({hasText:'ARCHIVED SNAPSHOTS'}).waitFor();
  assert.equal(await page.locator('.review-metric strong').first().textContent(),pct(legacy.datasets.verified.v5_qb_plus.summary.accuracy));
  await page.getByRole('button',{name:'Historical backtest',exact:true}).click();await page.getByLabel('Model',{exact:true}).selectOption('v4_a');
  assert.equal(await page.locator('.review-metric strong').first().textContent(),pct(legacy.datasets.backtest.v4_a.summary.accuracy));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No page overflow at ${width}`);
  await page.screenshot({path:`qa/performance/${width}-winners.png`,fullPage:true});
  await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Verified pregame',exact:true}).click();
  // Faulted research endpoint must keep winner records reachable.
  await page.route('**/research_performance.json',r=>r.fulfill({status:503,body:''}));await page.reload();await page.getByRole('alert').waitFor();
  await page.getByRole('button',{name:'Winners',exact:true}).click();await page.locator('.review-metric strong').first().waitFor();
  assert.equal(await page.locator('.review-metric strong').first().textContent(),pct(legacy.datasets.verified.v5_qb_plus.summary.accuracy));
  await page.close();console.log(`PASS ${width}: real metric values, families/targets/versions, dataset isolation, preserved winner records, error fallback, dark styling and no overflow`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
