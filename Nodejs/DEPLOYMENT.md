# CryptoSignals – Deployment Guide

This project is a long‑running Node.js server that:
- serves an HTTP API with crypto signals
- connects to KuCoin WebSocket + CoinGecko
- runs background paper‑trading loops
- integrates with a Telegram bot and webhook

Because of the long‑running WebSocket connections and `setInterval` loops, it **must run on a persistent Node server** (VM / container), not on a fully serverless platform.

## 1. Run locally

```bash
npm install
cp .env.example .env   # then edit .env with your keys
npm start
```

The server listens on `PORT` (default 3000) and exposes:

- `/` – HTML landing page
- `/api/health` – health check
- `/api/symbols`, `/api/signal`, `/api/paper`, etc.
- `/telegram/webhook` – Telegram webhook endpoint

## 2. Prepare GitHub repository

On your computer:

```bash
git init
git add .
git commit -m "Initial commit – CryptoSignals"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

> Tip: make sure the `.git` folder from the Replit export is **removed** before running `git init`.

## 3. Recommended hosting (Render / Railway / similar)

Platforms like **Render**, **Railway**, **Fly.io**, or a simple VPS are a good fit because they keep a Node process alive.

Typical Render setup:

- New ➜ Web Service ➜ Connect your GitHub repo
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Environment variables: copy everything from your `.env` file

Render will inject its own `PORT` variable; this project already reads `process.env.PORT`, so no code change is needed.

## 4. About Vercel

Vercel is optimised for **serverless / Next.js**.  
This app **opens WebSocket connections and runs continuous background jobs**, which are not compatible with typical serverless limits (short‑lived functions).

If you still want to use Vercel:

- Host the **front‑end** (dashboard UI) on Vercel
- Host this **Node.js backend** on Render/Railway/etc.
- Point the front‑end to the backend API URL (e.g. `https://cryptosignals.onrender.com/api/signal`).

This keeps all the trading logic running reliably while using Vercel only for the static site or React dashboard.

