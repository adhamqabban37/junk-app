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

Frontend: http://localhost:3000
Backend: http://localhost:3001 (adjust to whatever port `backend/src/main.ts` binds)

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
