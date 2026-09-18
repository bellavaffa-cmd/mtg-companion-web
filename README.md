# MTG Companion — Web

A browser-based companion to the MTG Companion Android app: browse and edit your **collection** and
**decks** from a PC, synced through the same **MTG Companion account** the phone app uses.

Live at https://bellavaffa-cmd.github.io/mtg-companion-web/

## What's here

- **Collection**: binders (Owned/Wishlist), add/remove cards, quantity + foil quantity.
- **Decks**: create/delete, add/remove cards, quantities, commander + partner commander, game
  mode, tags.
- **Search**: live Scryfall search, add results straight into any deck or binder.
- **Precons** (Decks -> Precons): official Commander decklists from MTGJSON; pick one to copy it in
  as a new deck.
- **Suggestions** (deck page): what other people play with your commander, from EDHREC — tap one to
  add it. Cards the deck already has are filtered out.
- **Legality** (deck stats): the deck checked against its format — size, commander, banned and
  restricted cards, copy limits and colour identity.
- **Combos**: which combos a deck contains or is one card short of (deck stats), and the combos a
  card is part of (its zoom view), from Commander Spellbook.
- **Life counter** (`/life`): the phone app's table — seatings for 1–10 players, tiles that face
  each seat and turn with the device, turn tracker, timer, commander damage, poison, dice, the
  monarch and the initiative, day and night, Planechase, and a history of the game.
- **News** (Home): headlines from MTG Arena Zone and Star City Games.
- **Account & sync** (Home): sign in, create an account, forgot/change password. Decks and binders
  sync with the Android app.

Not yet ported from the phone app: scanning, card-art recognition,
search filters beyond raw Scryfall syntax, and the rules reference.

Commander Spellbook and the news feeds don't allow browser requests, so those go through the
`api-relay` Supabase function (source in `MtgCompanionApp/supabase/functions/api-relay`). Scryfall
and EDHREC are called directly.

## How sync works

- Everything is saved in the browser's local storage right away, so the app works signed out and
  offline.
- Signed in, each deck and binder is its own row in Supabase (`public.library_items`, see
  `MtgCompanionApp/supabase/migrations/`). Edits to different decks on the phone and here never
  overwrite each other. If the same deck is edited in both places, the two sets of edits are merged
  card by card: additions from both sides are kept, a removal on either side sticks, and counts that
  both sides changed add up. Only a field both sides changed differently (a deck's name, say) falls
  back to the more recent edit.
- Sync runs on load, 2 seconds after an edit, when you come back to the tab, every 20 seconds while
  the tab is open, and whenever you pull down at the top of a page on a touch screen. The logic lives in
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
