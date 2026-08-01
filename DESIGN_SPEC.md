# AI Salvage Yard Parts Intelligence Platform: Product Design Specification

## 1. Product Design Principles
The architectural and interface design of the AI Salvage Yard Parts Intelligence Platform is engineered to address the severe environmental and cognitive constraints of automotive dismantling facilities. The system operates as a bipartite architecture, bridging the hostile physical realities of the salvage yard with the data-rich requirements of digital marketplace syndication. 

### Core Philosophies:
- **Worker-First Ergonomics:** Optimized for outdoors, heavy mechanic's gloves, and grease/dirt. Oversized touch targets (min 48x48px, primary 64x64px), swipe gestures over precise taps, and high-contrast color palettes for direct sunlight.
- **Relentless Linearity:** The intake workflow is strictly linear to minimize cognitive load and maximize speed.
- **Offline-First Resilience:** Built for "Faraday cage" environments. Data capture, storage, and workflow progression must never block on a network request. All state is buffered in IndexedDB and synced via a background engine.
- **AI Transparency:** AI grading (based on ARA standards) is not a "black box." Confidence scores and visual mappings of damage codes are displayed to ensure QA managers can verify results with absolute confidence.

## 2. Application Architecture
The platform is distributed across two distinct presentation layers:

| Architecture Layer | Target Persona | Primary Environment | Core Technologies | Key Responsibilities |
| :--- | :--- | :--- | :--- | :--- |
| **Mobile PWA** | Field Worker / Dismantler | Salvage Yard, Offline, Outdoors | Next.js, IndexedDB, Workbox, ImageCapture API, Zustand | VIN capture, guided photo acquisition, offline queueing, edge validation. |
| **Desktop Dashboard** | QA Manager / Sales | Office, High-Speed Internet, Multi-Monitor | Next.js, React Query, Tailwind CSS, shadcn/ui | AI result verification, Hollander mapping, market pricing, eBay syndication. |

## 3. Complete Screen Inventory

### 3.1 Authentication Screen
- **Purpose:** Secure, persistent access for workers and managers.
- **Layout:** Centered single-column card.
- **Components:** BrandLogo, EmailInput, PinPasswordInput, PrimarySubmitButton.
- **Implementation:** Long-lived JWT cached in local storage for offline app launches.

### 3.2 Mobile: Home Screen
- **Purpose:** Operational hub for the shift.
- **Layout:** Mobile-first stacked; Top nav with sync status, massive "Start Intake" action zone.
- **Components:** TopNav (connectivity indicator), PrimaryActionCard, MetricGrid, SyncQueueWidget.
- **Note:** SyncQueueWidget must subscribe to Zustand store and `navigator.onLine` API.

### 3.3 Mobile: VIN Scanner Screen
- **Purpose:** Capture vehicle identity via barcode or OCR.
- **Layout:** Full-screen camera overlay with central targeting reticle.
- **Components:** CameraViewfinder, ScannerReticle, FlashToggle, ManualEntryFallbackButton.
- **AI:** Edge-based barcode/OCR detection.

### 3.4 Mobile: Vehicle Context Screen
- **Purpose:** Verify decoded vehicle data and capture baseline photos.
- **Layout:** Decoded details header $\rightarrow$ 4-angle image upload grid.
- **Components:** VehicleDetailHeader, RequiredPhotoGrid (Front, Rear, Left, Right), ProceedButton.
- **Note:** Record instantiated in IndexedDB immediately to prevent data loss.

### 3.5 Mobile: Part Selection Screen
- **Purpose:** Tag the specific component being inventoried.
- **Layout:** Pinned search input $\rightarrow$ 8-item "Quick Pick" grid $\rightarrow$ virtualized list.
- **Components:** SearchInput, QuickPickGrid, VirtualizedPartList.
- **Note:** Taxonomy must be precached in Service Worker for instant offline searching.

### 3.6 Mobile: Camera Capture & Guidance Screen
- **Purpose:** Acquire standardized photos for AI analysis.
- **Layout:** Full-screen viewfinder with "ghosted" structural overlays (silhouettes) guiding the shot.
- **Components:** CameraViewfinder, GhostOverlay, CaptureShutterButton, QualityWarningBanner.
- **AI:** Client-side blur detection via Laplacian variance on off-screen canvas.

### 3.7 Mobile: Sync Queue Manager Screen
- **Purpose:** Transparency and control over background synchronization.
- **Layout:** List view of pending, active, and completed upload jobs.
- **Components:** QueueStatusHeader, QueueItemCard (thumbnail, part name, progress bar).
- **Note:** Reads sequentially from IndexedDB.

### 3.8 Desktop: Global Dashboard Screen
- **Purpose:** High-level operational overview.
- **Layout:** Bento-box style grid.
- **Components:** SidebarNav, MetricCard (Intake Volume, Est. Value), TimeseriesChart, AlertFeed.
- **AI:** Displays aggregated AI accuracy metrics (Grade match rate vs Human QA).

### 3.9 Desktop: AI Review Queue Screen
- **Purpose:** Human-in-the-loop QA of AI-generated data.
- **Layout:** Split-pane. Left: High-res image viewer with bounding boxes. Right: Dense data form.
- **Components:** ImageViewerWithOverlay (pan/zoom), AIConfidenceMeter, ARACodeBuilder.
- **Note:** Keyboard-first navigation (Enter to approve, Space to expand, Arrows to navigate).

### 3.10 Desktop: Inventory Management Screen
- **Purpose:** Master database of approved inventory.
- **Layout:** Full-width virtualized table with sticky header.
- **Components:** VirtualizedDataTable, BulkActionToolbar, MarketplaceStatusBadge, FilterSidebar.
- **Note:** Uses `@tanstack/react-virtual` for 60fps scrolling on 10k+ parts.

### 3.11 Desktop: Vehicles Management Screen
- **Purpose:** Manage donor vehicle (hulk) lifecycles.
- **Layout:** List view with accordion drop-downs for stripped parts.
- **Components:** VehicleListTable, VehicleDetailPanel, CrushStatusToggle.

### 3.12 Desktop: Marketplace Syndication Screen
- **Purpose:** Map internal taxonomies to external marketplaces (eBay).
- **Layout:** Dual-pane (Internal data vs Marketplace preview).
- **Components:** ListingPreviewPane, FitmentDataMapper, MarketplaceSyncButton.
- **AI:** Auto-generation of SEO-optimized titles.

### 3.13 Desktop: Analytics Screen
- **Purpose:** BI reporting on bottlenecks and AI efficacy.
- **Layout:** Customizable chart grid.
- **Components:** DateRangePicker, BarChart (Sales by Category), PieChart (Damage Types).

### 3.14 Desktop: Users Screen
- **Purpose:** RBAC and team management.
- **Layout:** Simple list view with user creation modal.

### 3.15 Desktop: Settings Screen
- **Purpose:** Global configuration.
- **Layout:** Vertical navigation tabs.
- **Components:** IntegrationCard (API keys), ThresholdSlider (AI confidence).

## 4. Mobile Worker Application Details

### 4.1 Navigation Hierarchy
`Root` $\rightarrow$ `Tabs` (Home, Upload Queue, Notifications, Profile) $\rightarrow$ `Intake Flow Stack` (Scan VIN $\rightarrow$ Confirm Vehicle $\rightarrow$ Select Part $\rightarrow$ Camera Capture $\rightarrow$ Summary).

### 4.2 Workflows
- **Intake:** VIN scan $\rightarrow$ Draft record in IndexedDB $\rightarrow$ 4 Exterior photos $\rightarrow$ Loop [Select Part $\rightarrow$ Guided Photos $\rightarrow$ Save to IndexedDB].
- **Camera:** Custom viewfinder with ghosted outlines to enforce spatial consistency for AI.
- **Sync:** Zustand store manages UI representation $\rightarrow$ Polling `navigator.connection` $\rightarrow$ Chunked uploads upon stable connectivity.

## 5. AI Interaction Design (ARA Standards)
The system automates condition grading using **Automotive Recyclers Association (ARA)** protocols.

### 5.1 Grading Logic
**Damage Code:** `[Location (1-9/0)][Damage Type (Letter)][Size (Number)]`
- **Types:** D (Dent), S (Scratch), C (Crease), R (Rust), T (Paint).
- **Units:** Based on surface area of a standard credit card.

| Grade | Description | Max Damage Units | Example Code |
| :--- | :--- | :--- | :--- |
| **A** | Excellent / Near Perfect | $\le$ 1 Unit | 000 or 2S1 |
| **B** | Good / Moderate Wear | 1.1 to 2 Units | 5D2 |
| **C** | Fair / Heavy Wear | $> 2$ Units | 4C3 |

### 5.2 UI Presentation
AI results are presented as an augmentative layer:
- **Condition:** Grade B (Moderate Wear)
- **Confidence:** [ 92% ] (Green Bar)
- **Codes:** [ 2D1 ] (Loc 2, Dent, 1 Unit), [ 7S1 ] (Loc 7, Scratch, 1 Unit)

## 6. Camera Experience Design
- **Custom Viewfinder:** Bypasses standard file pickers. Uses `MediaStream` and `ImageCapture` APIs.
- **Environmental Controls:** Directly toggles `fillLightMode` for dark interiors.
- **Edge Validation:**
  - **Blur Detection:** Laplacian variance algorithm on hidden `<canvas>`.
  - **Lighting:** Pixel sampling for luminosity.
- **iOS Fallback:** Since Safari lacks `takePhoto()`, it falls back to `canvas.toDataURL('image/jpeg')` from the video stream.

## 7. Design System (Tailwind + shadcn/ui)
- **Framework:** shadcn/ui (Radix primitives) for accessibility and total DOM control.
- **Colors (High Contrast):**
  - Primary: `slate-900`
  - Action: `blue-600`
  - Success (Grade A / Synced): `emerald-600`
  - Warning (Grade B / Offline): `amber-500`
  - Error (Grade C / Failed): `red-600`
- **Typography:** Inter font family. Base 16px, Mobile Actions 18px (`text-lg`).
- **Touch Targets:** Minimum 48px (h-12), Primary 64px.

## 8. Frontend Implementation Requirements
- **Framework:** Next.js (App Router).
- **State:** Zustand (Global/Persistence) + TanStack React Query (Server State).
- **PWA:** `@ducanh2912/next-pwa` with Workbox. `StaleWhileRevalidate` and `CacheFirst` strategies.
- **Validation:** Gemini API `response_mime_type: "application/json"` validated via **Zod** schemas.

## 9. User Flows
- **Happy Path:** Login $\rightarrow$ Scan VIN $\rightarrow$ 4 Exterior Photos $\rightarrow$ Select Part $\rightarrow$ Guided Photos $\rightarrow$ Save $\rightarrow$ Background Sync $\rightarrow$ AI Processing $\rightarrow$ Manager Review $\rightarrow$ eBay Listing.
- **Offline Path:** 0 bars signal $\rightarrow$ Manual VIN Entry $\rightarrow$ Part Photos $\rightarrow$ Local IndexedDB Save $\rightarrow$ "1 Item Pending Sync" $\rightarrow$ WiFi Detection $\rightarrow$ Automatic Upload.

## 10. MVP Implementation Plan
- **Build First (Months 1-2):** PWA Setup, Mobile Intake Flow (VIN/Camera), Offline Queue (Zustand/IndexedDB), Basic Gemini integration, Desktop Review Skeleton.
- **Build Later (Months 3-4):** eBay Motors API, Hollander Interchange mapping, Laplacian Blur detection, Manager Analytics.
- **Post-MVP:** Custom YOLO/SAM models, Predictive Pricing, Vector Search.

## 11. AI Coding Instructions
**Strict Directives for Agents:**
1. **Mobile-First:** All components must default to mobile styling.
2. **State Completeness:** Every fetch must have `isLoading` (skeletons), `isError` (toasts), and `empty` states.
3. **Accessibility:** Semantic HTML mandatory; `aria-label` on icon buttons.
4. **Structure:** `src/app/(mobile)/...` and `src/app/(desktop)/...`.
5. **Types:** Strict TypeScript. No `any`.
6. **Gemini API:** Must use `response_mime_type: "application/json"` and Zod validation.
7. **No Custom Primitives:** Use shadcn/ui equivalents.
8. **No Redux/Context:** Use Zustand.
