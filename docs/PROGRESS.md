# Build Progress: AI Salvage Yard Intelligence Platform

Tracks completion against `docs/BUILD_PLAN.md`. Check boxes as each phase's acceptance criteria are verified.

## Phase 0 — Scaffold ✅ (2026-07-31)
- [x] npm workspaces for `/frontend` + `/backend`
- [x] TypeScript strict mode both workspaces
- [x] Tailwind + shadcn/ui in frontend
- [x] ESLint/Prettier shared config
- [x] Jest (backend) + Vitest/RTL (frontend), trivial failing→passing test round-trip verified (frontend)
- [x] Docker Compose: Postgres (pgvector image) + Redis
- [x] README with documented clone-to-running-app setup sequence
- [x] **Acceptance verified:** both dev servers boot (verified directly — `npm run dev` via cmd.exe wrapper loses buffered output on abrupt kill on Windows, direct `next`/`nest` invocation confirms clean startup), `npm test` passes both workspaces, `docker-compose up` brings up healthy Postgres+Redis, README sequence works up through Phase 0 (migrate/seed steps land in Phase 1)

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
- **Operational quirks found during Phase 0 (Windows + this npm version):**
  - `npm install <pkgs>` on an *existing* node_modules tree can crash with `TypeError: Invalid Version:` in npm's arborist dedupe logic when a package is both a direct and transitive dependency with different version ranges (hit with `bullmq`/`passport`). Fix: declare all deps directly in `package.json` and do one fresh `rm -rf node_modules package-lock.json && npm install` rather than incremental adds.
  - `typeorm@^1.1.0` peer-requires `ioredis@^5.x`; pinning `ioredis@^6` breaks `npm install` with a real ERESOLVE (not a bug — fix the version).
  - Piping `npm install ... | tail` (or similar) masks the real exit code in this shell — always check actual output/exit code directly (e.g. redirect to a file, `echo "EXIT=$?"` on its own line with no pipe) rather than trusting a green summary.
  - `npm run dev` (nest/next) invoked via the Windows `cmd.exe` wrapper loses buffered stdout when killed abruptly (e.g. by `timeout`); invoking the underlying binary directly (`node node_modules/next/dist/bin/next dev`, `node_modules/.bin/nest start`) gives reliable output for verification.
