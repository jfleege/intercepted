# Glass interface styling

The existing dashboard grid, animated playbook hero, card order, responsive breakpoints, data, and controls are retained. This pass changes materials and loading presentation, rather than replacing the dashboard with the conceptual preview.

`frontend/src/GlassTheme.css` supplies shared navy surface, border, inset-control, and shadow tokens. Those materials carry through Dashboard, Matchups, Players, Performance, Markets, and the matchup modal. No generated preview image or illustrative statistics are used by the application.

High-opacity data cards preserve readability without per-card backdrop filters. Navigation and the modal veil use blur when supported, with solid-color fallbacks. Reduced-transparency preferences remove those filters. Existing focus rings, invalid input states, touch targets, selection semantics, modal focus management, and reduced-motion support remain available.

The matchup placeholder now follows the slate/focus structure. Generic and player-directory loading retain their layouts and gain one subtle shimmer per loading region, disabled for reduced motion. Loaded matchups fade in briefly without replaying chart entrances or changing the hero animation timeline. There are no artificial delays, new requests, dependencies, or projection changes.

Validation: lint, frontend unit tests, production build, existing playbook/matchup/players/performance/markets/regression browser flows, and screenshots at 375/650/900/1440px. Browser validation runs in the branch's read-only GitHub Actions workflow; it does not refresh forecasts, access paid odds endpoints, or deploy.
