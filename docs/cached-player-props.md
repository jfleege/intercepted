# Cached DraftKings player props

`python -m src.ml.refresh_props` uses the existing server-side `ODDS_API_KEY`. The browser reads saved `player_props.json`; it never calls a sportsbook or receives a key. The four requested markets are passing yards, rushing yards, receiving yards, and anytime rushing/receiving TD. Passing TD odds, alternate ladders, and combined parlay quotes are outside this fetch.

The daily morning workflow starts checking on Thursday in America/Chicago, with catch-up through Monday. Each game is requested at most once per season/week, even if its response is empty or fails. Later checks can discover games that were previously missing, without refetching cached games. No prop calls happen on push deploys or results-only runs. Manual `refresh_props` allows an initial Tuesday/Wednesday fetch but never bypasses cache or limits.

Budget guards:

- Reserve four credits before each request, up to 64 per NFL slate and 320 per Central calendar month. Reservations remain consumed on failed or empty responses; actual reported charges may be lower.
- Read the account's real remaining balance using the documented zero-credit `/sports` endpoint. Event discovery is also zero-credit.
- Before each charged request, require enough remaining account credits to preserve a 100-credit reserve. This covers up to 31 existing daily three-credit calls with a small margin. Missing balance stops the batch. Unverified or unexpectedly large response charges pause future prop requests until the ledger has been reviewed; the app never automatically clears that pause.
- No request retries. Persist reservations before requests, then commit the ledger/cache before the frontend build. The existing workflow concurrency group serializes refresh jobs. A runner termination before its checkpoint commit can lose local reservations; the next run still checks the provider's account-wide balance, but no local ledger can guarantee exactly-once delivery across that failure window. Other consumers of the same API key also affect the balance.

The 320-credit cap is by calendar month, **not** an assumed subscription renewal date. The provider's remaining count is authoritative for its current quota period. `odds_usage.json` stores only timestamp, remaining/used credits, last cost, and request kind. Daily game-odds requests also update this file. No key, URL, account identity, or response body is logged to public data.

Provider events must match home/away teams and the exact trusted research kickoff. Markets must come from DraftKings. Player matching uses exact normalized names within the same game and rejects ambiguous names; there is no fuzzy matching. An unmatched/missing market stays a projection guide. Stored prices retain event ID, outcome identity, market update time, and observation time when added to a draft.

Both available yardage sides use the exact book line, while retaining the model mean/range. The app does not derive a model hit probability from the book price or projected mean. An anytime-TD Yes quote attaches only to the rushing/receiving TD probability; it never prices the passing-TD event. Editing a target clears its quote and provenance. Prices older than 24 hours, future timestamps, and post-kickoff quotes are explicitly stale/unverified. A weekly cache is not a live feed.

The initial committed prop file is empty. The first eligible morning run after merge populates source-backed quotes, subject to provider coverage, schedule matches and available credits. Combined parlay pricing remains manual; standalone prices and marginal probabilities are never multiplied.

Validation: Python budget/cache/provider tests, TypeScript price-binding tests, and browser-only synthetic provider contracts at 375/650/900/1440px. Synthetic prices are never written to production public JSON. The existing Markets and unified dashboard browser suites remain in CI.
