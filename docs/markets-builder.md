# Projection Markets builder

The Markets route reads the current `predictions.json`, matching season/week `research/*.json`, `odds.json`, and the existing normalized moneyline `markets.json`. It makes no sportsbook requests. Only available, team/opponent-matched tracked player forecasts appear; these are not complete active rosters.

Game tabs scope the same cards to one matchup. All Teams combines the slate. Profile filters apply to saved binary winner/TD probabilities: higher ≥65%, near even 45–55%, longer <45%; the 55–65% middle remains in All profiles. Projection guides have no target hit probability. Winner-model agreement describes direction across saved models, not independent evidence or a confidence interval.

Yardage targets start at a rounded-down projection guide. Scoring cards use a saved spread/total line if available, otherwise a rounded guide. Neither means nor nominal outcome ranges are converted into target hit rates. Editing a target clears its price and probability. The existing daily odds exporter retains spread/total prices and market timestamps already included in its current three-market response; older snapshots simply show missing prices.

Research combinations select 2–4 known-probability legs from distinct upcoming games. These are probability-ranked research ideas, not positive-EV recommendations. TD probabilities are conditional on appearing. No independence assumption, joint probability, marginal-odds multiplication, or same-game parlay pricing is used.

A slip can combine any displayed markets, replacing alternate selections on the same contract. Manual combined American quotes are explicitly unverified and cleared on selection changes. Return is stake times the entered quote's decimal payout; profit subtracts the stake. Quotes must be re-entered when loading a saved snapshot. Historical drafts can be saved as research, never retrospectively verified or graded as results.

Drafts live in `intercepted.projection-slips.v1`, separate from the prior `intercepted.moneyline-paper.v1` ledger. Save/load/export preserves frozen forecast and quote evidence. Unreadable storage is preserved and saving is disabled. The old moneyline research and paper ledger remain under the archive disclosure.

Run `npm test`, `npm run lint`, and `npm run build` in `frontend`. `tests/markets-builder.browser.mjs` covers 375/650/900/1440px browser flows against committed source-backed data; its fixed pregame clock is solely a test fixture. CI also runs the existing unified dashboard browser suite. Live prop/combined quotes and calibrated exceedance/joint probabilities require additional data/model work.
