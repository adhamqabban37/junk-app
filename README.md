# AI Salvage Yard Intelligence Platform

AI-native sidecar app that turns salvage-yard photo walkarounds into structured inventory. See `docs/BUILD_PLAN.md` for the full architecture and phased plan, and `docs/PROGRESS.md` for build status.

## Stack

- `frontend/` — Next.js PWA (React, Tailwind, shadcn/ui, Zustand, IndexedDB)
- `backend/` — NestJS API + BullMQ workers (Postgres + pgvector + RLS, Redis)

## Setup (clean checkout → running app)

Requires Node.js 20+, npm, and Docker.

```bash
# 1. Install dependencies (npm workspaces — installs frontend + backend together)
npm install

# 2. Start Postgres (pgvector) + Redis
npm run db:up

# 3. Copy env templates and fill in secrets (Gemini API key, etc.)
cp backend/.env.example backend/.env

# 4. Run database migrations
npm run migrate --workspace=backend

# 5. Seed dev data (demo tenant + worker PIN user + manager account)
npm run seed:dev --workspace=backend

# 6. Start both dev servers (run in separate terminals)
npm run dev:backend
npm run dev:frontend
```

### Testing on a phone (same network)

The PWA calls the API from the *browser*, so it needs a reachable address — `localhost` on a phone means the phone. Create `frontend/.env.local` (gitignored) with this machine's LAN IP and restart the frontend:

```
NEXT_PUBLIC_API_BASE_URL=http://<your-lan-ip>:3001
```

Then open `http://<your-lan-ip>:3000` on the phone. On Windows you'll also need an inbound firewall rule for ports 3000/3001 (elevated shell). Verify the IP with `Get-NetAdapter` — a disconnected adapter can hold a stale lease that answers locally but not from the phone.

**The live camera won't work over plain HTTP** (`getUserMedia` requires a secure context); the photo picker and bulk scan work fine. Real camera testing needs an HTTPS tunnel.

Frontend: http://localhost:3000
Backend: http://localhost:3001 (both dev servers run at once per step 6 above; the backend defaults to 3001 specifically so it doesn't collide with the frontend's 3000 — see `backend/src/main.ts` / `frontend/src/lib/api.ts`)

## Common commands

| Command | What it does |
|---|---|
| `npm run dev:frontend` | Start the Next.js PWA dev server |
| `npm run dev:backend` | Start the NestJS API in watch mode |
| `npm test` | Run backend (Jest) + frontend (Vitest) test suites |
| `npm run lint` | Lint both workspaces |
| `npm run db:up` / `npm run db:down` | Start/stop local Postgres + Redis via Docker Compose |

## Docs

- `docs/BUILD_PLAN.md` — architecture, data model, phased build plan, G-Stack review report
- `docs/PROGRESS.md` — checklist tracking build status against the plan
- `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `DESIGN_SPEC.md`, `MEMORY.md` — source specs
