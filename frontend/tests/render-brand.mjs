import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import process from 'node:process';
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});
try{
 const page=await browser.newPage();const icon=await readFile('public/brand/intercepted-icon.svg','utf8');
 for(const size of [16,32,180,512]){
  await page.setViewportSize({width:size,height:size});await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${icon}`);
  await page.locator('svg').screenshot({path:`public/brand/icon-${size}.png`,omitBackground:true});
 }
 await mkdir('qa/brand',{recursive:true});const logo=await readFile('public/brand/intercepted-logo.svg','utf8');await page.setViewportSize({width:1360,height:308});await page.setContent(`<style>html,body{margin:0;background:#081721}svg{width:1360px;height:308px;display:block}</style>${logo}`);await page.screenshot({path:'qa/brand/logo-artwork.png'});
}finally{await browser.close();}
