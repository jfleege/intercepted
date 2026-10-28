# Availability, opportunity context, observed changes, and monitoring

`python -m src.ml.forecast_insights` builds `frontend/public/forecast_insights.json` after the player directory and research grading steps. It downloads free nflverse injury and depth-chart tables once per full refresh. `--results-only` uses the existing context without network calls. Neither path requests odds or retrains any models. Failures are included in refresh status; evidence is persisted alongside status before the frontend build. Original forecast, model weights, grading evidence, and paper records are untouched.

## Player context

Injury/practice joins require current season, REG, forecast week, exact GSIS ID, normalized team, a unique source row, a pregame cutoff, and a source observation within 48 hours. Known report-update timestamps must also be current and not future. The currently inspected 2026 injury table lacks report-update times, so observation time is explicitly distinct from report time. Missing/ambiguous rows remain unknown. DNP practice does not imply Out; Questionable/Doubtful are not converted to numerical participation probabilities. No row means neither healthy nor inactive.

Depth charts use the latest pre-observation snapshot per team, not an old player's latest row after removal from a newer chart. A fresh first-unit listing is package dependent and is not a game-day confirmation. Fresh game-specific sourced QB reports retain their distinct expected/confirmed status. A disagreement between the published QB and a unique first-unit QB is a review signal, not a cosmetic rename or an unsourced automatic quarterback replacement.

Usage is the mean of the prior three same-team completed appearances for QB attempts, RB carries, and WR/TE targets. Missing values and role/team changes do not become zero. The estimate is conditional on appearing and is not injury-adjusted; independent conditional player baselines are not a team-total allocation. The recent observed min/max is not a prediction interval. A recency-weighted 20/30/50 candidate was not consistently better in the current-directory retrospective check and has not been promoted. Performance displays that candidate comparison on identical walk-forward outcomes, separately from verified live model records. It is a descriptive, current-directory check with possible selection effects, not an independent league-wide benchmark or evidence of improved yardage/TD accuracy.

Fresh current-week reported-out players are excluded from Dashboard/Players watch rankings and cross-game combinations. Their conditional forecasts remain visible in the directory and Markets, with new selections/edited selections disabled. Existing saved research stays intact; a loaded out selection is labeled and must be removed before saving another draft. Source failures, expiry, unknown status, or a started game do not create an automatic out/healthy determination. The client validates slate, identity, observation time and kickoff again; these are published snapshots, not a guaranteed game-day active list.

## Observed changes

Each slate has its own durable baseline and append-only events at `data/tracking/forecast_insights/SEASON-week-WEEK.json`. The first actual observation starts tracking; no prior revisions are reconstructed. Same-game home/away/kickoff identity is required. Only pregame observations can revise a baseline. Result corrections and after-kickoff updates do not rewrite forecasts or produce pregame revisions. Optional missing numeric inputs are monitored as missing rather than inventing zero deltas. Source and observation times are distinct.

Tracked values include QB identity/confirmation, home-win probabilities per saved model, scoring points, player yards/TD probabilities, research version, injury/practice/depth status, and usage. Repeated identical checks add no events. Reasons are restricted to observable QB/version/source evidence or say the cause was not provided. Co-occurring changes are not presented as proof of causation. Probability deltas use percentage points. Dashboard has a compact filtered change disclosure; Players shows the matching player's changes.

## Monitoring and review

Full/results-only refreshes publish input/slate/cutoff/invalid-probability/duplicate-identity/source-failure checks, stale player/result export warnings, unusual projection movement, existing version-specific error health, and calibration watch signals. Actions warnings and the job summary carry actionable signals. There are no emails, external messages, paid calls, model promotion, or automatic recalibration.

Provisional movement thresholds: home win 10 pp; TD 15 pp; points 7; yards both 15 and 25%; opportunities both 3 and 40%. A change calls for inspection; it does not establish an error or a profitable opportunity. Forecast age alone is not model drift: weekly saved forecasts can legitimately remain unchanged.

Calibration uses only verified graded binary outcomes, grouped by target and exact weight version. Duplicate evidence is collapsed; conflicts fail. Whole games stay together in two latest disjoint windows. Minimums are 100 winner games and 500 TD appearances per window. Two windows with absolute mean probability bias >=10 pp AND ten-bin ECE >=10 pp flag Review; a bad latest single window is Watch; insufficient history is Sample building. This heuristic is not a significance test. All-version curves remain descriptive. Monitoring does not alter the existing paired error baseline policy or frozen grades.

## Validation

Offline Python tests cover strict joins, source age/future dates, unknown/DNP semantics, current-team depth snapshots, usage cutoffs and transfers, first-observation/idempotent changes, kickoff/rollover boundaries, version isolation, whole-game calibration windows, duplicates, invalid inputs, and network-free results checks. Frontend unit tests cover freshness/identity/selection guards, unknown status, pp units and out ranking exclusions. Browser QA uses explicitly mocked out/change/calibration examples (never written as real forecasts) at 375/650/900/1440px, plus existing hero, Dashboard, Players, Markets, quote, Performance and footer flows. Live-source initial export contains no fabricated changes.

Source references: https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html ; https://nflreadr.nflverse.com/articles/dictionary_injuries.html ; https://nflreadr.nflverse.com/reference/load_depth_charts.html . All provider dates/coverage remain subject to upstream availability.
