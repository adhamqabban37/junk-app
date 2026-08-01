# Build Plan: AI Salvage Yard Intelligence Platform

> Status: DRAFT — pending G-Stack Review Gauntlet (CLAUDE.md Planning Gate rule) and final user sign-off before Phase 0 begins.

## Decisions Locked In
- **ORM:** TypeORM (NestJS-native, raw-SQL escape hatches for pgvector columns and per-request RLS session variables).
- **Dev infra:** Docker Compose, local — Postgres w/ pgvector extension + Redis. No external cloud accounts for local dev.
- **Auth:** PIN-based login for Worker role (glove-friendly, fast); email+password for Manager/Owner roles. Long-lived JWT cached client-side for offline PWA launches (DESIGN_SPEC.md §3.1).
- **Package manager / monorepo:** npm workspaces, `/frontend` + `/backend` per project CLAUDE.md — no Turborepo/Nx needed at this scale.
- **Testing:** Jest (backend, NestJS default), Vitest + React Testing Library (frontend), Playwright reserved for later e2e.

## 1. Architecture
**Frontend:** Next.js (App Router), React, Tailwind CSS, shadcn/ui (Radix), Zustand, TanStack React Query, `@ducanh2912/next-pwa` + Workbox.
**Backend:** Node.js + TypeScript + NestJS, monolithic API with event-driven core, BullMQ + Redis for async Gemini jobs.
**Database:** PostgreSQL + pgvector + Row-Level Security, `tenant_id` on every table, TypeORM as data-access layer.
**AI:** Gemini Vision (Stage 1) with `response_mime_type: application/json` validated by Zod; NHTSA VIN API (free, MVP).

Folder structure:
```
/frontend        Next.js PWA — src/app/(mobile)/..., src/app/(desktop)/...
/backend         NestJS API + BullMQ workers — src/{auth,vehicles,parts,ai,queues,database}
/docs            BUILD_PLAN.md, PROGRESS.md
/project-memory  decision logs, session history
```

## 2. Data Model
| Entity | Key fields | Relations | Source |
|---|---|---|---|
| Tenant | id, name | — | ARCHITECTURE.md §3 |
| User | id, tenant_id, email/pin, role (worker/manager/owner) | → Tenant | ARCHITECTURE.md §3; DESIGN_SPEC §3.1, §3.14 |
| Vehicle | id, tenant_id, vin, decoded NHTSA fields, crush_status | → Tenant | ARCHITECTURE.md §3; DESIGN_SPEC §3.4, §3.11 |
| VehicleImage | id, vehicle_id, angle, url | → Vehicle | DESIGN_SPEC §3.4 |
| PartTaxonomy | id, name, category | — | DESIGN_SPEC §3.5 |
| Part | id, tenant_id, vehicle_id, taxonomy_id, status | → Vehicle, PartTaxonomy | ARCHITECTURE.md §3; DESIGN_SPEC §3.5, §3.10 |
| PartImage | id, part_id, url, blur/lighting flags | → Part | DESIGN_SPEC §3.6 |
| AIAnalysis | id, part_id, raw_json, grade, damage_codes[], confidence, model_version | → Part | ARCHITECTURE.md §4; DESIGN_SPEC §5 |
| HumanCorrection | id, ai_analysis_id, field, original, corrected, corrected_by | → AIAnalysis, User | ARCHITECTURE.md §4; CLAUDE.md rule 6 |
| Embedding | id, part_id/image_id, vector, type | → Part/PartImage | ARCHITECTURE.md §3 |
| PricingHistory | id, part_id, source, price, date | → Part | ARCHITECTURE.md §3, §5 |
| Listing | id, part_id, marketplace, external_id, status | → Part | ARCHITECTURE.md §3, §5; DESIGN_SPEC §3.12 |

Full schema built day-one per MEMORY.md decision log, even though PricingHistory/Listing sync are Phase 2/3 features.

## 3. Source Map
| Topic | Source |
|---|---|
| Vision, roadmap, personas | PRODUCT_SPEC.md (all) |
| Frontend/backend/DB/AI architecture | ARCHITECTURE.md §1–5 |
| Out-of-scope (MVP) | ARCHITECTURE.md §6 |
| Full screen inventory | DESIGN_SPEC.md §3 |
| Mobile nav & workflows | DESIGN_SPEC.md §4 |
| ARA grading logic | DESIGN_SPEC.md §5 |
| Camera/blur/lighting tech | DESIGN_SPEC.md §6 |
| Design system | DESIGN_SPEC.md §7 |
| Frontend implementation rules | DESIGN_SPEC.md §8 |
| User flows | DESIGN_SPEC.md §9 |
| Build order | DESIGN_SPEC.md §10 |
| AI agent coding directives | DESIGN_SPEC.md §11 |
| Stack decisions & rationale | MEMORY.md Decision Log |
| Dev rules | CLAUDE.md |

## 4. Phased Task Breakdown

### Phase 0 — Scaffold
- npm workspaces for `/frontend` + `/backend`
- TypeScript strict mode both workspaces
- Tailwind + shadcn/ui in frontend
- ESLint/Prettier shared config
- Jest (backend) + Vitest/RTL (frontend), verify a trivial failing→passing test round-trip
- Docker Compose: Postgres (pgvector image) + Redis
- Files: root configs, `frontend/`, `backend/`, `docker-compose.yml`
- **Acceptance:** `npm run dev:frontend` and `npm run dev:backend` boot; `npm test` runs in both workspaces; `docker-compose up` brings up reachable Postgres+Redis.

### Phase 1 — Data Layer
- TypeORM entities + migrations for all 11 entities above
- RLS policies per table (tenant_id enforced at kernel level)
- pgvector extension enabled
- Seed script for PartTaxonomy
- Tests first: creating a Part without tenant scope throws; RLS blocks cross-tenant read
- Files: `backend/src/database`, `backend/src/**/*.entity.ts`, `backend/migrations/`
- **Acceptance:** migrations apply cleanly to local Postgres; RLS cross-tenant isolation test passes; taxonomy seed present.

### Phase 2 — Auth & Multi-tenancy
- PIN-based login (Worker), email+password (Manager/Owner)
- Long-lived JWT cached client-side for offline PWA launch
- RBAC guard (worker/manager/owner)
- Tenant context middleware setting Postgres RLS session var per request
- Tests first: unauthorized access denied; RLS session var scopes queries; role guard blocks wrong-role routes
- Files: `backend/src/auth`
- **Acceptance:** auth e2e tests cover login (both mechanisms), token validity offline, RBAC denial, RLS isolation across 2 seeded tenants.

### Phase 3 — Mobile Intake Flow
- Auth screen (§3.1), Home screen w/ sync status (§3.2), VIN Scanner + manual fallback (§3.3), Vehicle Context + NHTSA decode + IndexedDB draft (§3.4), Part Selection w/ precached taxonomy (§3.5), Camera Capture + ghost overlays + blur/lighting edge validation (§3.6), Sync Queue Manager screen (§3.7)
- Zustand store + IndexedDB persistence + Background Sync API registration
- Tests first: Zod schema validation for VIN decode response; IndexedDB draft persistence; offline queue reducer logic; blur-detection unit test with fixture images
- Files: `frontend/src/app/(mobile)/...`, `frontend/src/store`, `frontend/src/lib/offline`
- **Acceptance:** full offline happy path in a browser with network disabled — VIN scan (manual fallback) → 4 exterior photos → part + guided photos saved locally → queue shows pending → reconnect triggers sync.

### Phase 4 — AI Orchestration Pipeline
- BullMQ queue + Redis wiring for image analysis jobs (non-blocking, CLAUDE.md rule 4)
- Gemini Vision integration, `response_mime_type: application/json`, Zod validation of response
- AIAnalysis + HumanCorrection persistence (the Moat, CLAUDE.md rule 6)
- Tests first: worker processes queued job → writes AIAnalysis; malformed Gemini response rejected by Zod, not silently stored; correction diff correctly recorded
- Files: `backend/src/ai`, `backend/src/queues`
- **Acceptance:** uploading a part image enqueues a job; worker produces AIAnalysis with grade/confidence/damage codes; simulated bad AI JSON is caught, not stored.

### Phase 5 — Desktop Manager Dashboard
- Global Dashboard (§3.8), AI Review Queue w/ keyboard nav + correction capture (§3.9), Inventory Management virtualized table (§3.10), Vehicles Management (§3.11), Marketplace Syndication — CSV export only for MVP (§3.12), Analytics (§3.13), Users/RBAC (§3.14), Settings (§3.15)
- Tests first: review-queue approve/reject writes HumanCorrection; virtualized table renders 10k+ rows; RBAC-gated routes
- Files: `frontend/src/app/(desktop)/...`
- **Acceptance:** manager reviews an AI-flagged part, corrects a field, approves it, sees it in Inventory, exports a CSV containing it.

### Phase 6 — Integrations (MVP scope)
- NHTSA error fallback to manual entry
- Finalized CSV export format (title/description/grade/damage codes/price placeholder)
- eBay/Shopify/ACES explicitly deferred to Phase 2 roadmap — not built now (ARCHITECTURE.md §6, PRODUCT_SPEC.md roadmap)
- **Acceptance:** VIN decode failure falls back gracefully to manual entry; CSV export opens correctly with AI-generated title/description/grade.

### Phase 7 — Polish & Hardening
- PWA manifest/Workbox strategies (StaleWhileRevalidate/CacheFirst)
- Accessibility pass (aria-labels, semantic HTML)
- Loading/error/empty state audit across all fetches
- Full regression test pass, typecheck, lint
- **Acceptance:** Lighthouse PWA score, a11y audit clean, no `any` types, all state-completeness checks pass.
