# Matchup research models, version 1

This pipeline adds three model families and historical period trends. It does not change the winner models, their probabilities, their archive, or the Odds API schedule.

## What is modeled

- **Scoring:** one histogram gradient-boosted regressor predicts each team's points from its own and its opponent's prior scoring/yardage, home status, rest, and season progress. Home-minus-away gives the scoring margin; their sum gives the total. Separate held-out residuals provide nominal 80% ranges for team points, margin, and total. These are expected values and outcome ranges, not exact score probabilities.
- **Player yardage:** separate passing (QB), rushing (RB), and receiving (WR/TE) regressors. Inputs include the player's prior three appearances and season production, historical attempts/carries/targets, prior touchdown rates, position, opponent defense, team scoring, and game context. At least three prior appearances are required. Ranges can include negative yardage because negative yardage is possible.
- **Touchdowns:** standardized logistic regression with separate chronological sigmoid calibration. The offensive anytime event is at least one rushing/receiving touchdown; **passing touchdowns and return scores do not count**. A separate QB classifier estimates at least one passing touchdown. No passing-TD probability is labeled as the QB scoring a touchdown.

Player forecasts are **conditional on the player appearing**. They are not starter, injury, snap-count, or availability forecasts. The current watch export supplies the candidate list, including its projected quarterbacks. Validation includes qualifying historical QB/RB/WR/TE appearances, rather than retrospectively selecting only today's top players. Records absent from the source are not filled as zero-yard inactive games.

## Features and temporal boundaries

Only regular-season completed games strictly before the forecast week enter the history. Each historical game has its features computed **before** either side's game outcomes or player usage are added to history. Opponent context also uses only prior games. Teams blend current-season averages with prior-season averages, increasing current-season weight as games accumulate; recent features use five prior team games. Player recent features use three prior appearances, and the reference rate uses up to ten prior appearances.

Fixed regression configuration: 140 boosting iterations, learning rate .06, 15 leaves, minimum 35 samples per leaf, L2 10, random seed 42. The event classifier uses standardized features and logistic C=.1; calibration uses sigmoid logistic C=1. No hyperparameter search uses the test year.

## Evaluation

The fixed development benchmark fits 2018–2023, calibrates on 2024, and tests on 2025. Historical test features roll forward using only already-completed games. MAE measures yardage and scoring error; Brier/log loss measure touchdown probabilities. Reliability bins and nominal 80% interval coverage are included in `research-validation.json`. This is retrospective model development, not a verified live record or evidence of betting profitability.

Baselines are the mean of recent own scoring and opponent points allowed for points; the last three appearances for player yardage; and smoothed per-appearance historical event rates for touchdowns. Margin and total baselines use the corresponding two team baselines.

The initial test shows a small improvement in team-point error and a larger improvement in game-total error. **Derived scoring-margin error is worse than its baseline.** All three player yardage regressors and the two TD events improve on their baselines in that test. Model output remains explicitly experimental. See the committed numeric report rather than interpreting training accuracy as performance.

Production weights are separate from benchmark weights: normally fit through the prior season, then calibrate on completed current-season games. If the current calibration sample has fewer than 40 appearances/team-games (100 for offensive TDs), or lacks both event classes, the previous season is used for calibration and training ends earlier. Model-specific fit/calibration cutoffs and sample counts are exported. These cutoffs must precede the forecast week.

## Quarter and half performance

Quarter/half charts are **descriptive historical trends**, not another prediction model. Current-season PBP cumulative quarter scores must reconcile with the schedule's final score; missing/inconsistent games are excluded and listed. Q1+Q2 equals H1, Q3+Q4 equals H2; overtime is separate. Pass/run EPA is play-weighted, and missing offensive plays yield unavailable EPA, not zero. Season and recent-three-game scoring, points allowed, efficiency, and game-by-game splits are available.

Source definitions: [nflverse PBP dictionary](https://nflreadr.nflverse.com/articles/dictionary_pbp.html), [schedule dictionary](https://nflreadr.nflverse.com/articles/dictionary_schedules.html). No odds-provider requests are made by this pipeline.

## Refresh and provenance

Run `python -m src.ml.refresh_research` after the weekly predictions and player export. Normal refresh skips unchanged inputs. `--force` rebuilds; `--reuse-downloads` explicitly uses locally cached sources for development. Historical sources are cached; current-season sources refresh on a rebuild.

Weights and metadata live in `models/research/`; data hashes, feature names, cutoffs, model SHA-256s, and timestamps identify the model version. New predictions are written only before kickoff. A started game's saved research is retained during revisions. Each version is archived in `data/tracking/research/`, and weekly report files are saved in `frontend/public/research/` for later browsing. No past weeks are backfilled as live pregame forecasts. The scoring/player models do not use sportsbook odds or live in-game information.

Pages refresh runs research after player refresh. A research-source failure retains the prior export and does not prevent the existing winner dashboard from deploying. The UI requests a week-specific report, so an older export cannot silently populate a new week's matchup.

## Useful next model families

1. **Participation and opportunity:** starts, snaps, routes, targets, carries and pass attempts. This would address the availability/usage uncertainty the current player models condition on.
2. **Red-zone opportunity:** expected red-zone carries/targets, followed by scoring conversion. This could improve touchdown explanations beyond recent production.
3. **Pace and possessions:** expected drives and play volume, informing totals and yardage.
4. **Pressure/turnover:** sacks and interception probabilities, with separate validation.

Half/quarter prediction models would be a subsequent research task. Historical splits should not be presented as forward probabilities without that validation. Joint simulations would also be required before constructing correlated parlay probabilities; multiplying the current player marginals would not suffice.
