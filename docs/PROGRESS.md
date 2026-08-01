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

## Phase 3 — Mobile Intake Flow 🚧 BUILT, acceptance not yet verified (2026-08-01)
- [x] Zustand store + IndexedDB + client-generated UUID dedup (`frontend/src/lib/offline/{db,store}.ts`)
- [x] NHTSA VIN decode client + Zod validation (`frontend/src/lib/nhtsa.ts`) — explicitly catches NHTSA's "200 OK, no make/model" undecodable-VIN shape, not just network failures
- [x] Blur/lighting quality check (`frontend/src/lib/offline/image-quality.ts`) — pure Laplacian-variance + mean-luminance function, fixture-tested, decoupled from canvas/video capture
- [x] Background Sync registration + `online`-event retry (`frontend/src/lib/offline/sync.ts`), wired up live in `(mobile)/layout.tsx` — full Workbox/service-worker build still deferred to Phase 7 by design
- [x] Auth screen (`(mobile)/login`) — device→tenant binding, Worker PIN / Manager email+password tabs
- [x] Home screen w/ sync status + empty state (0 pending) (`(mobile)/page.tsx`, `components/mobile/sync-status-bar.tsx`)
- [x] VIN Scanner + manual entry fallback (`(mobile)/intake/[draftId]/vin`) — manual entry is the only path when `BarcodeDetector` is unsupported (Safari/Firefox), not a secondary option nobody exercises
- [x] Vehicle Context screen + NHTSA decode + IndexedDB draft (`(mobile)/intake/[draftId]/vehicle`) — prefilled when decode succeeded, blank and fully editable (manual fallback) when it didn't; required 4-angle exterior photo capture with a per-angle blurry/dark warning
- [x] Part Selection w/ precached taxonomy (`(mobile)/intake/[draftId]/parts`, `GET /taxonomy`, `lib/offline/taxonomy-store.ts`) — quick-picks + search, "Finish & queue for sync" gated on at least one photographed part
- [x] Camera Capture + ghost overlay + blur/lighting validation (`(mobile)/intake/[draftId]/parts/[partId]/camera`) — ghost overlay is a generic centered framing guide, not a per-taxonomy reference silhouette (no such art exists yet; a real limitation, noted rather than silently skipped)
- [x] Sync Queue Manager screen + empty state (`(mobile)/sync`)
- [ ] **Acceptance NOT yet verified:** a live browser walkthrough of the full offline happy path (network disabled, VIN entry through sync) was not performed. All business logic — offline store, sync retry/pooled-leak-safety equivalents, blur/lighting detection, VIN decode/fallback, RBAC-gated taxonomy fetch — is covered by 98 frontend + 15 backend automated tests, and `next build`/`nest build` both succeed, but that stops short of the phase's literal acceptance criterion. Camera-dependent steps (4 exterior angles, per-part photos) can't be walked end-to-end without a real device/camera in this environment regardless — worth a manual pass on an actual phone before calling this phase done.

### Notes
- **Dynamic route pages are Server Component wrappers, not `use(params)` Client Components.** Every `[draftId]`/`[partId]` page (`vin`, `vehicle`, `parts`, `parts/[partId]/camera`) is a thin async Server Component that `await params` and passes plain string props to a `'use client'` child (`*-page-client.tsx`). Calling `use(params)` directly inside a client page suspended and never resolved under RTL in this workspace (npm workspace hoisting can produce duplicate `react` copies, a known cause of exactly this symptom) — the Server-wrapper split sidesteps it entirely and is also the more idiomatic Next 16 shape for a page that needs both a route param and client-side hooks. Use this pattern for any future dynamic route.
- **`react-hooks/set-state-in-effect`** (a stricter React 19 lint rule than most training data will know) fires on the classic "read browser-only state after mount, to dodge an SSR hydration mismatch" idiom — `useEffect(() => setState(readBrowserThing()))` — and also on "prefill local state once external data arrives" effects. Real fixes applied here, never suppressions:
  - Browser-only capability/storage reads: moved into the existing Zustand `hydrate()`/`hydrated` pattern (`useAuthSession.restored`, `useTenantStore`) or `useSyncExternalStore` (`navigator.onLine` in `SyncStatusBar`) — both avoid the hydration mismatch the effect was guarding against, without the lint violation.
  - "Prefill state once async data arrives" (vehicle info form prefilling from NHTSA decode): restructured so the form is a child component that only mounts once the data is already known (gated by a loading check in the parent), letting it use a lazy `useState(() => ...)` initializer instead of an effect + "have I prefilled yet" flag.
  - A synchronous one-time capability check (`use-camera.ts`'s "does `getUserMedia` exist") became a lazy initializer too; the actual async `getUserMedia().then()/.catch()` calls were already fine as-is — the rule only flags synchronous `setState` in the effect body, not calls inside async callbacks, which is the documented correct "subscribe, then update when the external thing resolves" shape.
- **CORS was not enabled on the backend** (`backend/src/main.ts`) until caught while smoke-testing the flow locally — the PWA frontend is always a different origin from this API (different port in dev, different subdomain in any real deployment), so every browser request would otherwise be silently blocked. Fixed via `app.enableCors()`, configurable through an optional `CORS_ORIGIN` env var (comma-separated allowlist; defaults to allow-all).

## Phase 4 — AI Orchestration Pipeline ✅ built, live Gemini call unverified (2026-08-01)
- [x] BullMQ + Redis wiring, concurrency capped to Gemini rate limit (`AI_QUEUE_CONCURRENCY`, conservative default of 2 — Gemini's exact rate limit for this project's plan tier isn't pinned down yet, see blocker below)
- [x] Gemini Vision integration w/ `response_mime_type: application/json` + Zod validation (`backend/src/ai/gemini.service.ts`, `gemini-response.schema.ts`) — no SDK dependency, plain REST
- [x] Idempotency key on AIAnalysis (`part_image_id` + `model_version`) — unique DB index from Phase 1 plus a pre-check in `AiAnalysisService` that skips a redundant Gemini call entirely on retry
- [x] Graceful degradation: exhausted retries → Part flips to `needs_manual_grading` (`AiAnalysisProcessor.onFailed`, only on the *last* attempt, not every transient one)
- [x] AIAnalysis + HumanCorrection persistence (`POST /ai-analyses/:id/corrections`, manager/owner only)
- [x] **Acceptance verified via tests:** job enqueue → AIAnalysis write (real BullMQ round trip in `parts.e2e-spec.ts`); retry does not duplicate (`ai-analysis.e2e-spec.ts`); malformed/schema-invalid Gemini JSON rejected, never stored (`gemini.service.spec.ts`, `ai-analysis.e2e-spec.ts`); simulated outage produces a manually-gradable Part (`ai-analysis.e2e-spec.ts`, `ai-analysis.processor.spec.ts`)
- [ ] **Live Gemini call NOT verified** — see blocker below

### Blocker: Gemini API quota is 0 on the connected Google Cloud project
`GEMINI_API_KEY` is saved in `backend/.env` (gitignored). Verified so far, against the real API:
- The key authenticates correctly (project `391327712385`).
- The Gemini API had to be enabled on that project via the GCP console — done mid-session.
- **CLAUDE.md's "Gemini 3.5 Flash / 3.1 Flash-Lite" model names don't exist in the real API.** Live-checked the actual model list: `gemini-2.5-flash` is deprecated for new users (404), `gemini-2.0-flash` is valid and reachable. Code default corrected to `gemini-2.0-flash` (override via `GEMINI_MODEL`) in `gemini.service.ts` and `ai-analysis.service.ts`.
- A real `generateContent` call against `gemini-2.0-flash`, built with the exact request shape `GeminiService` sends (inline base64 JPEG, `responseMimeType: application/json`), gets a well-formed `429 RESOURCE_EXHAUSTED` with `limit: 0` on every free-tier quota metric for that project. This is a genuine zero-quota project state, not a transient rate limit — the project needs a billing account attached (or a different quota tier) before any call will succeed. That's a Google Cloud Console action only you can take, same as the earlier "enable the API" step.
- Everything else about the integration (auth, model resolution, request/response contract) is now confirmed working against the live API; only the final "does a real image get graded" call remains unverified.

### Test-infrastructure note: flaky e2e teardown (partially fixed, not fully eliminated)
Bootstrapping the full app (`AppModule`) in multiple e2e spec files, run sequentially in one Jest process (`--runInBand`, required since Phase 4 — see below), occasionally produced `Unhandled error: Connection is closed` crashes attributed to whichever spec file happened to be running when a stray async error fired — sometimes a completely unrelated file with no BullMQ code of its own (e.g. `rls-isolation.e2e-spec.ts`), confirming this is cross-file bleed, not a bug local to one file.

Root cause: BullMQ's `Worker` keeps a dedicated blocking Redis connection (for its internal blocking read) that doesn't necessarily finish unblocking by the time `app.close()`'s promise resolves; the connection can throw an unhandled `'error'` event asynchronously afterward, once a different spec file's app has already started booting.

Fixed, in order of what actually helped:
1. `GeminiService`'s `fetchImpl: typeof fetch = fetch` constructor parameter (a default-value pattern used throughout this codebase for test injection) broke Nest's DI once it was provided through a real module — Nest tries to resolve every constructor parameter as a token regardless of default values. Fixed with `@Optional()`. This alone was the cause of an early, worse failure mode (a misleading `DriverPackageNotInstalledError: pg` that was actually an orphaned retry loop from a *different* provider's partial DI failure).
2. Passing BullMQ's Redis connection as a pre-built `IORedis` instance meant BullMQ wouldn't close it on shutdown (it only closes connections it created itself) — every e2e run hung indefinitely after finishing. Fixed by passing connection *options* instead (`queues/redis-connection.ts`), letting BullMQ own the connection lifecycle.
3. `AiModule` redundantly called `BullModule.registerQueue()` even though `@Processor`/`WorkerHost` doesn't need it (it builds its own `Worker` from the root connection config) — this created a second, entirely unused `Queue` producer with its own connection and no error listener. Removed.
4. Added explicit `'error'` listeners on both the `Worker` (`AiAnalysisProcessor.onError`) and the one `Queue` actually in use (`PartsService`'s constructor) — EventEmitters with zero listeners for `'error'` crash the process, not just log a line; this is correct production hygiene regardless of the test flake.
5. `--runInBand` added to `test:e2e` (was already needed independently — running e2e spec files in parallel Jest workers meant every file's `AiAnalysisProcessor` competed for jobs on the same real Redis queue, so a job enqueued by `parts.e2e-spec.ts` could get grabbed by a different file's worker with a non-mocked `GeminiService`).
6. `test/close-test-app.ts`: every e2e spec's `afterAll` now explicitly awaits `processor.worker.close()` (graceful, no force flag) before `app.close()`, giving BullMQ's own shutdown sequence a chance to settle that blocking connection inside the owning file's teardown window. **Tried `close(true)` (force) first — under some timing it produced a native access violation (Windows exit code 3221226505) instead of just failing a test, i.e. forcing the socket closed mid-blocking-read is a real crash risk, not just noise. Switched to graceful `close()`.**

Net effect: failure rate dropped from roughly 1-in-2 runs to roughly 1-in-8 runs across ~15 repeated full-suite runs while diagnosing this. The residual flake looks like Windows-specific ioredis/BullMQ socket-teardown timing under rapid sequential Nest app boot/teardown — a pattern that only exists in this multi-file e2e run, never in real operation (a production app boots once and runs continuously). Stopped chasing it further past this point; if it becomes a real CI problem, the next lever to pull is investigating BullMQ's own internals for the blocking connection (blocked this session by a permission restriction on reading `node_modules` source directly) or splitting e2e specs that need a full app boot from those that don't (`rls-isolation` and `ai-analysis` already don't).

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
