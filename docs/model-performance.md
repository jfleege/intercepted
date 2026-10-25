# Model performance hub

Performance defaults to an overview of winner, scoring, yardage and touchdown evaluations in the dashboard's navy/cyan/Barlow style. Forecast-family views include actual-vs-projected plots, cumulative error, paired baseline bars, TD calibration with Wilson intervals, signed residual distributions, 80% range coverage with width, and an audit trail. The Winners view preserves the existing verified/late/backtest datasets, model controls, accuracy/Brier/log-loss summaries, calibration, weekly records and archived evidence. Research benchmarks are a separate retrospective table, never fabricated game-level live data.

## Evidence and freezing

`python -m src.ml.research_performance` reads `data/tracking/research/*.json`. First-commit time is imported only when the working file's content matches the tracked snapshot. Otherwise the first actual refresh observation is saved. A self-reported generation timestamp alone cannot establish pregame evidence. Model creation, generation, observation, kickoff, schedule identity and training/calibration cutoffs must agree. Git times are repository evidence, not independently certified timestamps.

The first eligible pregame estimate per game, target and player/team is frozen. A later revision cannot replace it or fill a baseline that was not saved with that estimate. Late/incomplete-evidence estimates stay separate. Model versions remain visible and health never pools different weight versions. Schedule kickoff changes make that snapshot unverified, consistent with the existing archive's limitations.

Outcomes use final nflverse schedules and regular-season weekly player stats, joined by season, week, team and player ID. Missing player-stat rows remain **ungraded**, not zero and not confirmed DNP. Duplicate identity rows fail. Passing TD means the QB throws one or more TDs; scoring TD means one or more rushing/receiving TDs, excluding passing and return scores. Ties can grade points/margin/player forecasts but do not enter binary winner records. Corrections regrade original predictions and append revisions; disappearing graded outcomes fail rather than silently erasing results.

`research_evidence.json` preserves first observations; `research_results.json` keeps current grades and revisions. The public `research_performance.json` derives from this evidence and is refreshed by the existing Pages workflow, including results-only runs. No paid odds request or model retraining is added by grading.

## Baselines

Yardage uses the saved last-three-appearance average. New research exports also save the scoring baseline (own recent points averaged with opponent recent points allowed) and smoothed per-appearance TD baseline used by training benchmarks. Old snapshots did not save those latter baselines: their model errors can be graded, but baseline comparisons remain unavailable. Model-versus-baseline summaries use only the same paired outcomes and show that count. Winner health uses a neutral .5 home-win probability reference (Brier .25), not a sportsbook or fitted prior.

## Provisional health policy

Default windows require 100 unique completed games for winners/scoring, 300 recorded appearances for each yardage target, and 500 for each TD target, **per weight version per window**. Whole games are kept together. The two most recent complete windows are disjoint; repeatedly checking the same records cannot create a second window. Missing baselines must not reduce a comparison below its sample gate.

Two windows each at least 10% worse than their paired baseline flag **Review**; one latest window worse than baseline is **Watch**. Below the sample gate is **Sample building**; mixed versions request version selection. New fitted weights restart health accumulation, so weekly research refits may remain sample-limited. This conservative limitation is visible rather than declaring sparse models healthy.

These are configurable code-level, provisional monitoring heuristics—not validated statistical tests or automatic retraining rules. They require historical policy validation before treating alerts as promotion decisions. A flag calls for data/usage/availability/calibration investigation. Frozen forecasts and records do not change, and no model is recalibrated automatically.

## Validation

Tests cover pregame evidence, no timestamp borrowing, training cutoffs, first-forecast selection, missing baselines, correct event definitions, missing/duplicate player rows, pending/cancelled/tied outcomes, corrections, paired denominators, coverage, p=0/1 reliability, per-version gates and non-overlapping windows. Browser verification compares rendered values with the generated source-backed export, exercises all families/sources/versions and legacy controls, and checks responsive dark styling and error fallback.
