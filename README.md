# OutLoud

An AI speaking coach for people who read and write English well but freeze when they have to speak it.
3 spoken questions, one AI interviewer, one honest scorecard. Runs in a phone browser.

## Deploy in 5 minutes (Vercel)

1. Go to **vercel.com → Add New → Project → Deploy without Git** (or push this folder to a GitHub repo and import it).
2. Drag this whole folder in. Framework preset: **Other**. No build command, no output directory.
3. Before you hit Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | your key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — it starts with `AIza` |
   | `GEMINI_MODEL` | `gemini-3.5-flash-lite` (optional) |

4. Deploy. Open the HTTPS URL on your phone in **Chrome**.

> The microphone only works over HTTPS. Vercel gives you that automatically. It will not work from a `file://` path or over plain `http`.

## Check it is wired up

Open `https://your-app.vercel.app/api/interview` in a browser — you should see `{"error":"POST only"}`. That means the function is live.
If the questions you hear are always the same three, the API call is failing and the app has fallen back to its local question bank. Check the function logs in Vercel.

## Files

```
index.html          all screens and the Material Design 3 system
app.js              speech, session flow, scoring, metrics
api/interview.js    Gemini proxy — the API key lives here, server-side only
assets/priya.jpg    the interviewer
vercel.json         permissions policy for mic/camera + asset caching
BUILD_LOG.md        what broke and how it was worked around
```

## Local testing

Speech recognition needs `https` or `localhost`:

```bash
npx serve .          # then open http://localhost:3000
```

The `/api` function will not run under a plain static server — install the Vercel CLI and use `vercel dev` if you want the real Gemini calls locally.

## Privacy

Audio is transcribed by the phone itself and never uploaded. Camera video never leaves the device.
Only the **text** of an answer is sent to Gemini, for coaching. Progress is stored in `localStorage` on the device.
