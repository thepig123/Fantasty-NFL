# Fantasy NFL Copilot

A React + TypeScript decision dashboard for a Sleeper NFL fantasy league, built for someone who wants competitive decisions without needing to closely follow the NFL.

## What V1 does

### Sleeper connection
- Enter a Sleeper username and automatically discover 2026 NFL leagues.
- Read league scoring, roster construction, rosters, drafts, picks, matchups, transactions, NFL state, injuries and trending adds/drops.
- No Sleeper API key required.
- Cache the large Sleeper player directory server-side.

### Decision dashboard
- One action queue instead of a wall of stats.
- Injury alerts.
- Weekly projected team total when projection data is available.
- Opponent projection comparison.
- Start/sit upgrade alerts.
- Draft and waiver opportunities.
- Manual refresh and visible sync status.

### Draft assistant
- Works before the real draft with an interactive practice draft.
- Make mock picks for yourself.
- Simulate picks by the other managers.
- Undo/reset the practice board.
- Recalculate roster need after every pick.
- During a live Sleeper draft, already-drafted players are excluded automatically.
- Scores combine projection value when available, roster need, positional scarcity, availability pressure and health.

### Lineup assistant
- Reads your real Sleeper starters and bench.
- Uses weekly projections when available.
- Suggests legal starter/bench swaps by roster slot.
- Shows expected point improvement and a simple confidence label.
- Highlights injury designations.

### Waiver assistant
- Filters Sleeper trending adds to players actually available in your league.
- Combines trend strength, position value, health and weekly projection when available.
- Suggests a possible same-position bench drop candidate.
- Shows players trending down across Sleeper.

### Player explorer
- Search active QB/RB/WR/TE players.
- See league availability, injuries, weekly projection and season projection.
- Open a plain-English player detail drawer.

### League page
- League scoring rules and roster slots.
- Current-week matchups and projected totals.
- Current-week Sleeper transactions.

### NFL 101
- Tiny glossary for the fantasy concepts that actually matter: QB/RB/WR/TE, FLEX, bye weeks, waivers, injury labels and projections.

## Data sources

Sleeper is the source of truth for league state. The app also attempts to use Sleeper's projection feed for weekly and season projection context. Projection availability can vary, so the UI deliberately falls back to transparent roster/position heuristics rather than inventing projected numbers.

A future upgrade can plug a consensus provider such as FantasyPros into the existing intelligence layer without rewriting the UI or league integration.

## Important limitation

Sleeper's public API is read-only. Fantasy Copilot can recommend a draft pick, lineup swap or waiver move, but you still perform the actual action inside Sleeper.

No projection model can remove the large luck component in fantasy football. Treat very small projection differences as close calls.

## Run locally

```bash
git clone https://github.com/thepig123/Fantasty-NFL.git
cd Fantasty-NFL
npm install
npm run dev
```

Open `http://localhost:3000` and enter your Sleeper username.

## Architecture

```text
Sleeper API
  ├─ user / league / scoring
  ├─ roster / ownership
  ├─ draft / picks
  ├─ matchup / transactions
  └─ injuries / trending
           ↓
Projection intelligence adapter
           ↓
Recommendation engine
  ├─ draft
  ├─ lineup
  └─ waivers
           ↓
React decision dashboard
```

## Validation

GitHub Actions runs TypeScript checking and a production Next.js build on pushes to `main`.
