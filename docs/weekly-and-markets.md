# Weekly forecasts and moneyline tracking

The existing 13:17 UTC daily refresh checks the regular-season slate before refreshing players and odds. Once all prior games are final (or explicitly cancelled), it advances to the earliest unfinished week. It verifies complete prior-season and prior-week team-game coverage in both PBP aggregations and current-season QB team-week coverage in Next Gen Stats. If statistics are delayed it logs a warning and retains the existing predictions; the next daily run retries. Unexpected errors fail the workflow rather than publish partial predictions.

New forecasts use the exact existing feature helpers and saved V4-A/V4-QB+ weights. Features incorporate completed weeks before the target; the weights remain trained through 2026 Week 5. This does not retrain the model. QB projections use the latest prior-week primary passer, not confirmed starters or injury adjustments. Regular-season completion does not launch postseason forecasts. Week 1 uses previous-season priors, with missing current-season QB projections handled by the saved imputer.

The normal daily run has the **same one scheduled Odds API request**, with the existing h2h/spreads/totals configuration. This change adds no requests, markets, or bookmakers. The 07:47 UTC results run and manual results-only runs do not call the Odds API. Manual “Refresh odds” remains optional and consumes additional quota. Weekly inputs use nflverse rather than the Odds API. Longer feature jobs can consume more GitHub Actions time; verify your account's included usage separately.

## Manual controls

After merging, open **Actions → Refresh data and deploy Pages → Run workflow** on main:

- Check **refresh_forecasts** to check advancement now; it skips an already published week.
- Check **results_only** for grading/results without players, forecast generation, or odds requests.
- Leave **refresh_odds** unchecked unless an extra paid-quota request is intended.
- To record a custom paper selection, enter **paper_game** (e.g. `2026_06_ARI_LA`), **paper_team**, **paper_model**, and **paper_stake**. A currently fresh pregame quote must already exist. This works with results-only checked. There is no actual wager. A second custom run intentionally creates another timestamped selection.

Local equivalents, with Python 3.12:

```sh
python -m pip install -r requirements-automation.txt
python -m src.ml.weekly_forecast
python -m src.ml.refresh_performance --import-git-history
python -m src.ml.refresh_markets
python -m src.ml.refresh_markets --record-paper 2026_06_ARI_LA LA --model v4_qb_plus --stake 1
```

`python -m src.ml.weekly_forecast --validate-current` downloads and reconstructs the current week without changing published predictions or their archives. Raw downloaded tables are ignored by git. The pinned scikit-learn version matches the saved models; mismatched pickle versions fail serving.

## Retained evidence

- `data/tracking/forecasts/`: immutable forecasts with saved-model identity and collection evidence.
- `data/tracking/odds/`: timestamped normalized odds snapshots, including event/book IDs and moneyline update time on new exports. API keys are never written here.
- `data/tracking/paper/`: immutable selections, original prices/stakes/model probabilities, timestamps and links to the forecast and odds snapshots.
- `data/tracking/results.json`: existing result revisions, used to regrade corrected scores.
- `frontend/public/markets.json`: generated comparisons, graded selections and baseline summaries.

Imported legacy odds retain their original provider/export times but their observation timestamp is the actual import time. They cannot create backdated selections. The initial imported quote is stale, so the ledger starts empty until a new eligible quote arrives.

## Paper rules

The automatic baseline records **one unit on each model's predicted winner per game**, once, at the first eligible quote seen while the tracker is running. Both model records are independent research comparisons; they are not a combined staking recommendation. Later price/model changes never replace a baseline record.

To create any record, both American moneylines must be valid, the quote and saved forecast must precede kickoff, the forecast's training cutoff must precede the game week, and provider and collection timestamps must be no more than 24 hours old. Quote kickoff must match the results schedule. Historical quotes may be displayed, but historical selections are never invented. Missing quotes simply produce no paper selection.

Implied probability is `1 / decimal odds`. The comparison normalizes the two implied probabilities to sum to one, removing the two-way bookmaker margin. The displayed difference is model minus normalized market probability in percentage points; it is not an expected-return estimate. DraftKings is the only connected bookmaker; no cross-book “best price” claim is made.

Final scores grade wins/losses at the original price. Under this explicitly two-way moneyline paper convention, a tie pushes and an explicitly cancelled game voids; neither produces profit. Profit is net of stake, and ROI divides profit by settled win/loss stakes, excluding pushes/voids and pending selections. These conventions do not implement every bookmaker's house rules. Corrections update derived grades, retaining original record files. Custom selections remain separate from the baseline totals. Props, spreads, totals, and parlays are outside this moneyline tracker.

After merge, a scheduled run (or a manual run) must succeed to populate and deploy the new page. This PR itself does not run odds requests, merge, or deploy.
