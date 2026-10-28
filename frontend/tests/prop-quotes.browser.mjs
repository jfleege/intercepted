// Regression: Markets must no longer consume cached player quotes, and old drafts must survive.
import process from 'node:process';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {likelihoodOffers} from '../src/likelihoodMarkets.ts';
import {makeDraft} from '../src/projectionMarkets.ts';
const data=JSON.parse(await readFile('public/predictions.json','utf8')),research=JSON.parse(await readFile(`public/research/${data.season}-week-${data.week}.json`,'utf8'));
const now=Math.min(...Object.values(research.games).map(g=>Date.parse(g.kickoff)))-3600000;
const offer=likelihoodOffers(data,research,'v5_qb_plus',now).find(o=>o.category==='touchdown');
const old=makeDraft([{...offer,price:350,bookmaker:'DraftKings',quoteAt:new Date(now).toISOString(),quoteFresh:true}],10,null,now);old.combined_price=350;old.quote_source='manual_unverified';const raw=JSON.stringify([old]);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});
try{
 const context=await browser.newContext(),page=await context.newPage();await page.clock.setFixedTime(now);await page.addInitScript(value=>localStorage.setItem('intercepted.projection-slips.v1',value),raw);
 await page.route('**/*',route=>{if(route.request().url().startsWith('http://127.0.0.1:4174'))return route.continue();return route.fulfill({json:{events:[]}});});
 await page.goto('http://127.0.0.1:4174/intercepted/#markets');await page.locator('.mb-offer').first().waitFor();
 await page.getByText('Earlier research drafts (1)',{exact:true}).click();await page.locator('.mb-saved').click();assert.ok((await page.locator('.mb-slip').textContent()).includes('Includes a saved selection snapshot'));assert.ok(!(await page.locator('.mb-slip').textContent()).includes('+350'));
 await page.getByRole('button',{name:'Save research plan',exact:true}).click();const plans=await page.evaluate(()=>JSON.parse(localStorage.getItem('intercepted.likelihood-plans.v1')));assert.equal(plans[0].legs[0].price,null);assert.equal(plans[0].legs[0].bookmaker,null);assert.equal(await page.evaluate(()=>localStorage.getItem('intercepted.projection-slips.v1')),raw);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export earlier drafts',exact:true}).click();const file=await downloadPromise;assert.equal(await readFile(await file.path(),'utf8'),JSON.stringify([old],null,2));
 await context.close();console.log('PASS earlier drafts preserved byte-for-byte; historical snapshot loading strips prices; new plans and original exports remain separate');
}finally{await browser.close();}
