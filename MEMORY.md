# Project Memory: AI Salvage Yard Intelligence Platform

## Decision Log
- **Date: 2026-07-30 (Final Verdict)**
  - **Architecture:** Consolidated a hybrid approach from two research blueprints.
  - **Backend:** Settled on **NestJS + Node.js** for a unified TypeScript stack with strong event-driven capabilities (BullMQ).
  - **Frontend:** Committed to a **PWA with IndexedDB and Background Sync** to handle the hostile networking environments of salvage yards.
  - **Database:** Standardized on **PostgreSQL + pgvector + RLS** from day one to prevent migration pain.
  - **AI Strategy:** Defined a two-stage evolution: Pure Gemini (Phase 1) $\rightarrow$ Hybrid YOLO/Segmentation/Gemini (Phase 3).
  - **Data Strategy:** Minimalist start with **NHTSA (Free)** and **CSV Exports** to minimize early costs and dependencies.
  - **The Moat:** Explicitly decided to capture all `[AI Prediction $\rightarrow$ Human Correction]` pairs to build a proprietary salvage-yard dataset.
  - **Scoping:** Intentionally excluded NMVTIS and Full YMS replacement from the MVP to focus on the "Photos to Inventory" thesis.

## Pitfalls & Lessons
*(Empty - New Project)*

## Current Status
- Final Verdict integrated.
- All foundational documents (`PRODUCT_SPEC`, `ARCHITECTURE`, `CLAUDE`, `MEMORY`) updated to reflect the final combined architecture.
- Project is now ready for technical implementation of Phase 1.
