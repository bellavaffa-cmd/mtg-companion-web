# Manabind — web app (manabind.com)

React + TypeScript + Vite, deployed to GitHub Pages. The Android app is the sister repo
`bellavaffa-cmd/mtg-companion-app`. The two mirror each other — scanner logic, life-counter remote
protocol (`src/lifecounter/remote.ts`), search filter wording — so a change to one usually needs
the same change in the other.

## Working rules (from the owner)

- **A push to `main` is live.** `.github/workflows/deploy.yml` tests, builds and deploys to
  manabind.com within minutes, and there is no staging site. Ask before pushing changes the owner
  hasn't seen; commit and push only when asked ("push web").
- Android changes go to the Manabind Tester app first — see the Android repo's `CLAUDE.md`. When a
  change is made in both apps, the web half waits for the owner's go-ahead too.
- Never commit `.env` (gitignored) or print its contents.

## Build and test

- Node 24. `npm ci`, then:
- `npm test` — the sync scenarios and other unit tests; a failure stops the deploy.
- `npm run build` — type-check and production build.
- `npm run lint` — oxlint.
- `npm run dev` — local dev server. Sign-in and sync need `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` in `.env` (see `.env.example`); in CI they come from repository secrets.

## Layout

- `src/pages/`, `src/components/` — screens and shared UI.
- `src/search/`, `src/scan/`, `src/lifecounter/`, `src/tags/`, `src/money/` — feature logic.
- `tests/` — unit tests, run directly from the TypeScript sources.
- `tools/card-index/` — builds the scanner's card index (run by the Android repo's workflow).
