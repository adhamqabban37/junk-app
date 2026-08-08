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

- **Date: 2026-08-06 (Bulk photo scan / AI multi-part detection)**
  - **Flow direction:** Added a **photo-first** path alongside the existing **part-first** one, rather than replacing it. Part-first works offline; photo-first cannot, because detection needs the server.
  - **Detection is stateless.** `POST /ai/detect-parts` writes nothing to the database. During intake the vehicle exists only as an IndexedDB draft, so there is no `Vehicle`/`Part` row to attach to. Confirmed detections enter the draft client-side and reach the DB through the existing `POST /vehicles/intake`, leaving the whole sync + review path unchanged.
  - **Human-in-the-loop placement:** the **worker confirms on the phone**, not the manager at the desk — they are standing at the vehicle and can look at it. (Supersedes an earlier note in PROGRESS.md that assumed manager-side confirmation.)
  - **Ambiguity is surfaced, never guessed.** A detection whose side is unknown offers its candidates; one whose side contradicts every candidate is reported unmapped. Rationale: a wrong part number in inventory is worse than an unresolved one.
  - **Unmapped detections are kept, not dropped.** A dropped detection is invisible to the worker — they'd never know the AI saw it.
  - **Per-photo grades, carried through sync.** `PartDraft.detections[]` is keyed by photo, not by part, and the server persists these instead of re-grading. Re-running the single-part prompt on a multi-part scene photo would stamp one arbitrary grade onto every part in it.
  - **LHD assumption** baked into the taxonomy matcher (`driver`=left, `passenger`=right), because the taxonomy itself mixes conventions (`Door (Driver Front)` vs `Fender (Left)`). Wrong for RHD markets — making it configurable is a real change, not a tweak.

- **Date: 2026-08-08 (Manager-side "add photos to an existing vehicle")**
  - **Re-grading is a side effect of uploading, not a separate action.** `POST /parts/:partId/images` enqueues an AI job and a successful grade forces `Part.status = PENDING_REVIEW`. There is no re-grade endpoint and none was added. Consequence worth remembering: **adding a photo to an already-approved part pulls it back into the Review Queue** — intended, and surfaced in the UI rather than left as a surprise.
  - **Manager and worker got separate screens** (`(desktop)/vehicles/[vehicleId]` vs `(mobile)/previous-vehicles/[vehicleId]`) despite calling the same three endpoints, because they answer different questions: re-shoot-this-part at the car vs which-parts-are-stuck at a desk. Only the manager screen has the missing-photos summary.
  - **No new backend endpoints or role changes.** Every route needed was already open to any authenticated role; verified against the live API (manager token → 400 for a missing file, not 403) instead of trusting the guards by reading them.

- **Date: 2026-08-08 (VIN-driven scan on the manager screen)**
  - **The VIN drives the expected parts list, and it is a heuristic — say so.** `Vehicle.decodedRaw` already stores all 140 NHTSA variables; `Body Class` + `Doors` are enough to derive which exterior panels exist. This is **not** fitment data (that's ACES/Hollander, licensed, out of scope). Anything the decode can't determine is left OUT of the expected list, never guessed — a checklist naming parts the vehicle never had can never be completed.
  - **The roster is fed to Gemini, not just used after it.** Pinning the model's vocabulary to the taxonomy's own wording took the live run from "rear doors/grille/windshield unmappable" to **0 unresolved out of 38 detections**. Constraining the matcher to the roster additionally makes a coupe incapable of producing a "rear door".
  - **Automatic filing, with the human gate moved rather than removed.** The user chose no per-detection confirmation. Parts land `pending_review`; approval before export is the gate. Confidence below the tenant threshold files the part and photo but writes **no grade** (`needs_manual_grading`); ambiguous/unmapped create **no Part at all** and are returned for a person.
  - **A poor photo must still produce parts.** The scene prompt now reports `image_quality` and is told explicitly that low clarity is not a reason to return nothing. The field is optional in the schema so a model omitting it can't fail the whole response.

## Pitfalls & Lessons
- **Shared reference data doesn't cascade.** `part_taxonomies` has no RLS and no FK from `Tenant`, so an e2e suite deleting its tenant does **not** reclaim taxonomy rows it created. Two suites leaked 16 rows into the dev DB this way over ~12 runs and polluted every worker's real part picker. Any test creating a `PartTaxonomy` must delete it explicitly.
- **Don't trust a diagnosis in the backlog without re-deriving it.** The duplicate-taxonomy item blamed `seed:taxonomy` having no upsert guard. It has had one since day one. The real cause was elsewhere entirely, and the "obvious" fix would have changed nothing.
- **Windows will answer requests to a disconnected adapter's stale IP.** A local `curl` against `192.168.1.193` succeeded while that Wi-Fi adapter was `Disconnected` — so "I tested it locally and it works" is *not* evidence a phone can reach it. Confirm with `Get-NetAdapter`.
- **`getUserMedia` needs a secure context.** Any LAN testing over plain `http://` will never have camera access, no matter the device. File inputs are unaffected.
- **Live runs find what tests don't.** Every session so far has had this shape: the suites go green, then the first real use finds real bugs (2026-08-02 found two, 2026-08-06 found two more in the first live detection call). Treat "tests pass" as necessary, not sufficient.
- **One symptom can be two bugs, and that's why it looks unfixable.** The e2e "flake" was a test-level BullMQ teardown race *and* a native `0xC0000409` crash at similar rates. Fixing either alone still left the suite red ~1 run in 3, so every prior fix attempt looked like it had failed. **Measure the failure rate before and after (30 runs, not 1)** — a single clean run proves nothing, and a still-failing run doesn't prove your fix was wrong.
- **Check whether a "cross-file" flake reproduces in one file alone.** The BullMQ race was described as a cross-file teardown race in every doc and code comment for months; `app.e2e-spec.ts` reproduced it running by itself, 2 runs in 3. The wrong framing is what stopped anyone trying the cheap experiment. Its real cause: BullMQ's `RedisConnection` constructor emits `'error'` when the in-flight `init()` rejects, while `close()` has already called `removeAllListeners()`. Await `connection.client` (the `initializing` promise) before closing.
- **Registering `process.on('uncaughtException')` does not stop Jest failing the test.** Node invokes *every* listener, so Jest's own handler still records the error against whatever test is running. Such a handler suppresses only Node's crash-the-process default — it is not a way to swallow a teardown error.
- **The taxonomy leak has a structural cause, not a per-suite one.** Every e2e suite deletes its tenant *then* its taxonomy row, so **any** throw in the tenant delete skips taxonomy cleanup — and the native `0xC0000409` crash kills Jest mid-run, skipping `afterAll` entirely. That is why leaked rows keep reappearing after being "fixed" twice. Delete taxonomy **before** tenants (safe once the suite's vehicles are gone), and find-or-create rather than blindly creating: CI runs migrations *without* `seed:taxonomy`, so a suite needing seeded rows must make its own and delete only what it made.
- **A verified-clean `tsc` goes stale.** `vehicles-intake.e2e-spec.ts` had a type error while all 77 e2e tests passed (an `await` on a sync predicate is fine at runtime). Green tests are not evidence the typecheck is green.

## Current Status
- All 7 BUILD_PLAN phases complete; core pipeline live-verified end to end.
- **AI multi-part scene detection built and live-verified** (2026-08-06) — the last roadmap item. Its **UI has not yet been used in a real browser**.
- Nothing pushed; commits sit on `feat/intake-endpoint-and-inventory-editing`.
- **Backend e2e is still not reliable** (2026-08-08): the test-level BullMQ teardown race is fixed, but a native `0xC0000409` crash remains at ~1 run in 3. CI keeps `continue-on-error` for that reason.
- See `docs/PROGRESS.md` → "Start here next session" for the current ordered next steps.
