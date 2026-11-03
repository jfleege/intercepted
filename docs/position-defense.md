# Team player columns and defensive allowances

The shared matchup research view groups player projections into away (left) and home (right) columns, one player per row within each team. Position order is QB, RB, WR, TE; larger projected yardage sorts first within a position. Phones stack the team columns. Existing projections, ranges, and TD probabilities are unchanged.

Each player card includes opponent allowances to that player's position: QB passing/rushing yards and passing/rushing TDs; RB rushing/receiving yards; WR/TE receiving/rushing yards. These are totals across **all** opposing players at the position per defensive team-game, including overtime. They are not individual-player averages, net passing-yard totals, individual target probabilities, or opponent-adjusted causal effects.

Last-three/last-five windows select the defense's completed games, not player appearances. Season uses completed current-season regular-season games strictly before the selected slate week. Missing/ambiguous position rows are unknown, never imputed to zero. Every metric shows usable games versus games in the selected window. Partial averages use only usable games and disclose the denominator. Position-level source gaps are not treated as team-level yardage.

The exporter uses complete league weekly box scores and schedules, not the limited Players to Watch list. Week-specific exports prevent later-week data from entering archived matchups. Unsupported or missing historical exports display unavailable. The normal full refresh updates this descriptive feed; postgame results-only checks do not modify pregame context or model forecasts. No sportsbook requests are added.
