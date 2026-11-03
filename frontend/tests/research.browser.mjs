import process from 'node:process';
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const predictions=JSON.parse(await readFile('public/predictions.json','utf8'));
const report=JSON.parse(await readFile(`public/research/${predictions.season}-week-${predictions.week}.json`,'utf8'));
const origin='http://127.0.0.1:4174/intercepted/';
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined});
const errors=[];
try{
 await mkdir('qa/research',{recursive:true});
 for(const width of [375,650,900,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4174')?r.continue():r.fulfill(r.request().resourceType()==='image'?{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'}:{json:{events:[]}}));
  await page.goto(origin);await page.locator('.ud-game').first().waitFor();
  const row=page.locator('.ud-game').first();const label=await row.getAttribute('aria-label');
  const game=predictions.games.find(g=>label.startsWith(`${g.away_team} at ${g.home_team}.`));assert.ok(game);
  await row.click();const open=page.getByRole('button',{name:'Full matchup analysis',exact:false});await open.click();
  await page.locator('.mr-score-card').first().waitFor();
  const saved=report.games[game.game_id];assert.ok(saved);
  assert.deepEqual(await page.locator('.mr-score-card > strong').allTextContents(),[saved.scoring.away.expected_points.toFixed(1),saved.scoring.home.expected_points.toFixed(1),saved.scoring.total.toFixed(1),`${saved.scoring.home_margin>0?'+':''}${saved.scoring.home_margin.toFixed(1)}`]);
  assert.equal(await page.locator('.mr-player').count(),saved.players.length);
  for(const [i,player] of saved.players.entries()){
   const card=page.locator('.mr-player').nth(i);
   assert.equal(await card.locator('h4').textContent(),player.name);
   if(player.status==='available'){
    assert.equal(await card.locator('.mr-yardage strong').textContent(),player.expected_yards.toFixed(1));
    assert.equal(await card.locator('.mr-td-row strong').textContent(),`${(player.anytime_td_probability*100).toFixed(1)}%`);
   }
  }
  assert.ok((await page.locator('.ic-dialog').evaluate(e=>getComputedStyle(e).fontFamily)).includes('Barlow'));
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  await page.getByRole('button',{name:'Close matchup',exact:true}).focus();await page.keyboard.press('Shift+Tab');
  assert.ok(await page.locator('.ic-dialog').evaluate(e=>e.contains(document.activeElement)),'Focus stays inside report');
  await page.locator('.ic-dialog').evaluate(e=>e.scrollTop=0);
  await page.screenshot({path:`qa/research/${width}-projections.png`});
  await page.getByRole('tab',{name:'Quarter & half',exact:true}).click();await page.locator('.mr-period-chart').waitFor();
  assert.equal(await page.locator('.mr-period-group').count(),4);
  const expected=report.period_trends.teams[game.away_team].summary.filter(p=>p.period.startsWith('Q'));
  assert.deepEqual(await page.locator('.mr-team-tables .mr-panel').first().locator('tbody td:nth-child(2)').allTextContents(),expected.map(p=>p.points_for.toFixed(1)));
  await page.getByRole('button',{name:'Halves',exact:true}).click();assert.equal(await page.locator('.mr-period-group').count(),2);
  await page.getByRole('button',{name:game.home_team,exact:true}).click();
  const history=report.period_trends.teams[game.home_team].history;
  assert.equal(await page.locator('.mr-periods > .mr-panel').last().locator('tbody tr').count(),history.length);
  await page.locator('.ic-dialog').evaluate(e=>e.scrollTop=0);await page.screenshot({path:`qa/research/${width}-halves.png`});
  await page.getByRole('tab',{name:'Projections',exact:true}).click();
  await page.getByText('Model validation & data provenance',{exact:true}).click();
  assert.ok(await page.locator('.mr-method table').count()>=2);
  await page.getByRole('tab',{name:'Vegas Odds',exact:true}).click();await page.locator('.ic-odds-grid').waitFor();
  await page.getByRole('tab',{name:'Players to Watch',exact:true}).click();await page.locator('.pw-card').first().waitFor();
  assert.ok(await page.locator('.ic-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Dialog must not overflow horizontally');
  await page.getByRole('button',{name:'Close matchup',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  assert.equal(await open.evaluate(e=>e===document.activeElement),true,'Focus returns to trigger');
  await page.getByLabel('Prediction week').selectOption('2026-6');await page.locator('.ud-game').first().waitFor();
  await page.getByRole('button',{name:'Full matchup analysis',exact:false}).click();await page.locator('.mr-empty').waitFor();
  assert.equal(await page.locator('.mr-score-card').count(),0,'No current research is injected into old weeks');
  await page.keyboard.press('Escape');assert.equal(await page.locator('.ic-dialog').count(),0);
  await page.close();console.log(`PASS ${width}px: exact score/player/TD projections, period/half data, methodology, current styling, photos/odds tabs, focus trap, Escape, archive isolation.`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
