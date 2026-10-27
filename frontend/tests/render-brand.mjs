import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import process from 'node:process';
import {Buffer} from 'node:buffer';
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});
try{
 const page=await browser.newPage();const icon=await readFile('public/brand/intercepted-icon.svg','utf8');
 for(const size of [16,32,180,512]){
  await page.setViewportSize({width:size,height:size});await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${icon}`);
  await page.locator('svg').screenshot({path:`public/brand/icon-${size}.png`,omitBackground:true});
 }
 const sizes=[16,32],images=await Promise.all(sizes.map(s=>readFile(`public/brand/icon-${s}.png`)));const head=Buffer.alloc(6+sizes.length*16);head.writeUInt16LE(1,2);head.writeUInt16LE(sizes.length,4);let offset=head.length;for(let i=0;i<sizes.length;i++){const at=6+i*16;head[at]=sizes[i];head[at+1]=sizes[i];head.writeUInt16LE(1,at+4);head.writeUInt16LE(32,at+6);head.writeUInt32LE(images[i].length,at+8);head.writeUInt32LE(offset,at+12);offset+=images[i].length;}await writeFile('public/favicon.ico',Buffer.concat([head,...images]));
 await mkdir('qa/brand',{recursive:true});const logo=await readFile('public/brand/intercepted-logo.svg','utf8');await page.setViewportSize({width:1360,height:308});await page.setContent(`<style>html,body{margin:0;background:#081721}svg{width:1360px;height:308px;display:block}</style>${logo}`);await page.screenshot({path:'qa/brand/logo-artwork.png'});
}finally{await browser.close();}
