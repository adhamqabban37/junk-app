# Project: AI Salvage Yard Intelligence Platform

## Vision
An AI-native "Sidecar Application" that eliminates manual data entry in the automotive salvage industry. The platform converts raw vehicle photos into structured inventory via a mobile-first PWA and a high-intelligence AI pipeline, eventually evolving into the comprehensive "AI Operating System" for salvage yard operations.

## Core Value Propositions
- **Instant Inventory:** Turn a guided mobile photo walkaround into a fully described, graded inventory list.
- **The Data Moat:** A proprietary dataset built from human-corrected AI predictions, creating a competitive advantage in automotive part identification.
- **Revenue Acceleration:** Rapidly move parts from the yard to the marketplace (eBay, Shopify, Car-Part).

## The Final Combined Roadmap

### Phase 1: "Turn Photos into Inventory" (0–4 Months)
**Goal: Prove the thesis that AI can eliminate manual data entry.**
- **Core Build:** Next.js PWA + NestJS + Postgres + Gemini + NHTSA VIN API.
- **Workflow:** VIN Scan $\rightarrow$ Photo Capture $\rightarrow$ Gemini Vision $\rightarrow$ JSON $\rightarrow$ Human Review $\rightarrow$ Inventory.
- **Output:** AI-generated titles, descriptions, and condition grades exported via CSV.

### Phase 2: "Turn Inventory into Revenue" (4–12 Months)
**Goal: Automate the path from identified part to sold item.**
- **Marketplace Sync:** Direct integration with eBay, Shopify, and Car-Part.
- **Fitment & Pricing:** Integration of ACES, MarketCheck/DataOne, and dynamic pricing suggestions based on sold listings.
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
