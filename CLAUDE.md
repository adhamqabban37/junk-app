# Project Guide: AI Salvage Yard Intelligence Platform

## Project Context
An AI-native "Sidecar Application" designed to eliminate manual data entry in salvage yard intake. It turns photos into inventory using a multimodal AI pipeline.

## Tech Stack
- **Frontend:** Next.js PWA (React, Tailwind, shadcn/ui, Zustand, IndexedDB, Background Sync).
- **Backend:** Node.js + TypeScript + NestJS (BullMQ, Redis).
- **Database:** PostgreSQL + pgvector + RLS.
- **AI:** Gemini 3.5 Flash / 3.1 Flash-Lite.
- **Data:** NHTSA VIN API (MVP) $\rightarrow$ MarketCheck/ACES (Later).
- **Syndication:** **Car-Part.com is the Phase 1 publishing target** (moved up from Phase 2 on 2026-08-12). eBay/Shopify are Phase 2.

## Car-Part.com — read before touching export, grading, or damage codes
- **The upload spec is behind an NDA.** Recycler registration + NDA is what releases it. **Never write the exporter against a guessed format.**
- **Interchange numbers are required** — Car-Part's search matches on them, so a part without one is unfindable. Sourced from Car-Part Interchange, *not* Hollander. This reverses ARCHITECTURE.md §5's old "avoid Hollander early" line. Interchange is **not** full fitment; ACES/OEM stays deferred.
- **Their standards win at the export boundary:** ARA damage codes (location + type + repair-hours) and ARA grades **A/B/C**. Our internal rubric has a fourth grade, **D** — it must map at the boundary or be dropped. Free-text damage strings must map to ARA codes.
- **Price is now mandatory**, not the placeholder it has always been (`parts.service.ts:390`).
- Full reasoning: MEMORY.md 2026-08-12 entry; scope and open questions: `docs/PROGRESS.md` 2026-08-12 section.

## Development Rules
1. **TDD First:** No production code without a failing test.
2. **Offline-First:** All yard-worker features must utilize IndexedDB and Background Sync.
3. **Strict Multi-tenancy:** Every database query must be scoped by `tenant_id` via PostgreSQL RLS.
4. **Non-Blocking AI:** All LLM calls must be handled by BullMQ workers.
5. **Human-in-the-Loop:** AI outputs are "suggestions" until approved by a human. In the bulk photo-scan flow the confirming human is the **worker on the phone** (they can see the vehicle); everywhere else it's the manager. Ambiguous or unrecognized detections are surfaced for a person to resolve — never auto-assigned, never silently dropped.
6. **The Moat:** Always log human corrections to AI predictions for future training data. **`AiAnalysis` is append-only — never update a row there.** A human's answer goes on `Part.final*`; readers combine the two via `parts/effective-condition.ts`. Mutating an analysis corrupts the training context of every `HumanCorrection` joined to it.
6a. **Migrations that touch data on a tenant-scoped table must set tenant context per tenant.** `FORCE ROW LEVEL SECURITY` binds the table owner too, so a migration with no `app.tenant_id` sees an **empty table** and its `UPDATE` silently changes zero rows. Never `DISABLE ROW LEVEL SECURITY` to work around it. See `1786330000000-AddVehicleIdentityAndAcquisition.ts`.
6b. **Canonical inventory is never designed around a marketplace.** Internal grades, damage vocabulary and part naming stay ours; conversion to any external standard happens in an export adapter. This is what lets Car-Part.com integration wait for its actual spec.
7. **The Planning Gate:** Before any implementation phase begins, the la-plan must undergo a G-Stack Review Gauntlet (CEO, Engineering, Design, and DX reviews) to identify edge cases and product gaps.

## Project Structure
- `/frontend`: Next.js PWA. Route groups `(mobile)` = worker, `(desktop)` = manager. **Route groups do not namespace URLs** — `(mobile)/vehicles` and `(desktop)/vehicles` both resolve to `/vehicles` and fail the build. This has bitten the project twice.
- `/backend`: NestJS API & BullMQ Workers.
- `/docs`: BUILD_PLAN and PROGRESS (read `PROGRESS.md` first — it carries current state and next steps).
- Root: PRODUCT_SPEC, ARCHITECTURE, DESIGN_SPEC, MEMORY (decision log + lessons).

## Two grading paths — don't conflate them
- **Part-first** (offline-capable): worker names the part, photographs it, `analyzePartImage()` grades that one part via BullMQ after sync.
- **Photo-first / bulk scan** (needs a connection): worker uploads many photos, `POST /ai/detect-parts` identifies *and grades every part per photo*, worker confirms, grades are carried through sync and persisted directly. **These photos must not be re-graded** — the single-part prompt would stamp one grade onto every part in the image.

## Key Commands (Planned)
- `npm run dev:frontend`: Start Next.js dev server.
- `npm run dev:backend`: Start NestJS API.
- `npm run worker`: Start BullMQ processing workers.
- `npm test`: Execute test suite.
- `npm run migrate`: Apply database migrations.
