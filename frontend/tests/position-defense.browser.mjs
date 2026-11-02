import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import process from 'node:process';
const slate=JSON.parse(await readFile('public/predictions.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});await mkdir('qa/position-defense',{recursive:true});
try{for(const width of [375,650,900,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4174')?r.continue():r.fulfill(r.request().resourceType()==='image'?{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}:{json:{events:[]}}));
 await page.goto('http://127.0.0.1:4174/intercepted/');await page.locator('.ud-game').first().waitFor();await page.getByRole('button',{name:'Full matchup analysis',exact:false}).click();await page.locator('.mr-team-column').first().waitFor();
 const verify=async()=>{
  const columns=page.locator('.mr-team-column');assert.equal(await columns.count(),2);
  for(const column of await columns.all()){
   const team=(await column.getAttribute('aria-label')).split(' ')[0];const identities=await column.locator('.mr-player header small:first-child').allTextContents();assert.ok(identities.every(t=>t.startsWith(team+' ·')));
   const positions=await column.locator('.mr-player').evaluateAll(cards=>cards.map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,left:e.getBoundingClientRect().left})));
   for(let i=1;i<positions.length;i++){assert.ok(positions[i].top>=positions[i-1].bottom);assert.ok(Math.abs(positions[i].left-positions[i-1].left)<2);}
  }
  const rects=await columns.evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));if(width>650)assert.ok(rects[0].right<=rects[1].left);else assert.ok(rects[0].bottom<=rects[1].top);
 };
 await verify();const defense=page.locator('.mr-defense').first();await defense.locator('dl').waitFor();assert.ok((await defense.textContent()).includes('Passing TDs / game'));await defense.locator('select').selectOption('last5');assert.equal(await defense.locator('select').inputValue(),'last5');await defense.screenshot({path:`qa/position-defense/${width}-allowances.png`});
 await page.getByRole('button',{name:'Close matchup',exact:true}).click();await page.locator('.dash-nav a[href="#matchups"]').click();await page.getByText('Individual player outlook & model validation',{exact:true}).click();await page.locator('.mr-team-column').first().waitFor();await verify();
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();assert.deepEqual(result.violations.map(v=>v.id),[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await page.locator('.mr-team-columns').screenshot({path:`qa/position-defense/${width}-teams.png`});await context.close();console.log(`PASS position defense ${width}px: modal and Matchups team columns, vertical cards, position totals, windows, accessibility`);
}}finally{await browser.close();}
