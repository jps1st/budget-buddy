# Money Maker Sheets

A TanStack Start SSR application with React, Tailwind CSS, and shadcn/ui components. Supports two deployment targets: **Cloudflare Workers** (primary) and a **self-hosted server** via `wrangler dev` + PM2.

---

## Prerequisites

- Node.js >= 22 and npm (`node:sqlite` is required for the sync backend)
- [PM2](https://pm2.keymetrics.io/) (for production server deployment)

```bash
npm install -g pm2
```

---

## Quick Start

Run the setup script — it installs dependencies, creates/migrates the D1 database, and builds the app:

```bash
npm run setup
```

Then start the dev server:

```bash
npm run dev
```

---

## Local Development

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:3000`.

---

## Build

```bash
npm run build
```

Output is written to `.cloudflare/` (Workers bundle) and `dist/` (static assets).

For a development build:

```bash
npm run build:dev
```

---

## Deployment

### Deployment — Self-hosted Server (Node.js + PM2)

The app runs as a Node.js HTTP server. No Cloudflare account or wrangler required.

**1. Install dependencies and build**

```bash
npm run setup
```

Or manually:

```bash
npm install
npm run build
```

**2. Start with PM2**

```bash
pm2 start ecosystem.config.json --env production
```

This runs `node dist/server/server.js` on port `4173`. The SQLite database is created automatically at `data/budget-sync.db`.

**Useful PM2 commands**

```bash
pm2 list                  # view running processes
pm2 logs budget           # tail logs
pm2 restart budget        # restart the process
pm2 stop budget           # stop the process
pm2 delete budget         # remove from PM2
pm2 save                  # persist process list across reboots
pm2 startup               # generate startup script for the OS
```

**Change the port**

Edit `PORT` in `ecosystem.config.json` under `env_production`, or set the `PORT` environment variable before starting.

---

## Online Sync (SQLite)

Budget data can be synced across devices and shared via 8-character codes. The server uses Node.js's built-in `node:sqlite` — no external database required. The database file is created automatically at `data/budget-sync.db` on first run.

**Requirements:** Node.js >= 22 (ships `node:sqlite` as a built-in).

**How it works**

- Each browser gets a persistent device ID stored in IndexedDB.
- Owned budgets sync automatically (3-second debounce after changes).
- Share a budget via an 8-character code; the owner controls read/write access per device.
- Shared budgets are opened by entering the code — they sync separately from owned budgets.
- The sync status icon (top-right) shows idle / syncing / synced / offline states.

---

## Environment Variables

Create a `.env` file at the project root (never commit this file):

```env
# Example — add your own variables here
VITE_API_BASE_URL=https://api.example.com
```

Vite automatically exposes variables prefixed with `VITE_` to the client bundle. Server-only variables (no prefix) are available in SSR context.

For Cloudflare Workers, set secrets via Wrangler:

```bash
wrangler secret put MY_SECRET
```

---

## Scripts Reference

| Command | Description |
|---|---|
| `npm run setup` | First-time setup: install dependencies and build |
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run build:dev` | Development build |
| `npm run preview` | Serve the production build locally (`node dist/server/server.js`) |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Prettier |
