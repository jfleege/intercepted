import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import process from 'node:process';
const origin='http://127.0.0.1:4174/intercepted/';
const original=JSON.parse(await readFile('public/refresh_status.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});
const errors=[];
await mkdir('qa/status',{recursive:true});
try {
 for(const width of [375,650,900,1440]) {
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',timezoneId:'America/Chicago'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const now=Date.now(),iso=delta=>new Date(now+delta).toISOString();
  let status={...original,snapshot_at:iso(0),last_successful_refresh_at:iso(-3_600_000),next_forecast_check_at:iso(3600000),attempt:{state:'success',mode:'full',completed_at:iso(0),steps:{}},forecast_check:{checked_at:iso(0),active_season:original.active_season,active_week:original.active_week,target_season:original.active_season,target_week:original.active_week+1,state:'waiting_stats',message:'QB statistics missing 2 completed team-weeks'}};
  let unavailable=false;
  await page.route('**/*',route=>{
   const req=route.request();
   if(req.url().endsWith('/refresh_status.json'))return unavailable?route.fulfill({status:404,body:'Not found'}):route.fulfill({json:status});
   if(req.url().startsWith('http://127.0.0.1:4174'))return route.continue();
   if(req.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
   return route.fulfill({json:{events:[]}});
  });
  await page.goto(origin);await page.getByText(`Waiting for Week ${original.active_week+1} stats`,{exact:true}).waitFor();
  const trigger=page.locator('#refresh-status');
  const panel=page.getByRole('dialog',{name:'Data status',exact:true});
  assert.equal(await panel.isVisible(),false);
  await trigger.focus();await page.keyboard.press('Enter');await panel.waitFor();
  if(width>=1200){
   const cards=await page.locator('.dashboard-status-row .status-card').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().toJSON()));
   assert.equal(cards.length,2);
   assert.equal(cards[0].y,cards[1].y);
   assert.equal(cards[0].height,cards[1].height);
  }
  await page.getByText('QB statistics missing 2 completed team-weeks',{exact:true}).waitFor();assert.equal(await panel.locator('dt').count(),8);
  assert.ok(await panel.innerText().then(v=>v.includes('Inputs through Week')));
  assert.equal(await panel.evaluate(e=>getComputedStyle(e).animationName),'none');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  for(const item of await panel.locator('dd,dt').all())assert.ok(await item.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:`qa/status/${width}-expanded.png`});
  await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  assert.ok(await trigger.evaluate(e=>e===document.activeElement));
  await page.screenshot({path:`qa/status/${width}-collapsed.png`});
  await page.locator('.dash-nav a[href="#players"]').click();assert.ok(await trigger.isVisible());
  status={...status,forecast_check:{...status.forecast_check,state:'current'},attempt:{...status.attempt,steps:{research:'failure'}}};
  await page.reload();await page.getByText('Some data updates did not complete',{exact:true}).waitFor();
  status={...status,snapshot_at:iso(-31*3600000)};await page.reload();await page.getByText('Refresh status is over 30 hours old',{exact:true}).waitFor();
  unavailable=true;await page.reload();await page.getByText('Refresh status unavailable',{exact:true}).waitFor();
  await context.close();console.log(`PASS ${width}px status, keyboard, failures, stale and missing evidence`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
