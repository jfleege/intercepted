import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import process from 'node:process';
import {likelihoodOffers} from '../src/likelihoodMarkets.ts';
const slate=JSON.parse(await readFile('public/predictions.json','utf8'));
const research=JSON.parse(await readFile(`public/research/${slate.season}-week-${slate.week}.json`,'utf8'));
const guide=likelihoodOffers(slate,research,'v5_qb_plus',0).find(o=>o.category==='yardage');
const now=Date.parse(guide.kickoff)-3600000;
const extensions={season:slate.season,week:slate.week,version:'fixture',generated_at:new Date(now-60000).toISOString(),policy:'Browser fixture only',validation:[],players:[{game_id:guide.game_id,player_id:guide.player_id,team:guide.team,opponent:guide.matchup.split(' @ ').find(t=>t!==guide.team),kickoff:guide.kickoff,kind:guide.target,usage:30,usage_field:'attempts',usage_status:'role_aware_conditional',role_adjustment:'Fixture role estimate',thresholds:[{threshold:75,probability:.7}]}]};
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});await mkdir('qa/extensions',{recursive:true});
try{for(const width of [375,650,900,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();let results=false;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(now);
 await page.route('**/*',r=>{const url=r.request().url();if(url.endsWith('/player_extensions.json'))return r.fulfill({json:extensions});if(url.endsWith('/research_performance.json'))return r.fulfill({json:{datasets:{verified:{rows:results?[{game_id:guide.game_id,player_id:guide.player_id,family:'yardage',target:guide.target,actual:80,status:'graded'}]:[]}}}});if(url.startsWith('http://127.0.0.1:4174'))return r.continue();return r.fulfill(r.request().resourceType()==='image'?{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}:{json:{events:[]}});});
 await page.goto('http://127.0.0.1:4174/intercepted/#markets');const offer=page.locator('.mb-offer').filter({has:page.getByText(`75+ ${guide.target} yards`,{exact:true})});await offer.waitFor();assert.ok((await offer.textContent()).includes('70.0%'));assert.equal(await offer.locator('.mb-target').count(),0);await offer.locator('details>summary').click();assert.ok((await offer.textContent()).includes('30.0 attempts'));await offer.getByRole('button').click();await page.getByRole('button',{name:'Save research plan',exact:true}).click();
 const original=await page.evaluate(()=>localStorage.getItem('intercepted.likelihood-plans.v1'));assert.ok(original);
 await page.getByRole('button',{name:'Cross-game ideas',exact:true}).click();await page.locator('.lm-idea').first().waitFor();const pin=page.locator('.lm-idea').first().getByRole('button',{name:/^Pin /}).first();const name=await pin.textContent();await pin.click();assert.ok(await page.getByRole('button',{name,exact:true}).first().getAttribute('aria-pressed')==='true');await page.getByLabel('Maximum shared legs',{exact:true}).selectOption('0');assert.ok(await page.locator('.lm-idea').count()<=1);await page.getByRole('button',{name:'Reset pins & exclusions',exact:true}).click();await page.getByLabel('Maximum shared legs',{exact:true}).selectOption('1');await page.locator('.lm-idea').first().getByRole('button',{name:/^Exclude /}).first().click();
 results=true;await page.clock.setFixedTime(Date.parse(guide.kickoff)+3600000);await page.reload();await page.getByText('Saved research plans (1)',{exact:true}).click();await page.getByText(`${guide.name} · hit · actual 80`,{exact:false}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('intercepted.likelihood-plans.v1')),original);
 const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();assert.deepEqual(audit.violations.map(v=>v.id),[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await page.screenshot({path:`qa/extensions/${width}-plan-results.png`,fullPage:true});await context.close();console.log(`PASS extensions ${width}px fixed thresholds, role usage, pins, exclusions, overlap limit, immutable plan results, accessibility`);
}}finally{await browser.close();}
