import type { Offer } from './projectionMarkets';
export type Actual = {game_id:string; player_id?:string; family:string; target:string; actual:number|null; status:string; team?:string; home_team?:string; away_team?:string; home_score?:number; away_score?:number};
export function gradeSelection(offer:Offer, savedAt:string, rows:Actual[]) {
 const start=Date.parse(offer.kickoff??'');
 if(!Number.isFinite(start)||!Number.isFinite(Date.parse(savedAt))||Date.parse(savedAt)>=start) return {status:'unverified',actual:null};
 const candidates=rows.filter(r=>r.game_id===offer.game_id && r.status==='graded' && typeof r.actual==='number' && Number.isFinite(r.actual));
 let values:number[]=[];
 if(offer.category==='moneyline')values=candidates.filter(r=>r.family==='winners' && r.home_team && r.away_team).map(r=>r.home_score!==undefined&&r.home_score===r.away_score?.valueOf()? .5 : offer.team===r.home_team?r.actual!:1-r.actual!);
 if(offer.category==='yardage')values=candidates.filter(r=>r.family==='yardage'&&r.player_id===offer.player_id&&r.target===offer.target).map(r=>r.actual!);
 if(offer.category==='touchdown')values=candidates.filter(r=>r.family==='touchdowns'&&r.player_id===offer.player_id&&r.target===(offer.target==='passing_td'?'pass_td':'any_td')).map(r=>r.actual!);
 if(offer.category==='spread')values=candidates.filter(r=>r.family==='scoring'&&r.target==='margin').map(r=>offer.team===r.home_team?r.actual!:-r.actual!);
 if(offer.category==='total')values=candidates.filter(r=>r.family==='scoring'&&r.target==='total').map(r=>r.actual!);
 if(!values.length)return {status:'pending',actual:null};
 if(values.some(v=>v!==values[0]))return {status:'conflicting_results',actual:null};
 const actual=values[0];
 if(offer.category==='moneyline'||offer.category==='touchdown')return {status:actual===1?'hit':actual===0?'miss':'push',actual};
 if(offer.line===null)return {status:'unavailable',actual};
 if(offer.category==='spread'){const margin=actual+offer.line;return {status:margin===0?'push':margin>0?'hit':'miss',actual};}
 return {status:actual===offer.line?'push':(offer.direction==='over'?actual>offer.line:actual<offer.line)?'hit':'miss',actual};
}
