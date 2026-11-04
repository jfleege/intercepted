# Availability and winner forecasts

The refresh pipeline reads nflverse injury/depth data and supplements missing or older injury evidence with ESPN's current injury feed. ESPN rows require the current regular season, a report and feed timestamp within 48 hours, and a unique normalized name/team/position identity. This is a supplementary news designation, not necessarily the official game designation. A fresh download does not make old reports fresh. Missing evidence never means healthy. Out/IR blocks current recommendations; questionable and concussion reports do not imply absence.

Availability is refreshed before same-week forecast revision checks. Changed actionable injury evidence rebuilds only future affected games and preserves prior forecast archives. Explicit sourced QB starter reports continue to select the main forecast's actual QB features. Injury-only changes do not apply an arbitrary team probability penalty.

If the displayed QB has an actionable injury report, one uniquely identified fresh second-unit QB can be evaluated as a conditional scenario. The scenario substitutes that QB's pre-target-week passing history into the same frozen model pipeline. Team, opponent, and other features remain fixed. Missing history produces an unavailable scenario. No probability of playing, combined scenario, or weighted injury-adjusted probability is invented. The Base model may give the same answer because it has no QB features.

Matchup focus, matchup reports, and the matchup modal show the injury assumptions and available scenarios. Non-QB injuries are displayed but do not yet have a separately validated effect on team win probability or redistribute teammates' yardage/TD projections. Historical injury feature evaluation is needed before adding that behavior.

The normal morning refresh and two extra daytime checks (17:17 and 21:17 UTC) update this evidence. Source outages keep published assumptions rather than generating a clearance revision. Results-only jobs skip the additional data fetch. Model weights and scoring rules are unchanged.
