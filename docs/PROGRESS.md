# Build Progress: AI Salvage Yard Intelligence Platform

Tracks completion against `docs/BUILD_PLAN.md`. Check boxes as each phase's acceptance criteria are verified.

## Phase 0 — Scaffold
- [ ] npm workspaces for `/frontend` + `/backend`
- [ ] TypeScript strict mode both workspaces
- [ ] Tailwind + shadcn/ui in frontend
- [ ] ESLint/Prettier shared config
- [ ] Jest (backend) + Vitest/RTL (frontend), trivial failing→passing test round-trip verified
- [ ] Docker Compose: Postgres (pgvector image) + Redis
- [ ] README with documented clone-to-running-app setup sequence
- [ ] **Acceptance verified:** dev servers boot, `npm test` runs both workspaces, `docker-compose up` reachable, README sequence works on a clean checkout

## Phase 1 — Data Layer
- [ ] TypeORM entities + migrations for all 11 entities
- [ ] RLS policies per table
- [ ] pgvector extension enabled
- [ ] PartTaxonomy seed script
- [ ] Dev seed script (`npm run seed:dev`): demo tenant + worker (PIN) + manager (email/password)
- [ ] Tests: tenant-scope violation throws; RLS isolation across SELECT/INSERT/UPDATE
- [ ] **Acceptance verified:** migrations apply cleanly; RLS isolation tests pass (all 3 operations); seeds present

## Phase 2 — Auth & Multi-tenancy
- [ ] PIN login (Worker), email+password login (Manager/Owner)
- [ ] Long-lived JWT cached client-side for offline PWA launch
- [ ] RBAC guard (worker/manager/owner)
- [ ] Tenant context middleware setting RLS session var per request
- [ ] Pooled-connection RLS leak test (two tenants, same connection, rapid requests)
- [ ] **Acceptance verified:** auth e2e covers both login mechanisms, offline token validity, RBAC denial, RLS isolation under pooled/concurrent load

## Phase 3 — Mobile Intake Flow
- [ ] Auth screen
- [ ] Home screen w/ sync status + empty state (0 pending)
- [ ] VIN Scanner + manual entry fallback
- [ ] Vehicle Context screen + NHTSA decode + IndexedDB draft
- [ ] Part Selection w/ precached taxonomy
- [ ] Camera Capture + ghost overlays + blur/lighting validation
- [ ] Sync Queue Manager screen + empty state
- [ ] Zustand store + IndexedDB + Background Sync API
- [ ] Client-generated UUID dedup for offline drafts
- [ ] **Acceptance verified:** full offline happy path with network disabled; manual-VIN-entry fallback path explicitly exercised

## Phase 4 — AI Orchestration Pipeline
- [ ] BullMQ + Redis wiring, concurrency capped to Gemini rate limit
- [ ] Gemini Vision integration w/ `response_mime_type: application/json` + Zod validation
- [ ] Idempotency key on AIAnalysis (`part_image_id` + `model_version`)
- [ ] Graceful degradation: exhausted retries → Part flips to "needs manual grading"
- [ ] AIAnalysis + HumanCorrection persistence
- [ ] **Acceptance verified:** job enqueue → AIAnalysis write; retry does not duplicate; malformed JSON rejected, not stored; simulated outage produces manually-gradable Part

## Phase 5 — Desktop Manager Dashboard
- [ ] Global Dashboard
- [ ] AI Review Queue w/ keyboard nav, correction capture, distinct low-confidence state
- [ ] Inventory Management virtualized table w/ measured frame-time budget
- [ ] Vehicles Management
- [ ] Marketplace Syndication (CSV export only for MVP)
- [ ] Analytics
- [ ] Users/RBAC
- [ ] Settings (incl. AI confidence threshold)
- [ ] **Acceptance verified:** review → correct → approve → visible in Inventory → CSV export contains it; low-confidence items visually distinct

## Phase 6 — Integrations (MVP scope)
- [ ] NHTSA error fallback to manual entry
- [ ] Finalized CSV export format
- [ ] **Acceptance verified:** VIN decode failure falls back gracefully; CSV opens correctly with AI-generated fields

## Phase 7 — Polish & Hardening
- [ ] PWA manifest/Workbox strategies
- [ ] Accessibility pass
- [ ] Loading/error/empty state audit (all fetches)
- [ ] Full regression pass, typecheck, lint
- [ ] **Acceptance verified:** Lighthouse PWA score, a11y clean, no `any` types, all state-completeness checks pass

## Notes
- Planning Gate review (docs/BUILD_PLAN.md § GSTACK REVIEW REPORT) completed 2026-07-31 — 11 findings, all fixed pre-build.
- Re-verify the RLS/connection-pooling leak risk (Phase 2, highest-severity finding) once auth middleware is implemented — easy to silently reintroduce on a pooling-strategy change.
