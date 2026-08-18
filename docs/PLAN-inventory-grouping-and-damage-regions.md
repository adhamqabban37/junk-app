# Plan: Grouped inventory, photo grid, and AI damage regions

Status: **awaiting Planning Gate (CLAUDE.md rule 7)** — not yet implemented.
Created 2026-08-15.

## What was asked

Three things, in the manager Inventory / dashboard:

1. Parts organised into sections by family, so the four doors sit under a
   **Doors** heading rather than scattered through a flat list. Applies to
   every part that comes in multiples.
2. A **photo grid** beside the grouped list.
3. The AI should **label where on the photo it sees damage** — scratches and
   the rest — against our existing grading rubric.

## Decisions already taken

| Question | Decision |
|---|---|
| What the grid is | Photo grid of the selected group's parts; clicking a thumbnail opens the annotated damage view |
| Naming | Display **Front/Rear + Left/Right**. Storage, `TaxonomyMatcher`, and the export boundary stay exactly as they are — translation happens in the display layer only |
| Existing photos | **Backfill everything** via a queued job |

## What is actually in the code today

Facts this plan is built on, all verified:

- `PartTaxonomy` (`part-taxonomy.entity.ts`) has `name`, `category`,
  `isQuickPick`. Position is baked into the *name string* —
  `Door (Driver Front)`, `Fender (Left)`. There is **no** family or position
  column to group on.
- `category` is coarse — `Body` holds doors, fenders, bumpers, quarter
  panels, rocker panels, grille, hood, trunk, liftgate, mirrors. Grouping on
  `category` alone would produce one enormous "Body" section and would not
  satisfy the ask.
- `AiAnalysis.damageCodes` is `string[]` — flat tags (`"scratch"`,
  `"dent"`). Nothing spatial exists anywhere.
- `AiAnalysis` is **append-only** (CLAUDE.md rule 6) with
  `@Index(['partImageId', 'modelVersion'], { unique: true })`.
- `PartListItem` already returns `photoIds: string[]`, so the photo grid
  needs **no new list endpoint**.
- `GRADING_RUBRIC` (`ai/gemini.service.ts:76`) is the single source of truth
  for A/B/C/D and already enumerates the defect vocabulary the boxes must
  use.
- Postgres is **16.14**, so `NULLS NOT DISTINCT` is available.

## The one real blocker, and its fix

Backfilling boxes onto an already-analyzed photo cannot update the existing
row — rule 6 forbids it, because `human_corrections` joins back to that row
for its training context. So the backfill must **insert** a new row.

But the unique key is `(part_image_id, model_version)`. Re-analyzing the same
image on the same Gemini model collides, even though the prompt is materially
different.

**Fix:** widen the index to
`(part_image_id, model_version, prompt_version) NULLS NOT DISTINCT`.

This is not a workaround bolted on for convenience — it is what the entity's
own comment already argues for:

> Two rows sharing a model_version can still come from materially different
> instructions — the grading rubric has already been rewritten once — so the
> model name alone is not enough provenance to train on.

`NULLS NOT DISTINCT` is load-bearing. `prompt_version` is nullable, and under
default Postgres semantics two NULLs are distinct — so a plain three-column
index would **silently stop deduping every pre-existing row** and let retried
jobs write duplicates. That is a regression in the idempotency guarantee the
index exists to provide.

Migration is index-only (no data touched), so rule 6a's per-tenant context
requirement does not apply to it. The backfill itself is a **BullMQ job, not
a migration**, which keeps rule 6a satisfied, keeps the Gemini spend
resumable and rate-limited, and keeps a long-running write out of a
migration transaction.

## Design

### 1. Family + position, derived not migrated

A pure function, `parsePartName(name)`, maps a stored taxonomy name to a
display family and position:

```
Door (Driver Front)   -> { family: "Doors",   position: "Front Left"  }
Door (Passenger Rear) -> { family: "Doors",   position: "Rear Right"  }
Fender (Left)         -> { family: "Fenders", position: "Left"        }
Alternator            -> { family: "Alternator", position: null       }
```

Rules:

- Driver -> Left, Passenger -> Right. **Left-hand-drive assumption**, stated
  explicitly in the code, since it is false in RHD markets and will need a
  tenant setting if the product ever ships there.
- A family renders as a section **only when the yard actually holds more
  than one position in it**. A vehicle with one door does not get a "Doors"
  header — that is the "parts that are in multiples" instruction taken
  literally.
- An unparseable name degrades to `{ family: name, position: null }` and
  renders flat. It is never dropped and never guessed at — the project's
  standing rule for ambiguity.

Pure input -> output with no I/O, so it is tested first and exhaustively
against every one of the 35 seeded taxonomy names.

### 2. Layout

Grouped tree on the left, photo grid on the right, both driven by the
existing `listParts` payload. Selecting a group or a part filters the grid;
clicking a thumbnail opens the damage view.

The current flat list is virtualized (`useVirtualizer`, `PAGE_SIZE` 1000)
because a yard's inventory is large. **Grouping must not quietly discard
that** — the tree virtualizes over a flattened `[header, row, row, header…]`
array rather than nesting scroll containers.

### 3. Damage regions

New Zod schema alongside the existing ones in `gemini-response.schema.ts`:

```ts
GeminiDamageRegionSchema = z.object({
  damage_code: z.string().min(1),      // reuses the existing tag vocabulary
  box: z.object({                       // normalized 0..1, resolution-independent
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }),
  confidence: z.number().min(0).max(1),
  note: z.string().optional(),
})
```

Normalized coordinates, not pixels: thumbnails, the detail view, and any
future export all scale from the same numbers without knowing the source
resolution.

Storage: a new `damage_regions jsonb` column on `ai_analyses`, nullable.
Nullable is the honest representation — rows written before this existed
genuinely have no regions, and that is different from "analyzed and found
none" (which is `[]`).

The prompt extends the existing `GRADING_PROMPT` rather than replacing it, so
grade and regions come from **one** Gemini call per image, not two. It reuses
`GRADING_RUBRIC` verbatim — the boxes must be justified by the same rubric
that produced the letter, or the overlay would contradict the grade sitting
next to it. Ships as `prompt_version: "grade-regions-v1"`.

Schema failure on the region array must **not** discard the grade. This
follows the precedent already set for `part_name` and `image_quality`: a
model that returns a malformed box should still yield a graded part.

### 4. Overlay

Boxes render as absolutely-positioned outlines over the photo, colour-coded
by damage code, with the code as a label. Toggleable, because a manager
verifying a grade sometimes needs the unobstructed image.

Accessibility: the regions are also listed as text beneath the photo. A
colour-coded box on an image is not readable by a screen reader, and this
view is how a manager justifies a grade.

## Work breakdown

Every step is TDD (rule 1) — failing test first.

**Phase 1 — grouping (no AI, no migration, ships alone)**
1. `parsePartName` + exhaustive tests over all 35 seeded names
2. Grouped tree component, virtualization preserved
3. Photo grid pane, fed by existing `photoIds`
4. Wire into `(desktop)/inventory/page.tsx`

**Phase 2 — regions, forward-only**
5. Migration: widen unique index to include `prompt_version`
   `NULLS NOT DISTINCT`; add `damage_regions jsonb`
6. `GeminiDamageRegionSchema` + prompt extension + parser tests, including
   the malformed-box-preserves-grade case
7. Processor writes regions on new analyses
8. Overlay component + text list

**Phase 3 — backfill**
9. BullMQ backfill job: resumable, rate-limited, idempotent under the new
   index
10. Trigger + progress reporting

Phase 1 is independently shippable and carries no Gemini cost — worth landing
before Phase 3's spend.

## Open questions for the gate

- **Backfill cost.** One Gemini call per existing `part_image`. The row count
  should be checked against current pricing before Phase 3 is authorised.
  Phases 1–2 do not depend on the answer.
- **Grade drift.** Re-analyzing produces a *new* grade alongside the new
  boxes. If it disagrees with a grade a manager already corrected,
  `effectiveCondition()` must keep the human's answer winning — the backfill
  must not visibly re-grade approved inventory. This needs an explicit test.
- **RHD.** The Driver->Left mapping is a hardcoded market assumption.
  Acceptable now, wrong later.
