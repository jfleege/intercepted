# Expanded offensive player coverage

The player-card export now contains a full `away_catalog` / `home_catalog` independently of its small Dashboard `away_players` / `home_players` shortlists. Each catalog includes every observed RB, WR, and TE on that team's latest unambiguous prior-week statistical record plus the exact projected QB used by the winner forecast. It has no three-skill-player cap. Backup QBs remain in the history directory where observed; they are not substituted for the projected starter in new markets.

Yardage/TD research and experimental usage/threshold exports consume the catalog. Existing saved slates without catalog fields fall back to their original shortlists. Player-history minimums, pregame timestamps, availability exclusions, validation gates, and archival behavior remain in force. New players do not receive retrospective forecasts for games that have started. Broader forecast coverage begins at the next eligible pregame refresh after this change is deployed.

The initial real-source export contains 433 candidates across the 28 teams on the loaded Week 8 slate (12–19 per team). This is a catalog count, not a count of published forecasts or confirmed active players. Latest statistical team is not an active roster; a player can be injured, inactive, or no longer participating. A player with insufficient history retains available statistics but no numeric forecast. Bye teams do not receive made-up matchups.

Players exposes forecast-coverage filters and explicitly labels history-only entries. Matchup outlooks show coverage counts and position filters, initially showing eight players per team with an option to expand the entire pool. Markets consumes every available forecast, retaining existing filters and progressive loading. Dashboard watch rankings remain curated.

Browser fixtures exercise 12 players per team, including additional RBs/WRs/TEs and insufficient-history entries. Fixture forecasts are solely UI test data and are never published as live projections.
