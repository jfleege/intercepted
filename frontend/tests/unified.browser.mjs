import process from 'node:process';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const origin='http://127.0.0.1:4174/intercepted/';
const data=JSON.parse(await readFile('public/predictions.json','utf8'));
const playerData=JSON.parse(await readFile('public/players_watch.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined});const errors=[];
await mkdir('qa/unified',{recursive:true});
try {
 for(const width of [375,650,900,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',timezoneId:'America/Chicago'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const req=route.request();if(req.url().startsWith('http://127.0.0.1:4174'))return route.continue();
   if(req.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'});
   return route.fulfill({json:{events:[]}});
  });
  await page.goto(origin);
  await page.locator('.ud-game').first().waitFor();
  await page.locator('.ud-model-vote').first().waitFor();
  await page.waitForFunction(()=>{const body=document.querySelector('.ud-market-body');return body && !body.textContent.includes('Loading sportsbook data...');});
  assert.ok(await page.locator('.ud-moneyline').count()===2 || await page.getByText('No sportsbook odds saved for this matchup.',{exact:true}).count()===1);
  await page.locator('.dp-headshot').first().waitFor();
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.ud-game').count(),data.games.length);
  assert.equal(await page.locator('.ud-draftkings-logo').getAttribute('alt'),'DraftKings');
  assert.ok((await page.locator('.dp-headshot').first().getAttribute('src')).startsWith('https://'));
  assert.equal(await page.locator('.dp-player-card').count(),10);
  const controlHeights=await page.locator('.ud-forecast .forecast-sort,.ud-forecast .model-switch').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().height));
  assert.ok(controlHeights.every(h=>Math.abs(h-38)<1),`Controls must share the compact model selector height: ${controlHeights}`);
  for(const card of await page.locator('.dp-player-card').all()){
   const name=await card.locator('.dp-player-identity strong').textContent();
   const matchup=Object.values(playerData.games).find(g=>[...g.away_players,...g.home_players].some(p=>p.name===name));
   const home=matchup.home_players.some(p=>p.name===name);
   const opponent=home?matchup.away_team:matchup.home_team;
   assert.equal(await card.locator('.dp-player-opponent').getAttribute('aria-label'),`Week ${playerData.week}: ${home?matchup.home_team:matchup.away_team} ${home?'hosts':'at'} ${opponent}`);
   assert.ok((await card.locator('.dp-player-opponent img').getAttribute('src')).endsWith(`/logos/${opponent}.png`));
   const fits=await card.evaluate(e=>{const identity=e.querySelector('.dp-player-identity').getBoundingClientRect(),badge=e.querySelector('.dp-player-opponent').getBoundingClientRect(),photo=e.querySelector('.dp-headshot').getBoundingClientRect();return identity.width>=65&&identity.right<=badge.left&&badge.top>=photo.top&&badge.bottom<=photo.bottom+1;});
   assert.ok(fits,`${name}: matchup badge must fit beside the name and photo at ${width}px`);
  }
  assert.ok((await page.locator('.ud-hero h1').evaluate(e=>getComputedStyle(e).fontFamily)).includes('Barlow Condensed'));
  assert.ok((await page.locator('.pulse-value').first().evaluate(e=>getComputedStyle(e).fontFamily)).includes('Barlow'));
  assert.ok(await page.evaluate(()=>document.fonts.check('600 16px Barlow')&&document.fonts.check('600 16px "Barlow Condensed"')));
  await page.screenshot({path:`qa/unified/${width}-initial.png`,fullPage:true});
  for(const index of [1,4]){
   const row=page.locator('.ud-game').nth(index);
   const label=await row.getAttribute('aria-label');
   const game=data.games.find(g=>label.startsWith(`${g.away_team} at ${g.home_team}.`));
   assert.ok(game);
   await row.click();
   await page.waitForFunction(title=>document.querySelector('.ud-focus h3')?.textContent===title,`${game.away_team} at ${game.home_team}`);
   assert.equal(await page.locator('.ud-game.is-selected').count(),1);
   const wheelLabel=await page.locator('.ud-wheel').getAttribute('aria-label');
   assert.ok(wheelLabel.includes(`${(game.home_win_prob_v5_qb_plus*100).toFixed(1)}%`));
   const fill=await page.locator('.ud-probability-fill').evaluateAll(els=>els.map(e=>getComputedStyle(e).animationName));
   assert.deepEqual(fill,['none','none']);
  }
  await page.getByRole('button',{name:'Full matchup analysis',exact:false}).click();
  await page.getByRole('button',{name:'Close matchup'}).waitFor();
  await page.getByRole('tab',{name:'Vegas Odds'}).click();
  await page.getByRole('tab',{name:'Players to Watch'}).click();
  await page.getByRole('button',{name:'Close matchup'}).click();
  await page.getByRole('button',{name:'Gradient Boosted',exact:true}).click();
  await page.getByRole('button',{name:'Base',exact:true}).click();
  await page.getByRole('button',{name:'Updated QB+',exact:true}).click();
  await page.getByLabel('Sort matchups').selectOption('confidence');
  const values=await page.locator('.ud-game-probability b').allTextContents();
  assert.deepEqual(values,values.toSorted((a,b)=>parseFloat(b)-parseFloat(a)));
  await page.getByLabel('Sort matchups').selectOption('date');
  await page.getByLabel('Search teams or matchups').fill('Bears');
  assert.equal(await page.locator('.ud-game').count(),1);
  await page.getByLabel('Search teams or matchups').fill('xyznoresult');
  assert.equal(await page.getByText('No matchups match your search.',{exact:true}).count(),1);
  await page.getByLabel('Search teams or matchups').fill('');
  await page.locator('.ud-game').first().click();
  await page.getByRole('button',{name:'Scroll players right'}).click();
  await page.waitForFunction(()=>document.querySelector('.dp-scroll-container').scrollLeft>0);
  await page.getByRole('button',{name:'Scroll players left'}).click();
  await page.waitForFunction(()=>document.querySelector('.dp-scroll-container').scrollLeft===0);
  await page.evaluate(async()=>{for(const img of document.images)img.loading='eager';await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r;})));window.scrollTo(0,0);});
  if(width>850){const rects=await page.locator('.ud-slate,.ud-focus').evaluateAll(els=>els.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));assert.ok(Math.abs(rects[0].width-rects[1].width)<1);assert.ok(Math.abs(rects[0].height-rects[1].height)<1);}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page must not overflow');
  assert.ok(await page.locator('.ud-game,.ud-focus,.dp-player-card,.ud-market-panel,.ud-model-panel').evaluateAll(els=>els.every(e=>e.scrollWidth<=e.clientWidth+1)),'Panels must not overflow');
  await page.screenshot({path:`qa/unified/${width}-dashboard.png`,fullPage:true});
  await page.locator('.ud-matchup-grid').screenshot({path:`qa/unified/${width}-matchups.png`});
  await page.locator('.dp-panel').screenshot({path:`qa/unified/${width}-players.png`});
  await page.locator('.ud-section-heading').screenshot({path:`qa/unified/${width}-controls.png`});
  await page.getByLabel('Prediction week').selectOption('2026-6');
  await page.getByRole('button',{name:'QB+ (original)',exact:true}).waitFor();
  await page.locator('.ud-result').first().waitFor();
  assert.equal(await page.locator('.ud-model-panel').count(),0);
  assert.equal(await page.getByRole('button',{name:'Gradient Boosted',exact:true}).count(),0);
  await page.getByLabel('Prediction week').selectOption('current');
  await page.getByRole('button',{name:'Updated QB+',exact:true}).waitFor();
  // Regular-motion selection: animate from empty, overshoot, and settle at the exact saved probability.
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('.ud-game').nth(1).click();
  assert.equal(await page.locator('.ud-probability-fill').first().evaluate(e=>getComputedStyle(e).animationName),'udBarRise');
  assert.equal(await page.locator('.ud-winner-arc').evaluate(e=>getComputedStyle(e).animationName),'udRingGrow');
  const overshoot=await page.locator('.ud-probability-fill').first().evaluate(async e=>{const a=e.getAnimations()[0];a.pause();a.currentTime=585;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const scale=new DOMMatrixReadOnly(getComputedStyle(e).transform).m22;a.play();await a.finished;return scale;});
  assert.ok(overshoot>1,'Winning bars must visibly overshoot before settling');
  assert.equal(await page.locator('.ud-probability-fill').first().evaluate(e=>getComputedStyle(e).transform),'matrix(1, 0, 0, 1, 0, 0)');
  await page.locator('.ud-winner-arc').evaluate(async e=>{await Promise.all(e.getAnimations().map(a=>a.finished));});
  const arc=await page.locator('.ud-winner-arc').evaluate(e=>({expected:parseFloat(e.style.getPropertyValue('--ud-arc')),actual:parseFloat(getComputedStyle(e).strokeDasharray)}));
  assert.ok(Math.abs(arc.expected-arc.actual)<.01,JSON.stringify(arc));
  const offsets=await page.locator('.ud-winner-arc').evaluate(async e=>{const a=e.getAnimations()[0];a.pause();const values=[];for(const time of [0,100,250,450,650]){a.currentTime=time;await new Promise(r=>requestAnimationFrame(r));values.push(parseFloat(getComputedStyle(e).strokeDashoffset));}a.finish();return values;});
  assert.ok(offsets[0]>0);assert.equal(offsets.at(-1),0);assert.ok(offsets.every((n,i)=>n>=0&&(!i||n<=offsets[i-1])),'Ring must sweep smoothly without reversal or overshoot');
  await page.locator('.dash-nav a[href="#performance"]').click();
  await page.locator('.ph-page').waitFor();
  await page.getByRole('button',{name:'Winners',exact:true}).click();
  await page.locator('.performance-page .review-draft').filter({hasText:'ARCHIVED SNAPSHOTS'}).waitFor();
  await page.locator('.dash-nav a[href="#markets"]').click();
  await page.locator('.mb-slate').waitFor();
  await context.close();console.log(`PASS ${width}px: real fonts, photos/PNG, matchup selection, probabilities, bounce/reduced motion, markets, archives, filters, no overflow.`);
 }
 assert.deepEqual(errors,[]);console.log('PASS: no browser errors.');
}finally{await browser.close();}
