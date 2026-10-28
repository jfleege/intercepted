// Browser-only identity/coverage fixture; never replaces a published forecast.
import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import process from 'node:process';
const origin='http://127.0.0.1:4174/intercepted/';
const data=JSON.parse(await readFile('public/predictions.json','utf8'));
const game=data.games.find(g=>[g.home_team,g.away_team].includes('TB'));
assert.ok(game,'Fixture needs the tracked Tampa Bay matchup');
const side=game.home_team==='TB'?'home':'away';
const note="Low-volume Week 7 NGS omitted; using this QB's available tracking history through 2026 Week 3";
game[`${side}_projected_qb_name`]='Baker Mayfield';game[`${side}_projected_qb_id`]='00-0034855';
game[`${side}_qb_selection`]={status:'unconfirmed_proxy',ngs_coverage_note:note};
const now=new Date().toISOString();
const status={schema_version:1,snapshot_at:now,active_season:data.season,active_week:data.week,sources:[],attempt:{steps:{}},forecast_check:{checked_at:now,active_season:data.season,active_week:data.week,target_season:data.season,target_week:data.week,state:'current_limited_qb',message:'Published slate uses qualified low-volume NGS exclusions. TB: Baker Mayfield NGS through 2026 Week 3.'}};
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined}),errors=[];
await mkdir('qa/qb-coverage',{recursive:true});
try{
 for(const width of [375,650,900,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const req=route.request(),url=req.url();
   if(url.endsWith('/predictions.json'))return route.fulfill({json:data});
   if(url.endsWith('/refresh_status.json'))return route.fulfill({json:status});
   if(url.startsWith('http://127.0.0.1:4174'))return route.continue();
   if(req.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
   return route.fulfill({json:{events:[]}});
  });
  await page.goto(origin);await page.getByText('Current slate · limited QB tracking',{exact:true}).waitFor();
  await page.locator(`.ud-game[aria-label^="${game.away_team} at ${game.home_team}."]`).click();await page.locator('.ud-focus .qb-coverage-note').waitFor();
  assert.ok((await page.locator('.ud-projected-qbs').textContent()).includes('Baker Mayfield'));
  await page.getByRole('button',{name:'Full matchup analysis',exact:false}).click();await page.getByRole('dialog').getByText(note,{exact:true}).waitFor();
  assert.ok(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:`qa/qb-coverage/${width}-dialog.png`});await page.getByRole('button',{name:'Close matchup'}).click();
  await page.locator('.dash-nav a[href="#matchups"]').click();
  const panel=page.locator('[data-page="matchups"]');await panel.locator('.qb-coverage-note').waitFor();assert.ok((await panel.locator('.mx-briefing').textContent()).includes('Baker Mayfield'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok(await panel.locator('.qb-coverage-note').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:`qa/qb-coverage/${width}-matchups.png`});await context.close();console.log(`PASS ${width}px Mayfield identity, older-input disclosure, status and no overflow`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
