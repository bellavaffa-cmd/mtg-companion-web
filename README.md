# MTG Companion — Web

A browser-based companion to the MTG Companion Android app: browse and edit your **collection** and
**decks** from a PC, synced through the same **MTG Companion account** the phone app uses.

Live at https://bellavaffa-cmd.github.io/mtg-companion-web/

## What's here

- **Collection**: binders (Owned/Wishlist), add/remove cards, quantity + foil quantity.
- **Decks**: create/delete, add/remove cards, quantities, commander + partner commander, game
  mode, tags.
- **Search**: live Scryfall search, add results straight into any deck or binder.
- **Account & sync** (Home): sign in, create an account, forgot/change password. Decks and binders
  sync with the Android app.

Not yet ported from the phone app: precons, EDHREC suggestions, deck legality, scanning, the Life
Counter, search filters beyond raw Scryfall syntax, and Rules/news.

## How sync works

- Everything is saved in the browser's local storage right away, so the app works signed out and
  offline.
- Signed in, each deck and binder is its own row in Supabase (`public.library_items`, see
  `MtgCompanionApp/supabase/migrations/`). Edits to different decks on the phone and here never
  overwrite each other; if the same deck is edited in both places, the most recent edit wins.
- Sync runs on load, 2 seconds after an edit, and when you come back to the tab. The logic lives in
  `src/sync/cloudSync.ts` and mirrors the Android app's `SupabaseSync.kt`.
- The first time an account signs in to a browser that already has decks or binders, the app asks
  whether to **add** them to the account or **use the account's library only**.
- Account emails (confirm sign-up, password reset) link back to this site and sign you in.

Google Drive sync was retired in favour of accounts.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with the Supabase project URL and **anon** key (Supabase dashboard → Project
Settings → API). The anon key is public by design — row-level security keeps each account's rows
private. Never use the `service_role` key here.

```bash
npm run dev
```

## Deploying

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`). The build
reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the repository's Actions secrets.
