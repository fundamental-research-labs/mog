# Plan 017 — Promote `mog/kernel/src/domain/pivots` to the canonical pivot domain layer

## Source folder and scope

- **Public source folder:** `/Users/guangyuyang/Code/mog-all/mog/kernel/src/domain/pivots`
- **Queue item 17:** Pivot table domain behavior and state transitions.

Current contents of the folder (verified):

```
mog/kernel/src/domain/pivots/
  style-normalization.ts                 (46 lines)
  __tests__/style-normalization.test.ts  (14 lines)
```

This is the **entire** domain/pivots module. By contrast, the actual pivot
domain behavior lives elsewhere in the tree and is large:

| File | Lines | Role |
|------|------:|------|
| `mog/kernel/src/api/worksheet/pivots.ts` | 2633 | `WorksheetPivotsImpl` + ~17 free helper functions (config conversion, field detection, source parsing, placement minting, source-change reconciliation) |
| `mog/kernel/src/bridges/pivot-bridge.ts` | 1540 | `PivotBridge` — wire conversion, result cache, CRUD, compute/refresh, placement minting |
| `mog/kernel/src/bridges/pivot-event-bridge.ts` | 328 | reactive refresh decisions on source-range changes |
| `mog/kernel/src/bridges/slicer-pivot-bridge.ts` | 454 | slicer ↔ pivot binding |
| `mog/kernel/src/api/workbook/pivot-styles.ts` | 51 | built-in style catalog + default-style API |
| `mog/kernel/src/errors/pivot.ts` | 111 | pivot error constructors + invalid-reference model |

**Scope of this plan:** make `domain/pivots` the canonical kernel TypeScript
domain module for pivot **pure behavior and state transitions** — style
catalog, placement identity, pure config-transition functions, source-change
reconciliation, and update/refresh policy — so that `api/worksheet/pivots.ts`,
`pivot-bridge.ts`, and `pivot-styles.ts` delegate to it instead of open-coding
the logic. **Out of scope:** Rust/Yrs persisted config state (the source of
truth), the Rust compute engine, wire (de)serialization transport, and any UI
session state. The TypeScript layer prepares valid transitions and metadata; it
does not shadow persisted state.

## Current role of this folder in Mog

The kernel domain layer is defined by `mog/kernel/src/domain/README.md` as the
"thin delegation layer between the kernel's public API and Rust compute-core …
Pure functions taking `DocumentContext` … No state. No business logic." Sibling
modules follow this: `tables/` has `core.ts`, `operations.ts`, `selection.ts`,
`range-resolution.ts`, `hit-testing.ts`, `auto-expansion.ts`,
`calculated-columns.ts`, `custom-styles.ts`, `style-normalization.ts`.
`slicers/` similarly has `crud.ts`, `selection.ts`, `cache.ts`,
`table-binding.ts`, `types.ts`.

`pivots/` does **not** appear in the README module table at all, and contains
only style normalization. Today it provides:

- `pivotStyleIdForCompute(name)` — canonicalizes built-in aliases
  (`light16`, `pivotstylemedium04`) to `PivotStyleLight16` / `PivotStyleMedium4`,
  preserves unknown/custom names verbatim, maps null/blank → `null`.
- `publicPivotStyleId(name)` — same, `null → undefined`.

Two production callers: `WorkbookPivotTableStylesImpl`
(`api/workbook/pivot-styles.ts`) and `WorksheetPivotsImpl.setStyle`
(`api/worksheet/pivots.ts:1150`, via the import at line 60).

Everything else that *is* pivot domain behavior is misplaced:

1. **Two divergent placement-ID formats.**
   - API `makePlacementId` (`api/worksheet/pivots.ts:83`) →
     `` `${area}:${fieldId}:${position}` `` — no pivot prefix, no collision handling.
   - Bridge `createStablePlacementId` (`bridges/pivot-bridge.ts:147`) →
     `` `${pivotId}:${area}:${fieldId}:${position}` `` with a `:${suffix}`
     collision-disambiguation loop.
   The same logical placement gets **different identities** depending on which
   path created it (create-config vs. add-placement). Placement IDs are stable
   identities used by sort-by-value, Show-Values-As base, and per-measure
   targeting — divergence is a correctness hazard, not cosmetic.

2. **Source-change reconciliation embedded in the API.**
   `WorksheetPivotsImpl.setDataSource` (`api/worksheet/pivots.ts:1437`) is a
   ~240-line method that re-detects source fields, re-resolves every placement /
   filter / sort-by-value / Show-Values-As base / calculated-field formula
   reference against the new headers, detects ambiguous duplicate headers, and
   accumulates structured `PivotInvalidReference[]` for atomic error reporting —
   all before any mutation. This is the single most complex pivot **state
   transition** in the codebase and it lives in the API class with no unit-level
   home.

3. **Config conversion + field detection in the API.**
   `dataConfigToApiConfig` (`:124`), `convertSimpleToDataConfig` (`:362`),
   `detectPivotFieldsForRange` (`:253`), `detectCellDataType` (`:246`),
   `parseDataSource` (`:192`), `resolveSourceSheetId` (`:221`),
   `effectivePivotFieldsForConfig` (`:336`), `fieldsByName` (`:300`),
   `configWithRequiredMetadata` (`:91`, owns `PIVOT_CONFIG_SCHEMA_VERSION = 2`),
   `formatDataSource` (`:105`) — all pure transformation logic that belongs in
   the domain layer.

4. **Update reason / refresh policy scattered as inline literals.**
   `{ reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' }`
   and friends are repeated ad hoc across `pivot-bridge.ts`
   (`:695,:773,:903,:927,:949,:980,:1058,:1102`). There is no single policy
   table mapping mutation kind → reason → refresh policy, so a missed/wrong
   policy is easy and silent. `pivot-event-bridge.ts:1497` independently keys
   off `refreshPolicy === 'refreshAndMaterialize'`.

5. **Style catalog magic numbers duplicated.**
   `PIVOT_STYLE_RANGES = { light: 28, medium: 28, dark: 28 }`
   (`style-normalization.ts:3`) vs. the independently-built
   `BUILT_IN_PIVOT_STYLES` loop (`api/workbook/pivot-styles.ts:14`, also `28`)
   vs. the `'PivotStyleLight16'` default literal (`pivot-styles.ts:26`). Three
   independent encodings of the same catalog that can drift. The default style
   has no validation that it is a member of the catalog.

6. **Near-duplicate of `tables/style-normalization.ts`.**
   `pivots/style-normalization.ts` and `tables/style-normalization.ts` share
   `normalizeStyleInput`, `canonicalFamily`, `isValidBuiltInStyle`, and the
   `^(?:Prefix)?(Light|Medium|Dark)(\d+)$` parsing shape verbatim, differing
   only in prefix string and dark-family count (28 vs 11).

## Improvement objectives

1. Promote `domain/pivots` from a style helper into the kernel's canonical pivot
   domain module, following the established `tables/`/`slicers/` decomposition
   and adding its row to `domain/README.md`.
2. Provide **one** placement-identity function used by both API and bridge so
   placement IDs are stable, prefixed, and collision-safe regardless of creation
   path.
3. Extract pure config transitions (create-config building, simple→data config
   conversion, data→api config conversion, metadata stamping) into the domain
   layer as `DocumentContext`-free pure functions where possible, with thin
   `ctx`-taking wrappers where source-data reads are required.
4. Move source-change reconciliation (`setDataSource`'s reference-remapping core)
   into a pure, exhaustively unit-tested module that returns either a complete
   reconciled config or a structured `PivotInvalidReference[]` — with zero
   mutation on the error path.
5. Centralize update reasons and refresh policies into a single domain policy
   table consumed by both `pivot-bridge.ts` and `pivot-event-bridge.ts`.
6. Make the built-in style catalog single-source-of-truth: one family→count
   table, one derived `BUILT_IN_PIVOT_STYLES`, one validated default constant,
   one alias parser. Share the cross-cutting normalizer with `tables/`.
7. Preserve Rust/Yrs as the persisted source of truth; the domain layer prepares
   valid transitions and never resurrects a TypeScript `PivotStore`.

## Production-path contracts and invariants to preserve or strengthen

- **Persistence boundary:** all persisted config lives in Rust/Yrs, reached via
  `ComputeBridge`. `pivot-bridge.ts:14` ("the former PivotStore has been
  deleted") must remain true — no in-TS authoritative config store.
- **Compute vs. refresh split:** `PivotBridge.compute()` stays a pure read path
  (no cell materialization, no viewport force-refresh, no dirty clearing, no
  subscriber notification); `PivotBridge.refresh()` stays the explicit
  materialization path. Extracting policy must not move side effects across this
  line.
- **Update-options contract:** every `updatePivot` producer must supply an
  explicit `{ reason, refreshPolicy }`. Strengthen this from "convention" to
  "the policy table is the only way to construct these," so a new mutator cannot
  forget one.
- **Refresh-policy semantics:** `sourceRangeChanged` remains `dirtyOnly`; all
  placement / aggregate / Show-Values-As / sort / filter / reset / layout /
  style / formatting / calculated-field / UI-config changes remain
  `refreshAndMaterialize` unless a new contract explicitly states otherwise.
  `pivot-event-bridge.ts` must continue to key its refresh decision off the same
  policy values.
- **Placement identity:** placement IDs are stable identities, never display
  labels; the same field may appear multiple times in Values; calculated fields
  may sit beside source fields; sort/filter may target a specific measure
  placement. Strengthen by making one function the sole minter and adding a
  cross-path identity-stability test.
- **`setDataSource` atomicity:** if any reference is unresolvable, the operation
  throws `PIVOT_UNRESOLVED_FIELD_REFERENCES` with the full
  `PivotInvalidReference[]` and performs **no** partial mutation. This atomicity
  is the central invariant of the reconciliation extraction.
- **Schema version:** `PIVOT_CONFIG_SCHEMA_VERSION` stays the single authority
  for stamping `schemaVersion` on created configs; do not introduce a second
  literal.
- **Style canonicalization contract:** built-in aliases canonicalize; unknown
  names are preserved verbatim (not dropped); null/blank → null/undefined.
  Strengthen by validating the workbook default against the catalog.
- **Public API/type stability:** `WorksheetPivots` / `WorkbookPivotTableStyles`
  method signatures and contract types are unchanged; this is an internal
  re-layering, not an API change.

## Concrete implementation plan

Target module shape (new files under `mog/kernel/src/domain/pivots/`):

```
domain/pivots/
  style-catalog.ts          # single catalog: family counts, BUILT_IN list, DEFAULT_PIVOT_STYLE
  style-normalization.ts    # keep public fns; delegate parsing to shared normalizer + catalog
  placement-identity.ts     # the one placement-id minter (prefixed, collision-safe)
  config.ts                 # pure config transforms: metadata stamping, data<->api, simple->data
  field-detection.ts        # ctx-taking source-field detection + cell type inference + source parsing
  source-change.ts          # pure reconciliation core for setDataSource
  update-policy.ts          # mutation-kind -> { reason, refreshPolicy } table
  index.ts                  # barrel
  __tests__/...
```

Plus a shared cross-cutting helper to deduplicate with tables:
`mog/kernel/src/domain/<shared>/builtin-style-normalizer.ts` (e.g. under a
small `formatting/` or `styles/` helper) exposing `normalizeStyleInput`,
`canonicalFamily`, and a parameterized `parseBuiltInStyle(prefix, name,
familyCounts)`. Both `pivots/style-normalization.ts` and
`tables/style-normalization.ts` consume it. (If a shared home is contentious,
keep the helper inside `pivots/` and have tables import it — the goal is one
implementation, not the location.)

### Step 1 — Style catalog single source of truth
- Create `style-catalog.ts` with `PIVOT_STYLE_FAMILY_COUNTS` (one table),
  derived `BUILT_IN_PIVOT_STYLES`, and `DEFAULT_PIVOT_STYLE = 'PivotStyleLight16'`.
- Refactor `style-normalization.ts` to read counts from the catalog and use the
  shared `parseBuiltInStyle`.
- Refactor `api/workbook/pivot-styles.ts` to import `BUILT_IN_PIVOT_STYLES` and
  `DEFAULT_PIVOT_STYLE` from the catalog (delete its local loop and literal),
  and validate `getDefault()`'s value against the catalog before returning.
- *Verification:* the existing `style-normalization.test.ts` must still pass
  unchanged.

### Step 2 — One placement-identity function
- Create `placement-identity.ts::makeStablePlacementId(pivotId, area, fieldId,
  position, existingPlacements)` implementing the prefixed, collision-safe form
  currently in `createStablePlacementId` (`pivot-bridge.ts:147`).
- Replace `createStablePlacementId` in `pivot-bridge.ts` with a call to it.
- Replace `makePlacementId` in `api/worksheet/pivots.ts:83` and all four
  call-sites in `convertSimpleToDataConfig` (`:402,:417,:430,:447`) with it,
  threading `pivotId` and `existingPlacements`. This eliminates the divergent
  format. (Where the API mints IDs *before* a pivot ID exists — create-config —
  decide one canonical ordering: pass the to-be-created pivot ID through, or
  mint server-side in the bridge and have the API not pre-mint at all. Prefer
  minting in one place; document the choice in the module header.)
- *Verification:* new identity-stability test asserting create-config and
  add-placement produce the same ID for the same logical placement.

### Step 3 — Pure config transforms
- Move `configWithRequiredMetadata` (owns `PIVOT_CONFIG_SCHEMA_VERSION`),
  `formatDataSource`, `dataConfigToApiConfig`, `isSimpleConfig`, and the pure
  parts of `convertSimpleToDataConfig` into `config.ts`. Keep the schema-version
  constant here as the sole authority.
- Re-point `api/worksheet/pivots.ts` to import these. The API class methods stay,
  but shrink to orchestration + bridge delegation.

### Step 4 — Field detection / source parsing
- Move `parseDataSource`, `detectCellDataType`, `detectPivotFieldsForRange`,
  `resolveSourceSheetId`, `resolveExistingPivotSourceSheetId`, `fieldsByName`,
  `effectivePivotFieldsForConfig` into `field-detection.ts`. The ones that read
  source data take `ctx: DocumentContext` (allowed by the README pattern); the
  pure ones (`parseDataSource`, `detectCellDataType`, `fieldsByName`) take plain
  inputs.

### Step 5 — Source-change reconciliation
- Extract the reference-remapping core of `setDataSource`
  (`api/worksheet/pivots.ts:1437`–~1678) into
  `source-change.ts::reconcilePivotConfigToSource(config, newFields,
  options) → { config } | { invalidReferences }`. Pure: inputs are the old
  config, the newly detected fields, and the calculated-field set; output is
  either a fully reconciled config or the structured invalid-reference list.
- `setDataSource` becomes: detect fields (Step 4) → call
  `reconcilePivotConfigToSource` → on `invalidReferences`, throw
  `createPivotUnresolvedFieldReferencesError`; on success, single `updatePivot`
  using the Step-6 policy. No partial mutation on the error path.
- This is the highest-value extraction: it is the most complex transition and
  currently has no unit-level test surface.

### Step 6 — Update-policy table
- Create `update-policy.ts` mapping a `PivotMutationKind` enum
  (`fieldPlacementChanged`, `fieldReset`, `uiConfigChanged`,
  `sourceRangeChanged`, `aggregateChanged`, `showValuesAsChanged`,
  `sortChanged`, `filterChanged`, `layoutChanged`, `styleChanged`,
  `formattingChanged`, `calculatedFieldChanged`) →
  `{ reason, refreshPolicy }`.
- Replace every inline `{ reason, refreshPolicy }` literal in `pivot-bridge.ts`
  with `pivotUpdateOptions(kind)`.
- Have `pivot-event-bridge.ts` import the policy enum/predicate rather than
  hard-comparing the string `'refreshAndMaterialize'` (`:1497`).
- Preserve the existing invariant test that asserts every producer passes
  explicit options.

### Step 7 — Barrel + README
- Add `index.ts` re-exporting the public domain surface.
- Add a `pivots/` row to the `domain/README.md` module table:
  "Pivot style catalog, placement identity, pure config transitions,
  source-change reconciliation, update policy."

## Tests and verification gates

> Per task constraints this plan does not run any build/test/typecheck commands.
> The gates below are what a follow-up implementation PR must satisfy.

1. **Existing test unchanged:** `pivots/__tests__/style-normalization.test.ts`
   passes without edits after Step 1.
2. **New unit tests (pure modules):**
   - `style-catalog`: catalog count matches `BUILT_IN_PIVOT_STYLES.length`;
     `DEFAULT_PIVOT_STYLE` is a catalog member.
   - `placement-identity`: collision suffixing; identical ID for create-config
     vs. add-placement of the same logical placement (the divergence fix).
   - `config`: round-trips for `dataConfigToApiConfig` / simple→data; schema
     version stamping; data-source formatting incl. quoted sheet names.
   - `source-change`: single-candidate remap; ambiguous-duplicate-header →
     `ambiguousDuplicateHeader` reference; missing field → concrete reference;
     calculated-field formula invalidation; **no mutation** when any reference
     is invalid (atomicity).
   - `update-policy`: every `PivotMutationKind` maps to a defined option;
     `sourceRangeChanged → dirtyOnly`; all others → `refreshAndMaterialize`.
3. **Bridge invariant test:** the existing "every updatePivot passes explicit
   options" test still passes, now backed by the policy table.
4. **Regression suites to run (read-only list for the implementer):**
   - kernel pivot unit tests: `bridges/__tests__/pivot-bridge.test.ts`,
     `bridges/__tests__/pivot-event-bridge.source-identity.test.ts`,
     `api/__tests__/worksheet-pivots.test.ts`.
   - app-eval pivot scenarios under
     `dev/app-eval/scenarios/pivot-tables/` (note pre-existing dirty specs
     `imported-pivot-field-panel-allows-edits.spec.ts`,
     `pivot-field-pane-sort-and-row-reorder.spec.ts` — do not modify; just
     ensure green).
5. **Typecheck gate:** `@mog-sdk/contracts` consumers compile; no public API or
   contract-type signature changed (re-layering only).
6. **Behavioral parity:** create-pivot, add/move/remove placement, set data
   source (valid + ambiguous + missing-field), set style/default-style produce
   byte-identical bridge calls before/after, except for the intended
   placement-ID unification.

## Risks, edge cases, and non-goals

**Risks / edge cases**
- *Placement-ID unification is observable.* If any persisted document or test
  fixture encodes the old unprefixed `area:fieldId:position` IDs, switching to
  the prefixed form changes stored identities. Mitigation: confirm Rust is the
  ID authority and that the API form was only ever transient pre-create; if
  not, the create path must mint via the bridge (one minter) and never persist
  the API form. This must be settled before Step 2 lands.
- *Ambiguous-duplicate-header semantics* in `setDataSource` are subtle (header
  appears N>1 times after a source swap). The extraction must preserve exact
  candidate-description formatting (`${id}:${name}@${sourceColumn}`) used in
  error context.
- *Calculated-field formula re-resolution* uses word-boundary regex matching on
  field names; preserve the exact escaping (`[.*+?^${}()|[\]\\]`) to avoid
  changing which formulas are flagged.
- *compute/refresh side-effect line.* Moving policy literals must not
  accidentally move a side effect across the compute/refresh boundary — verify
  each `updatePivot` call keeps its original `refreshPolicy`.
- *Shared normalizer with tables* differs in dark-family count (28 vs 11); the
  parameterized helper must take counts per caller, not assume a shared 28.

**Non-goals**
- No Rust/compute-core changes; no wire-format changes.
- No public API surface or contract-type changes.
- No resurrection of a TypeScript pivot config store.
- No new pivot features (no new aggregations, layouts, or Show-Values-As modes).
- No UI/session-state ownership; expansion state remains where it is.
- Not a test-only fix and not a shim: callers are repointed to the new domain
  modules; the old open-coded copies are deleted, not wrapped.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable steps:** Step 1 (catalog), Step 6 (policy
  table) touch disjoint files and can land in parallel.
- **Sequenced:** Step 2 (placement identity) should land before/with Steps 3–5
  because `convertSimpleToDataConfig` and `setDataSource` both mint IDs. Step 5
  depends on Step 4 (field detection extraction).
- **Cross-folder coupling:**
  - `tables/style-normalization.ts` (queue folder for tables) shares the
    normalizer; coordinate the shared-helper extraction so both folders import
    one copy. Either folder's plan can own the helper; the other consumes it.
  - `bridges/pivot-bridge.ts`, `bridges/pivot-event-bridge.ts`,
    `bridges/slicer-pivot-bridge.ts` are the primary consumers being repointed
    (outside this folder, but the integration target).
  - `errors/pivot.ts` defines `PivotInvalidReference` — `source-change.ts`
    depends on its type shape; no change to errors required, only consumption.
  - `@mog-sdk/contracts` (`api`, `pivot`, `events`, `bridges`) supply the public
    types; per the contracts-rollup memo, any (non-goal here) type edit would
    require `pnpm --filter @mog-sdk/contracts build` before consumers typecheck —
    this plan introduces no such edit.
- **Compute-core pivot crate** (`compute-core/.../compute-pivot`) is the Rust
  authority and a hard dependency boundary, not modified here.
