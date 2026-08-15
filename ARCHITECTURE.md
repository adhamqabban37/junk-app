# Architecture: AI Salvage Yard Intelligence Platform

## 1. Frontend (Next.js PWA)
**Stack:** Next.js, React, Tailwind CSS, shadcn/ui, Zustand.
- **Worker Mobile App:** 
  - VIN scanning and camera-first interface.
  - **Offline Resilience:** IndexedDB for local storage $\rightarrow$ Background Sync API for asynchronous upload.
  - **UX:** Progressive image loading ("blur-up") to maintain responsiveness during large uploads.
- **Manager Dashboard:**
  - High-density UI for inventory management, AI review, analytics, and marketplace syndication.

## 2. Backend (NestJS Orchestration)
**Stack:** Node.js + TypeScript + NestJS.
- **Architecture:** Monolithic API (starting) with an event-driven core.
- **Async Processing:** BullMQ + Redis for managing Gemini API rate limits and long-running analysis jobs.
- **Core Modules:** Auth, Vehicles, Parts, AI Orchestration, Inventory, Marketplace.

## 3. Database (PostgreSQL)
**Stack:** PostgreSQL + pgvector + Row-Level Security (RLS).
- **Multi-tenancy:** `tenant_id` on every table, enforced via RLS at the kernel level.
- **Visual Intelligence:** pgvector is installed and an `embeddings` table exists, but **nothing writes to it** — similarity search is unimplemented (Phase 3). Do not read its presence as a feature.
- **Key Entities:** Tenants, Users, Vehicles, Images, Parts, AI Analysis, Human Corrections. Also present but **referenced by no application code**: Embeddings, Pricing History, Listings — modelled day one, still dormant.
- **Prediction vs. claim are separate rows (2026-08-12).** `AiAnalysis` is **append-only** and records what the model said. The human's answer lives on `Part.final_grade` / `final_damage_codes` / `final_confidence`. Every display surface resolves the two, per field, through `parts/effective-condition.ts` — nothing reads either in isolation.
- **Vehicle carries the yard's commercial facts:** `stock_number` (per-tenant series, issued at intake), `odometer_miles`, `acquisition_cost`, `acquisition_source`, `acquisition_date`, `location_code`. Odometer matters beyond reporting — mechanical parts are graded on mileage, which no photograph can supply.

## 4. AI System (The Evolutionary Path)
- **Stage 1 (MVP):** 
  - `Images` $\rightarrow$ `Gemini Vision` $\rightarrow$ `Structured JSON` $\rightarrow$ `Human Approval`.
- **Stage 2 (Scale):** 
  - `Images` $\rightarrow$ `YOLO detection` $\rightarrow$ `Segmentation` $\rightarrow$ `Gemini reasoning` $\rightarrow$ `Final Inventory`.
- **The Moat (The Feedback Loop):** 
  - Capture `[Image + AI Prediction + Human Correction]`.
  - Use this dataset to fine-tune custom models in Phase 3.

## 5. Automotive Data & Marketplace Strategy
- **VIN Decoding:** Start with **NHTSA (Free)** $\rightarrow$ Upgrade to **MarketCheck/DataOne**.
- **Interchange (revised 2026-08-12):** **In scope for Phase 1.** Car-Part.com's search is interchange-based, so publishing there without an interchange number produces listings buyers cannot find. Preferred source is **Car-Part Interchange, licensed via the recycler agreement**, rather than Hollander.
  - *This reverses the previous line, "Fitment: avoid Hollander early."* That position was correct while syndication was deferred; it is not compatible with a Phase 1 Car-Part.com target. It also resolves the long-standing contradiction with DESIGN_SPEC.md §10, which had listed Hollander Interchange mapping as a Month 3–4 item — in favour of **interchange now, via Car-Part rather than Hollander**.
- **Fitment beyond interchange:** still deferred. **AutoCare ACES** and OEM data remain Phase 2+. Interchange ≠ full fitment.
- **Marketplace Syndication:**
  - **Phase 1:** AI generates content $\rightarrow$ **Car-Part.com**. Generic CSV export retained as a fallback.
    - **Blocked on a business step, not an engineering one:** the upload format is released only after recycler registration + NDA. Do not build the exporter against an assumed format.
    - Boundary standards are **theirs, not ours**: ARA damage codes (location + type + repair-hours) and ARA grades A/B/C. Internal grades and free-text damage strings must be mapped at the export boundary.
  - **Phase 2:** Direct API integration with eBay (Trading API) and Shopify (GraphQL).

## 6. Out-of-Scope (Early Phase)
- NMVTIS automation.
- Full-scale Yard Management System (YMS) replacement.
- Custom AI model training/hosting.
- Complex pricing engines.
