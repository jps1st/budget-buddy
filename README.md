# Money Maker Sheets

A TanStack Start SSR application with React, Tailwind CSS, and shadcn/ui components. Supports two deployment targets: **Cloudflare Workers** (primary) and a **traditional Node.js server** via `vite preview` + PM2.

---

## Prerequisites

- Node.js >= 18 and npm
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (for Cloudflare deployment)
- [PM2](https://pm2.keymetrics.io/) (for traditional server deployment)

```bash
npm install -g wrangler pm2
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

### Option A — Cloudflare Workers (recommended)

This is the primary deployment target. The app runs as a Worker at the edge.

**1. Authenticate with Cloudflare**

```bash
wrangler login
```

**2. Build and deploy**

```bash
npm run build
wrangler deploy
```

The app name and compatibility settings are defined in `wrangler.jsonc`. Change the `name` field there to match your desired Worker name.

**Environment-specific deployments** (if you add environments to `wrangler.jsonc`):

```bash
# staging
wrangler deploy --env staging

# production
wrangler deploy --env production
```

---

### Option B — Traditional Node.js Server (PM2)

Use this if you need to host on a VPS or bare-metal server instead of Cloudflare.

**1. Install dependencies and build**

```bash
npm install
npm run build
```

**2. Start with PM2**

```bash
pm2 start ecosystem.config.json --env production
```

This runs `npm run preview` (Vite's production preview server) on port `4173`.

**Useful PM2 commands**

```bash
pm2 list                          # view running processes
pm2 logs money-maker-sheets       # tail logs
pm2 restart money-maker-sheets    # restart the process
pm2 stop money-maker-sheets       # stop the process
pm2 delete money-maker-sheets     # remove from PM2
pm2 save                          # persist process list across reboots
pm2 startup                       # generate startup script for the OS
```

**Expose a custom port**

Edit `ecosystem.config.json` → `env_production.PORT`, then also pass `--port` to the preview script by updating `package.json`:

```json
"preview": "vite preview --port 4173 --host 0.0.0.0"
```

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
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run build:dev` | Development build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Prettier |
| `wrangler deploy` | Deploy to Cloudflare Workers |
