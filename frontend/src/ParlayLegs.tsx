import type {ReactNode} from 'react';
import './ParlayLegs.css';

type Leg = {
  id: string; context?: string; name: string; market: string;
  probability: number | null; actual?: number; quote?: ReactNode;
};

export default function ParlayLegs({legs}: {legs: Leg[]}) {
  return <ul className="parlay-legs">{legs.map(leg => <li key={leg.id}>
    {leg.context && <small>{leg.context}</small>}
    <strong>{leg.name} · {leg.market}</strong>
    <div className="parlay-leg-meta"><small>{leg.probability == null ? 'Model likelihood unavailable' : `${(leg.probability*100).toFixed(1)}% model likelihood`}
      {leg.actual != null && ` · Actual ${leg.actual}`}
    </small>
    {leg.quote}</div>
  </li>)}</ul>;
}
