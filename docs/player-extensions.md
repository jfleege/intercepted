# Experimental player extensions

Four work areas: conditional learned usage with fresh reported-out eligibility, fixed integer yardage thresholds, constrained cross-game alternatives, and browser-local saved-plan results.

The new classifiers fit through 2023, calibrate in 2024, and compare to a 2024 event-frequency baseline on 2025. Usage regressors compare to the same player's prior-three opportunity mean on 2025. Only development checks beating their baseline are exposed. These gates reuse development results and are not independent prospective confirmation. Estimates remain experimental and conditional on appearance. Separately trained thresholds with a non-monotone curve are withheld. Custom targets do not interpolate probabilities. Original yardage/TD/winner forecasts are not overwritten.

Fresh unique reported-out evidence withholds new player threshold selections and labels zero expected usage. Practice DNP does not imply Out. **Historical pregame starter/injury evidence has not been validated; numeric adjustments for other role changes and injuries are not implemented.** No claim of calibrated participation probabilities is made. Source gaps and older input caches with newer directory appearances withhold affected estimates.

Pins refer to exact selections and must satisfy the profile, search, and included-game filters. Exclusions remove exact selections. Shared-leg limits can yield fewer alternatives. Candidate search remains bounded and heuristic. Player-conditional combinations do not receive joint probability summaries.

Results use public verified final-outcome rows matched by game/player/stat and require the saved plan to precede kickoff. Conflicting results are withheld; missing outcomes remain pending. Records saved after kickoff are unverified. No payout is calculated. Original plan probabilities and quotes are never overwritten. Browser timestamps are client-supplied evidence, not independent timestamp certification.

Status: implementation draft. Full browser validation, broader historical role inputs, independent validation, and source/identity review are still required before release.
