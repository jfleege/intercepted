import process from 'node:process';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const data=JSON.parse(await readFile('public/player_intelligence.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined}),errors=[];await mkdir('qa/players',{recursive:true});
try{
 for(const width of [375,650,900,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{if(route.request().url().startsWith('http://127.0.0.1:4174'))return route.continue();if(route.request().resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});return route.fulfill({json:{events:[]}});});
  await page.goto('http://127.0.0.1:4174/intercepted/#players');await page.locator('.pi-player-row').first().waitFor();assert.ok(await page.locator('.pi-player-row').count()>=data.players.length);
  await page.getByRole('button',{name:'View top 10',exact:false}).click();assert.ok(await page.locator('.pi-watch-strip>button').count()<=10);
  await page.getByRole('button',{name:'QB',exact:true}).click();assert.ok(await page.locator('.pi-player-row').evaluateAll(els=>els.every(e=>e.textContent.includes('QB ·'))));
  assert.ok((await page.locator('.pi-hero').textContent()).includes('1+ PASSING TD'));assert.ok((await page.locator('.pi-hero').textContent()).includes('1+ SCORING TD'));
  await page.getByRole('button',{name:'All',exact:true}).click();
  const first=data.players.find(p=>p.history.length>=3);await page.getByLabel('Search players',{exact:true}).fill(first.name);await page.locator('.pi-player-row').first().click();assert.ok((await page.locator('.pi-identity h2').textContent()).includes(first.name));
  await page.getByRole('button',{name:'Last 10',exact:true}).click();await page.getByRole('button',{name:'Usage',exact:true}).click();await page.getByLabel('Usage period').selectOption('quarter');assert.ok(await page.locator('.pi-periods').count()||await page.getByText('Period-level usage has not been published for these appearances.',{exact:true}).count());
  await page.getByRole('button',{name:'Forecast accuracy',exact:true}).click();await page.getByLabel('Player forecast version').waitFor();
  await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Add to compare',exact:false}).click();
  await page.getByLabel('Search players',{exact:true}).fill('');await page.getByRole('button',{name:'Season',exact:true}).click();
  for(const p of data.players.filter(p=>p.player_id!==first.player_id).slice(0,2)){await page.getByLabel('Search players',{exact:true}).fill(p.name);await page.locator('.pi-player-row').first().click();await page.getByRole('button',{name:'Add to compare',exact:false}).click();}
  assert.equal(await page.locator('.pi-compare th .pi-photo').count(),3);await page.locator('.pi-compare button[aria-label^="Remove"]').first().click();assert.equal(await page.locator('.pi-compare th .pi-photo').count(),2);
  await page.getByLabel('Search players',{exact:true}).fill('nobodymatchesxyz');assert.ok(await page.getByText('No players match these filters.',{exact:true}).count());assert.equal(await page.locator('.pi-compare th .pi-photo').count(),2);
  await page.getByLabel('Search players',{exact:true}).fill('');await page.getByRole('button',{name:'Clear all',exact:true}).click();assert.equal(await page.locator('.pi-compare th .pi-photo').count(),0);
  await page.getByRole('button',{name:'Last 5',exact:true}).click();await page.evaluate(()=>document.fonts.ready);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} page overflow`);assert.ok(await page.locator('.pi-panel').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)),`${width} panel overflow`);
  await page.screenshot({path:`qa/players/${width}-overview.png`,fullPage:true});
  await page.locator('.dash-nav a[href="#dashboard"]').click();await page.locator('.ud-game').first().waitFor();await page.locator('.dash-nav a[href="#players"]').click();await page.locator('.pi-player-row').first().waitFor();await context.close();console.log(`PASS ${width}px directory, filters, QB events, history, periods, accuracy, comparison, navigation and overflow`);
 }
 const context=await browser.newContext(),page=await context.newPage();await page.route('**/player_intelligence.json',r=>r.fulfill({status:404}));await page.goto('http://127.0.0.1:4174/intercepted/#players');await page.locator('.pi-player-row').first().waitFor();assert.ok(await page.getByText('Some player data is unavailable. Available projections and history remain accessible.',{exact:false}).count());await context.close();assert.deepEqual(errors,[]);
}finally{await browser.close();}
