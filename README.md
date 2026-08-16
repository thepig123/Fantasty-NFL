# Fantasy NFL Copilot

A React + TypeScript decision dashboard for Sleeper fantasy football, designed for someone who wants good decisions without needing to follow the NFL closely.

## Current first draft

- Sleeper username lookup
- 2026 league discovery and league selection
- Reads real roster slots and scoring settings
- Reads your real Sleeper roster
- Reads draft metadata and completed picks
- Automatically removes drafted players from draft recommendations
- Dashboard with action-oriented summaries
- Draft assistant with a transparent heuristic score
- Team view with starters, bench, and injury flags
- Waiver radar using players available in your actual league + Sleeper trending adds
- Searchable player explorer
- Cached Sleeper NFL player directory
- Responsive UI for laptop and phone

## Important limitation

Sleeper provides the league state, players, rosters, drafts, picks, and trending transactions, but it does **not** provide a high-quality consensus 2026 projection/ADP feed through the public API.

The current draft and waiver scores are therefore intentionally labeled as heuristics. The next major step is to plug in a reliable 2026 projections/rankings/ADP provider and make those models the main source of player quality while Sleeper remains the source of truth for your league.

## Run locally

```bash
git clone https://github.com/thepig123/Fantasty-NFL.git
cd Fantasty-NFL
npm install
npm run dev
```

Then open `http://localhost:3000` and enter your Sleeper username.

No Sleeper API key is required.

## Architecture

```text
Sleeper API
  ├─ user / leagues / scoring
  ├─ rosters / ownership
  ├─ drafts / picks
  └─ trending adds
          ↓
    normalized app state
          ↓
 recommendation engine
          ↓
 Dashboard / Draft / Team / Waivers / Players
```

## Next steps

1. Add real 2026 ADP and consensus rankings.
2. Add season and weekly projections.
3. Match your draft slot and calculate distance until your next pick.
4. Improve positional scarcity using actual remaining tiers.
5. Add weekly start/sit optimization once Week 1 approaches.
6. Add matchup and injury/news context.
7. Add rest-of-season and drop-candidate scores for waivers.
8. Persist selected Sleeper account/league locally.
