# Money Maker Sheets

A TanStack Start SSR application with React, Tailwind CSS, and shadcn/ui components. Supports two deployment targets: **Cloudflare Workers** (primary) and a **self-hosted server** via `wrangler dev` + PM2.

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

### Option B — Self-hosted Server (PM2 + Wrangler)

Use this if you need to host on a VPS or bare-metal server instead of Cloudflare.

> **Note:** Because this app targets the Cloudflare Workers runtime, `wrangler dev` is used to run the Workers bundle locally via Miniflare. `vite preview` will **not** work — it expects a Node.js server bundle that this build does not produce.

**1. Install dependencies and build**

```bash
npm install
npm run build
```

**2. Start with PM2**

```bash
pm2 start ecosystem.config.json --env production
```

This runs `wrangler dev --port 4173 --host 0.0.0.0`, serving the built Workers bundle on port `4173`.

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

**Change the port**

Edit `--port` in the `preview` script in `package.json`:

```json
"preview": "wrangler dev --port 4173 --host 0.0.0.0"
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
