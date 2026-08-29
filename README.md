# Word Journal

A small home-screen app for collecting your favorite words from books,
with a daily notification showing one saved word, its meaning, and a
sentence/quote you attach (ideally from the author you found it in).

- **Add a word** — type it, tap "Look up" to auto-fill the definition
  (via the free [dictionaryapi.dev](https://dictionaryapi.dev/) API), then
  add your own sentence/paragraph, author, and book.
- **Today** — shows one word a day, picked automatically so you cycle
  through your whole collection before repeating.
- **My Words** — browse, search, edit, and delete everything you've saved.
- **Settings** — turn on daily notifications, and export/import a backup.

All your words are stored **only on your phone** (in the browser's local
IndexedDB) — nothing is sent to a server. That keeps things simple and
private, but also means you should use **Settings → Export as file**
occasionally to back up your list, since uninstalling the app or clearing
browsing data will erase it.

## Installing it on your phone

This is a Progressive Web App (PWA) — no app store needed.

1. Host the files somewhere with HTTPS (see below), or open them from a
   local server for testing.
2. Visit the site in your phone's browser.
3. **iPhone (Safari):** tap the Share icon → "Add to Home Screen".
   **Android (Chrome):** tap the ⋮ menu → "Add to Home screen" / "Install app".
4. Open the app from your home screen icon (not the browser) and go to
   **Settings → Enable daily notification**.

### About the daily notification

- On Android/Chrome, once notifications are enabled the app registers a
  background sync so the notification can appear even if you haven't
  opened the app that day.
- On iPhone, Safari doesn't support scheduling notifications in the
  background without a push server. To keep this app fully local (no
  backend, no account), it instead shows the day's word as a notification
  the moment you open the app if it hasn't shown one yet that day — so it
  works great if you open it once each morning. A truly "wakes you up with
  a notification with the app closed" experience on iPhone would require
  adding a small push-notification server later; ask if you'd like that
  as a follow-up.

## Running it locally to try it out

No build step — it's static files. From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser. (Service workers and
notifications require either `localhost` or a real HTTPS domain — they
won't work over plain `http://` on another device.)

## Deploying

Any static host works, e.g. **GitHub Pages**:

1. Push this repo to GitHub.
2. In the repo settings, enable GitHub Pages for the branch/folder.
3. Visit the resulting `https://<you>.github.io/<repo>/` URL on your phone
   and add it to your home screen.

## Files

- `index.html`, `styles.css`, `app.js` — the app UI and logic.
- `db.js` — shared IndexedDB helpers (used by both the page and the
  service worker).
- `sw.js` — service worker: offline caching + notification logic.
- `manifest.json`, `icons/` — PWA metadata and icons.
