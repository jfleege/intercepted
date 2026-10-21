import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import pngjs from 'pngjs';

const origins=['http://127.0.0.1:4173/intercepted/','http://127.0.0.1:4174/intercepted/'];
const browser=await chromium.launch({headless:true});
const output='qa/refactor';
await mkdir(output,{recursive:true});
const errors=[];
const properties=['display','position','width','height','min-width','max-width','padding','margin','gap','grid-template-columns','flex-direction','flex-wrap','align-items','justify-content','color','background-color','background-image','font-family','font-size','font-weight','line-height','letter-spacing','border','border-radius','box-shadow','opacity','overflow-x','overflow-y','transform','inset'];
async function settle(page){
  if(page.url().endsWith('#performance'))await page.locator('.performance-page .review-draft').filter({hasText:'ARCHIVED SNAPSHOTS'}).waitFor();
  if(page.url().endsWith('#markets'))await page.getByText('Loading saved moneylines…',{exact:true}).waitFor({state:'hidden'});
  await page.waitForLoadState('networkidle');
  await page.evaluate(async()=>{await document.fonts.ready; for(const img of document.images)img.loading='eager'; await Promise.all([...document.images].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=img.onerror=resolve;})));});
}
async function state(page){
  return page.evaluate(({properties,origin})=>[...document.querySelectorAll('.dashboard-shell, .dashboard-shell *')].map(el=>{
    const s=getComputedStyle(el),r=el.getBoundingClientRect();
    return {tag:el.tagName,classes:el.getAttribute('class'),text:el.children.length?null:el.textContent,
      rect:[r.x,r.y,r.width,r.height].map(n=>Math.round(n*1000)/1000),
      css:Object.fromEntries(properties.map(p=>[p,s.getPropertyValue(p).replaceAll(origin,'APP/')]))};
  }),{properties,origin:page.url().split('#')[0]});
}
async function compare(pages,label,width){
  await Promise.all(pages.map(settle));
  const states=await Promise.all(pages.map(state));
  if(JSON.stringify(states[0])!==JSON.stringify(states[1])){
    await writeFile(`${output}/${width}-${label}-dom.json`,JSON.stringify(states,null,2));
    assert.deepEqual(states[1],states[0],`DOM or computed layout changed: ${label} at ${width}px`);
  }
  const shots=await Promise.all(pages.map((page,i)=>page.screenshot({path:`${output}/${width}-${label}-${i?'after':'before'}.png`,fullPage:true,animations:'disabled'})));
  const [a,b]=shots.map(buffer=>pngjs.PNG.sync.read(buffer));
  assert.equal(b.width,a.width);assert.equal(b.height,a.height);
  let changed=0;for(let i=0;i<a.data.length;i+=4)if(a.data[i]!==b.data[i]||a.data[i+1]!==b.data[i+1]||a.data[i+2]!==b.data[i+2]||a.data[i+3]!==b.data[i+3])changed++;
  assert.equal(changed,0,`Pixels changed: ${label} at ${width}px (${changed})`);
  console.log(`PASS: ${width}px ${label}, identical DOM/layout and ${a.width}x${a.height} pixels.`);
}
try{
 for(const width of [375,650,900,1440]){
  const contexts=await Promise.all(origins.map(()=>browser.newContext({viewport:{width,height:1000},timezoneId:'America/Chicago',reducedMotion:'reduce'})));
  const pages=await Promise.all(contexts.map(async(context,i)=>{
   await context.addInitScript(()=>{const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-21T14:00:00Z']));}static now(){return new NativeDate('2026-10-21T14:00:00Z').getTime();}};});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{
    const request=route.request();if(request.url().startsWith(origins[i].split('/intercepted/')[0]))return route.continue();
    if(request.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'});
    return route.fulfill({json:{events:[]}});
   });
   await page.goto(origins[i]);
   await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}'});
   await page.getByRole('button',{name:'Updated QB+',exact:true}).waitFor();return page;
  }));
  await compare(pages,'dashboard',width);
  for(const name of ['Gradient Boosted','Base']){
   await Promise.all(pages.map(p=>p.getByRole('button',{name,exact:true}).click()));
   await compare(pages,name.replaceAll(' ','-'),width);
  }
  await Promise.all(pages.map(p=>p.getByLabel('Sort matchups').selectOption('confidence')));
  await compare(pages,'confidence-sort',width);
  await Promise.all(pages.map(p=>p.getByRole('button',{name:'Full matchup analysis',exact:false}).click()));
  await compare(pages,'modal-overview',width);
  await Promise.all(pages.map(p=>p.getByRole('tab',{name:'Vegas Odds'}).click()));
  await compare(pages,'modal-odds',width);
  await Promise.all(pages.map(p=>p.getByRole('tab',{name:'Players to Watch'}).click()));
  await compare(pages,'modal-players',width);
  await Promise.all(pages.map(p=>p.getByRole('button',{name:'Close matchup'}).click()));
  await Promise.all(pages.map(p=>p.getByLabel('Prediction week').selectOption('2026-6')));
  await Promise.all(pages.map(p=>p.getByRole('button',{name:'QB+ (original)',exact:true}).waitFor()));
  await compare(pages,'week6-archive',width);
  await Promise.all(pages.map(p=>p.locator('a[href="#performance"]').click()));
  await compare(pages,'performance',width);
  await Promise.all(pages.map(p=>p.getByRole('button',{name:'Historical backtest',exact:true}).click()));
  await Promise.all(pages.map(p=>p.getByLabel('Model',{exact:true}).selectOption('compare')));
  await compare(pages,'historical-performance',width);
  await Promise.all(pages.map(p=>p.locator('a[href="#markets"]').click()));
  await compare(pages,'markets',width);
  await Promise.all(contexts.map(c=>c.close()));
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: before/after UI parity at four breakpoints; no browser errors.');
}finally{await browser.close();}
