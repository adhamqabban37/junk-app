# Project Guide: AI Salvage Yard Intelligence Platform

## Project Context
An AI-native "Sidecar Application" designed to eliminate manual data entry in salvage yard intake. It turns photos into inventory using a multimodal AI pipeline.

## Tech Stack
- **Frontend:** Next.js PWA (React, Tailwind, shadcn/ui, Zustand, IndexedDB, Background Sync).
- **Backend:** Node.js + TypeScript + NestJS (BullMQ, Redis).
- **Database:** PostgreSQL + pgvector + RLS.
- **AI:** Gemini 3.5 Flash / 3.1 Flash-Lite.
- **Data:** NHTSA VIN API (MVP) $\rightarrow$ MarketCheck/ACES (Later).

## Development Rules
1. **TDD First:** No production code without a failing test.
2. **Offline-First:** All yard-worker features must utilize IndexedDB and Background Sync.
3. **Strict Multi-tenancy:** Every database query must be scoped by `tenant_id` via PostgreSQL RLS.
4. **Non-Blocking AI:** All LLM calls must be handled by BullMQ workers.
5. **Human-in-the-Loop:** AI outputs are "suggestions" until approved by a human. In the bulk photo-scan flow the confirming human is the **worker on the phone** (they can see the vehicle); everywhere else it's the manager. Ambiguous or unrecognized detections are surfaced for a person to resolve — never auto-assigned, never silently dropped.
6. **The Moat:** Always log human corrections to AI predictions for future training data.
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
