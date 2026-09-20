# Manabind — Web

A browser-based companion to the Manabind Android app: browse and edit your **collection** and
**decks** from a PC, synced through the same **Manabind account** the phone app uses.

Live at https://bellavaffa-cmd.github.io/mtg-companion-web/

## What's here

- **Collection**: binders (Owned/Wishlist), add/remove cards, quantity + foil quantity.
- **Decks**: create/delete, add/remove cards, quantities, commander + partner commander, game
  mode, tags.
- **Scan** (`/scan`, or Search → Scan): hold a card up to the camera and its name is read and looked
  up; scanned cards collect in a list (adjust counts, remove mistakes) that goes into a deck or binder
  in one go. Names are read with Tesseract (`tesseract.js`, in a Web Worker; its engine and English
  data, about 4.5 MB, download from jsDelivr the first time) and matched against Scryfall's list of
  every card name, so a misread letter still finds the card. A name can also be typed. `src/scan/`.
- **Search**: live Scryfall search with the phone app's filters (type, rules text, colours, commander
  colours, rarity, finish, price, power, toughness, sets, artist) and sort; add results straight into
  any deck or binder.
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
- **Rules** (`/rules`): a keyword glossary that works offline (the same one as the phone app), and
  the official rulings for any card from Scryfall.
- **News** (Home): headlines from MTG Arena Zone and Star City Games.
- **Install it** like an app: the browser's install option (Chrome/Edge: the install icon in the
  address bar; Android: menu → Add to home screen / Install app; iPhone: Share → Add to Home Screen)
  gives it a home-screen icon and its own window. It opens without a connection too, with the decks
  already in the browser (pwa/sw.template.js; card search, images and sync need the network).
- **Account & sync** (Home): sign in, create an account, forgot/change password. Decks and binders
  sync with the Android app.

Not yet ported from the phone app: recognising a card by its art (the phone's fallback when a name can't be read).

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
- Sync runs on load, a second after an edit, when you leave or come back to the tab, from the sync
  button, and whenever you pull down at the top of a page on a touch screen. While a tab is open and
  visible it also gets **live updates** (Supabase Realtime, `src/sync/realtime.ts`): another device's
  save syncs here within a second. A check every 15 seconds (every 60 while live updates are
  connected) is the backup. The logic lives in `src/sync/cloudSync.ts` and makes the same decisions as
  the Android app's `SyncCore.kt`; `npm test` runs both through the same scenarios.
- Signing out — or being signed out, when the server ends the session — removes the account's decks
  and binders from this browser; they come back on signing in. The Sign out button syncs first and
  warns about anything that couldn't be sent. If the server ends a session with edits not yet
  synced, those few items are kept out of sight and merged back in when the same account signs in
  again (any other account, or 7 days, and they're dropped).
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

## Tests

```bash
npm test
```

`tests/sync/` runs the real sync code (`src/sync/cloudSync.ts`) through two or three simulated devices
and a fake Supabase: edits on both sides, failed and half-answered pushes, clocks that are off, two
syncs racing on the same deck. Every scenario runs twice — against the old push function and against
the compare-and-swap one — and checks what each device and the server end up with. Uses Node's own
test runner (Node 22.15+), no extra packages.

## Deploying

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`). The build
reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the repository's Actions secrets.
