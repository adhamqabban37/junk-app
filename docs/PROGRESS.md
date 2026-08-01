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

## Phase 1 — Data Layer ✅ (2026-08-01)
- [x] TypeORM entities for all 11 tenant-scoped entities + Tenant + PartTaxonomy (`backend/src/database/entities/*.entity.ts`)
- [x] Migration written: `backend/migrations/1785559260000-InitialSchema.ts` — all tables, enums, indexes, FKs, RLS policies (`ENABLE` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy per tenant-scoped table)
- [x] `withTenantContext()` helper (`backend/src/database/tenant-context.ts`) — sets `SET LOCAL app.tenant_id` inside a transaction (UUID-validated, since SET doesn't accept bind params)
- [x] Taxonomy seed (`backend/src/database/seeds/taxonomy.seed.ts`) — 22 common salvage parts, 8 flagged quick-pick
- [x] Dev seed (`backend/src/database/seeds/dev.seed.ts`) — demo tenant + PIN worker + email/password manager
- [x] `DatabaseModule` wired into `AppModule`
- [x] RLS isolation e2e test written: `backend/test/rls-isolation.e2e-spec.ts` (SELECT/INSERT/UPDATE + no-context default-deny)
- [x] pgvector extension enabled
- [x] Migration applied against the corrected (non-superuser) `junkyard_app` role
- [x] Dev seed re-run against the corrected role
- [x] RLS isolation e2e test passing (4/4)
- [x] **Acceptance verified:** `npm run migrate`, `npm run seed:dev`, `npm run test:e2e` (rls-isolation, 4/4 passing) and `npm test` (unit) all green in `backend/`

### Resolved blockers (fixed 2026-08-01)
1. **RLS silently not enforced.** `docker-compose.yml`'s `POSTGRES_USER` (`junkyard`) is always created as a Postgres superuser by the official image's bootstrap, and Postgres never applies row-level security to superusers, even with `FORCE ROW LEVEL SECURITY`. Fixed by adding `docker/postgres-init/01-app-role.sql` (non-superuser role `junkyard_app`, granted DB + schema privileges) and pointing `DATABASE_URL` at it.
2. **`CREATE EXTENSION vector` needs superuser**, but the app now connects as non-superuser `junkyard_app`. Fixed by adding `docker/postgres-init/00-extensions.sql` (runs before `01-app-role.sql`, as the bootstrap superuser) and removing the `CREATE EXTENSION` call from the migration itself.
3. **`invalid input syntax for type uuid: ""` on the no-context RLS test.** Root cause: `app.tenant_id` is an undeclared custom GUC placeholder. Once `SET LOCAL app.tenant_id = '...'` runs at least once on a physical backend connection, Postgres resets it to `''` (not NULL) once the transaction ends — and with TypeORM's connection pool, a later query with no tenant context can land on that same reused connection, so `current_setting(...)::uuid` throws instead of returning NULL. Fixed by wrapping every RLS policy's `current_setting` call in `NULLIF(..., '')` before the `::uuid` cast, in both `USING` and `WITH CHECK` clauses.

Also fixed along the way:
- Test's cross-tenant VIN string was 19 chars against a `varchar(17)` column, masking the real RLS check with a length error — fixed to a 17-char value.
- `entities/index.ts` barrel re-exports enums alongside entity classes, which TypeORM's `entities:` array rejects (`Object.values(entities)` broke `data-source.ts`/`database.module.ts`) — fixed by adding `backend/src/database/entities.list.ts` with an explicit `ENTITIES` array of just the classes; both files now import from there instead.

## Phase 2 — Auth & Multi-tenancy ✅ (2026-08-01)
- [x] PIN login (Worker) via `POST /auth/login/pin` `{tenantId, userId, pin}` — `GET /auth/tenants/:tenantId/workers` lists worker names/ids for the PIN picker (never the PIN itself, see user.entity.ts)
- [x] Email+password login (Manager/Owner) via `POST /auth/login/manager` `{tenantId, email, password}`
- [x] Long-lived JWT (`JWT_EXPIRES_IN=30d`) — claims (`sub`, `tenantId`, `role`, `name`) are self-contained, `JwtStrategy.validate()` does no DB round-trip so an offline-launched PWA can still authenticate locally-cached requests
- [x] RBAC: `@Roles(...)` decorator + `RolesGuard`, e.g. `GET /auth/workers` (own-tenant worker list) is manager/owner-only
- [x] `JwtAuthGuard` registered globally (`APP_GUARD`) — every route requires a valid JWT unless annotated `@Public()`
- [x] Tenant-scoped queries go through the existing `withTenantContext()` helper (Phase 1) inside `AuthService`, never a bare repository call — `SET LOCAL app.tenant_id` is Postgres-guaranteed transaction-scoped, so there is no request-scoped "tenant context middleware" object that could itself leak; the guarantee lives at the DB layer instead
- [x] Pooled-connection RLS leak test: `backend/test/auth.e2e-spec.ts` forces `DB_POOL_MAX=2` and fires 30 concurrent alternating-tenant requests at `GET /auth/workers`, asserting every response only ever contains its own tenant's worker — passing
- [x] **Acceptance verified:** `backend/test/auth.e2e-spec.ts` (7/7) covers both login mechanisms (success + failure), `/auth/me` token validity + claims, RBAC denial (worker on manager-only route → 403), RLS scoping (manager only sees own-tenant workers), and the pooled-connection concurrent-tenant leak test. `npm test`, `npm run test:e2e` (12/12 across all 3 suites), `npm run build`, and `npm run lint` all clean.

### Design decisions made during this phase
- **Login requires a client-supplied `tenantId`**, for both PIN and password login. There's no cross-tenant email lookup (email isn't globally unique, and querying `users` without a tenant context would mean bypassing RLS for auth itself). This mirrors how the PIN flow already needed a known tenant to list workers from — in practice a yard's device/URL already knows which tenant it belongs to before anyone logs in. Tenant *identification* (slug, subdomain, QR code) is a Phase 3 frontend/UX concern, not solved here.
- **`DatabaseModule` is now `@Global()`** and exports `TypeOrmModule`, so `DataSource` is injectable anywhere (AuthModule today, every future resource module later) without re-importing it per feature module.
- **`DB_POOL_MAX` config** added to `DatabaseModule` (defaults to 10, same as node-postgres's own default) specifically so `auth.e2e-spec.ts` can force a tiny pool and reliably reproduce the pooled-connection leak scenario the Phase 2 planning-gate finding warned about.
- **Scaffolded root `GET /` → `GET /health`.** The placeholder Nest "Hello World" route had no reason to stay unauthenticated once `JwtAuthGuard` went global; replaced with a real `@Public()` health check instead of just exempting the placeholder.

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
