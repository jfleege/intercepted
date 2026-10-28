# QB tracking coverage and low-volume games

NGS weekly passing data is a qualified leaderboard, not a complete ledger of every QB appearance. The data loader documents a minimum-volume requirement: https://nflreadr.nflverse.com/reference/load_nextgen_stats.html . The original weekly scraper documents the 15-attempt display minimum: https://github.com/Deryck97/nfl_nextgenstats_data . The exception here uses a conservative cutoff of fewer than 15 attempts per passer; it does not exempt missing qualifying-volume performances.

The observed case is Tampa Bay, 2026 Week 7. The schedule identifies Baker Mayfield, and the player and team box scores both show 11 attempts. NGS has no TB Week 7 row. Its last TB rows belong to Jalon Daniels in Week 6, so selecting a QB solely from that feed can retain the wrong proxy. Waiting for an NGS row for every completed team-week can block rollover indefinitely for a non-qualifying game.

## Publication rules

Full prior-game coverage in the existing PBP team and expanded aggregates is still required. Missing NGS team-weeks remain blocking by default. A low-volume exclusion requires:

- An exact, completed regular-season schedule game before the forecast target week.
- Matching player and team box-score records for the same season, week, game ID and normalized team.
- Valid nonnegative integer attempts, unique passer IDs, and player attempts reconciling exactly to the team total.
- Every passer below 15 attempts, a unique primary QB, and agreement between that QB's ID and the completed schedule's QB ID.
- Existing pre-target NGS history for that exact player. The generator also requires the resulting saved-feature snapshot to be finite.

Partial box scores, qualifying-volume missing rows, missing/ambiguous identities, zero-attempt games, missing history, or incomplete PBP still block publication with a team/week-specific reason. Ordinary box-score metrics are **not** converted into invented CPOE, time-to-throw, air-yard, or aggressiveness observations. Existing saved feature definitions and model weights are unchanged.

For an exclusion newer than a team's latest NGS row, the QB picker uses the reconciled completed game's primary passer and that player's own existing NGS history. Reviewed game-specific starter reports retain precedence. The fallback remains an **unconfirmed next-game proxy**, not a claim that the QB is confirmed to start. A newer usable NGS observation takes precedence on later forecasts. Historical low-volume exclusions remain auditable without blocking subsequent weeks again.

## Evidence and history

The selection stores the completed game ID, player ID, attempts, reconciliation reason, and actual NGS history cutoff in `qb_selection.ngs_exclusion`. This evidence is retained by the existing immutable forecast archive and saved-week exporter. Dashboard focus, Matchups, and the matchup dialog show the limitation; the status strip marks the active slate as using limited QB tracking. Routine no-op checks retain that limitation rather than silently relabeling the same forecast fully current.

Completed Week 7 predictions are not rewritten with postgame starter knowledge. A subsequent Week 8 forecast uses Mayfield's identity/features; original archived picks keep their original identity and probabilities. Changing a QB is not a cosmetic display-name replacement.

`python -m scripts.validate_qb_coverage_source` is a read-only current-source check of the TB Week 7 case. It compares the feeds, resolves the Week 8 TB QB, and verifies his NGS feature values are finite. Its report is validation evidence, not a published forecast. It makes no Odds API calls. New source-dependent checks live in the branch QA workflow; normal refresh tests remain offline.
