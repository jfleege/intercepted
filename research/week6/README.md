# Three-model comparison: 2026 Week 6

**Recommendation: keep the current production model. None of these candidates exceeds the existing 66.30% historical out-of-sample benchmark.**

The experiment uses nflverse through the existing nflreadpy loaders. No Odds API request or production deployment is included. Candidate settings were selected using earlier seasons only, before grading Week 6. Fixed random seed: 42; decision threshold: 0.5.

| Candidate | Training through Week 5 | Historical 2022–2024 (813 games) | 2025 (271 games) | Week 6 (14 games) | Week 6 Brier |
|---|---:|---:|---:|---:|---:|
| QB retuned | 64.64% | 65.44% | 60.89% | 7/14 (50.00%) | 0.2765 |
| QB + context | 64.08% | 65.56% | 60.15% | 6/14 (42.86%) | 0.2599 |
| Gradient boosted | 66.80% | 63.10% | 61.25% | 8/14 (57.14%) | 0.2645 |

Brier measures probability error; lower is better. A higher training score is not evidence of better forecasts. The boosted candidate wins one additional Week 6 game compared with production weights on the same rebuilt inputs (8/14 versus 7/14), but its historical accuracy is worse.

## Candidates

- **QB retuned:** the existing 18 EPA, success-rate, QB completion, experience and style features; logistic C selected from 0.001, 0.01, 0.03, 0.1, 1. Final C=0.01.
- **QB + context:** those 18 features plus seven rest, short-week, extended-rest, neutral-site and division indicators. Final C=0.001.
- **Gradient boosted:** the same 25 contextual features, 150 boosting iterations, learning rate 0.05, minimum leaf size 30, no random early-stopping split. Temporal tuning selects three leaves and L2=10.

## Evaluation and limitations

Historical evaluation trains on earlier years and predicts the next season. Each evaluation year's settings are selected only from earlier inner-year validation folds. Accuracy is the selection target; Brier breaks ties. The existing archived 66.30% benchmark used Brier-based regularization selection, so this experiment also changes the selection objective. 2025 is reported separately. Final settings use historical folds through 2025, then weights fit 2019–2026 Week 5. Week 6 labels are used only for grading. No candidate is retuned after viewing Week 6.

The fresh reconstruction contains **1,943 training games**, versus 1,930 in the saved production metadata. Therefore training accuracy is not directly comparable to an old fitted-data score. The historical benchmark comparison uses the same 813 game IDs and outcomes. All 14 Week 6 games must be final and represented before evaluation can pass.

Week 6 results are **retrospective reconstructions**, not forecasts that were issued at the time. Historical data may include later upstream corrections. QB selection consistently uses the previous-game primary passer; the game-specific Caleb Williams override is not applied to these candidate features. A prospective test with current starter handling is still needed before promotion.

## Actual archived production forecasts

These are separate from rebuilt-input model tests. Selecting the first timestamped snapshot before each kickoff gives **5/14 (35.71%)**. Selecting the latest available snapshot before each kickoff gives **7/14 (50.00%)**, including pregame revisions. Existing accuracy records remain unchanged. Neither archived statistic should be silently replaced by the retrospective candidate scores.

## Week 6 game-by-game

| Matchup | Actual winner | QB retuned | QB + context | Gradient boosted | Production, rebuilt inputs |
|---|---|---|---|---|---|
| ARI at LA | ARI | LA ✗ | LA ✗ | LA ✗ | LA ✗ |
| BAL at CLE | CLE | BAL ✗ | BAL ✗ | BAL ✗ | BAL ✗ |
| BUF at LV | BUF | BUF ✓ | BUF ✓ | BUF ✓ | BUF ✓ |
| CAR at PHI | CAR | CAR ✓ | CAR ✓ | CAR ✓ | CAR ✓ |
| CHI at ATL | CHI | ATL ✗ | ATL ✗ | CHI ✓ | ATL ✗ |
| DAL at GB | GB | GB ✓ | GB ✓ | DAL ✗ | GB ✓ |
| HOU at JAX | HOU | JAX ✗ | JAX ✗ | JAX ✗ | JAX ✗ |
| LAC at KC | KC | KC ✓ | KC ✓ | KC ✓ | KC ✓ |
| NO at NYG | NO | NYG ✗ | NYG ✗ | NYG ✗ | NYG ✗ |
| NYJ at NE | NE | NE ✓ | NE ✓ | NE ✓ | NE ✓ |
| PIT at TB | PIT | PIT ✓ | TB ✗ | PIT ✓ | PIT ✓ |
| SEA at DEN | DEN | SEA ✗ | SEA ✗ | DEN ✓ | SEA ✗ |
| TEN at IND | TEN | IND ✗ | IND ✗ | IND ✗ | IND ✗ |
| WAS at SF | SF | SF ✓ | SF ✓ | SF ✓ | SF ✓ |

## Reproduction

The branch-only **Week 6 model research** Actions workflow rebuilds the input tables, evaluates the three fixed candidate families, and uploads `week6-model-research`. The artifact contains candidate weights, feature matrix and hash, tuning scores, comparison JSON, and a Markdown summary. It grants read-only repository access and has no deployment or recurring schedule.

Verified run (including coverage gates): https://github.com/jfleege/intercepted/actions/runs/39460860204

Feature matrix SHA-256: `686d44c98f39c88dafb7c83bffbdd928c9b69c13ff3091affba552fbd7616095`.

No merge or production replacement is recommended on this evidence. Keep these candidates for research and measure the strongest candidate prospectively across additional weeks.
