import process from 'node:process';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const data=JSON.parse(await readFile('public/predictions.json','utf8'));
const research=JSON.parse(await readFile(`public/research/${data.season}-week-${data.week}.json`,'utf8'));
const first=Math.min(...Object.values(research.games).map(g=>Date.parse(g.kickoff)));
const index=data.games.findIndex(g=>Date.parse(research.games[g.game_id].kickoff)>=first+2*86400000);
const game=data.games[index],report=research.games[game.game_id],player=report.players.find(p=>p.status==='available'&&p.stat==='passing'&&typeof p.anytime_td_probability==='number');
const now=Date.parse(report.kickoff)-2*86400000,iso=t=>new Date(t).toISOString();
// Explicit browser-only provider-contract fixture. These prices are never written to public data.
const quote={schema_version:1,season:data.season,week:data.week,exported_at:iso(now-60000),status:'cached',games:{[game.game_id]:{event_id:'browser-fixture',home_team:game.home_team,away_team:game.away_team,kickoff:report.kickoff,observed_at:iso(now-60000),bookmaker:'DraftKings',markets:[{key:'player_pass_yds',last_update:iso(now-120000),outcomes:[{name:'Over',description:player.name,point:225.5,price:-110},{name:'Under',description:player.name,point:225.5,price:-115}]},{key:'player_anytime_td',last_update:iso(now-120000),outcomes:[{name:'Yes',description:player.name,price:350}]}]}}};
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined}),errors=[];await mkdir('qa/props',{recursive:true});
try{
 for(const width of [375,650,900,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(now);
  await page.route('**/*',route=>{const req=route.request();if(req.url().endsWith('/player_props.json'))return route.fulfill({json:quote});if(req.url().startsWith('http://127.0.0.1:4174'))return route.continue();if(req.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});return route.fulfill({json:{events:[]}});});
  await page.goto('http://127.0.0.1:4174/intercepted/#markets');await page.locator('.mb-offer').first().waitFor();assert.ok((await page.locator('.mb-slate').textContent()).includes(`${Object.values(research.games).flatMap(g=>g.players).filter(p=>p.status==='available'&&Number.isFinite(p.expected_yards)&&['passing','rushing','receiving'].includes(p.stat)).length} tracked player projections`));await page.locator('.mb-games button').nth(index+1).click();await page.getByRole('button',{name:'Player yards',exact:true}).click();
  const rows=page.locator('.mb-offer').filter({has:page.getByRole('heading',{name:player.name,exact:true})});assert.equal(await rows.count(),2);
  const over=rows.filter({hasText:'Over 225.5'}),under=rows.filter({hasText:'Under 225.5'});assert.equal(await over.locator('.mb-metrics b').nth(1).textContent(),'-110');assert.equal(await under.locator('.mb-metrics b').nth(1).textContent(),'-115');assert.ok((await over.textContent()).includes('Recent DraftKings quote'));
  assert.equal(await over.locator('.mb-metrics b').first().textContent(),player.expected_yards.toFixed(1));assert.ok((await over.textContent()).includes('Target hit probability unavailable'));
  await over.getByRole('button').click();await over.locator('input').fill('230.5');
  const changed=rows.filter({hasText:'Over 230.5'});assert.equal(await changed.locator('.mb-metrics b').nth(1).textContent(),'Needs quote');assert.ok((await page.locator('.mb-slip-leg').textContent()).includes('Needs quote'));
  await under.getByRole('button').click();assert.equal(await page.locator('.mb-slip-leg').count(),1);assert.ok((await page.locator('.mb-slip-leg').textContent()).includes('-115'));
  await page.getByRole('button',{name:'Touchdowns',exact:true}).click();const td=page.locator('.mb-offer').filter({has:page.getByRole('heading',{name:player.name,exact:true})}).filter({hasText:'1+ rushing/receiving TD'});assert.equal(await td.locator('.mb-metrics b').nth(1).textContent(),'+350');await td.getByRole('button').click();assert.equal(await page.locator('.mb-slip-leg').count(),2);assert.equal(await page.locator('.mb-slip dd').first().textContent(),'Unavailable');
  await page.getByRole('button',{name:'Save research draft',exact:true}).click();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('intercepted.projection-slips.v1')));assert.equal(saved[0].legs.find(l=>l.target==='scoring_td').quoteEventId,'browser-fixture');assert.equal(saved[0].combined_price,null);
  await page.clock.setFixedTime(now+25*3600000);await page.reload();await page.locator('.mb-offer').first().waitFor();await page.locator('.mb-games button').nth(index+1).click();await page.getByRole('button',{name:'Touchdowns',exact:true}).click();const stale=page.locator('.mb-offer').filter({has:page.getByRole('heading',{name:player.name,exact:true})}).filter({hasText:'1+ rushing/receiving TD'});assert.ok((await stale.textContent()).includes('stale / unverified quote'));assert.ok((await stale.textContent()).includes('Upcoming'));
  assert.ok(await page.locator('.mb-feed-status').textContent().then(t=>t.includes('API credits remaining:')));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`qa/props/${width}-cached-props.png`,fullPage:true});await context.close();console.log(`PASS ${width}px exact prop lines/prices, edit invalidation, conditional TD event, saved evidence, stale state and no overflow`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
