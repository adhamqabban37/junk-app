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
- **Visual Intelligence:** pgvector for storing image/text embeddings to enable similarity searches.
- **Key Entities:** Tenants, Users, Vehicles, Images, Parts, AI Analysis, Embeddings, Pricing History, Listings.

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
- **Fitment:** Avoid Hollander early. Move toward **AutoCare ACES** and OEM data.
- **Marketplace Syndication:**
  - **MVP:** AI generates content $\rightarrow$ CSV Export.
  - **Scale:** Direct API integration with eBay (Trading API), Shopify (GraphQL), and Car-Part.

## 6. Out-of-Scope (Early Phase)
- NMVTIS automation.
- Full-scale Yard Management System (YMS) replacement.
- Custom AI model training/hosting.
- Complex pricing engines.
