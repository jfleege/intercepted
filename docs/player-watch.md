# Players to Watch

The dashboard defaults to a projection + form watchlist. It joins each tracked player's saved yardage projection by season, week, game ID, player ID, team, opponent, position and yardage category. Missing/unavailable/nonfinite projections cannot enter the blended ranking. If the matching export is unavailable, the section explicitly falls back to the existing positive-trend list. The Recent form selector also retains that ordering.

The blend is 50% projected-yardage percentile plus 50% recent-improvement percentile, each within position among eligible tracked players. Ties use midranks, then stable player IDs. Improvement is (last-three average minus season average) / max(season average, position floor). Floors are QB 100, RB 25, WR 20, TE 15 yards to limit tiny-baseline effects. Position normalization avoids letting QB passing-yard volume dominate receiving/rushing yards. A singleton position receives the neutral 50th percentile. This is an editorial watchlist heuristic, not a calibrated probability or evidence that these are the league's best ten players.

Candidate coverage remains the existing player export: the forecast's selected QB and three skill players per team. Rankings can include declining recent form when projected output warrants it. Model estimates are experimental and conditional on appearing. The cards show saved projected yardage and the nominal 80% range alongside season and recent averages. No paid data calls or model retraining are added.

The outer panel no longer clips its header to rounded corners. Horizontal clipping stays in the card carousel. Header controls wrap on small screens.
