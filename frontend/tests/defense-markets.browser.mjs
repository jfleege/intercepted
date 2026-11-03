import process from 'node:process';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const players=JSON.parse(await readFile('public/players_watch.json','utf8'));
const odds=JSON.parse(await readFile('public/odds.json','utf8'));
const predictions=JSON.parse(await readFile('public/predictions.json','utf8'));
const origin='http://127.0.0.1:4174/intercepted/';
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined});
const errors=[];
const sign=n=>n==null?'—':n===0?'PK':n>0?`+${n}`:String(n);
try {
 await mkdir('qa/defense-markets',{recursive:true});
 assert.equal(players.defense_rankings.league_size,32);
 assert.equal(Object.keys(players.defense_rankings.teams).length,32);
 assert.ok(players.defense_rankings.through_week<players.week);
 for(const width of [375,650,900,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4174')?r.continue():r.fulfill(r.request().resourceType()==='image'?{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'}:{json:{events:[]}}));
  await page.goto(origin);await page.locator('.dp-player-card').first().waitFor();await page.locator('.ud-market-lines').waitFor();await page.evaluate(()=>document.fonts.ready);
  for(const card of await page.locator('.dp-player-card').all()){
   const name=await card.locator('.dp-player-identity strong').textContent();
   const matchup=Object.values(players.games).find(g=>[...g.home_players,...g.away_players].some(p=>p.name===name));
   const home=matchup.home_players.some(p=>p.name===name), opponent=home?matchup.away_team:matchup.home_team;
   const rank=players.defense_rankings.teams[opponent], position=await card.locator('.dp-position').textContent();
   const expected=position==='RB'?rank.rush_rank:rank.pass_rank;
   assert.deepEqual(await card.locator('.dp-defense-ranks b').allTextContents(),[rank.overall_rank==null?'—':`#${rank.overall_rank}`,expected==null?'—':`#${expected}`]);
   assert.ok((await card.locator('.dp-defense-ranks span').first().getAttribute('aria-label')).includes(`${opponent} scoring defense`));
   assert.ok(await card.locator('.dp-player-top').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Player header must fit');
  }
  for(const index of [0,3]){
   await page.locator('.ud-game').nth(index).click();
   const heading=await page.locator('.ud-market-panel .ud-panel-heading p').textContent();
   const game=predictions.games.find(g=>heading.startsWith(`${g.away_team} at ${g.home_team}`));assert.ok(game);
   const quote=odds.games[game.game_id];assert.ok(quote);
   assert.deepEqual(await page.locator('.ud-market-line').first().locator('strong').allTextContents(),[`${game.away_team} ${sign(quote.away_spread)}`,`${game.home_team} ${sign(quote.home_spread)}`]);
   assert.equal(await page.locator('.ud-market-total strong').textContent(),quote.over_under==null?'—':`O/U ${quote.over_under}`);
  }
  assert.ok(await page.locator('.ud-market-panel,.dp-player-card').evaluateAll(els=>els.every(e=>e.scrollWidth<=e.clientWidth+1)));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('.dp-panel').screenshot({path:`qa/defense-markets/${width}-players.png`});
  await page.locator('.ud-market-panel').screenshot({path:`qa/defense-markets/${width}-markets.png`});
  if(width===1440){
   const legacy=structuredClone(players);delete legacy.defense_rankings;
   await page.route('**/players_watch.json',r=>r.fulfill({json:legacy}));
   const missing=structuredClone(odds);for(const quote of Object.values(missing.games)){delete quote.away_spread;quote.home_spread=0;quote.over_under=null;}
   await page.route('**/odds.json',r=>r.fulfill({json:missing}));
   await page.reload();await page.locator('.dp-player-card').first().waitFor();await page.locator('.ud-market-lines').waitFor();
   assert.deepEqual(await page.locator('.dp-defense-ranks b').first().textContent(),'—');
   assert.deepEqual(await page.locator('.ud-market-line').first().locator('b').allTextContents(),['—','PK']);
   assert.equal(await page.locator('.ud-market-total strong').textContent(),'—');
  }
  await page.close();console.log(`PASS defense/markets ${width}px: opponent ranks, position-specific yardage, saved spreads/totals, matchup updates, missing-data handling, no overflow.`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
