import type { Game, PredictionData } from './forecastTypes.ts';
import { availableModels, MODEL_LABELS, probability } from './predictionModels.ts';
import type { Model } from './predictionModels.ts';
import { decimalOdds, freshQuote } from './marketResearch.ts';
import type { Line } from './marketResearch.ts';
export type PlayerForecast={player_id:string;name:string;team:string;opponent:string;position:string;headshot?:string|null;status:string;stat?:string;expected_yards?:number;range_80?:number[];anytime_td_probability?:number;passing_td_probability?:number};
export type Research={season:number;week:number;games:Record<string,{kickoff:string;generated_at:string;model_version:string;players:PlayerForecast[];scoring:{away:{team:string;expected_points:number};home:{team:string;expected_points:number};total:number;home_margin:number;total_range_80:number[];margin_range_80:number[]}}>};
export type Quote={bookmaker:string;commence_time:string;last_update:string|null;moneyline_last_update?:string;spreads_last_update?:string;totals_last_update?:string;home_moneyline:number|null;away_moneyline:number|null;home_spread:number|null;away_spread:number|null;home_spread_price?:number;away_spread_price?:number;over_under:number|null;over_price?:number;under_price?:number};
export type Odds={exported_at:string;games:Record<string,Quote>};
export type Offer={id:string;contract:string;game_id:string;matchup:string;team:string;name:string;headshot:string|null;bookmaker:string|null;category:'moneyline'|'yardage'|'touchdown'|'total'|'spread';market:string;target:string;direction:'over'|'under'|'yes'|'win';line:number|null;custom:boolean;prediction:number|null;range:number[]|null;probability:number|null;price:number|null;quoteFresh:boolean;quoteAt:string|null;kickoff:string|null;source:string;modelVersion:string;modelRange:number[]|null;agreement:string|null;forecastAt:string|null};
export type Profile='all'|'higher'|'even'|'longer'|'unscored';
export const DRAFT_KEY='intercepted.projection-slips.v1';
export type Draft={schema_version:1;id:string;saved_at:string;kind:'unverified_research_draft';stake:number;legs:Offer[];combined_price:number|null;quote_source:'manual_unverified'|'saved_single'|'unavailable';joint_probability:null};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const pValid=(v:unknown):v is number=>finite(v)&&v>=0&&v<=1;
export const validPrice=(v:unknown):v is number=>finite(v)&&Math.abs(v)>=100;
const validRange=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===2&&v.every(finite)&&v[0]<=v[1];
export function profile(p:number|null):Profile{return p==null?'unscored':p>=.65?'higher':p>=.45&&p<=.55?'even':p<.45?'longer':'all';}
export function upcoming(offer:Offer,now:number){const t=Date.parse(offer.kickoff??'');return Number.isFinite(t)&&now<t;}
function quoteFresh(quote:Quote|undefined,at:string|undefined,start:string|null,market:'moneyline'|'total'|'spread',now:number){
 if(!quote||!at||!start||Date.parse(quote.commence_time)!==Date.parse(start))return false;
 const updated=market==='total'?quote.totals_last_update:market==='spread'?quote.spreads_last_update:quote.moneyline_last_update;
 const times=[Date.parse(at),Date.parse(updated??''),Date.parse(start)];
 return times.every(Number.isFinite)&&times[1]<=times[0]&&times[0]<=now&&now<times[2]&&now-times[0]<=86400000&&now-times[1]<=86400000;
}
export function buildOffers(data:PredictionData,research:Research|null,odds:Odds|null,lines:Line[],model:Model,now:number):Offer[]{
 const matching=research?.season===data.season&&research.week===data.week?research:null;
 const result:Offer[]=[];
 for(const game of data.games){
  const r=matching?.games[game.game_id];
  const identity=r&&r.scoring.home.team===game.home_team&&r.scoring.away.team===game.away_team;
  const report=identity?r:undefined;
  const tracked=lines.find(l=>l.game_id===game.game_id&&l.home_team===game.home_team&&l.away_team===game.away_team);
  const q=odds?.games[game.game_id];const start=report?.kickoff??tracked?.kickoff??null;
  const base={game_id:game.game_id,matchup:`${game.away_team} @ ${game.home_team}`,kickoff:start,headshot:null,bookmaker:q?.bookmaker??null,price:null,quoteFresh:false,quoteAt:null,probability:null,prediction:null,range:null,modelRange:null,agreement:null,forecastAt:report?.generated_at??null,modelVersion:report?.model_version??'saved winner forecast'};
  const models=availableModels([game],true);const chosen=models.includes(model)?model:models[0];
  if(chosen){const home=probability(game,chosen);for(const side of ['away','home'] as const){
   const team=game[`${side}_team`],p=side==='home'?home:1-home;
   const raw=q?.[`${side}_moneyline`];const candidate=tracked?.[`${side}_price`];
   const aligned=tracked&&candidate===raw&&Math.abs(tracked.probabilities[chosen]-home)<1e-10;
   const fresh=!!aligned&&tracked!.bookmaker===q?.bookmaker&&Date.parse(tracked!.observed_at)===Date.parse(odds?.exported_at??'')&&quoteFresh(q,odds?.exported_at,start,'moneyline',now)&&freshQuote(tracked!,now)&&(!report||Date.parse(report.generated_at)<Date.parse(start!));
   result.push({...base,id:`${game.game_id}:ml:${side}:${chosen}`,contract:`${game.game_id}:ml`,team,name:team,category:'moneyline',market:`${team} to win`,target:'winner',direction:'win',line:null,custom:false,probability:p,price:validPrice(raw)?raw:null,quoteFresh:fresh,quoteAt:odds?.exported_at??null,source:`${MODEL_LABELS[chosen]} home/away win probability`,modelVersion:tracked?.forecast_snapshot_id??'saved winner forecast',forecastAt:tracked?.forecast_observed_at??null,modelRange:models.map(m=>side==='home'?probability(game,m):1-probability(game,m)),agreement:`${models.filter(m=>(probability(game,m)>=.5)===(side==='home')).length}/${models.length} models favor ${team}`});
  }}
  if(!report)continue;
  for(const p of report.players){
   const opponent=p.team===game.home_team?game.away_team:p.team===game.away_team?game.home_team:null;
   if(p.status!=='available'||p.opponent!==opponent||!opponent)continue;
   const player={...base,team:p.team,name:p.name,headshot:p.headshot??null,source:'Player yardage model · conditional on appearing'};
   if(finite(p.expected_yards)&&['passing','rushing','receiving'].includes(p.stat??'')){
    const target=Math.max(0,Math.floor(p.expected_yards/10)*10);
    result.push({...player,id:`${game.game_id}:${p.player_id}:yards`,contract:`${game.game_id}:${p.player_id}:yards`,category:'yardage',target:p.stat!,market:`Over ${target} ${p.stat} yards`,direction:'over',line:target,custom:true,prediction:p.expected_yards,range:validRange(p.range_80)?p.range_80:null});
   }
   for(const [key,target,label] of [['anytime_td_probability','scoring_td','1+ rushing/receiving TD'],['passing_td_probability','passing_td','1+ passing TD']] as const){
    if(target==='passing_td'&&p.position!=='QB')continue;
    if(!pValid(p[key]))continue;
    result.push({...player,id:`${game.game_id}:${p.player_id}:${target}`,contract:`${game.game_id}:${p.player_id}:${target}`,category:'touchdown',target,market:label,direction:'yes',line:null,custom:false,probability:p[key]!,source:`${target==='passing_td'?'Passing':'Rushing/receiving'} TD classifier · conditional on appearing`});
   }
  }
  const total=finite(q?.over_under)?q.over_under:Math.round(report.scoring.total*2)/2;
  for(const direction of ['over','under'] as const){const raw=q?.[direction==='over'?'over_price':'under_price'];
   result.push({...base,id:`${game.game_id}:total:${direction}`,contract:`${game.game_id}:total`,team:'',name:`${game.away_team} @ ${game.home_team}`,category:'total',target:'total',direction,line:total,custom:!finite(q?.over_under),market:`${direction==='over'?'Over':'Under'} ${total} points`,prediction:report.scoring.total,range:validRange(report.scoring.total_range_80)?report.scoring.total_range_80:null,price:finite(q?.over_under)&&validPrice(raw)?raw:null,quoteFresh:finite(q?.over_under)&&validPrice(raw)&&quoteFresh(q,odds?.exported_at,start,'total',now),quoteAt:odds?.exported_at??null,source:'Scoring model · mean and outcome range'});
  }
  for(const side of ['away','home'] as const){const saved=q?.[`${side}_spread`];const margin=side==='home'?report.scoring.home_margin:-report.scoring.home_margin;const spread=finite(saved)?saved:Math.round(-margin*2)/2;const raw=q?.[`${side}_spread_price`];
   result.push({...base,id:`${game.game_id}:spread:${side}`,contract:`${game.game_id}:spread`,team:game[`${side}_team`],name:game[`${side}_team`],category:'spread',target:'margin',direction:'win',line:spread,custom:!finite(saved),market:`${game[`${side}_team`]} ${spread>0?'+':''}${spread}`,prediction:margin,range:null,price:finite(saved)&&validPrice(raw)?raw:null,quoteFresh:finite(saved)&&validPrice(raw)&&quoteFresh(q,odds?.exported_at,start,'spread',now),quoteAt:odds?.exported_at??null,source:`Scoring model · expected ${game[`${side}_team`]} margin`});
  }
 }
 return result;
}
export function editTarget(offer:Offer,line:number,direction:'over'|'under'):Offer{
 if(!finite(line)||line<0||!['yardage','total'].includes(offer.category))throw Error('Enter a nonnegative numeric target.');
 return {...offer,line,direction,custom:true,market:`${direction==='over'?'Over':'Under'} ${line} ${offer.category==='yardage'?`${offer.target} yards`:'points'}`,probability:null,price:null,quoteAt:null,quoteFresh:false};
}
export function selectLeg(legs:Offer[],offer:Offer){return [...legs.filter(l=>l.contract!==offer.contract),{...offer}];}
export function signature(legs:Offer[]){return JSON.stringify(legs.map(l=>[l.id,l.direction,l.line,l.modelVersion,l.probability,l.price,l.quoteAt]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
export function slipAmounts(legs:Offer[],stake:number,manual:{signature:string;price:string}|null){
 if(!finite(stake)||stake<=0)return {price:null,profit:null,total:null,source:'unavailable' as const};
 const price=manual?.signature===signature(legs)&&manual.price.trim()!==''&&validPrice(Number(manual.price))?Number(manual.price):null;
 if(!legs.length||price===null)return {price:null,profit:null,total:null,source:'unavailable' as const};
 const total=stake*decimalOdds(price);return {price,total,profit:total-stake,source:'manual_unverified' as const};
}
export function researchCombinations(offers:Offer[],kind:'higher'|'even'|'longer'|'agreement',count:number,now:number):Offer[]{
 const available=offers.filter(o=>upcoming(o,now)&&o.probability!=null&&(kind==='agreement'?o.category==='moneyline'&&o.probability>=.5:kind==='higher'?o.probability>=.65:kind==='even'?o.probability>=.45&&o.probability<=.55:o.probability<.45));
 available.sort((a,b)=>kind==='even'?Math.abs(a.probability!-.5)-Math.abs(b.probability!-.5):kind==='agreement'?(b.modelRange?.filter(p=>p>=.5).length??0)-(a.modelRange?.filter(p=>p>=.5).length??0)||b.probability!-a.probability!:b.probability!-a.probability!);
 const games=new Set<string>(),chosen:Offer[]=[];
 for(const o of available){if(games.has(o.game_id))continue;games.add(o.game_id);chosen.push(o);if(chosen.length>=count)break;}
 return chosen.length>=count?chosen:[];
}
function validOffer(o:Offer){return !!o&&typeof o.id==='string'&&typeof o.contract==='string'&&typeof o.game_id==='string'&&typeof o.market==='string'&&typeof o.modelVersion==='string'&&typeof o.name==='string'&&typeof o.matchup==='string'&&typeof o.source==='string'&&typeof o.target==='string'&&['over','under','yes','win'].includes(o.direction)&&(o.kickoff===null||typeof o.kickoff==='string')&&(o.range===null||validRange(o.range))&&(o.modelRange===null||(Array.isArray(o.modelRange)&&o.modelRange.every(pValid)))&&(o.probability===null||pValid(o.probability))&&(o.line===null||finite(o.line))&&(o.price===null||validPrice(o.price))&&['moneyline','yardage','touchdown','total','spread'].includes(o.category);}
export function readDrafts(raw:string|null):Draft[]{if(raw===null)return [];const value=JSON.parse(raw);if(!Array.isArray(value)||!value.every(d=>d.schema_version===1&&d.kind==='unverified_research_draft'&&typeof d.id==='string'&&Number.isFinite(Date.parse(d.saved_at))&&finite(d.stake)&&d.stake>0&&Array.isArray(d.legs)&&d.legs.length>0&&d.legs.every(validOffer)&&new Set(d.legs.map((o:Offer)=>o.contract)).size===d.legs.length&&(d.combined_price===null||validPrice(d.combined_price))&&['manual_unverified','saved_single','unavailable'].includes(d.quote_source)&&d.joint_probability===null))throw Error('Saved drafts are unreadable; existing storage has been preserved.');return value;}
export function makeDraft(legs:Offer[],stake:number,manual:{signature:string;price:string}|null,now:number):Draft{
 if(!legs.length||!legs.every(validOffer)||new Set(legs.map(l=>l.contract)).size!==legs.length)throw Error('Select distinct, valid markets first.');
 if(!finite(stake)||stake<=0)throw Error('Enter a positive paper stake.');
 const amounts=slipAmounts(legs,stake,manual);
 return {schema_version:1,id:`draft:${now}:${signature(legs)}`,saved_at:new Date(now).toISOString(),kind:'unverified_research_draft',stake,legs:JSON.parse(JSON.stringify(legs)),combined_price:amounts.price,quote_source:amounts.source,joint_probability:null};
}
export function estimatedEV(offer:Offer,now:number){return offer.probability!=null&&validPrice(offer.price)&&offer.quoteFresh&&upcoming(offer,now)?offer.probability*decimalOdds(offer.price)-1:null;}
export type { Game, Model };
