import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import process from 'node:process';
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined}),errors=[];
try{for(const width of [375,650,900,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{if(r.request().url().startsWith('http://127.0.0.1:4174'))return r.continue();if(r.request().resourceType()==='image')return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});return r.fulfill({json:{events:[]}});});
 await page.goto('http://127.0.0.1:4174/intercepted/');await page.locator('.ud-game').first().waitFor();assert.equal(await page.title(),'Intercepted');const favicon=await page.locator('link[rel="icon"]').getAttribute('href');assert.equal(favicon,'/intercepted/favicon.svg');assert.equal((await page.request.get('http://127.0.0.1:4174'+favicon)).status(),200);
 assert.equal(await page.locator('.brand-player-body,.brand-football,.brand-icon').count(),0);await page.locator('.intercepted-footer-brand img').evaluate(i=>i.decode());
 if(width>1050){await page.locator('.intercepted-logo').evaluate(i=>i.decode());assert.ok(await page.locator('.intercepted-logo').isVisible());}else if(width>650)assert.ok(await page.locator('.intercepted-icon').isVisible());
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`qa/brand/${width}-header.png`});await page.locator('.footer').screenshot({path:`qa/brand/${width}-footer.png`});await context.close();console.log(`PASS ${width}px branding, title, favicon and overflow`);
}assert.deepEqual(errors,[]);}finally{await browser.close();}
