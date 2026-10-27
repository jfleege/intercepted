import process from 'node:process';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const data=JSON.parse(await readFile('public/predictions.json','utf8'));
const research=JSON.parse(await readFile(`public/research/${data.season}-week-${data.week}.json`,'utf8'));
const earliest=Math.min(...Object.values(research.games).map(g=>Date.parse(g.kickoff)));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});
const errors=[];await mkdir('qa/markets',{recursive:true});
try{
 for(const width of [375,650,900,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(earliest-3600000);
  await page.route('**/*',route=>{if(route.request().url().startsWith('http://127.0.0.1:4174'))return route.continue();if(route.request().resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});return route.fulfill({json:{events:[]}});});
  await page.goto('http://127.0.0.1:4174/intercepted/#markets');await page.locator('.mb-offer').first().waitFor();
  assert.equal(await page.getByLabel('Market game',{exact:true}).locator('option').count(),data.games.length+1);await page.getByRole('button',{name:'Cross-game ideas',exact:true}).click();
  assert.ok((await page.getByAltText('DraftKings',{exact:true}).first().getAttribute('src')).includes('draftkings'));
  assert.ok(await page.locator('.mb-combo-legs').count());
  await page.getByRole('button',{name:'Use this research combination'}).click();assert.equal(await page.locator('.mb-slip-leg').count(),2);
  await page.getByLabel('Manual combined American price').fill('+350');assert.equal(await page.locator('.mb-slip dd').nth(1).textContent(),'$35.00');
  await page.getByRole('button',{name:'Save research draft',exact:true}).click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('intercepted.projection-slips.v1')));assert.equal(saved[0].kind,'unverified_research_draft');assert.equal(saved[0].joint_probability,null);assert.equal(saved[0].combined_price,350);
  assert.equal(await page.evaluate(()=>localStorage.getItem('intercepted.moneyline-paper.v1')),null);
  if(width>760)assert.ok(await page.locator('.mb-slip').evaluate(e=>e.clientHeight<=innerHeight-40));
  await page.locator('.mb-slip details summary').click();await page.locator('.mb-saved').first().click();assert.equal(await page.getByLabel('Manual combined American price').inputValue(),'');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export drafts',exact:true}).click();const downloaded=await downloadPromise;const exported=JSON.parse(await readFile(await downloaded.path(),'utf8'));assert.equal(exported[0].kind,'unverified_research_draft');assert.equal(exported[0].joint_probability,null);
  if(width<=760){await page.locator('.mb-mobile-slip').click();await page.getByLabel('Paper stake ($)').waitFor({state:'visible'});await page.locator('.mb-mobile-back').click();await page.locator('#mb-explore').waitFor({state:'visible'});}
  await page.getByLabel('Manual combined American price').fill('+350');
  await page.getByLabel('Market game',{exact:true}).selectOption(data.games[0].game_id);await page.getByRole('button',{name:'Player yards',exact:true}).click();
  const game=data.games[0],eligible=research.games[game.game_id].players.filter(p=>p.status==='available'&&Number.isFinite(p.expected_yards));assert.deepEqual(new Set(await page.locator('.mb-offer h3').allTextContents()),new Set(eligible.map(p=>p.name)));assert.ok(await page.locator('.mb-offer').count()>=eligible.length);
  const card=page.locator('.mb-offer').first();assert.ok((await card.locator('.mb-headshot').getAttribute('src')).startsWith('https://'));
  assert.ok((await card.textContent()).includes('Target hit probability unavailable'));
  await card.locator('input').fill('55.5');assert.ok((await card.locator('.mb-market').textContent()).includes('55.5'));
  await card.getByRole('button').click();assert.equal(await page.getByLabel('Manual combined American price').inputValue(),'');
  await page.getByRole('button',{name:'Winners',exact:true}).click();await page.getByRole('button',{name:'Clear slip',exact:true}).click();
  await page.locator('.mb-offer').nth(0).getByRole('button').click();await page.locator('.mb-offer').nth(1).getByRole('button').click();assert.equal(await page.locator('.mb-slip-leg').count(),1);
  await page.getByLabel('Manual combined American price').fill('+200');await page.locator('.mb-slip-leg button').click();await page.locator('.mb-offer').nth(1).getByRole('button').click();assert.equal(await page.getByLabel('Manual combined American price').inputValue(),'');
  await page.getByRole('button',{name:'Touchdowns',exact:true}).click();assert.ok(await page.locator('[role="meter"]').count()>0);
  await page.getByRole('button',{name:'All markets',exact:true}).click();
  await page.evaluate(()=>document.fonts.ready);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} overflow`);
  assert.ok(await page.locator('.mb-offer,.mb-slip,.mb-panel').evaluateAll(els=>els.every(e=>e.scrollWidth<=e.clientWidth+1)),`${width} panel overflow`);
  await page.screenshot({path:`qa/markets/${width}-game.png`,fullPage:true});
  await page.getByLabel('Market game',{exact:true}).selectOption('all');await page.locator('.mb-advanced>summary').click();await page.getByLabel('Probability profile',{exact:true}).selectOption('higher');
  assert.ok(await page.locator('[role="meter"]').evaluateAll(els=>els.every(e=>Number(e.getAttribute('aria-valuenow'))>=65)));
  await page.screenshot({path:`qa/markets/${width}-all-teams.png`,fullPage:true});
  await page.locator('.mb-archive>summary').click();await page.locator('.mb-archive .markets-page table').first().waitFor();assert.ok(await page.locator('.mb-archive .market-saved-records').count());await page.locator('.mb-archive>summary').click();
  await context.close();console.log(`PASS ${width}px builder, per-game player coverage, cross-game combinations, probability profiles, quote invalidation, storage separation, no overflow`);
 }
 const context=await browser.newContext();const page=await context.newPage();await page.addInitScript(()=>localStorage.setItem('intercepted.projection-slips.v1','broken'));
 await page.goto('http://127.0.0.1:4174/intercepted/#markets');await page.locator('.mb-slate').waitFor();assert.ok(await page.getByRole('button',{name:'Save research draft',exact:true}).isDisabled());assert.equal(await page.evaluate(()=>localStorage.getItem('intercepted.projection-slips.v1')),'broken');await context.close();
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
