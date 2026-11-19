import {useEffect, useState} from 'react';
import {fetchSnapshot} from './snapshotCache';
import Segmented from './Segmented';

type Value = {average:number|null; games:number; window_games:number};
type Report = {schema_version:number; season:number; week:number; teams:Record<string,{through_week:number; windows:Record<string,Record<string,Record<string,Value>>>}>};
const fields = {
  QB: [['passing_yards','Passing yards'],['rushing_yards','Rushing yards'],['passing_tds','Passing TDs'],['rushing_tds','Rushing TDs']],
  RB: [['rushing_yards','Rushing yards'],['receiving_yards','Receiving yards']],
  WR: [['receiving_yards','Receiving yards'],['rushing_yards','Rushing yards']],
  TE: [['receiving_yards','Receiving yards'],['rushing_yards','Rushing yards']],
};
type Position = keyof typeof fields;

export default function PositionDefense({season, week, opponents, position}: {season:number; week:number; opponents:[string,string]; position:string}) {
  const [settled, setSettled] = useState('');
  const [report, setReport] = useState<Report|null>(null);
  const [window, setWindow] = useState('last3');
  const [override, setOverride] = useState<{filter:string; position:Position}>();
  const selected = override?.filter === position ? override.position : position === 'all' ? 'QB' : position as Position;
  useEffect(() => {
    let active = true;
    const save = (data:Report|null) => { if (active) {setReport(data); setSettled(`${season}:${week}`);} };
    fetchSnapshot(`${import.meta.env.BASE_URL}position_defense/${season}-week-${week}.json`)
      .then(r => r.ok ? r.json() : null).then(save).catch(() => save(null));
    return () => { active = false; };
  }, [season,week]);

  const matching = report?.schema_version === 1 && report.season === season && report.week === week;
  const teams = opponents.map(code => {
    const team = matching ? report.teams[code] : undefined;
    return team && team.through_week < week ? team : undefined;
  });
  const values = teams.map(team => team?.windows[window]?.[selected]);
  const coverage = fields[selected].flatMap(([field]) => values.map(group => group?.[field]));
  const first = coverage[0];
  const shared = first && coverage.every(v => v?.games === first.games && v.window_games === first.window_games);
  return <section className="mr-defense" aria-label="Opponent defense by position">
    <div className="mr-defense-controls"><h4>Opponent defense by position</h4>
      <Segmented role="group" aria-label="Defense position">{(Object.keys(fields) as Position[]).map(p => <button type="button" key={p} aria-pressed={selected === p} onClick={() => setOverride({filter:position, position:p})}>{p}</button>)}</Segmented>
      <Segmented role="group" aria-label="Defense history window">{[['last3','Last 3'],['last5','Last 5'],['season','Season']].map(([key,label]) => <button type="button" key={key} aria-pressed={window === key} onClick={() => setWindow(key)}>{label}</button>)}</Segmented>
    </div>
    {values.some(Boolean) ? <><div className="mr-table-scroll"><table>
      <thead><tr><th scope="col">Allowed per game</th>{opponents.map((code,i) => <th scope="col" key={code}>{code} defense <small>vs {opponents[1-i]} {selected}s</small></th>)}</tr></thead>
      <tbody>{fields[selected].map(([field,label]) => <tr key={field}><th scope="row">{label}</th>{values.map((group,i) => {
        const value = group?.[field];
        return <td key={opponents[i]}>{value?.average?.toFixed(1) ?? '—'}{!shared && value && <small>{value.games}/{value.window_games} games</small>}</td>;
      })}</tr>)}</tbody>
    </table></div>
    <p>{shared && `${first.games} of ${first.window_games} games with data · `}{teams[0] && teams[0].through_week === teams[1]?.through_week ? `Through Week ${teams[0].through_week} · ` : teams.map((team,i) => team ? `${opponents[i]} through Week ${team.through_week} · ` : '')}Historical totals across opposing {selected}s, including OT.{selected === 'QB' && ' Passing yards are gross.'}</p></> :
      <p>{settled === `${season}:${week}` ? 'Matching position-level defensive data unavailable.' : 'Loading position allowances…'}</p>}
  </section>;
}
