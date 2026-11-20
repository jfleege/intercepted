import './ParlayLegs.css';

type Leg = {
  id: string; context?: string; name: string; market: string;
  probability: number | null; conditional?: boolean; actual?: number;
};

export default function ParlayLegs({legs}: {legs: Leg[]}) {
  return <ul className="parlay-legs">{legs.map(leg => <li key={leg.id}>
    {leg.context && <small>{leg.context}</small>}
    <strong>{leg.name} · {leg.market}</strong>
    <small>{leg.probability == null ? 'Model likelihood unavailable' : `${(leg.probability*100).toFixed(1)}% model likelihood${leg.conditional ? ' · if appearing' : ''}`}
      {leg.actual != null && ` · Actual ${leg.actual}`}
    </small>
  </li>)}</ul>;
}
