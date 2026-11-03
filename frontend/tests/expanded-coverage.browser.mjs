import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import process from 'node:process';
const read=async name=>JSON.parse(await readFile(`public/${name}`,'utf8'));
const slate=await read('predictions.json'),watch=await read('players_watch.json'),base=await read(`research/${slate.season}-week-${slate.week}.json`);
const research=structuredClone(base),game=slate.games[0],report=research.games[game.game_id],match=watch.games[game.game_id];
const templates=Object.values(base.games).flatMap(g=>g.players).filter(p=>p.status==='available');
report.players=[];
for(const side of ['away','home']){
 const team=game[`${side}_team`],opponent=game[side==='home'?'away_team':'home_team'];
 const pool=match[`${side}_catalog`];assert.ok(pool.length>8,'initial catalog must carry more than the shortlist');
 const sample=[['QB',1],['RB',3],['WR',5],['TE',3]].flatMap(([position,n])=>pool.filter(p=>p.position===position).slice(0,n));
 assert.equal(sample.length,12);
 for(const [i,person] of sample.entries()){
  const template=templates.find(p=>p.position===person.position);assert.ok(template);
  report.players.push({...template,...person,team,opponent,prior_appearances:8,status:i===11?'insufficient_history':'available'});
 }
}
const targets=report.players.filter(p=>p.status==='available');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined});const audits=[];
await mkdir('qa/expanded-coverage',{recursive:true});
try{for(const width of [375,650,900,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(Date.parse(report.kickoff)-3600000);
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url.endsWith(`research/${slate.season}-week-${slate.week}.json`))return route.fulfill({json:research});
  if(url.startsWith('http://127.0.0.1:4174'))return route.continue();
  return route.fulfill(route.request().resourceType()==='image'?{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}:{json:{events:[]}});
 });
 await page.goto('http://127.0.0.1:4174/intercepted/#players');await page.locator('.pi-player-row').first().waitFor();
 await page.getByText('More filters',{exact:true}).click();
 await page.getByLabel('Player forecast coverage').selectOption('projected');
 await page.getByLabel('Player team',{exact:true}).selectOption(game.away_team);
 assert.equal(await page.locator('.pi-player-row').count(),targets.filter(p=>p.team===game.away_team).length);
 await page.getByLabel('Player forecast coverage').selectOption('history');assert.ok(await page.locator('.pi-player-row').count()>0);
 assert.ok((await page.locator('.pi-player-row').first().textContent()).includes('Stats only'));
 await page.getByLabel('Player forecast coverage').selectOption('all');await page.getByText('More filters',{exact:true}).click();
 await page.screenshot({path:`qa/expanded-coverage/${width}-players.png`,fullPage:true});
 await page.locator('.dash-nav a[href="#markets"]').click();await page.locator('.mb-slate').waitFor();
 await page.getByLabel('Market game',{exact:true}).selectOption(game.game_id);await page.getByRole('button',{name:'Player yards',exact:true}).click();
 assert.equal(await page.locator('.mb-offer').count(),targets.length);
 const extra=targets.find(p=>!match.away_players.some(w=>w.player_id===p.player_id)&&p.team===game.away_team);assert.ok(extra);
 await page.locator('.mb-offer').filter({has:page.getByRole('heading',{name:extra.name,exact:true})}).getByRole('button').click();
 assert.ok((await page.locator('.mb-slip').textContent()).includes(extra.name));
 await page.screenshot({path:`qa/expanded-coverage/${width}-markets.png`,fullPage:true});
 await page.locator('.dash-nav a[href="#matchups"]').click();await page.locator('.mx-slate button').filter({hasText:game.away_team}).filter({hasText:game.home_team}).click();await page.getByText('Individual player outlook & model validation',{exact:true}).click();
 await page.locator('.mr-team-column').first().waitFor();
 for(const side of ['away','home']){
  const team=game[`${side}_team`],column=page.getByRole('region',{name:`${team} player outlooks`,exact:true});
  assert.equal(await column.locator('.mr-player').count(),8);
  await column.getByRole('button',{name:`Show all 12 ${team} players`,exact:true}).click();assert.equal(await column.locator('.mr-player').count(),12);
 }
 await page.getByLabel('Matchup player position').selectOption('TE');
 assert.equal(await page.locator('.mr-player').count(),report.players.filter(p=>p.position==='TE').length);
 await page.getByLabel('Matchup player position').selectOption('all');
 await page.screenshot({path:`qa/expanded-coverage/${width}-matchups.png`,fullPage:true});
 const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();audits.push({width,violations:audit.violations});assert.deepEqual(audit.violations.map(v=>v.id),[]);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
 await context.close();console.log(`PASS expanded coverage ${width}px: 24 fixture outlooks, non-shortlist market selections, history-only filter, team expansion, position filter, accessibility`);
}}finally{await browser.close();}
await writeFile('qa/expanded-coverage/axe.json',JSON.stringify(audits,null,2));
