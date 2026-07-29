# Recall — a spaced-repetition study tracker

A self-contained PWA clone of the "Review" app you shared: To-do / Tasks / Profile
tabs, projects with colored tags, and a real **FSRS-4.5** scheduling engine
(the same memory model — stability, difficulty, retrievability — used by
modern spaced-repetition apps). All data stays on your device; nothing is
sent to a server.

## Install it on your phone (takes ~2 minutes)

A PWA has to be served over **https** (or `localhost`) for "Add to Home
Screen" and notifications to work — opening the HTML file directly from
your Downloads folder won't enable those. Easiest free option:

**GitHub Pages**
1. Create a new repository on github.com (public, no README needed).
2. Upload every file in this folder (keep the `icons/` folder as a folder).
3. Repo → Settings → Pages → Deploy from branch → `main` / root → Save.
4. After a minute, open the `https://<you>.github.io/<repo>/` link it gives you, **on your phone**, in Chrome.
5. Chrome menu (⋮) → **Add to Home screen**. It now opens full-screen like a real app.

**Netlify Drop** (no account, but the URL is temporary/random)
Go to `app.netlify.com/drop` on a computer, drag this whole folder in, open the link it gives you on your phone, then "Add to Home screen" the same way.

## About the daily reminder

This is the one thing a plain web app genuinely can't fully replicate: native
apps get a system alarm that fires at an exact time even when closed. A
browser has no equivalent guaranteed timer. Recall does two things instead:

- **Every time you open it**, it instantly checks if anything's due and
  notifies you if so — so you're never more than "one open" behind.
- **In the background**, on Android Chrome, it registers Periodic
  Background Sync, which *can* fire a real notification without opening
  the app — but the browser decides if/when, based on how often you use
  the app, battery, and Wi-Fi. It's a bonus, not a guarantee.

If you want a rock-solid exact-time push notification, that needs a small
always-on backend (e.g. Firebase Cloud Messaging) — happy to build that
next if you want it; just ask.

## The engine

`app.js` implements FSRS-4.5 verbatim from the published formulas and
default weights (open-spaced-repetition project): initial stability/difficulty
from your first rating, then stability updates from recall vs. lapse, a
power-law forgetting curve, and interval = solve for the day your
retrievability drops to your requested-retention target (default 90%,
adjustable in Settings → Algorithm). The four rating buttons preview their
resulting interval live, exactly like the original.

## Files

- `index.html` / `style.css` / `app.js` — the whole app
- `manifest.json`, `sw.js`, `icons/` — PWA install + offline + notifications
- Data lives in `localStorage` on your device; back it up anytime from
  Settings → Data → Export.
