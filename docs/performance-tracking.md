# Forecast archive and Performance page

Run from the repository root:

```bash
python -m src.ml.refresh_performance --import-git-history
```

This downloads nflverse schedules, archives the committed prediction slate and
model identity, grades completed games, and writes frontend/public/performance.json.
No Odds API request is made. Install nflreadpy==0.1.5 for the results loader.

## Persistence and provenance

- data/tracking/forecasts contains immutable content-addressed snapshots. Identical
  forecast/model content is archived once. Changed forecasts create new files.
- Each snapshot preserves both models, metadata, artifact Git blob IDs, training
  cutoff, timestamp, and a source commit or local export reference.
- Git history import uses the first commit containing the exact forecast bytes.
  Git timestamps are repository evidence, not independent timestamp certification.
- Snapshot eligibility requires saved evidence before kickoff, model creation
  before the saved evidence, and a training cutoff before the target week.
- The first verified pregame snapshot per game/model is frozen for evaluation.
  Later snapshots remain on disk and cannot improve the chosen record retroactively.
- Late or unverified forecasts are displayed separately. Unavailable kickoff times
  cannot qualify a forecast for verified metrics. Current schedule kickoff changes
  are not an independently certified record of historic rescheduling.
- data/tracking/results.json stores latest normalized results plus append-only
  observations whenever the source changes. Stat corrections regrade the same
  original forecast and leave result history intact.

## Completion and metrics

The nflverse schedule must publish both scores and a non-null result after kickoff.
This is a daily results source, not an in-game scoreboard. Missing data aborts the
refresh rather than removing records. A completed result cannot regress to pending.
Explicit cancellation flags are supported when provided; otherwise missing results
stay pending. nflverse schedules do not always distinguish cancelled or postponed games.

Accuracy, Brier score, and log loss exclude ties, pending and cancelled games. A
0.5 home probability selects the home side consistently with the prediction app.
Log loss clips exact zero/one probabilities to 1e-15 for numerical stability.
Game form shows individual correctness and Brier error. Cumulative curves show
expanding accuracy/Brier by kickoff then game ID; weekly tables show sample sizes.
Calibration uses home-win bins with 95% Wilson intervals; small samples are not
evidence that the model is calibrated.

Historical backtests import the existing qb_experiments_predictions.csv (2022–2024).
Those probabilities used regularization selected on earlier seasons, rather than
the production fixed C=0.01. They never enter the verified live record. Only winner
outcomes are stored in this CSV; no final-score values are invented.

## Daily refresh and deployment

The existing workflow refreshes results at 07:47 and 13:17 UTC daily (02:47 and
08:17 CDT; 01:47 and 07:17 CST), and on manual dispatch. GitHub may delay schedules.
Both scheduled runs refresh players and performance. Only the original 13:17 UTC schedule
requests odds; manual dispatch only requests odds if checked. Normal daily odds
usage remains one three-market request. This does not retrain models or advance weeks.

Manual runs expose a results_only checkbox. When checked it skips player and odds
fetches, even if refresh_odds is also checked, while still rebuilding/deploying.
Pushing predictions.json to main also refreshes the archive and site without odds.

After a successful frontend build the workflow commits data/tracking and
performance.json to main, then deploys in the same run. The existing concurrency
group prevents simultaneous refresh workflows. A conflicting external push or
protected-branch denial fails persistence and blocks deployment; it never force-pushes.
If main requires PRs for all writes, allow the automation appropriately or use a
separate data branch before enabling. Generated archives must not be discarded as
temporary artifacts. Never store them only in the ephemeral runner filesystem.

## Weekly usage

export_predictions now archives immediately after export, using the current
model metadata and Git blob hashes. Run it before kickoff and commit both the
prediction JSON and data/tracking. Forecasts made only on your computer cannot be
recovered remotely unless their snapshots are committed. The CSV input path in
export_predictions still needs updating when advancing weeks.

## Review and validation

```bash
python -m unittest discover -s tests -v
cd frontend
npm ci
npm run build
npm run dev
```

Navigate to #performance and switch datasets/models. The Markets page remains
the existing skeleton. There are no new prop models or betting actions.

Attribution: nflverse schedules via nflreadpy, CC-BY 4.0;
https://nflreadpy.nflverse.com/ and https://github.com/nflverse/nfldata.
