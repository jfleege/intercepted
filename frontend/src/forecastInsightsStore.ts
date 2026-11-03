import {createContext,useContext} from 'react';
import type {ForecastInsights} from './forecastInsights';
export const ForecastInsightsContext=createContext<{data:ForecastInsights|null;now:number;error:string}>({data:null,now:Date.now(),error:''});
export const useForecastInsights=()=>useContext(ForecastInsightsContext);
