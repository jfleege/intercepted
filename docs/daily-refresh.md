# Scheduled data refresh on GitHub Pages

The **Refresh data and deploy Pages** workflow on `main` uses three schedules:

| Run | Schedule | Purpose |
| --- | --- | --- |
| Morning refresh | Daily, 13:17 UTC (8:17 a.m. CDT / 7:17 a.m. CST) | Check the next slate; refresh players, projections, results, rankings, and the existing budgeted odds feed. |
| Overnight refresh | Daily, 07:47 UTC | Refresh final results and other existing data exports; no scheduled odds or prop request. |
| Weekly archive and refresh | Tuesday, noon `America/Chicago` | Commit the published forecast archive and final results first, then check the next slate and refresh all site data. |

Tuesday uses `cron: "0 12 * * 2"` with `timezone: "America/Chicago"`. Noon therefore remains noon Central through daylight saving changes. GitHub may queue scheduled jobs later than their nominal start. Schedules become active only after the workflow is merged onto the default branch.

The noon run is an **additional checkpoint**, not a replacement for the morning refresh. If the morning run already advanced the week, noon retains the published forecasts and updates the supporting data. If prior games are unfinished or required statistics have not arrived, the existing slate stays published and the status strip explains the wait. The next morning retries. The schedule does not force an arbitrary week increment or invent missing inputs.

## Archives and publication

Before the Tuesday check (and a manual `refresh_forecasts` run), the workflow uses the existing importer to preserve original forecast evidence, ingest final results, and export browsable saved weeks. It commits and pushes that checkpoint **before** trying to advance. If this archive step fails, advancement is blocked. Repeated checks retain immutable archive identities and original timestamps.

After the weekly check, the normal pipeline archives the active forecasts, grades results, exports prediction history, player cards, player directory/history, matchup projections, period trends, team rankings, research results, and market/paper records. Its existing commit/build/deploy steps persist the generated exports and archives. Prior committed versions of all tracked exports remain in Git history; this change does not duplicate large player/odds JSON files into a second storage system. Optional source failures remain visible as incomplete refreshes. A failed build or deployment leaves the last deployed site visible, while the pre-rollover archive checkpoint remains committed.

## Quota and manual use

Tuesday noon makes **no additional Odds API requests**. The existing morning odds request and Thursday-through-Monday guarded prop cache are unchanged. Tuesday does not bypass the prop cache, weekly/monthly credit caps, or the account reserve. `ODDS_API_KEY` remains a GitHub Actions secret and is not included in frontend code.

To run the same archive/check sequence manually: **Actions → Refresh data and deploy Pages → Run workflow** on `main`, enable **refresh_forecasts**, and leave **refresh_odds** / **refresh_props** unchecked. The separate **results_only** input refreshes archived records without requesting a new forecast slate. No workflow run places real wagers.

Game winner forecasts use saved model weights with fresh eligible inputs; a weekly check is not an automatic retraining of those weights. The existing experimental projection pipeline keeps its own versioning and archive rules.
