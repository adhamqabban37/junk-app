# Project: AI Salvage Yard Intelligence Platform

## Vision
An AI-native "Sidecar Application" that eliminates manual data entry in the automotive salvage industry. The platform converts raw vehicle photos into structured inventory via a mobile-first PWA and a high-intelligence AI pipeline, eventually evolving into the comprehensive "AI Operating System" for salvage yard operations.

## Core Value Propositions
- **Instant Inventory:** Turn a guided mobile photo walkaround into a fully described, graded inventory list.
- **The Data Moat:** A proprietary dataset built from human-corrected AI predictions, creating a competitive advantage in automotive part identification.
- **Revenue Acceleration:** Rapidly move parts from the yard onto **Car-Part.com** — where salvage buyers actually search for recycled OEM parts — and later onto eBay and Shopify.

## The Final Combined Roadmap

### Phase 1: "Turn Photos into Listings on Car-Part.com" (0–4 Months)
**Goal: Prove the thesis that AI can eliminate manual data entry — and land the result where buyers are.**
- **Core Build:** Next.js PWA + NestJS + Postgres + Gemini + NHTSA VIN API.
- **Workflow:** VIN Scan $\rightarrow$ Photo Capture $\rightarrow$ Gemini Vision $\rightarrow$ JSON $\rightarrow$ Human Review $\rightarrow$ Inventory $\rightarrow$ **Car-Part.com**.
- **Output:** AI-generated titles, descriptions, and condition grades, published to Car-Part.com. Generic CSV export is retained as a fallback.
- **Car-Part.com prerequisites** (see MEMORY.md 2026-08-12 for the reasoning):
  - **Recycler registration + NDA with Car-Part.com.** The upload spec is only released after this, so it gates the exporter and nothing else can substitute for it.
  - **Interchange numbers per part** — Car-Part's search is interchange-based. Preferred path is licensing **Car-Part Interchange** via the recycler agreement rather than Hollander. This supersedes ARCHITECTURE.md §5's earlier "avoid Hollander early, defer fitment" stance.
  - **ARA damage codes** (structured location + type + repair-hours) replacing today's free-text damage strings.
  - **ARA grades A/B/C** — reconcile against our internal four-grade A/B/C/D rubric.
  - **Real prices.** Today's CSV `price` column is a hardcoded empty placeholder.

### Phase 2: "Turn Inventory into Revenue" (4–12 Months)
**Goal: Automate the path from identified part to sold item, and widen distribution.**
- **Marketplace Sync:** Direct integration with eBay and Shopify. (Car-Part.com moved to Phase 1.)
- **Fitment & Pricing:** ACES/OEM fitment beyond interchange, MarketCheck/DataOne, and dynamic pricing suggestions based on sold listings.
- **Car-Part Pro certification** — opens repairer/insurer demand, and carries warranty and return obligations (1-year warranty option on non-"AS-IS" parts, 30-day minimum warranty, 30-day refund period).
- **Analytics:** basic inventory turnover and revenue tracking.

### Phase 3: "Become the AI Operating System" (12+ Months)
**Goal: Maximize accuracy and scale margins via custom AI.**
- **Hybrid Vision:** Transition to YOLO detection $\rightarrow$ Segmentation $\rightarrow$ Gemini reasoning.
- **Custom Models:** Deploy proprietary models trained on the "human-correction" dataset.
- **Intelligence:** Cross-yard intelligence and predictive pricing algorithms.

## Target User Personas
- **Yard Worker:** Using a camera-first PWA with offline resilience to log parts.
- **Office Manager:** Reviewing AI outputs and pushing listings to marketplaces.
- **Yard Owner:** Scaling operations and increasing margins through AI automation.
