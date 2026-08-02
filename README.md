# MTG Companion — Web

A browser-based companion to the MTG Companion Android app: browse/edit your **collection** and
**decks** from a PC, syncing to the exact same Google Drive backup file the phone app uses
(`MTG Companion/mtg-companion-backup.json`).

## What's here

- **Collection**: binders (Owned/Wishlist), add/remove cards, quantity + foil quantity.
- **Decks**: create/delete, add/remove cards, quantities, commander + partner commander, game
  mode, tags.
- **Search**: live Scryfall search, add results straight into any deck or binder.
- **Sync**: connects to your Google account, reads/writes the same backup file as the phone app.
  Last-write-wins by edit time, same as the Android app's Drive sync.

Not yet ported from the phone app: precons, EDHREC suggestions, deck stats/legality/mana-curve,
scanning, the Life Counter, search filters beyond raw Scryfall syntax, and Rules/news. The
foundation (data model, sync, routing) is in place to add these incrementally.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Google OAuth Client ID (one-time, you do this yourself)

This app needs its own OAuth client so your browser can ask Google for permission to read/write
your Drive backup file. I can't create this for you — it requires signing in to your own Google
account in the Cloud Console. Steps:

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and either use the same
   project the Android app's Drive sync already uses, or create a new one.
2. **APIs & Services → Library** — make sure "Google Drive API" is enabled (it already is if the
   phone app's sync works).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Application type: **Web application**.
5. Under **Authorized JavaScript origins**, add the URL(s) you'll run this from, e.g.:
   - `http://localhost:5174` (for local dev — matches this project's dev server port)
   - your real domain later, if you deploy it somewhere (e.g. `https://mtg.yourdomain.com`)
6. Leave "Authorized redirect URIs" empty — this app uses Google's implicit token flow (no
   redirect needed).
7. Click **Create**. Copy the **Client ID** (looks like `123-abc.apps.googleusercontent.com`).
   This value is not a secret — it's fine to have it embedded in this browser app's code.

### 3. Configure the app

```bash
cp .env.example .env
```

Edit `.env` and paste your client ID:

```
VITE_GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com
```

### 4. Run it

```bash
npm run dev
```

Open the printed local URL. Click **Connect Google Drive** on the Home page and sign in with the
**same Google account** your phone app is connected to.

The first time you sign in, Google will show an "unverified app" warning (since this is a personal
app you haven't submitted for Google's verification review) — click through it
("Advanced" → "Go to [app name] (unsafe)"). This is expected for a self-hosted personal tool and
is safe since it's your own OAuth client.

## How sync works

- Decks/collections edited here are saved to your browser's local storage immediately, and pushed
  to the same Drive file the phone app uses ~1.5s after you stop editing (if connected).
- On "Sync now" (or connecting), it compares the local edit time against the Drive file's and
  applies whichever is newer — same last-write-wins rule as the phone app.
- This web app requests the broader `drive` OAuth scope (not the phone app's narrower
  `drive.file`), because a browser OAuth client is a different "app" from the Android one for
  Google's per-file access rules — the broad scope is what lets it find the phone-created file by
  name. It's still limited to your own Google account's Drive, and only after you explicitly sign
  in.
- Nothing is synced automatically without you clicking "Connect" first — until then, everything
  stays local to this browser only.

## Building for deployment

```bash
npm run build
```

Outputs a static site in `dist/` — deployable to any static host (GitHub Pages, Netlify, Vercel,
Cloudflare Pages, etc.). Remember to add that host's URL to the OAuth client's Authorized
JavaScript origins (step 5 above) once you know it.
