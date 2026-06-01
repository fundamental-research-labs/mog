# Pivot Tables

Internal implementation notes for the Pivot Table feature in the Mog spreadsheet engine. The shipped path uses Rust-backed storage, computation, and materialization, TypeScript kernel bridges, public worksheet/contract types, and React UI integration.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Rust compute-pivot Crate](#rust-compute-pivot-crate)
- [Computation Pipeline](#computation-pipeline)
- [Bridges](#bridges)
- [Contracts](#contracts)
- [UI Layer](#ui-layer)
- [Data Model](#data-model)
- [Show Values As](#show-values-as)
- [Calculated Fields](#calculated-fields)
- [Key Design Decisions](#key-design-decisions)
- [Current Status](#current-status)
- [File Reference](#file-reference)

---

## Overview

Pivot tables summarize large datasets by grouping, filtering, and aggregating data along configurable row and column axes. Users select source data, define field placements (rows, columns, values, filters), and the engine produces a materialized result table with headers, aggregated values, subtotals, and grand totals.

The implementation tracks Excel pivot-table concepts across field areas, aggregation functions, date/number grouping, Show Values As calculations, expand/collapse hierarchies, drill-down, and layout modes. UI support varies by command; see [Current Status](#current-status).

### Surface Status

| Surface | Status | Notes |
| --- | --- | --- |
| `Worksheet.pivots` API types | public | `types/api/src/api/worksheet/pivots.ts`, re-exported through `contracts/src/api/worksheet/pivots.ts`. Placement-id-first methods are preferred; name/field facades remain as deprecated compatibility paths. |
| Pivot data/event/bridge contracts | public | `types/data`, `types/events`, and `types/bridges` source packages feed the `@mog-sdk/contracts` shims. |
| `@mog-sdk/kernel`, spreadsheet UI hooks/components | workspace-internal | Used by the app/runtime, not published as a direct public integration surface. |
| Rust `compute-pivot` / `compute-relational` crates | workspace-internal | `publish = false`; reached from public runtimes through generated compute bridge bindings. |
| Rust `compute/api/src/sheet/pivots.rs` | reserved | Not the shipped sheet-level API; persisted pivot CRUD is implemented on `YrsComputeEngine` bridge methods under `compute/core/src/storage/engine/objects/pivots.rs`. |
| `PivotTableResult.measureDescriptors` / `valueRecords` | reserved | Public/generated types include them, and the TS bridge can translate them, but the current Rust projection initializes them as empty vectors. |

### Source Layout

| Area | Primary paths |
|------|---------------|
| Pivot facade, presenter, Show Values As | `compute/core/crates/compute-pivot/` |
| Relational filter/group/aggregate engine | `compute/core/crates/compute-relational/` |
| Rust pivot data types | `domain-types/src/domain/pivot/`, `compute/core/crates/types/pivot-types/` |
| Rust storage and materialization | `compute/core/src/storage/engine/objects/pivots.rs`, `compute/core/src/storage/sheet/pivots.rs`, `compute/core/src/mirror/write/pivot_materialization.rs` |
| TypeScript pivot contracts | `types/data/src/data/pivot.ts`, `types/api/src/api/worksheet/pivots.ts`, `types/bridges/src/pivot-bridge.ts`, `types/events/src/pivot-events.ts` |
| Kernel bridge and worksheet API | `kernel/src/bridges/pivot-bridge.ts`, `kernel/src/api/worksheet/pivots.ts` |
| Spreadsheet UI | `apps/spreadsheet/src/components/pivot/`, `apps/spreadsheet/src/hooks/data/`, `apps/spreadsheet/src/systems/pivot/` |

---

## Architecture

```
+------------------------------------------------------------------+
|                          UI Layer                                 |
|  +-------------------+  +------------------+  +----------------+ |
|  | Pivot Dialog      |  | Context Menu     |  | Field Panel    | |
|  | (create/edit)     |  | (sort/filter/    |  | (drag fields   | |
|  |                   |  |  expand/delete)  |  |  between areas)| |
|  +-------------------+  +------------------+  +----------------+ |
|         |                       |                     |          |
|  +--------------------------------------------------------------+|
|  | React Hooks                                                   |
|  |  usePivotTables  |  usePivotContextMenuActions                |
|  |  usePivotEditorActions                                        |
|  +--------------------------------------------------------------+|
+------------------------------------------------------------------+
         |                        |                     |
+------------------------------------------------------------------+
|                        Kernel Layer                               |
|  +-------------------------------------------------------------+ |
|  |  PivotBridge                                                 | |
|  |  - CRUD via ComputeBridge (Rust-backed persistence)          | |
|  |  - Computation orchestrator                                  | |
|  |  - Result caching + version tracking                         | |
|  |  - Reactive subscriptions                                    | |
|  |  - Data marshaling (source data -> Rust)                     | |
|  +-------------------------------------------------------------+ |
|                                         |                        |
|  +--------------------------------------+----------------------+ |
|  |  PivotEventBridge                                           | |
|  |  - Subscribes to pivot lifecycle/expansion events           | |
|  |  - Triggers recomputation when source data changes          | |
|  +-------------------------------------------------------------+ |
+------------------------------------------------------------------+
         |
         | ComputeBridge transport
         |
+------------------------------------------------------------------+
|                    Rust Compute Layer                             |
|  +-------------------------------------------------------------+|
|  | compute-pivot crate                                          ||
|  |                                                              ||
|  |  compute-pivot facade                                        ||
|  |    validate -> query mapping -> compute-relational::execute  ||
|  |    -> presenter projection -> optional show_values_as        ||
|  |                                                              ||
|  |  +----------+ +----------+ +---------+ +-------------------+ ||
|  |  | grouper  | | filter   | | engine/ | | show_values_as    | ||
|  |  | - text   | | - include| | compute | | - 12 transforms   | ||
|  |  | - date   | | - exclude| | - rows  | | - hierarchy-aware | ||
|  |  | - number | | - cond   | | - cols  | | - Kahan summation | ||
|  |  | - expand | | - top/N  | | - agg   | +-------------------+ ||
|  |  +----------+ +----------+ +---------+                       ||
|  |                                                              ||
|  |  Depends on: value-types, cell-types, pivot-types,           ||
|  |  domain-types, compute-relational, compute-stats             ||
|  +-------------------------------------------------------------+||
+------------------------------------------------------------------+
```

### Communication Flow

1. `PivotBridge` delegates pivot reads, writes, and materialization to `ComputeBridge`.
2. Generated `ComputeBridge` methods call transport keys such as `compute_pivot_create`, `compute_pivot_create_with_sheet`, `compute_pivot_get_all`, `compute_pivot_compute_from_source`, `compute_pivot_materialize`, `compute_pivot_get_all_items`, `pivot_detect_fields`, and `pivot_drill_down`.
3. The `ComputeBridge` transport layer owns runtime routing for desktop/native and web runtimes; `PivotBridge` does not perform its own Tauri/WASM dispatch.

### Data Marshaling

`kernel/src/bridges/pivot-bridge.ts` maps between public TypeScript pivot contracts and generated compute DTOs:

- Config mapping: `toComputePivotConfig()`, `toPublicPivotConfig()`
- Field/placement mapping: `toComputePivotField()`, `toPublicPivotField()`, `toComputePivotPlacement()`, `toPublicPivotPlacement()`
- Result mapping: `toPublicPivotTableResult()`, `toPublicPivotRow()`, `toPublicPivotHeader()`
- Source data reads: `getDataFromRange()` calls `queryRange()` and normalizes cell values with `normalizeCellValue()`

---

## Rust compute-pivot Crate

**Path**: [`compute/core/crates/compute-pivot/`](../../../compute/core/crates/compute-pivot/)

**Dependencies**: `value-types` (CellValue, CellError, date_serial), `cell-types` (ranges/sheet IDs), `pivot-types` (which re-exports canonical domain pivot contracts), `compute-relational` (query execution), `compute-stats` (aggregation, sorting, value semantics), `snapshot-types` (PivotTableDef conversion), `chrono` (date grouping), `serde`/`serde_json`.

The crate exposes pure computation entry points: `(config, data, expansion_state) -> result`. Document state, persistence, and materialization live in `compute/core/src/storage` and are reached through `ComputeBridge`.

### Module Map

| Module | Purpose | Key Types/Functions |
|--------|---------|-------------------|
| `types/` | Re-export shim over `pivot-types` / `domain-types` | `PivotTableConfig`, `PivotField`, `PivotFieldPlacement`, `PivotFilter`, `PivotTableResult`, `ShowValuesAs` |
| `compute/core/crates/types/pivot-types/` | Dependency-light Rust pivot type facade | config, placement, result, filter, expansion re-exports |
| `domain-types/src/domain/pivot/` | Canonical Rust pivot domain types | `PivotTableConfig`, `PlacementId`, `ShowValuesAs`, placement/config/filter structs |
| `resolved.rs` | Validated config | `ResolvedPivotConfig` -- constructed only via `validate_and_resolve()` |
| `engine/` | Pipeline orchestrator | `compute()`, `detect_fields()`, `drill_down()`, `validate_config()` |
| `engine/compute.rs` | Core computation | Validates config, maps to relational query, runs presenter projection |
| `engine/validation.rs` | Config validation | `validate_and_resolve()` -- produces `ResolvedPivotConfig` |
| `engine/type_detection.rs` | Field detection | `detect_fields()` -- scans source data to infer field names and types |
| `engine/row_computation.rs` | Calculated-field helpers | `apply_calc_fields_to_values()` |
| `engine/drill_down.rs` | Drill-down | `drill_down()`, `drill_down_resolved()` -- source row lookup |
| `presenter/` | Relational result projection | `pivot_config_to_query()`, `query_result_to_pivot()` |
| `grouper.rs` | Grouping helpers | `apply_date_grouping()`, `apply_number_grouping()`, `normalize_to_key()` |
| `filter.rs` | Index-based filtering helpers | `apply_filters_resolved()` -- used by drill-down and item extraction |
| `show_values_as/` | Post-aggregation transforms | `apply_show_values_as_to_result()`, `apply_show_values_as_with_hierarchy()` |
| `hierarchy.rs` + `hierarchy/` | Group hierarchy index | `GroupHierarchy`, `build_group_hierarchy_from_aggregated_tree()` |
| `calc_field/` | Calculated fields | `parse_calc_field()`, `evaluate_calc_field()`, `CalcFieldExpr` |

### Re-exports from compute-stats

The crate re-exports key primitives from `compute-stats`:

- **Aggregator** (`compute_stats::aggregate`): `aggregate()` function supporting 12 aggregate functions
- **Sorter** (`compute_stats::sort`): `sort_by_in_place()`, `sort_by_custom_order_in_place()`, `SortConfig`
- **Values** (`compute_stats::values`): `cell_value_to_key()`, `cell_value_filter_keys()`, `cell_value_eq()`, `cell_value_is_numeric()`, `cell_value_to_sort_key()`, `cell_value_to_display_key()`, `kahan_sum()`

### Type System: "Parse, Don't Validate"

The types module follows a parse-don't-validate philosophy:

1. **Wire types** (`PivotFieldPlacementFlat`, `PivotFilterConditionFlat`) match the TypeScript JSON format for serde compatibility.
2. **Type-safe enums** (`PivotFieldPlacement`, `PivotFilterCondition`) live in the Rust domain types and make invalid area-specific states unrepresentable after conversion.
3. **Resolved types** (`ResolvedPivotConfig`, `ResolvedAxisPlacement`, etc.) can only be constructed through validation. The engine accepts only resolved types -- zero fallback defaults.

`From` implementations convert between flat and type-safe representations at the boundary.

### Placement Identity and UX Contract

Pivot UX is placement-id-first. A pivot placement has stable identity independent of source field, area, position, display label, aggregate function, and show-values-as transform. This is required because a pivot can place the same field multiple times in Values, place a calculated measure beside source-field measures, or sort/filter an axis by a specific measure.

The architectural boundary is:

| Concern | Owner |
| --- | --- |
| Persistent pivot config, placement identity, calculated-field identity, expansion keys | Rust domain/compute/storage |
| Public mutation API and kernel mutation receipts | Kernel worksheet pivot API / `PivotBridge` |
| User mutation entry | Spreadsheet action handlers via `dispatch(PIVOT_*)` |
| UI sessions, semantic targets, dialog drafts, range-pick drafts, command readiness receipts | `apps/spreadsheet/src/systems/pivot` |
| Presentational markup and `data-pivot-*` attributes | `apps/spreadsheet/src/components/pivot` |
| Readback surfaces | `PivotModelReadback`, `PivotSurfaceReadback`, and `PivotUiStateReadback` API types |

Materialized grid cells own workbook-visible pivot values. The pivot overlay owns semantic affordances, hit targets, context metadata, and pivot-specific interaction UI. Expansion that changes materialized cells is persistent pivot config/kernel state; overlay-only preview expansion must be modeled separately if it is introduced later.

Command completion is layered:

```text
UI input -> dispatch(PIVOT_*) -> action handler -> ws.pivots/kernel bridge
  -> Rust config/result/materialization -> PivotKernelMutationReceipt
  -> systems/pivot UI readiness tracking -> projection/paint
  -> PivotCommandReceipt
```

Test and automation paths should keep real UI input paths. Readback assertions should use stable model/surface/UI snapshots or visible grid snapshots instead of scraping pivot overlay table structure.

---

## Computation Pipeline

The shared compute path validates the pivot config, translates it into a relational query, executes that query, then projects the query result back into pivot layout structures. The plain pure `compute()` entry point stops after projection; production storage/materialization and `pivot_compute_from_source` use `compute_with_show_values_as_resolved()` so configured Show Values As calculations are applied.

```
validate_and_resolve
  -> pivot_config_to_query
  -> compute_relational::execute
  -> query_result_to_pivot
  -> apply_show_values_as_to_result (production and explicit Show Values As path only)
```

### Stage 1: Validate (`validate_and_resolve`)

Converts wire-format `PivotTableConfig` into `ResolvedPivotConfig`:
- Verifies all field references exist
- Resolves all `Option` defaults to concrete values
- Converts flat serde types to type-safe enums
- Pre-resolves field IDs to column indices
- Pre-parses calculated field formulas
- Returns `Result<ResolvedPivotConfig, PivotError>` -- engine never touches raw config

### Stage 2: Query Mapping (`pivot_config_to_query`)

`presenter/query_mapping.rs` converts the resolved pivot config into `compute-relational`'s `RelationalQuery`:
- Row and column placements become `GroupField`s with identity, date, or number grouping.
- Value placements become measures.
- Pivot filters become query filters.
- Calculated fields become relational calculated measures.
- Subtotal and grand-total options become relational config.

### Stage 3: Relational Execution (`compute_relational::execute`)

The relational engine owns the core data pipeline:

```
validate(query)
  -> filter(data, query.filters)
  -> group_rows(data, query.row_fields)
  -> group_columns(data, query.column_fields)
  -> aggregate(row_tree, col_tree, query.measures)
  -> sort_trees(row_tree, col_tree, query)
  -> calc_measures(tree, query.calculated_measures)
  -> grand_totals(tree, query.grand_totals)
  -> QueryResult
```

Filtering and grouping operate on source row indices. Date grouping supports Year, Quarter, Month, Week, Day, Hour, Minute, and Second; number grouping uses equal-width bins.

### Stage 4: Aggregate Functions

The public contract exposes 12 aggregation names:

| Function | Description |
|----------|-------------|
| `Sum` | Sum of numeric values |
| `Count` | Count of numeric values |
| `CountA` | Count of non-blank values |
| `CountUnique` | Count of distinct values |
| `Average` | Arithmetic mean of numeric values |
| `Min` | Minimum numeric value |
| `Max` | Maximum numeric value |
| `Product` | Product of numeric values |
| `StdDev` | Sample standard deviation |
| `StdDevP` | Population standard deviation |
| `Var` | Sample variance |
| `VarP` | Population variance |

`compute-stats` implements the full aggregate set with Welford's algorithm for variance/standard deviation and Kahan compensated summation for sums. The current `compute-pivot` relational mapping forwards most aggregate functions directly; `CountA` maps to the relational `CountNums` variant, and `CountUnique` currently maps to `Count` in `presenter/query_mapping.rs`.

### Stage 5: Calculated Fields

Calculated fields are parsed during validation and mapped into relational calculated measures. Grand-total paths also use `apply_calc_fields_to_values()` where needed. Expression language:
- Field references: `Revenue`, `'Cost of Goods'`
- Arithmetic: `+`, `-`, `*`, `/` with standard precedence
- Parentheses: `(Revenue - Cost) / Revenue`
- Numeric literals: `100`, `3.14`
- Unary negation: `-Revenue`

### Stage 6: Result Projection (`query_result_to_pivot`)

`presenter/result_projection.rs` converts `QueryResult` to `PivotTableResult`:
- Builds multi-level column headers
- Flattens the row tree according to expansion state and layout form
- Emits subtotal rows when configured
- Builds row, column, and corner grand totals
- Computes `rendered_bounds` for materialization

### Stage 7: Show Values As (`apply_show_values_as_to_result`)

When value placements include Show Values As configs, `compute_with_show_values_as_resolved()` builds a `GroupHierarchy` from the relational row tree and applies transforms to rows and grand totals. See [Show Values As](#show-values-as) for full details.

### Pipeline Output: `PivotTableResult`

```rust
pub struct PivotTableResult {
    pub column_headers: Vec<PivotColumnHeader>,  // Multi-level column headers
    pub rows: Vec<PivotRow>,                     // Data rows + subtotals
    pub grand_totals: PivotGrandTotals,          // Row, column, corner totals
    pub source_row_count: usize,                 // Source data size
    pub rendered_bounds: PivotRenderedBounds,    // Materialization geometry
    pub measure_descriptors: Vec<PivotMeasureDescriptor>,
    pub value_records: Vec<PivotValueRecord>,
    pub errors: Option<Vec<String>>,             // Non-fatal errors
}
```

`measure_descriptors` and `value_records` are reserved metadata fields in the Rust/generated/public contracts. As of the current projection in `presenter/result_projection.rs`, they are initialized as empty vectors; the kernel bridge preserves and translates them if a future compute path populates them.

---

## Bridges

### PivotBridge

**Path**: [`kernel/src/bridges/pivot-bridge.ts`](../../../kernel/src/bridges/pivot-bridge.ts)

The `PivotBridge` is the workspace-internal bridge connecting worksheet/UI code to the Rust pivot engine. It implements `IPivotBridge`. The former TypeScript `PivotStore` path is gone; persisted pivot config state now lives in Rust/Yrs storage and is accessed via `ComputeBridge`.

**Key responsibilities**:
- **CRUD**: `createPivot()`, `getPivot()`, `getAllPivots()`, `updatePivot()`, `deletePivot()`, `createPivotWithSheet()` -- all delegate to ComputeBridge methods (`pivotCreate`, `pivotGet`, `pivotGetAll`, `pivotUpdate`, `pivotDelete`, `pivotCreateWithSheet`)
- **Placement mutations**: `addPlacement()`, `updatePlacement()`, `removePlacement()`, `movePlacement()`, `setAggregateFunction()`, `setShowValuesAs()`, `renameValuePlacement()`, `setSortOrder()`, `setSortByValue()`, `resetPlacement()`
- **Computation/materialization**: `compute()` calls `pivotComputeFromSource()` for read-only results; `refresh()` calls `pivotMaterialize()` for the production write path
- **Field detection**: `detectFields()` -- analyzes source data to infer field names/types
- **Drill-down**: `drillDown()`, `getDrillDownData()` -- retrieve source rows for a pivot cell
- **Caching**: Result cache with version-based invalidation (config version + data version)
- **Subscriptions**: `subscribe(pivotId, callback)` for ephemeral result-cache notifications

**Cache invalidation strategy**:
- `invalidateCache()` clears a pivot result and bumps its config version; PivotBridge calls it for pivot lifecycle events and explicit refreshes.
- `refreshDependentPivots(sourceSheetId)` increments the source sheet data version and recomputes pivots that use that sheet.
- Cached read results are reused only when both config and data versions match.

**ComputeBridge methods used**:

| Method | Purpose |
|--------|---------|
| `pivotCreate(config)` | Create a pivot table on `config.outputSheetName` |
| `pivotGet(sheetId, pivotId)` | Get a single pivot config |
| `pivotGetAll(sheetId)` | Get all pivots on a sheet |
| `pivotUpdate(sheetId, pivotId, config)` | Update a pivot config |
| `pivotDelete(sheetId, pivotId)` | Delete a pivot table |
| `pivotCreateWithSheet(sheetName, config)` | Atomically create sheet + pivot |
| `pivotComputeFromSource(sheetId, pivotId, expansionState)` | Read-only compute from stored config and source data |
| `pivotMaterialize(sheetId, pivotId, expansionState)` | Compute and write materialized pivot output |
| `pivotDetectFields(data)` | Detect fields from source data |
| `pivotDrillDown(config, data, rowKey, colKey)` | Get source row indices for a pivot cell |
| `pivotGetAllItems(sheetId, pivotId, expansionState)` | Extract placed pivot items for UI filtering |

### PivotEventBridge

**Path**: [`kernel/src/bridges/pivot-event-bridge.ts`](../../../kernel/src/bridges/pivot-event-bridge.ts)

Connects the EventBus to the pivot rendering system. Subscribes to state change events and triggers pivot recalculation.

**Event subscriptions**:

| Event | Response |
|-------|----------|
| `pivot:created` | Trigger initial computation and render |
| `pivot:updated` | Recompute and re-render |
| `pivot:deleted` | Clean up display |
| `pivot:expansion-changed` | Recompute to reflect expansion state |
| `cell:changed` | Check if source data range is affected, recompute if so |
| `cells:batch-changed` | Same as above, but efficient batch check |

**Usage pattern** (React component):
```typescript
useEffect(() => {
  const disconnect = connectPivotToEventBus({
    sheetId: activeSheetId,
    pivotBridge: ctx.pivot,
    eventBus: ctx.eventBus,
    getSheetName: (sheetId) => ctx.computeBridge.getSheetName(sheetId),
    onPivotRefresh: (pivotId) => { /* trigger re-render */ },
  });
  return disconnect;
}, [activeSheetId, ctx.pivot, ctx.eventBus, ctx.computeBridge]);
```

The `createPivotEventBridge()` factory supports dynamic sheet ID tracking; `setSheetId()` disconnects and reconnects the bridge with the new active sheet ID.

---

## Contracts

**Path**: [`types/data/src/data/pivot.ts`](../../../types/data/src/data/pivot.ts) (re-exported from [`contracts/src/data/pivot.ts`](../../../contracts/src/data/pivot.ts))

The contracts define the shared type interface between kernel, UI, and engine.

### Core Types

| Type | Location | Purpose |
|------|----------|---------|
| `PivotField` | `types/data/src/data/pivot.ts` | Field definition (id, name, sourceColumn, dataType) |
| `PivotFieldPlacementFlat` / `PivotFieldPlacement` | `types/data/src/data/pivot.ts` | Field placed in an area with config |
| `PivotFieldArea` | `types/data/src/data/pivot.ts` | `'row' \| 'column' \| 'value' \| 'filter'` |
| `AggregateFunction` | `types/data/src/data/pivot.ts` | 12 aggregation names |
| `PivotFilter` | `types/data/src/data/pivot.ts` | Include/exclude/condition/topBottom per field |
| `PivotTableConfig` | `types/data/src/data/pivot.ts` | Public/common pivot definition |
| `PivotTableResult` | `types/data/src/data/pivot.ts` | Computed output |
| `PivotRow`, `PivotHeader` | `types/data/src/data/pivot.ts` | Row/header structures in results |
| `ShowValuesAs` | `types/data/src/data/pivot.ts` | 13 post-aggregation calculation names |
| `ShowValuesAsConfig` | `types/data/src/data/pivot.ts` | Calculation type + base field + base item |
| `SortByValueConfig` | `types/data/src/data/pivot.ts` | Sort by aggregated values |

### Bridge Interfaces

| Interface | Location | Purpose |
|-----------|----------|---------|
| `IPivotBridge` | `types/bridges/src/pivot-bridge.ts` | CRUD + computation + caching + subscription |
| `PivotResultCallback` | `types/bridges/src/pivot-bridge.ts` | Subscription callback type |
| `PivotCacheStats` | `types/bridges/src/pivot-bridge.ts` | Cache debugging info |

### Event Types

| Event | Location | Fields |
|-------|----------|--------|
| `PivotCreatedEvent` | `types/events/src/pivot-events.ts` | outputSheetId, sourceSheetId, deprecated sheetId, pivotId, kernelReceipt, config, source |
| `PivotUpdatedEvent` | `types/events/src/pivot-events.ts` | outputSheetId, sourceSheetId, deprecated sheetId, pivotId, placementIds, oldConfig, newConfig, update, receipts, source |
| `PivotDeletedEvent` | `types/events/src/pivot-events.ts` | outputSheetId, sourceSheetId, deprecated sheetId, pivotId, removedPlacementIds, source |
| `PivotExpansionChangedEvent` | `types/events/src/pivot-events.ts` | sheetId, pivotId, expansionKey, deprecated headerKey, isExpanded, axis, axisPlacementId |

---

## UI Layer

### React Hooks

**Path**: [`apps/spreadsheet/src/hooks/data/`](../../../apps/spreadsheet/src/hooks/data/)

| Hook | File | Purpose |
|------|------|---------|
| `usePivotTables` | `use-pivot-tables.ts` | Primary hook: CRUD, field management, computation, drill-down, expansion |
| `usePivotEditorActions` | `use-pivot-editor-actions.ts` | Editor panel: add/remove/move fields, aggregate change, refresh, delete |
| `usePivotContextMenuActions` | `use-pivot-context-menu-actions.ts` | Context menu: sort, expand/collapse, aggregate, Show Values As, group/ungroup |

### Dialog State (Zustand)

**Path**: [`apps/spreadsheet/src/ui-store/slices/dialogs/pivot-dialog.ts`](../../../apps/spreadsheet/src/ui-store/slices/dialogs/pivot-dialog.ts)

The `PivotDialogSlice` manages UI state for pivot table creation and editing:
- `isDialogOpen`: Whether the creation dialog is open
- `selectedPivotId` / `editingPivotId`: Selection and editing state
- `locationMode`: `'newWorksheet'` (default) or `'existingWorksheet'`
- `destinationSheetId` / `destinationCellRef`: Output placement for existing worksheet mode

### Creation Flow

1. User opens pivot dialog (via menu or ribbon)
2. Dialog shows source range (auto-detected from selection) and location options
3. On create, `usePivotTables.createPivotTable()`:
   - Calls `ws.pivots.detectFields()` to analyze source data
   - **New Worksheet mode**: Calls `ws.pivots.addWithSheet()` so sheet creation and pivot creation share the production mutation path
   - **Existing Worksheet mode**: Creates pivot on the specified sheet at the specified cell
4. Returns `{ config, outputSheetId }` so the caller can navigate to the output sheet

---

## Data Model

### PivotTableConfig Structure

The persisted Rust/generated compute DTO is the superset shown below. The public `types/data/src/data/pivot.ts` contract carries the common fields used by worksheet APIs and UI code, but currently omits some OOXML-only preservation fields such as `dataOnRows`, `firstHeaderRow`, `rowsPerPage`, `colsPerPage`, and some style flags.

```
PivotTableConfig
  schemaVersion: number           -- Persisted config schema version
  id: string                      -- Unique identifier
  name: string                    -- Display name
  sourceSheetId?: string          -- Stable source sheet ID when available
  sourceSheetName: string         -- Source sheet display name / legacy identity
  sourceRange: CellRange          -- { startRow, startCol, endRow, endCol }
  outputSheetName: string         -- Sheet where pivot is rendered
  outputLocation: { row, col }    -- Anchor cell (top-left corner)
  fields: PivotField[]            -- Detected fields from source header row
  placements: PivotFieldPlacement[] -- Where fields are placed
  filters: PivotFilter[]          -- Per-field filter configurations
  layout?: PivotTableLayout       -- Grand totals, subtotals, form, etc.
  style?: PivotTableStyle         -- Theme, stripes
  dataOptions?: PivotTableDataOptions -- Empty/error value display
  calculatedFields?: CalculatedField[] -- Post-aggregation formulas
  allowMultipleFiltersPerField?: boolean
  autoFormat?: boolean
  preserveFormatting?: boolean
  cacheId?: number                -- OOXML pivot cache ID
  dataOnRows?: boolean            -- OOXML data-axis placement
  refRange?: string               -- OOXML rendered pivot range
  firstDataRow?: number
  firstHeaderRow?: number
  firstDataCol?: number
  rowsPerPage?: number
  colsPerPage?: number
  rowItems?: PivotRowColItem[]    -- OOXML layout reconstruction
  colItems?: PivotRowColItem[]    -- OOXML layout reconstruction
  createdAt?: number              -- Unix milliseconds
  updatedAt?: number              -- Unix milliseconds
```

### Field Placement (Type-Safe Enum in Rust)

```
PivotFieldPlacement
  ::Row(AxisPlacement)     -- sortOrder, dateGrouping, numberGrouping, showSubtotals, sortByValue
  ::Column(AxisPlacement)  -- same as Row
  ::Value(ValuePlacement)  -- source, aggregateFunction (required), numberFormat, showValuesAs
  ::Filter(FilterPlacement) -- just identity
```

All variants share `PlacementBase { field_id, placement_id, position, display_name }`. Value placements also carry a `PivotValueSource`, so calculated-field measures can live beside source-field measures.

### Storage (Rust-Backed)

Pivot configs are persisted in Rust/Yrs storage via ComputeBridge. The `PivotBridge` delegates CRUD to ComputeBridge methods (`pivotCreate`, `pivotCreateWithSheet`, `pivotGet`, `pivotGetAll`, `pivotUpdate`, `pivotDelete`). Configs are stored by **output sheet** (where they are displayed), matching Excel's model.

### Key Encoding

Headers use NUL-separated compound keys for unique identification:
- Simple: `"East"` (single-level)
- Hierarchical: `"East\0Widget"` (Widget under East)
- Subtotal: `"East\0__SUBTOTAL__"` (subtotal for East group)
- Grand total: `"__GRAND_TOTAL__"`

---

## Show Values As

The Show Values As system transforms aggregated values into derived metrics. The public contract has 13 calculation names: `NoCalculation` plus 12 non-noop transforms. The non-noop transforms are hierarchy-aware.

### Entry Point

`apply_show_values_as_to_result(result, value_configs, hierarchy)`

The compute path uses this whole-result wrapper so body rows, row grand totals, column grand totals, and corner totals are transformed together. The lower-level `apply_show_values_as_with_hierarchy(rows, value_configs, grand_totals, hierarchy)` helper applies the row transforms. Both receive a `GroupHierarchy` that provides O(1) parent lookup, group-scoped iteration, and group boundary detection.

### Calculation Types

| Type | Description | Requires |
|------|-------------|----------|
| `NoCalculation` | Raw aggregated value (default) | - |
| `PercentOfGrandTotal` | `value / grand_total` | - |
| `PercentOfColumnTotal` | `value / column_total` | - |
| `PercentOfRowTotal` | `value / row_total` | - |
| `PercentOfParentRowTotal` | `value / parent_row_total` | `base_field` (optional) |
| `PercentOfParentColumnTotal` | `value / parent_column_total` | `base_field` (optional) |
| `Difference` | `value - base_value` | `base_field` + `base_item` |
| `PercentDifference` | `(value - base) / base` | `base_field` + `base_item` |
| `RunningTotal` | Cumulative sum, resets at group boundaries | `base_field` |
| `PercentRunningTotal` | `running_total / grand_total` | `base_field` |
| `RankAscending` | Rank where 1 = smallest, scoped within group | `base_field` |
| `RankDescending` | Rank where 1 = largest, scoped within group | `base_field` |
| `Index` | `(value * grand_total) / (row_total * column_total)` | - |

Percentage-style transforms return fractions; display formatting is responsible for showing percent notation.

### Base Field and Base Item

- `base_field`: Determines which hierarchy depth controls group scoping
  - `Some("Region")` -- scope to Region groups
  - `None` -- defaults to innermost (leaf) level
- `base_item`: Determines what to compare against
  - `Relative { position: Previous }` -- previous item in sort order
  - `Relative { position: Next }` -- next item in sort order
  - `Specific { value: CellValue }` -- a named item

### GroupHierarchy

Built in O(R) time from either flattened rows or the relational `AggregatedNode` tree. Provides:
- **O(1) parent lookup**: `row_group_paths[i]` gives the group path for row i
- **Group-scoped iteration**: `children_by_parent[(depth, parent_key)]` lists child row indices
- **Group boundary detection**: Check if a row is first/last in its group
- **Field depth resolution**: `depth_for_field("Region")` returns the hierarchy depth

### Numerical Accuracy

- All summations use Kahan compensated summation (`kahan_sum`)
- Tie detection in ranking uses relative epsilon (1e-12)
- Division by zero produces `CellValue::Null`

---

## Calculated Fields

**Path**: [`compute/core/crates/compute-pivot/src/calc_field/mod.rs`](../../../compute/core/crates/compute-pivot/src/calc_field/mod.rs)

Calculated fields create derived value columns using formulas that reference other fields. Formulas operate on aggregated values -- after Sum/Average/etc. has been applied.

### Expression Language

```
Revenue / Units                    -- Simple division
(Revenue - Cost) / Revenue * 100   -- Margin percentage
'Cost of Goods' + Shipping         -- Quoted field names
"Cost of Goods" + Shipping         -- Double-quoted field names are also accepted
-Revenue                           -- Unary negation
```

### API

```rust
let expr = parse_calc_field("Revenue / Units")?;
let mut fields = HashMap::new();
fields.insert("Revenue", 10000.0);
fields.insert("Units", 100.0);
let result = evaluate_calc_field(&expr, &fields); // Some(100.0)
```

### Evaluation

Calculated fields are parsed during pivot validation and mapped into the relational query as calculated measures. Each calculated field produces one additional value column per column leaf in the pivot table, with grand-total paths applying the same formula logic to aggregated totals.

---

## Key Design Decisions

### 1. Pure-Function Engine

The Rust engine is completely stateless: `(config, data, expansion_state) -> result`. No `CellMirror`, no document references. This enables:
- Deterministic results
- No shared mutable state between calls
- Simple WASM compilation

### 2. Index-Based Filtering

Filtering operates on row indices in both the relational execution path and the drill-down helper path. This keeps memory usage proportional to the number of rows, not the data size.

### 3. Resolved Config Pattern

The engine never works with raw `PivotTableConfig`. All computation goes through `ResolvedPivotConfig`, which can only be constructed via `validate_and_resolve()`. This eliminates an entire class of bugs (missing fields, invalid references, unresolved defaults).

### 4. Hierarchy-Aware Show Values As

Running totals, ranks, and difference calculations all respect group boundaries. A `GroupHierarchy` is built once per computation and shared across all transforms. For flat (single-level) pivots, the hierarchy degenerates to a single root group -- same code path, correct behavior.

### 5. Output Sheet Storage

Pivots are stored by output sheet (where displayed), not source sheet (where data comes from). This matches Excel's mental model and simplifies queries like "what pivots are on this sheet?"

---

## Current Status

The pivot table engine is Rust-backed for computation, storage, and materialization.

### Completed

- Rust `compute-pivot` facade with presenter, Show Values As, hierarchy, drill-down, field detection, and calculated-field support
- `compute-relational` engine for filtering, grouping, aggregation, sorting, calculated measures, and grand totals
- `PivotBridge` updated to call Rust via ComputeBridge
- Former TypeScript `PivotStore` config ownership removed; persisted config state now lives in Rust/Yrs storage
- ComputeBridge pivot CRUD and materialization paths (`pivotCreate`, `pivotGet`, `pivotGetAll`, `pivotUpdate`, `pivotDelete`, `pivotCreateWithSheet`, `pivotComputeFromSource`, `pivotMaterialize`)
- Show Values As UI dispatch persists via `PIVOT_SET_SHOW_VALUES_AS` / `WorksheetPivots.setShowValuesAs()`
- Public worksheet API types include placement-id-first mutation methods (`addPlacement`, `updatePlacement`, `removePlacement`, `movePlacement`, `setSortByValue`, `resetPlacement`) alongside deprecated name/field facades

### Known Limitations

- Group/Ungroup UI is not enabled in the context-menu hook (`canGroup = false`, `canUngroup = false`)
- `PivotBridge.setExpansion()` currently returns a mutation receipt but does not update the expansion provider; UI expansion state is managed by `PivotExpansionStateProvider` / `PivotExpansionManager`
- `PivotTableResult.measureDescriptors`, `PivotTableResult.valueRecords`, and TS `records` derived from them are reserved; the current Rust presenter emits empty metadata vectors
- Some imported OOXML layout metadata (`rowItems`, `colItems`, `refRange`, `dataOnRows`, `firstHeaderRow`, page counts) is preserved for reconstruction in Rust/generated DTOs but is not part of the simple public API creation flow
- `compute/api/src/sheet/pivots.rs` is a reserved stub and should not be treated as the shipped Rust sheet-level pivot API

---

## File Reference

### Rust Engine

| File | Path |
|------|------|
| Crate root | [`compute/core/crates/compute-pivot/Cargo.toml`](../../../compute/core/crates/compute-pivot/Cargo.toml) |
| lib.rs | [`compute/core/crates/compute-pivot/src/lib.rs`](../../../compute/core/crates/compute-pivot/src/lib.rs) |
| type re-exports | [`compute/core/crates/compute-pivot/src/types/`](../../../compute/core/crates/compute-pivot/src/types/) |
| pivot-types | [`compute/core/crates/types/pivot-types/src/`](../../../compute/core/crates/types/pivot-types/src/) |
| domain pivot types | [`domain-types/src/domain/pivot/`](../../../domain-types/src/domain/pivot/) |
| engine/ | [`compute/core/crates/compute-pivot/src/engine/`](../../../compute/core/crates/compute-pivot/src/engine/) |
| presenter/ | [`compute/core/crates/compute-pivot/src/presenter/`](../../../compute/core/crates/compute-pivot/src/presenter/) |
| compute-relational | [`compute/core/crates/compute-relational/src/`](../../../compute/core/crates/compute-relational/src/) |
| grouper.rs | [`compute/core/crates/compute-pivot/src/grouper.rs`](../../../compute/core/crates/compute-pivot/src/grouper.rs) |
| filter.rs | [`compute/core/crates/compute-pivot/src/filter.rs`](../../../compute/core/crates/compute-pivot/src/filter.rs) |
| show_values_as module | [`compute/core/crates/compute-pivot/src/show_values_as/mod.rs`](../../../compute/core/crates/compute-pivot/src/show_values_as/mod.rs) |
| hierarchy.rs | [`compute/core/crates/compute-pivot/src/hierarchy.rs`](../../../compute/core/crates/compute-pivot/src/hierarchy.rs) |
| calc_field module | [`compute/core/crates/compute-pivot/src/calc_field/mod.rs`](../../../compute/core/crates/compute-pivot/src/calc_field/mod.rs) |
| resolved.rs | [`compute/core/crates/compute-pivot/src/resolved.rs`](../../../compute/core/crates/compute-pivot/src/resolved.rs) |
| storage bridge methods | [`compute/core/src/storage/engine/objects/pivots.rs`](../../../compute/core/src/storage/engine/objects/pivots.rs) |
| Yrs pivot storage | [`compute/core/src/storage/sheet/pivots.rs`](../../../compute/core/src/storage/sheet/pivots.rs) |
| import/recalc materialization | [`compute/core/src/storage/engine/pivot_materialization.rs`](../../../compute/core/src/storage/engine/pivot_materialization.rs) |
| mirror materializer | [`compute/core/src/mirror/write/pivot_materialization.rs`](../../../compute/core/src/mirror/write/pivot_materialization.rs) |
| reserved compute API sheet stub | [`compute/api/src/sheet/pivots.rs`](../../../compute/api/src/sheet/pivots.rs) |

### TypeScript Kernel

| File | Path |
|------|------|
| PivotBridge | [`kernel/src/bridges/pivot-bridge.ts`](../../../kernel/src/bridges/pivot-bridge.ts) |
| PivotEventBridge | [`kernel/src/bridges/pivot-event-bridge.ts`](../../../kernel/src/bridges/pivot-event-bridge.ts) |

### Contracts

| File | Path |
|------|------|
| Pivot types | [`types/data/src/data/pivot.ts`](../../../types/data/src/data/pivot.ts) |
| Worksheet pivot API | [`types/api/src/api/worksheet/pivots.ts`](../../../types/api/src/api/worksheet/pivots.ts) |
| Bridge interface | [`types/bridges/src/pivot-bridge.ts`](../../../types/bridges/src/pivot-bridge.ts) |
| Events | [`types/events/src/pivot-events.ts`](../../../types/events/src/pivot-events.ts) |
| Contracts shims | [`contracts/src/data/pivot.ts`](../../../contracts/src/data/pivot.ts), [`contracts/src/api/worksheet/pivots.ts`](../../../contracts/src/api/worksheet/pivots.ts), [`contracts/src/bridges/pivot-bridge.ts`](../../../contracts/src/bridges/pivot-bridge.ts), [`contracts/src/events/pivot-events.ts`](../../../contracts/src/events/pivot-events.ts) |

### UI

| File | Path |
|------|------|
| usePivotTables | [`apps/spreadsheet/src/hooks/data/use-pivot-tables.ts`](../../../apps/spreadsheet/src/hooks/data/use-pivot-tables.ts) |
| usePivotEditorActions | [`apps/spreadsheet/src/hooks/data/use-pivot-editor-actions.ts`](../../../apps/spreadsheet/src/hooks/data/use-pivot-editor-actions.ts) |
| usePivotContextMenuActions | [`apps/spreadsheet/src/hooks/data/use-pivot-context-menu-actions.ts`](../../../apps/spreadsheet/src/hooks/data/use-pivot-context-menu-actions.ts) |
| Pivot dialog state | [`apps/spreadsheet/src/ui-store/slices/dialogs/pivot-dialog.ts`](../../../apps/spreadsheet/src/ui-store/slices/dialogs/pivot-dialog.ts) |
