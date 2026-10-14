# Daily data refresh on GitHub Pages

1. Merge this change into main.
2. In Settings > Pages, set the build source to GitHub Actions.
3. In Settings > Secrets and variables > Actions, add ODDS_API_KEY as a repository secret.
4. In Actions, choose Refresh data and deploy Pages and run it on main.
   Leave refresh_odds unchecked for a player-only refresh, or check it to fetch odds.

The scheduled job runs daily at 13:17 UTC (8:17am Chicago daylight time,
7:17am standard time). GitHub may delay scheduled jobs.
It refreshes player cards, fetches odds once, builds the frontend, and deploys.
The key is available only to the odds step and is never included in the site.

The current request uses DraftKings and three markets. Normal usage is
3 credits per run, or up to 93 credits in a 31-day month, excluding manual
runs and other use of the key. Confirm this against your account allowance.
If the secret is missing, the job warns and uses the committed odds snapshot.
If a fetch or build fails, the deployment does not run and the previous site remains.

Player cards automatically use today's Chicago date but exclude the prediction
slate's target week and later. Odds read the same frontend/public/predictions.json
slate, rather than a hardcoded Week 6 CSV.

This refresh does not retrain models, change projected starters, advance the
prediction week, or generate new win probabilities. Commit the new
predictions.json when you advance the forecast slate.

Generated player and odds JSON are included in the deployed artifact; they are
not committed back to the repository. Local JSON files therefore do not update
from this job. Manual runs rebuild from main and fetch players; odds are only
fetched when checked. There is no push trigger consuming extra API credits.

Before enabling, push your latest local frontend changes so the deployed site
matches the design you intend to publish. Public repositories with no activity
for 60 days may have scheduled workflows disabled by GitHub.

