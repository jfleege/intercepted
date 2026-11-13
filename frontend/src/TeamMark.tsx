import './TeamIdentity.css';
export default function TeamMark({team}: {team: string}) {
  return <span className="team-mark"><img src={`${import.meta.env.BASE_URL}logos/${team}.png`} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }}/><span>{team}</span></span>;
}
