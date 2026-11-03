import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import type {ForecastInsights} from './forecastInsights';
import {matchesInsights} from './forecastInsights';
import {fetchSnapshot} from './snapshotCache';
import {ForecastInsightsContext} from './forecastInsightsStore';
export function ForecastInsightsProvider({children}:{children:ReactNode}){
 const [data,setData]=useState<ForecastInsights|null>(null),[now,setNow]=useState(Date.now),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();
  const load=async()=>{try{const [a,b]=await Promise.all(['forecast_insights.json','predictions.json'].map(async file=>{const r=await fetchSnapshot(`${import.meta.env.BASE_URL}${file}`,{signal:controller.signal});if(!r.ok)throw Error('Context not published');return r.json();}));
   if(!Array.isArray(a.players)||!Array.isArray(a.changes)||!Array.isArray(a.monitoring?.alerts)||!matchesInsights(a,b,Date.now()))throw Error('Context is stale or belongs to another slate');
   if(!controller.signal.aborted){setData(a);setError('');}
  }catch{if(!controller.signal.aborted){setData(null);setError('Current forecast context is unavailable or stale. Availability remains unknown.');}}};
  void load();let ticks=0;
  const timer=window.setInterval(()=>{setNow(Date.now());if(!document.hidden&&++ticks%5===0)void load();},60000);
  const visible=()=>{setNow(Date.now());if(!document.hidden)void load();};document.addEventListener('visibilitychange',visible);
  return()=>{controller.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[]);
 return <ForecastInsightsContext value={{data,now,error}}>{children}</ForecastInsightsContext>;
}
