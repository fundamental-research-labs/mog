Rating: 8/10

# Review of `019-kernel-src-floating-objects.md`

## Summary judgment

This is a strong, evidence-grounded plan. Nearly every concrete claim it makes
about the current state of the folder is verifiable in source, and the central
architectural thesis — that the kernel-owned `FloatingObjectsProjection` exists
but is not yet the production read model, while the app still runs a parallel
`FloatingObjectCache` + `SheetCoordinator` path — is correct. The plan reads
like it was written by someone who actually traced the read/write paths rather
than skimmed the README. It defines real invariants, sequences the work
sensibly, and lists honest risks.

The deductions are not for inaccuracy. They are for *scope vs. verification
rigor*: this is a multi-week, five-package migration presented under the banner
of "improve a folder," and its verification gates are coarse (command lists, not
behavioral acceptance criteria), with no atomic cross-package landing strategy
and no rollout/rollback plan for swapping a live renderer's read model.

## Verification of the plan's factual claims

Spot-checked against `/Users/guangyuyang/Code/mog-all/mog`:

- `__placeholder__` and `cell-0-0` default anchors: **confirmed** in
  `floating-objects/managers/picture-manager.ts`, `managers/textbox-manager.ts`,
  `spreadsheet/ole-object-manager.ts`, `spreadsheet/cell-anchor-resolver.ts`,
  and across `domain/` (`equation-manager.ts`, `diagram-manager.ts`,
  `drawing/drawing-manager.ts`, `charts/chart-manager-conversion.ts`,
  `diagram/diagram-bridge.ts`).
- Picture creation "persist fire-and-forget": **confirmed** —
  `picture-manager.ts:261` comment "Persist to ComputeBridge asynchronously
  (fire-and-forget)".
- Parallel app cache: **confirmed** — `apps/spreadsheet/src/cache/floating-object-cache.ts`
  plus `coordinator/sheet-coordinator.ts`, `coordinator/receipt-processing.ts`,
  `coordinator/connector-rerouting.ts`, and `hooks/objects/*` consumers.
- Projection exists but is **not** wired into production: **confirmed** — no
  consumer of `setupFloatingObjectsProjection` / `createFloatingObjectsProjection`
  exists outside `kernel/src/floating-objects/**`; the API layer and app do not
  reference it. `IFloatingObjectsView` is a real contract in
  `types/objects/src/objects/floating-objects-view.ts`.
- Geometry normalization: **confirmed** —
  `kernel/src/bridges/compute/floating-object-geometry-normalization.ts`.
- Rust bounds split: **confirmed** — `compute_object_pixel_bounds` and
  `recompute_floating_object_bounds` live in
  `compute/core/src/storage/engine/services/structural/floating_bounds.rs` and
  related modules.
- Atomic resize-with-anchor: **confirmed** — `ResizeConfig.anchor_corner` already
  exists (`compute/core/src/storage/sheet/floating_objects/mutations.rs:111`,
  "When `anchor_corner` is set, the position is adjusted"). This is a genuine
  hook, not wishful thinking.
- `core/positioning.ts` is pure: **confirmed** — imports only contract types.

This level of corroboration is the single biggest reason for the high rating.

## Major strengths

- **Accurate problem statement.** The "Current architecture observed in source"
  section is true to the code, including the subtle point that production writes
  already bypass `cell-anchor-resolver.ts` and delegate to Rust.
- **Excellent contracts/invariants section.** The list under "Production-path
  contracts and invariants" is the strongest part of the plan: sync
  projection-backed reads, all writes through `ComputeBridge` typed paths,
  `position`/`anchor` equivalence, `sheetId`/`containerId` identity, oneCell vs
  twoCell vs absolute anchor semantics, sheet-scoped deletions, deterministic
  z-order under sparse/duplicate imported z-indexes, and "omit uncomputable
  bounds rather than render at origin." These are testable and they map onto the
  edge cases that actually bite spreadsheet object rendering.
- **Identity-aware normalization objective (#9).** Catching that opaque stable
  `CellId` anchors silently degrade to `(0,0)` when no positional `cell-r-c` ID
  is present is a precise, high-value bug, not a vague cleanup.
- **Honest risk inventory.** Stale dual-reads during migration, lost bounds-only
  events when Rust emits `data: None`, mixed flat/nested imported anchors,
  fire-and-forget persistence changing caller timing, and the TS `memberIds` vs
  Rust `children` group-schema mismatch are all real and specific.
- **Sequencing and parallelization are coherent.** Dependency order
  (contracts/Rust → projection completeness → manager cleanup → app migration →
  delete duplicates) is the correct direction, and the A–E agent split respects
  package boundaries.

## Major gaps or risks

- **Scope is enormous for one "folder" plan.** It spans `compute/core` (Rust),
  `kernel/src/floating-objects`, `kernel/src/domain/*`, `kernel/src/api/worksheet`,
  `types/objects`, `contracts`, and `apps/spreadsheet`. Steps 1–10 plus a 5-agent
  fan-out is effectively a quarter-scale migration. The plan would be stronger if
  it explicitly named a minimal first landing (e.g., "projection event
  completeness + Rust bounds parity, behind the existing tests, with no app
  migration yet") as a shippable slice, then staged the rest.
- **No atomic cross-package landing story.** Contract changes in `types/objects`
  / `contracts` must propagate to compute, kernel, and app. There is a known
  gotcha in this repo that editing contract types requires a declaration build
  before consumers typecheck. The plan lists "Root `pnpm typecheck` after
  cross-package contract changes" but does not address how to land a breaking
  contract change without a red intermediate state, nor the public API snapshot
  (`tools/api-snapshots/@mog-sdk__contracts.api.txt` references `IFloatingObjectsView`).
- **Verification gates are command lists, not acceptance criteria.** The gates
  name `cargo test -p compute-core`, `pnpm test`, etc., but do not bind specific
  invariants to specific assertions. "UI dev server exercise of the spreadsheet
  object workflows in a browser" is not a gate — given this repo has app-eval and
  api-eval harnesses, the plan should name concrete scenarios (drag, resize
  handle by corner, sheet switch, row/column resize repaint, duplicate, paste
  cross-sheet) as required passing checks.
- **No rollout/rollback or feature-flag plan** for switching the renderer's read
  model from `FloatingObjectCache` to the projection. This is the single
  riskiest change (the "stale dual-read" risk the plan itself names), yet there
  is no shadow-read/compare or flag-gated cutover described.
- **Existing tests not referenced.** Step 1 says "establish executable contracts
  before refactoring," but `projection/__tests__/floating-objects-projection.test.ts`
  and `setup-disposal.test.ts` already exist. The plan should build on / extend
  the existing suite explicitly rather than implying greenfield.
- **A few aspirational objectives.** "Unify chart/shape/picture/.../slicer
  hosting behavior" (objective #6) and "deduplicate chart-specific move/resize"
  (step 5) are stated as goals without file-level edit targets, so they are hard
  to scope or verify as done.

## Contract and verification assessment

Contract clarity is the plan's best dimension: the invariants are explicit,
mostly already represented by real types (`IFloatingObjectsView`,
`ObjectPosition`, `ResizeConfig.anchor_corner`), and they translate cleanly into
test cases. The plan correctly distinguishes the sync-read / async-write
contract and refuses to violate it (non-goal: "Do not make renderer paint by
awaiting `computeObjectBounds`").

Verification is the weaker half. The test enumeration (projection coalescing,
sheet-scoped delete, bounds-only updates, missing-bounds fetch by *event* sheet,
empty-sheet seeding, cross-sheet move, disposal guards, all object kinds, Rust
one/two/absolute/nested/flat/EMU/hidden/resize/insert-delete/deleted-anchor/
inverted cases) is genuinely thorough and is the right matrix. But it is a list
of tests to *write*, not gates to *pass*, and there is no behavioral pass/fail
threshold, no perf budget for the renderer read path despite step 9 touching it,
and no named browser scenario set. The "omit uncomputable bounds, consumers
skip" invariant in particular deserves an explicit assertion that no consumer
substitutes a zero rectangle.

## Concrete changes that would raise the rating

1. **Define a minimal shippable first slice** (projection event-completeness +
   Rust bounds parity behind existing tests, no app migration) and mark steps
   7/10 as a separate follow-up phase. This de-risks the "too big to land" issue.
2. **Add a cross-package landing strategy**: order of contract build/declaration
   rollup, how to keep typecheck green at each commit, and how the public API
   snapshot is updated/reviewed.
3. **Turn verification gates into acceptance criteria**: bind each invariant to a
   named test (e.g., "sheet-scoped delete → assert subscriber for that sheet
   notified and workbook-null path not used") and list the specific app-eval /
   api-eval scenarios that must pass, replacing "UI dev server exercise."
4. **Add a cutover plan** for the read-model swap: a shadow/compare mode or
   feature flag so projection and `FloatingObjectCache` can run in parallel and
   be diffed before the cache is deleted, with a rollback path.
5. **Reference and extend the existing projection tests** rather than implying
   new ones, and state the pre/post coverage delta.
6. **Make objectives #6 and step 5's dedup concrete**: name the chart vs.
   shape/image move/resize call sites to merge and the chart geometry fields to
   derive from `ObjectPosition`, with the invariant check that fails before
   persistence on disagreement.
7. **Add a renderer read-path budget** (e.g., projection snapshot read is O(objects
   in sheet), no allocation on paint) so step 9's "efficient batch bounds map"
   has a measurable target.
