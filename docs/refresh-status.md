# Refresh status

The expandable status strip is shared across all five tabs. It reports the **active** prediction slate even while a saved week is selected. Central timestamps and per-source dates distinguish weekly forecast creation, input coverage, result exports, and sportsbook snapshots.

`weekly_forecast` records its actual decision in `data/tracking/forecast_refresh_status.json`: waiting for remaining game results, waiting for team/QB statistics, current, or regular-season complete. Validation-only runs never modify this evidence. Data-pending decisions retain the existing forecast slate.

The Pages workflow starts an attempt record and exports `frontend/public/refresh_status.json` after the data steps, using each step's **outcome**, including failures masked by `continue-on-error`. Only successful completion of all required data steps advances the last full refresh timestamp. Expected skipped odds/prop calls do not prevent success. Results-only runs have a separate success timestamp. Neither successful export nor a newly generated forecast means model weights were retrained.

Status and forecast-check evidence are committed before the frontend build, including on failed data runs when the status exporter can still execute. The public page displays the most recently deployed snapshot, **not a live GitHub Actions monitor**. If the workflow/build/deployment fails, its newly committed status may not be visible until a later deployment; after 30 hours, the strip warns that the published status is old. A link to the snapshot's workflow run is shown when available.

The next forecast check is the next 13:17 UTC schedule (8:17 a.m. CDT / 7:17 a.m. CST). It is an expected start, not a guaranteed completion time. Once the saved next-check time has passed, the UI shows the recurring schedule instead of inventing a future check. Player prop automation still starts Thursday and retains the existing budget guards. This feature makes no Odds API requests.

The initial snapshot intentionally has no last-success timestamp or weekly-check outcome; the first merged workflow run records them. Exported source timestamps are retained as evidence, never inferred from filesystem modification times. Old weekly forecasts do not receive a daily-age warning; sportsbook snapshots older than 24 hours do. Individual quote timestamps and kickoff checks in Markets remain authoritative.
