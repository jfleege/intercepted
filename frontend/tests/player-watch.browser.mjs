import process from 'node:process';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const origin='http://127.0.0.1:4174/intercepted/';
const data=JSON.parse(await readFile('public/players_watch.json','utf8'));
const report=JSON.parse(await readFile(`public/research/${data.season}-week-${data.week}.json`,'utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined});
const errors=[];
try {
 await mkdir('qa/player-watch',{recursive:true});
 for(const width of [375,650,900,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4174')?r.continue():r.fulfill(r.request().resourceType()==='image'?{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'}:{json:{events:[]}}));
  await page.goto(origin);
  await page.locator('.dp-projection-range').first().waitFor();
  const panel=page.locator('.dp-panel');
  await panel.scrollIntoViewIfNeeded();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await panel.locator('.dp-player-card').count(),10);
  for(const card of await panel.locator('.dp-player-card').all()){
   const name=await card.locator('.dp-player-identity strong').textContent();
   const p=Object.values(report.games).flatMap(g=>g.players).find(p=>p.name===name);
   const td=p.position==='QB'?p.passing_td_probability:p.anytime_td_probability;
   assert.equal(await card.locator('.dp-touchdown-stat strong').textContent(),`${(td*100).toFixed(1)}%`);
   assert.equal(await card.locator('.dp-touchdown-stat span').textContent(),p.position==='QB'?'1+ passing TD':'1+ rush/receiving TD');
   assert.ok(await card.evaluate(e=>{const a=e.querySelector('.dp-player-stat').getBoundingClientRect(),b=e.querySelector('.dp-touchdown-stat').getBoundingClientRect();return a.right<=b.left&&a.top<b.bottom&&b.top<a.bottom;}),'TD probability sits beside yardage without overlap');
   assert.ok(p);assert.equal(await card.locator('.dp-player-stat strong').textContent(),p.expected_yards.toFixed(1));
   assert.equal(await card.locator('.ud-player-comparison > div').count(),3);
  }
  const header=await panel.locator('.dash-bottom-heading').evaluate(e=>{const p=e.parentElement,s=getComputedStyle(p);return {overflow:s.overflow,radius:s.borderRadius,fits:[...e.querySelectorAll('p,h3,button,select')].every(n=>{const r=n.getBoundingClientRect(),b=p.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right+1&&r.top>=b.top;})};});
  assert.equal(header.overflow,'visible');assert.equal(header.radius,'0px');assert.ok(header.fits,`Header controls fit at ${width}`);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await panel.screenshot({path:`qa/player-watch/${width}.png`});
  await page.getByLabel('Player ranking',{exact:true}).selectOption('form');
  assert.ok((await panel.locator('.dash-bottom-heading').textContent()).includes('positive yardage trends'));
  assert.equal(await panel.locator('.dp-player-card').count(),10);
  await page.getByLabel('Player ranking',{exact:true}).selectOption('blend');
  await page.route('**/research/*.json',r=>r.fulfill({status:404,body:''}));
  await page.reload();await page.getByText('Matching projections unavailable; showing recent form.',{exact:true}).waitFor();
  assert.equal(await page.locator('.dp-projection-range').count(),0);
  assert.equal(await page.locator('.dp-player-card').count(),10);
  await page.close();console.log(`PASS ${width}px: matching projections, fallback, mode switching, unclipped header and controls, no overflow`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
