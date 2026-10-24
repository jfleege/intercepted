import process from 'node:process';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base='http://127.0.0.1:4174/intercepted/';
const predictions=JSON.parse(await readFile('public/predictions.json','utf8'));
const insight=JSON.parse(await readFile(`public/team_insights/${predictions.season}-week-${predictions.week}.json`,'utf8'));
const report=JSON.parse(await readFile(`public/research/${predictions.season}-week-${predictions.week}.json`,'utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});const errors=[];
try{
 await mkdir('qa/matchups',{recursive:true});
 for(const width of [375,650,900,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4174')?r.continue():r.fulfill(r.request().resourceType()==='image'?{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'}:{json:{events:[]}}));
  await page.goto(base+'#matchups');await page.locator('.mx-ranking').first().waitFor();await page.locator('.mx-scoreboard').waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.ud-hero').count(),0);
  assert.equal(await page.locator('a[href="#matchups"]').getAttribute('aria-current'),'page');
  assert.equal(await page.locator('.mx-slate > button').count(),predictions.games.length);
  const firstButton=page.locator('.mx-slate > button[aria-pressed="true"]');
  const initialText=await firstButton.textContent();
  const first=predictions.games.find(g=>initialText.includes(g.away_team+'@'+g.home_team));assert.ok(first);
  const s=report.games[first.game_id].scoring;
  assert.deepEqual(await page.locator('.mx-scoreboard strong').allTextContents(),[s.away.expected_points.toFixed(1),s.total.toFixed(1),s.home.expected_points.toFixed(1)]);
  for(const [i,kind] of ['off','def'].entries()){
   const ranking=page.locator('.mx-ranking').nth(i);await ranking.getByRole('button').click();
   assert.equal(await ranking.locator('li').count(),Object.keys(insight.teams).length);
   for(const li of await ranking.locator('li').all()){
    const t=await li.locator('abbr').textContent(),team=insight.teams[t];
    assert.equal(await li.locator('.mx-rank-number').textContent(),String(team[kind+'_rank']));
    assert.ok((await li.locator('img').getAttribute('src')).endsWith(`/logos/${t}.png`));
    const m=team[kind+'_movement'];assert.equal(await li.locator('.mx-movement').textContent(),m==null?'—':m>0?`▲ ${m}`:m<0?`▼ ${-m}`:'–');
   }
   await ranking.getByRole('button').click();
  }
  const td=page.locator('.mx-panel').filter({has:page.getByRole('heading',{name:'Touchdown production',exact:true})});
  assert.deepEqual(await td.locator('.mx-bar-row b').allTextContents(),['pass_td_per_game','rush_td_per_game'].flatMap(k=>[first.away_team,first.home_team].map(t=>insight.teams[t].season[k].toFixed(1))));
  await page.getByRole('button',{name:'Halves',exact:true}).click();
  assert.equal(await page.getByText('H1',{exact:true}).count(),1);assert.equal(await page.getByText('H2',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Quarters',exact:true}).click();
  await page.locator('.mx-slate>button').nth(1).click();
  assert.equal(await page.locator('.mx-slate>button[aria-pressed=true]').count(),1);
  assert.ok(await page.locator('.mx-player-detail').count());await page.locator('.mx-player-detail>summary').click();await page.locator('.mr-player').first().waitFor();
  assert.equal(await page.locator('.mr-score-grid').count(),0,'Scoring is shown once, not repeated with players');
  await page.locator('.mx-player-detail>summary').click();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`No page overflow at ${width}`);
  await page.screenshot({path:`qa/matchups/${width}.png`,fullPage:true});
  const saved=await page.getByLabel('Prediction week',{exact:true}).locator('option').evaluateAll(opts=>opts.find(o=>o.value!=='current')?.value);
  if(saved){await page.getByLabel('Prediction week',{exact:true}).selectOption(saved);await page.getByText('No team ranking export is available for this week.',{exact:true}).waitFor();assert.equal(await page.locator('.mx-ranking').count(),0);assert.equal(await page.locator('.ud-market-body').count(),0);}
  await page.locator('a[href="#dashboard"]').click();await page.locator('.ud-hero').waitFor();assert.equal(await page.locator('.mx-page').count(),0);
  await page.close();console.log(`PASS ${width}: route, saved scores, ranking values/logos/movement, TD charts, quarters/halves, matchup selection, player report, archive isolation and no overflow`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
