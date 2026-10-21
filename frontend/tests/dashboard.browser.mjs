import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const origin='http://127.0.0.1:4174/intercepted/';
const forecasts=JSON.parse(await readFile('public/predictions.json','utf8'));
const performance=JSON.parse(await readFile('public/performance.json','utf8'));
const rows=performance.datasets.verified.v4_qb_plus.rows.filter(r=>r.season===forecasts.season && r.week<=forecasts.week);
const graded=rows.filter(r=>['correct','incorrect'].includes(r.grade));
const expectedAccuracy=graded.length?`${(graded.filter(r=>r.grade==='correct').length/graded.length*100).toFixed(1)}%`:'—';
const events=forecasts.games.map((game,i)=>({date:`${game.game_date}T17:00:00Z`,competitions:[{competitors:[{homeAway:'home',score:'27',team:{abbreviation:game.home_team}},{homeAway:'away',score:'21',team:{abbreviation:game.away_team}}]}],status:{type:{state:i===0?'post':i===1?'in':'pre',completed:i===0,shortDetail:i===0?'Final':'Q3 8:12'}}}));
await mkdir('qa/dashboard',{recursive:true});
const browser=await chromium.launch();const errors=[];
try {
 for(const width of [375,650,900,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',timezoneId:'America/Chicago'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  let fail=false;
  await page.route('**/*',route=>{
   const req=route.request();if(req.url().startsWith('http://127.0.0.1:4174'))return route.continue();
   if(req.url().includes('/scoreboard?'))return route.fulfill(fail?{status:503,body:'Unavailable'}:{json:{events:req.url().includes(`week=${forecasts.week}`)?events:[]}});
   if(req.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'});
   return route.fulfill({json:{events:[]}});
  });
  await page.goto(origin);
  const cards=page.locator('.pulse-card');await page.locator('.pulse-value').first().getByText(expectedAccuracy,{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.score-ticker-status')?.textContent==='Final');
  assert.equal(await cards.count(),3);
  assert.equal(await cards.nth(1).locator('.pulse-value').innerText(),String(new Set(rows.map(r=>r.game_id)).size));
  assert.equal(await page.getByText('Model vs. Vegas',{exact:true}).count(),0);
  assert.equal(await page.locator('.score-ticker-team').count(),forecasts.games.length*2);
  assert.equal(await page.locator('.score-ticker-team strong').first().innerText(),'21');
  assert.equal(await page.locator('.score-ticker-status.is-live').count(),1);
  await page.getByRole('button',{name:'Next score matchups',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.score-ticker-window').scrollLeft>0);
  await page.getByRole('button',{name:'Pause scoreboard scrolling',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Resume scoreboard scrolling'}).getAttribute('aria-pressed'),'true');
  await page.locator('.score-ticker-game').nth(2).click();await page.getByRole('button',{name:'Close matchup'}).waitFor();
  await page.getByRole('button',{name:'Close matchup'}).click();
  assert.equal(await page.locator('.score-ticker-game.is-selected').getAttribute('aria-current'),'true');
  await page.getByLabel('Record model',{exact:true}).selectOption('v5_qb_plus');
  await page.waitForFunction(()=>document.querySelector('.pulse-value')?.textContent==='—');
  assert.equal(await cards.first().getByText('No graded games yet',{exact:true}).count(),1);
  await page.getByLabel('Record model',{exact:true}).selectOption('v4_qb_plus');
  await page.locator('.pulse-value').first().getByText(expectedAccuracy,{exact:true}).waitFor();
  // Page geometry and card contents remain readable at mobile/tablet/desktop widths.
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok(await cards.evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+1)));
  await page.evaluate(async()=>{for(const img of document.images)img.loading='eager';await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r;})));window.scrollTo(0,0);});
  await page.screenshot({path:`qa/dashboard/${width}-dashboard.png`,fullPage:true});
  await page.locator('.season-pulse').screenshot({path:`qa/dashboard/${width}-metrics.png`});
  await page.getByLabel('Prediction week').selectOption('2026-6');
  await page.waitForFunction(()=>document.querySelector('.score-ticker-label strong')?.textContent==='WEEK 6');
  await page.locator('.score-ticker-status').first().getByText('FINAL · SAVED',{exact:true}).waitFor();
  await page.locator('.score-ticker').screenshot({path:`qa/dashboard/${width}-archive-scores.png`});
  // A failed score API cannot display a fabricated score. Archived finals still use saved outcomes.
  fail=true;await page.reload();
  await page.waitForFunction(()=>document.querySelector('.score-ticker-status')?.textContent==='SCORES UNAVAILABLE');
  assert.equal(await page.locator('.score-ticker-team strong').first().innerText(),'');
  await page.getByLabel('Prediction week').selectOption('2026-6');
  await page.locator('.score-ticker-status').first().getByText('FINAL · SAVED',{exact:true}).waitFor();
  await context.close();console.log(`PASS ${width}px: metrics, charts, ticker, navigation, archive outcomes, API failure, no overflow.`);
 }
 assert.deepEqual(errors,[]);console.log('PASS: no browser errors.');
}finally{await browser.close();}
