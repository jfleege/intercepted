export type GameSchedule = { home_team: string; away_team: string; kickoff: string; networks?: string[] };
export type ScheduleSnapshot = { season: number; week: number; games: Record<string, GameSchedule> };
type ScheduledGame = { home_team: string; away_team: string; game_date: string; kickoff?: string; result?: { kickoff?: string | null } };

export function gameScheduleLabel(game: ScheduledGame, schedule?: GameSchedule): string {
  const matching = schedule?.home_team === game.home_team && schedule.away_team === game.away_team ? schedule : undefined;
  const value = matching?.kickoff ?? game.kickoff ?? game.result?.kickoff;
  const date = new Date(value ?? '');
  if (!value || !/(Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(date.getTime())) {
    const day = new Date(`${game.game_date}T12:00:00Z`);
    const label = Number.isFinite(day.getTime()) ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' }).format(day) : game.game_date;
    return `${label} · Time TBD`;
  }
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }).format(date);
  const networks = matching?.networks?.filter(name => typeof name === 'string' && name.trim()).join(' / ');
  return `${day} · ${time} CT${networks ? ` · ${networks}` : ''}`;
}
