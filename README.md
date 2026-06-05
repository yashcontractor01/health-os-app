# Health OS Coach — your own private health-coach app

A single-page web app (PWA) that is **yours**: your data, your AI key, your storage.
No company account, no subscription lock-in. If you ever stop paying any AI, your whole
journey is still a plain markdown file in your GitHub repo, readable by any tool, forever.

## What it does
- Chat with an AI health coach on your phone (text, **voice**, **photos** of plates / BP / lab reports).
- The coach reads your **master file** (`Yash_Health_OS.md`) as its memory and **auto-updates it** after every change.
- Open-ended: nutrition, labs, skin routine, gym, sleep, any new problem — it just grows.
- **Auto-backup** of the master file to your private GitHub repo (versioned history of your whole journey).

## One-time setup (~15 min)

### 1. Get an AI key (pick one)
- **Claude (best coaching quality):** console.anthropic.com → API Keys → create key (`sk-ant-...`). Pay-per-use — a few cents per session, no monthly subscription.
- **Gemini (free):** aistudio.google.com → Get API key (`AIza...`). Free tier is plenty for personal use.

### 2. Make a private GitHub repo for your data (recommended)
- Create a **private** repo, e.g. `health-os`.
- Token: github.com → Settings → Developer settings → **Fine-grained tokens** → new token → select that repo → **Contents: Read & write**.

### 3. Host the app so your phone can open it
Pick the easiest:
- **Netlify Drop (60 seconds, no account needed to try):** go to app.netlify.com/drop and drag this `app` folder in. You get a URL.
- **Cloudflare Pages / Vercel / GitHub Pages:** deploy this `app` folder as a static site.
- **Just the laptop:** run `npx serve` (or any static server) inside this folder and open it.

> The deployed app contains **no health data and no keys** — those live only in your browser + your private repo. So a public app URL is fine.

### 4. First run
1. Open the URL on your phone → browser menu → **Add to Home Screen** (now it's an app icon).
2. Tap ⚙️ → choose provider → paste your AI key → (optional) fill GitHub user / repo / token → Save.
3. Tap 📄 → **Import .md** → load your `Yash_Health_OS.md`. (Or it auto-loads if running next to the file on the laptop.)
4. Send your morning weight. You're coaching.

## How your data flows
```
phone app  ──reads──►  master file (in browser)  ──coach edits──►  saved to browser
     │                                                                   │
     └────────────────── auto-backup (GitHub API) ──────────────────────►  private repo
```
The same repo file is what your laptop Claude Code reads/writes too — one brain, two front-ends.

## Privacy & safety notes
- API keys & GitHub token are stored in this browser's localStorage only. Use a passcode/biometric lock on your phone.
- Don't deploy your `Yash_Health_OS.md` to a public host — keep the data in your **private** repo and Import it into the app.
- The app talks directly to Claude/Gemini/GitHub from your browser (no middle-man server).

## Known limits (MVP)
- The coach returns the **whole** master file when it changes; as the daily log grows over many months this gets long. Future upgrade: switch to append-only patches.
- Voice input quality depends on the browser (Chrome on Android works best).
- This is a personal tool, not medical advice — keep confirming supplements/doses with your doctor (as your own rules say).
