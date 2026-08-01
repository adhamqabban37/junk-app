<!-- /autoplan restore point: /c/Users/Tyson/.gstack/projects/adhamqabban37-junk-app/main-autoplan-restore-20260731-220459.md -->
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
- Minimal README with a single documented path from clone to running app (docker-compose up → migrate → seed → dev servers) — a new engineer should not need tribal knowledge to get running
- Files: root configs, `frontend/`, `backend/`, `docker-compose.yml`, `README.md`
- **Acceptance:** `npm run dev:frontend` and `npm run dev:backend` boot; `npm test` runs in both workspaces; `docker-compose up` brings up reachable Postgres+Redis; README's documented setup sequence works end to end on a clean checkout.

### Phase 1 — Data Layer
- TypeORM entities + migrations for all 11 entities above
- RLS policies per table (tenant_id enforced at kernel level)
- pgvector extension enabled
- Seed script for PartTaxonomy, plus one demo tenant + one worker (PIN) + one manager (email/password) for local dev (`npm run seed:dev`) — a new engineer needs a login to exercise the intake flow without hand-crafting rows
- Tests first: creating a Part without tenant scope throws; RLS blocks cross-tenant read, write, and update paths separately (policies can differ per operation)
- Files: `backend/src/database`, `backend/src/**/*.entity.ts`, `backend/migrations/`
- **Acceptance:** migrations apply cleanly to local Postgres; RLS cross-tenant isolation test passes for SELECT/INSERT/UPDATE; taxonomy + dev seed present.

### Phase 2 — Auth & Multi-tenancy
- PIN-based login (Worker), email+password (Manager/Owner)
- Long-lived JWT cached client-side for offline PWA launch
- RBAC guard (worker/manager/owner)
- Tenant context middleware setting Postgres RLS session var (`SET app.tenant_id`) per request/transaction — **must verify the session var is reset between requests when using a pooled connection** (TypeORM's default pool can hand a connection from tenant A's request to tenant B's next request; a stale `app.tenant_id` is a cross-tenant data leak, not just a bug)
- Tests first: unauthorized access denied; RLS session var scopes queries; role guard blocks wrong-role routes; **two rapid requests from different tenants on the same pooled connection do not leak data**
- Files: `backend/src/auth`
- **Acceptance:** auth e2e tests cover login (both mechanisms), token validity offline, RBAC denial, RLS isolation across 2 seeded tenants under concurrent/pooled load.

### Phase 3 — Mobile Intake Flow
- Auth screen (§3.1), Home screen w/ sync status (§3.2), VIN Scanner + manual fallback (§3.3), Vehicle Context + NHTSA decode + IndexedDB draft (§3.4), Part Selection w/ precached taxonomy (§3.5), Camera Capture + ghost overlays + blur/lighting edge validation (§3.6), Sync Queue Manager screen (§3.7)
- Zustand store + IndexedDB persistence + Background Sync API registration
- Client-generated UUID per draft record, checked server-side before insert — protects against duplicate records if the app is closed/reopened mid-sync
- Empty states: Home screen with 0 pending items, Sync Queue with nothing queued (CLAUDE.md rule: every fetch needs loading/error/empty)
- Tests first: Zod schema validation for VIN decode response; IndexedDB draft persistence; offline queue reducer logic; blur-detection unit test with fixture images; duplicate-draft dedup on re-sync
- Files: `frontend/src/app/(mobile)/...`, `frontend/src/store`, `frontend/src/lib/offline`
- **Acceptance:** full offline happy path in a browser with network disabled — VIN scan (manual fallback) → 4 exterior photos → part + guided photos saved locally → queue shows pending → reconnect triggers sync. Manual-VIN-entry fallback path is explicitly exercised, not just the happy-path VIN scan.

### Phase 4 — AI Orchestration Pipeline
- BullMQ queue + Redis wiring for image analysis jobs (non-blocking, CLAUDE.md rule 4)
- Queue concurrency capped to Gemini's actual rate limit (not yet specified by Google for the exact plan tier — set a conservative default, make it configurable)
- Gemini Vision integration, `response_mime_type: application/json`, Zod validation of response
- Idempotency key on AIAnalysis (`part_image_id` + `model_version`) — BullMQ job retries on transient failure must not create duplicate AIAnalysis rows for the same image
- Graceful degradation: if Gemini is down/rate-limited past the retry budget, the Part status moves to "needs manual grading" rather than silently stalling — a yard worker's shift must never block on AI availability (CLAUDE.md: AI outputs are suggestions, not gates)
- AIAnalysis + HumanCorrection persistence (the Moat, CLAUDE.md rule 6)
- Tests first: worker processes queued job → writes AIAnalysis; retrying the same job does not duplicate the AIAnalysis row; malformed Gemini response rejected by Zod, not silently stored; exhausted retries flip Part to manual-grading state; correction diff correctly recorded
- Files: `backend/src/ai`, `backend/src/queues`
- **Acceptance:** uploading a part image enqueues a job; worker produces AIAnalysis with grade/confidence/damage codes; simulated bad AI JSON is caught, not stored; simulated Gemini outage results in a manually-gradable Part, not a stuck job.

### Phase 5 — Desktop Manager Dashboard
- Global Dashboard (§3.8), AI Review Queue w/ keyboard nav + correction capture (§3.9), Inventory Management virtualized table (§3.10), Vehicles Management (§3.11), Marketplace Syndication — CSV export only for MVP (§3.12), Analytics (§3.13), Users/RBAC (§3.14), Settings (§3.15)
- AI Review Queue: low-confidence AIAnalysis (below the configurable threshold from Settings §3.15) renders a visibly distinct "needs review" state, not the same UI treatment as high-confidence auto-suggestions — confidence score should change what the manager sees, not just be a number on screen
- Tests first: review-queue approve/reject writes HumanCorrection; low-confidence vs high-confidence results render distinctly; virtualized table renders 10k+ rows at a defined frame-time budget (measured via Playwright trace, not just "feels fast"); RBAC-gated routes
- Files: `frontend/src/app/(desktop)/...`
- **Acceptance:** manager reviews an AI-flagged part, corrects a field, approves it, sees it in Inventory, exports a CSV containing it. Low-confidence items are visually distinguishable in the queue.

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

---

## GSTACK REVIEW REPORT

**Mode:** Condensed single-reviewer pass (Claude), not the full dual-voice `/autoplan` pipeline.
**Why condensed:** Codex CLI is not installed in this environment, so the dual-voice (Claude + Codex) consensus tables the full pipeline produces aren't available — running one voice and presenting it as "consensus" would be fabricated data, so this report is honestly scoped as single-reviewer. This is also a pre-code planning review (5 spec docs, no diff), so the git-archaeology-heavy parts of the full pipeline (diff stats, commit history mining) don't apply — reviewed `docs/BUILD_PLAN.md` directly instead.
**Scope detected:** UI scope = yes (screens, dashboard, forms). DX scope = yes (API integrations, CLI dev commands, npm workflows) — treated as *engineer* DX (onboarding this codebase), since the product itself is an operational SaaS tool, not a developer tool.

### CEO / Strategy
- **Premises accepted.** "Eliminate manual data entry via photo → AI → inventory" is a coherent, well-scoped thesis; MVP correctly excludes eBay/Shopify/Hollander/NMVTIS (ARCHITECTURE.md §6). Not challenged.
- **Finding (medium): no AI-outage fallback was specified.** If Gemini is down or rate-limited mid-shift, the original plan had no defined behavior — risks blocking a yard worker's entire shift on a third-party API. Fixed: Phase 4 now requires jobs to degrade to a "needs manual grading" Part status after exhausted retries, never a silent stall.
- **Finding (medium): BullMQ retries could double-write AIAnalysis.** Job retries on transient failure (network blip, Gemini 500) with no idempotency key would create duplicate analysis rows for the same image. Fixed: Phase 4 now requires an idempotency key (`part_image_id` + `model_version`).
- **What already exists / leverage:** None — greenfield project, nothing to reuse.
- **Not in scope (correctly deferred):** eBay/Shopify/Car-Part direct integration, ACES fitment, NMVTIS, custom YOLO/SAM models, predictive pricing — all explicitly Phase 2/3 per PRODUCT_SPEC.md roadmap and ARCHITECTURE.md §6.

### Design
- **Finding (medium): AI confidence score had no UI consequence.** DESIGN_SPEC §5.2 shows confidence as a number/bar but didn't specify that low-confidence results should look different from high-confidence ones in the AI Review Queue. A manager scanning 50 items needs the UI to do the triage, not just display a number. Fixed: Phase 5 now requires a visually distinct "needs review" state below the confidence threshold.
- **Finding (low): missing empty states named explicitly.** CLAUDE.md's own AI-coding rule requires loading/error/empty states everywhere, but Phase 7 only had "audit" as a catch-all with no named instances. Fixed: Phase 3 now names the two most consequential empty states (Home with 0 pending, Sync Queue empty) explicitly rather than leaving them to a late audit.
- **Finding (low): offline path under-tested.** Phase 3's acceptance criteria only exercised the VIN-scan happy path offline; the manual-entry fallback (the actual offline path per DESIGN_SPEC §9) wasn't separately required. Fixed.

### Engineering
- **Finding (high): TypeORM connection pooling + RLS session variables is a real cross-tenant leak risk.** `SET app.tenant_id` on a pooled Postgres connection persists for the life of that connection, not the request. If TypeORM hands a pooled connection from Tenant A's request to Tenant B's next request without resetting the session var, Tenant B's query runs under Tenant A's RLS context — a silent cross-tenant data leak, not just a bug. This is the single highest-severity gap found. Fixed: Phase 2 now explicitly calls this out with a required test (two rapid requests from different tenants on the same pooled connection must not leak data).
- **Finding (medium): RLS test coverage was under-specified.** "RLS cross-tenant isolation test passes" (singular) doesn't guarantee INSERT/UPDATE policies are tested, only SELECT. Fixed: Phase 1 now requires isolation tests across SELECT/INSERT/UPDATE.
- **Finding (low): no dedup key for offline draft records.** If the PWA is killed and relaunched mid-sync, the same local draft could be re-queued and inserted twice server-side. Fixed: Phase 3 now requires a client-generated UUID checked server-side before insert.
- **Finding (low): virtualized table performance target had no measurement method.** "10k+ parts, 60fps" (DESIGN_SPEC §3.10) is untestable as written. Fixed: Phase 5 now requires a Playwright-traced frame-time budget instead of a vibe check.
- **Architecture:** monolithic NestJS API + BullMQ workers + Postgres/RLS/pgvector is appropriately simple for a Phase 1 MVP; no premature microservices, no premature custom ML — consistent with MEMORY.md's decision log and DESIGN_SPEC.md §11's "no custom primitives" ethos.

### DX (engineer onboarding, not end-user)
- **Finding (low): no documented path from clone to running app.** Phase 0's acceptance only checked that dev servers boot, not that a new engineer could get there without tribal knowledge. Fixed: Phase 0 now requires a README with one documented setup sequence, verified end-to-end on a clean checkout.
- **Finding (low): no dev seed data.** A new engineer couldn't exercise the intake flow without hand-creating a tenant, worker PIN user, and manager account first. Fixed: Phase 1 now includes a `npm run seed:dev` producing one of each.

### Decision Audit Trail

| # | Phase | Decision | Classification | Rationale |
|---|-------|----------|-----------------|-----------|
| 1 | CEO | Add AI-outage graceful degradation to Phase 4 | Mechanical | CLAUDE.md rule 5 (human-in-loop, AI is a suggestion) implies the system must function when AI doesn't |
| 2 | CEO | Add idempotency key to AIAnalysis | Mechanical | BullMQ retries are a stated architecture choice (ARCHITECTURE.md §2); retries without idempotency are a known correctness bug class |
| 3 | Design | Distinct low-confidence UI state | Mechanical | DESIGN_SPEC §5.2 already establishes confidence as a first-class signal; not surfacing it in the UI wastes the signal |
| 4 | Design | Name explicit empty states in Phase 3 | Mechanical | CLAUDE.md's own AI-coding directive #2 requires this; moved from a late audit to a build-time requirement |
| 5 | Eng | RLS + pooled-connection leak test | Mechanical | Direct consequence of choosing TypeORM + connection pooling with session-variable-based RLS; not optional |
| 6 | Eng | RLS test coverage across SELECT/INSERT/UPDATE | Mechanical | "Isolation test passes" was ambiguous; RLS policies commonly differ per operation |
| 7 | Eng | Client UUID dedup for offline drafts | Mechanical | Direct consequence of the offline-first architecture (ARCHITECTURE.md §1); app-kill-mid-sync is a realistic yard-worker scenario |
| 8 | Eng | Explicit perf measurement method for virtualized table | Mechanical | "60fps" without a measurement method is not a testable acceptance criterion |
| 9 | DX | README + verified setup path | Mechanical | Phase 0 acceptance previously didn't test onboarding, only that servers boot with implicit local state |
| 10 | DX | Dev seed script | Mechanical | Needed to exercise Phase 3's intake flow locally without manual DB surgery |

No taste decisions or user challenges — every finding traced to an existing spec requirement or a well-established correctness/architecture pattern, so all were auto-applied rather than deferred to you. Nothing was deferred to TODOS.md.

### Completion Summary
- **CEO:** 2 findings (both medium), premises accepted, scope confirmed correct.
- **Design:** 3 findings (1 medium, 2 low).
- **Eng:** 4 findings (1 high — RLS/pooling — 2 medium/low, 1 architecture confirmation).
- **DX:** 2 findings (both low).
- **Total:** 11 findings, all fixed directly in the phase breakdown above. 0 deferred, 0 rejected.
- **Highest-severity item:** RLS session-variable leak risk under TypeORM connection pooling (Phase 2) — worth double-checking again once the auth middleware is actually implemented, since this class of bug is easy to reintroduce silently (e.g., a future refactor that switches pooling strategy).
