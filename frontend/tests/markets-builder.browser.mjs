import process from 'node:process';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const data=JSON.parse(await readFile('public/predictions.json','utf8'));
const research=JSON.parse(await readFile(`public/research/${data.season}-week-${data.week}.json`,'utf8'));
const earliest=Math.min(...Object.values(research.games).map(g=>Date.parse(g.kickoff)));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});
const errors=[],reports=[];await mkdir('qa/markets',{recursive:true});
try{
 for(const width of [375,650,900,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
  const requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.clock.setFixedTime(earliest-3600000);
  await page.route('**/*',route=>{if(route.request().url().startsWith('http://127.0.0.1:4174'))return route.continue();if(route.request().resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});return route.fulfill({json:{events:[]}});});
  await page.goto('http://127.0.0.1:4174/intercepted/#markets');await page.locator('.mb-offer').first().waitFor();
  assert.equal(await page.getByLabel('Market game',{exact:true}).locator('option').count(),data.games.length+1);
  assert.equal(await page.getByText('Needs quote',{exact:true}).count(),0);assert.equal(await page.getByLabel('Manual combined American price').count(),0);
  assert.equal(await page.getByLabel('Paper stake ($)').count(),0);
  await page.getByRole('button',{name:'Cross-game ideas',exact:true}).click();assert.equal(await page.locator('.lm-idea').count(),3);
  await page.getByLabel('Combination alternatives',{exact:true}).selectOption('6');assert.equal(await page.locator('.lm-idea').count(),6);
  const identities=await page.locator('.lm-idea').evaluateAll(els=>els.map(e=>[...e.querySelectorAll('.mb-combo-legs strong')].map(x=>x.textContent).sort().join('|')));assert.equal(new Set(identities).size,6);
  await page.getByLabel('Combination markets',{exact:true}).selectOption('moneyline');assert.equal(await page.locator('.lm-idea').count(),6);
  assert.equal(await page.locator('.lm-idea').first().locator('.lm-bounds').count(),2); // includes collapsed stress test
  assert.equal(await page.getByText('Independence scenario',{exact:true}).count(),0);
  await page.locator('.lm-lab>summary').click();await page.getByLabel('Show independence scenarios',{exact:true}).check();assert.ok(await page.getByText('Independence scenario',{exact:true}).count()>0);
  await page.getByLabel('Probability reduction',{exact:true}).fill('10');
  await page.locator('.lm-games>summary').click();const boxes=page.locator('.lm-games input');for(let i=0;i<await boxes.count();i++)await boxes.nth(i).uncheck();
  assert.equal(await page.locator('.lm-idea').count(),0);assert.ok(await page.getByText('Not enough eligible upcoming games',{exact:false}).count());
  for(let i=0;i<await boxes.count();i++)await boxes.nth(i).check();await page.locator('.lm-games>summary').click();
  await page.getByRole('button',{name:'Use option 2',exact:true}).click();assert.equal(await page.locator('.mb-slip-leg').count(),2);
  await page.getByRole('button',{name:'Save research plan',exact:true}).click();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('intercepted.likelihood-plans.v1')));
  assert.equal(saved[0].kind,'likelihood_research_plan');assert.equal('stake' in saved[0],false);assert.ok(saved[0].legs.every(o=>o.price===null&&o.quoteAt===null));
  assert.equal(await page.evaluate(()=>localStorage.getItem('intercepted.projection-slips.v1')),null);assert.equal(await page.evaluate(()=>localStorage.getItem('intercepted.moneyline-paper.v1')),null);
  if(width>760)assert.ok(await page.locator('.mb-slip').evaluate(e=>e.clientHeight<=innerHeight-40));
  await page.locator('.mb-slip details').filter({has:page.getByText('Saved research plans (1)',{exact:true})}).locator('summary').click();await page.locator('.mb-saved').first().click();assert.ok(await page.getByText('Includes a saved selection snapshot',{exact:false}).count());
  const promise=page.waitForEvent('download');await page.getByRole('button',{name:'Export plans',exact:true}).click();const file=await promise;assert.deepEqual(JSON.parse(await readFile(await file.path(),'utf8')),saved);
  await page.screenshot({path:`qa/markets/${width}-cross-game.png`,fullPage:true});
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();reports.push({width,view:'ideas',violations:axe.violations});assert.deepEqual(axe.violations.map(v=>v.id),[]);
  if(width<=760){await page.locator('.mb-mobile-slip').click();await page.locator('.mb-mobile-back').click();await page.locator('#mb-explore').waitFor({state:'visible'});}
  await page.getByLabel('Market game',{exact:true}).selectOption(data.games[0].game_id);await page.getByRole('button',{name:'Player yards',exact:true}).click();
  const game=data.games[0],eligible=research.games[game.game_id].players.filter(p=>p.status==='available'&&Number.isFinite(p.expected_yards));assert.deepEqual(new Set(await page.locator('.mb-offer h3').allTextContents()),new Set(eligible.map(p=>p.name)));
  const card=page.locator('.mb-offer').first();assert.ok((await card.textContent()).includes('Target hit probability unavailable'));await card.locator('input').fill('55.5');await card.getByRole('button').click();assert.ok((await page.locator('.mb-slip').textContent()).includes('Joint likelihood unavailable'));
  await page.getByRole('button',{name:'Winners',exact:true}).click();await page.getByRole('button',{name:'Clear plan',exact:true}).click();await page.locator('.mb-offer').nth(0).getByRole('button').click();await page.locator('.mb-offer').nth(1).getByRole('button').click();assert.equal(await page.locator('.mb-slip-leg').count(),1);
  await page.getByRole('button',{name:'Touchdowns',exact:true}).click();await page.locator('.mb-offer').first().getByRole('button').click();assert.ok((await page.locator('.mb-slip').textContent()).includes('Separate conditional estimates do not establish a combined probability'));
  await page.getByRole('button',{name:'All markets',exact:true}).click();await page.evaluate(()=>document.fonts.ready);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} overflow`);assert.ok(await page.locator('.mb-offer,.mb-slip,.mb-panel,.lm-idea').evaluateAll(els=>els.every(e=>e.scrollWidth<=e.clientWidth+1)),`${width} panel overflow`);
  assert.ok(!requests.some(u=>/\/(odds|player_props|odds_usage|markets)\.json/.test(u)),requests.filter(u=>/json/.test(u)).join('\n'));
  await page.screenshot({path:`qa/markets/${width}-game.png`,fullPage:true});await context.close();console.log(`PASS ${width}px likelihood-only offers, six unique alternatives, included-game filtering, scenario controls, plan save/load/export, no odds requests, accessibility, no overflow`);
 }
 const context=await browser.newContext(),page=await context.newPage();await page.addInitScript(()=>localStorage.setItem('intercepted.likelihood-plans.v1','broken'));await page.goto('http://127.0.0.1:4174/intercepted/#markets');await page.locator('.mb-slate').waitFor();assert.ok(await page.getByRole('button',{name:'Save research plan',exact:true}).isDisabled());assert.equal(await page.evaluate(()=>localStorage.getItem('intercepted.likelihood-plans.v1')),'broken');await context.close();
 const {writeFile}=await import('node:fs/promises');await writeFile('qa/markets/axe.json',JSON.stringify(reports,null,2));assert.deepEqual(errors,[]);
}finally{await browser.close();}
