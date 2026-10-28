export type RefreshSource = {
  id: string; label: string; updated_at?: string | null; season?: number; week?: number;
  features_through_week?: number; through_week?: number; refresh_outcome?: string;
};
export type RefreshStatus = {
  schema_version: number; snapshot_at: string; active_season?: number; active_week?: number;
  last_successful_refresh_at?: string | null; last_results_refresh_at?: string | null;
  next_forecast_check_at?: string;
  attempt?: {mode?: string; state?: string; completed_at?: string; steps?: Record<string,string>};
  forecast_check?: {checked_at: string; state: string; message: string; target_season: number; target_week: number | null; active_season: number; active_week: number} | null;
  sources: RefreshSource[]; workflow_url?: string;
};
export function validDate(value?: string | null): number | null {
  if (!value) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : null;
}
export function statusSummary(status: RefreshStatus | null, now: number) {
  if (!status) return {tone: 'muted', label: 'Refresh status unavailable'};
  const snapshot = validDate(status.snapshot_at);
  if (snapshot === null || snapshot > now + 5 * 60_000) return {tone: 'muted', label: 'Refresh status unverified'};
  if (now - snapshot > 30 * 3_600_000) return {tone: 'warning', label: 'Refresh status is over 30 hours old'};
  if (Object.values(status.attempt?.steps ?? {}).some(v => v === 'failure' || v === 'cancelled')) return {tone: 'warning', label: 'Some data updates did not complete'};
  const fullRefresh = validDate(status.last_successful_refresh_at);
  if (fullRefresh !== null && now - fullRefresh > 30 * 3_600_000) return {tone: 'warning', label: 'Full data refresh is overdue'};
  if (status.sources.some(source => ['players', 'directory', 'research'].includes(source.id) && source.week != null && (source.week !== status.active_week || source.season !== status.active_season))) return {tone: 'warning', label: 'Some projections are from a different week'};
  const check = status.forecast_check;
  if (!check || check.active_season !== status.active_season || check.active_week !== status.active_week) return {tone: 'muted', label: 'Weekly check not yet recorded'};
  const checked = validDate(check.checked_at);
  if (checked === null || checked > now + 5 * 60_000 || now - checked > 30 * 3_600_000) return {tone: 'warning', label: 'Weekly check needs an update'};
  if (check.state === 'current_limited_qb') return {tone: 'warning', label: 'Current slate · limited QB tracking'};
  if (check.state === 'waiting_stats') return {tone: 'warning', label: `Waiting for Week ${check.target_week ?? '—'} stats`};
  if (check.state === 'waiting_games') return {tone: 'good', label: 'Current slate · awaiting final games'};
  if (check.state === 'season_complete') return {tone: 'muted', label: 'Regular season complete'};
  if (check.state === 'current') return {tone: 'good', label: 'Forecast slate is current'};
  return {tone: 'muted', label: 'Weekly check not yet recorded'};
}
export function sourceNote(source: RefreshSource, status: RefreshStatus, now: number) {
  if (source.refresh_outcome === 'failure' || source.refresh_outcome === 'cancelled') return 'Update failed · saved snapshot retained';
  if (source.week != null && (source.week !== status.active_week || source.season !== status.active_season)) return `Saved ${source.season ?? '—'} Week ${source.week} · different forecast week`;
  const date = validDate(source.updated_at);
  if (date === null || date > now + 5 * 60_000) return 'Timestamp unavailable or unverified';
  if (['odds', 'props'].includes(source.id)) return now - date > 24 * 3_600_000 ? 'Quote snapshot older than 24 hours' : 'Snapshot time · individual quotes may be older';
  const through = source.features_through_week ?? source.through_week;
  if (through != null) return `Inputs through Week ${through}`;
  if (source.week != null) return `${source.season ?? '—'} · Week ${source.week}`;
  return 'Snapshot export time';
}
export function nextCheck(status: RefreshStatus, now: number) {
  const next = validDate(status.next_forecast_check_at);
  return next !== null && next > now ? next : null;
}
