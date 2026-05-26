# Pivot Tables

Comprehensive documentation for the Pivot Table feature in the Mog spreadsheet engine. The pivot table system implements an Excel-compatible pivot table model with a fully-ported Rust computation engine, TypeScript kernel bridges, and React UI integration.

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
- [Migration Status](#migration-status)
- [File Reference](#file-reference)

---

## Overview

Pivot tables summarize large datasets by grouping, filtering, and aggregating data along configurable row and column axes. Users select source data, define field placements (rows, columns, values, filters), and the engine produces a materialized result table with headers, aggregated values, subtotals, and grand totals.

The implementation is Excel-compatible: field areas, aggregation functions, date/number grouping, Show Values As transforms, expand/collapse hierarchies, drill-down, and layout modes all follow Excel semantics.

### Scale

| Component | Lines | Tests |
|-----------|-------|-------|
| Rust `compute-pivot` crate (source) | ~12,400 | 666 |
| Rust `compute-pivot` crate (total incl. tests) | ~41,800 | - |
| TypeScript `pivot-bridge.ts` | ~546 | - |
| TypeScript `pivot-event-bridge.ts` | ~305 | - |
| Contracts (`pivot.ts`, bridge interfaces) | ~630 | - |
| UI hooks (3 files) | ~870 | - |

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
|  |  - Subscribes to pivot:created/updated/deleted              | |
|  |  - Triggers recomputation when source data changes          | |
|  +-------------------------------------------------------------+ |
+------------------------------------------------------------------+
         |
         | Tauri IPC (desktop) / WASM (web)
         |
+------------------------------------------------------------------+
|                    Rust Compute Layer                             |
|  +-------------------------------------------------------------+|
|  | compute-pivot crate                                          ||
|  |                                                              ||
|  |  engine/                                                     ||
|  |    validate -> filter -> group(row) -> group(col)            ||
|  |    -> aggregate -> calc_fields -> sort -> grand_totals       ||
|  |    -> show_values_as                                         ||
|  |                                                              ||
|  |  +----------+ +----------+ +---------+ +-------------------+ ||
|  |  | grouper  | | filter   | | engine/ | | show_values_as    | ||
|  |  | - text   | | - include| | compute | | - 13 transforms   | ||
|  |  | - date   | | - exclude| | - rows  | | - hierarchy-aware | ||
|  |  | - number | | - cond   | | - cols  | | - Kahan summation | ||
|  |  | - expand | | - top/N  | | - agg   | +-------------------+ ||
|  |  +----------+ +----------+ +---------+                       ||
|  |                                                              ||
|  |  Depends on: value-types, compute-stats                      ||
|  +-------------------------------------------------------------+||
+------------------------------------------------------------------+
```

### Communication Flow

1. **Desktop (Tauri)**: TypeScript calls Rust via Tauri IPC commands (`pivot_compute`, `pivot_detect_fields`, `pivot_drill_down`, `pivot_validate_config`).
2. **Web (WASM)**: TypeScript calls Rust via WASM module exports (same function signatures, loaded lazily from `@mog-sdk/wasm`).
3. **Auto-detection**: `PivotBridge.callRustPivot()` checks `isTauriEnvironment()` and routes accordingly.

### Data Marshaling

CellValue representations differ between TypeScript and Rust:

| TypeScript | Rust Wire Format |
|------------|-----------------|
| `42` (number) | `{ type: "Number", value: 42 }` |
| `"hello"` (string) | `{ type: "Text", value: "hello" }` |
| `true` (boolean) | `{ type: "Boolean", value: true }` |
| `null` | `{ type: "Null" }` |
| `{ type: "error", value: "#DIV/0!" }` | `{ type: "Error", value: "Div0" }` |

Conversion functions: `toComputeCellValue()`, `fromComputeCellValue()`, `convertDataToRust()`, `convertPivotResultFromRust()` (all in `pivot-bridge.ts`).

---

## Rust compute-pivot Crate

**Path**: [`compute/core/crates/compute-pivot/`](../../compute/core/crates/compute-pivot/)

**Dependencies**: `value-types` (CellValue, CellError, date_serial), `compute-stats` (aggregation, sorting, filtering primitives), `chrono` (date grouping), `serde`/`serde_json`.

The crate is a pure-function engine: `(config, data, expansion_state) -> result`. No document state, no side effects.

### Module Map

| Module | Purpose | Key Types/Functions |
|--------|---------|-------------------|
| `types/` | All pivot-specific types | `PivotTableConfig`, `PivotField`, `PivotFieldPlacement`, `PivotFilter`, `PivotTableResult`, `ShowValuesAs` |
| `types/field.rs` | Field definition | `PivotField { id, name, source_column, data_type }` |
| `types/placement.rs` | Type-safe placement enum | `PivotFieldPlacement::Row(AxisPlacement)`, `::Column(AxisPlacement)`, `::Value(ValuePlacement)`, `::Filter(FilterPlacement)` |
| `types/config.rs` | Top-level config | `PivotTableConfig`, `PivotTableLayout`, `CalculatedField`, `CellRange`, `OutputLocation` |
| `types/result.rs` | Computation output | `PivotTableResult`, `PivotRow`, `PivotHeader`, `PivotColumnHeader`, `PivotGrandTotals` |
| `types/show_values_as.rs` | Show Values As types | `ShowValuesAs` (13 variants), `ShowValuesAsConfig`, `ShowValuesAsBaseItem`, `SortByValueConfig` |
| `types/filter_types.rs` | Filter types | `PivotFilter`, `PivotFilterCondition`, `PivotTopBottomFilter`, `TopBottomType`, `TopBottomBy` |
| `types/expansion.rs` | Expand/collapse state | `PivotExpansionState` |
| `resolved.rs` | Validated config | `ResolvedPivotConfig` -- constructed only via `validate_and_resolve()` |
| `engine/` | Pipeline orchestrator | `compute()`, `detect_fields()`, `drill_down()`, `validate_config()` |
| `engine/compute.rs` | Core computation | Orchestrates the 9-stage pipeline |
| `engine/validation.rs` | Config validation | `validate_and_resolve()` -- produces `ResolvedPivotConfig` |
| `engine/type_detection.rs` | Field detection | `detect_fields()` -- scans source data to infer field names and types |
| `engine/row_computation.rs` | Row building | `compute_pivot_rows()`, `apply_calc_fields_to_values()` |
| `engine/value_sorting.rs` | Value-based sort | `sort_rows_by_value()` -- sort rows by aggregated values |
| `engine/grand_totals.rs` | Grand total computation | `compute_grand_totals()` |
| `engine/drill_down.rs` | Drill-down | `drill_down()`, `drill_down_resolved()` -- source row lookup |
| `grouper.rs` | Hierarchical grouping | `create_group_hierarchy()`, `flatten_group_hierarchy()`, `apply_date_grouping()`, `apply_number_grouping()` |
| `filter.rs` | Index-based filtering | `apply_filters()` -- include/exclude, conditions, top/bottom N |
| `show_values_as.rs` | Post-aggregation transforms | `apply_show_values_as_with_hierarchy()` |
| `hierarchy.rs` | Group hierarchy index | `GroupHierarchy`, `build_group_hierarchy()` -- O(1) parent lookup, group-scoped iteration |
| `calc_field.rs` | Calculated fields | `parse_calc_field()`, `evaluate_calc_field()`, `CalcFieldExpr` |

### Re-exports from compute-stats

The crate re-exports key primitives from `compute-stats`:

- **Aggregator** (`compute_stats::aggregate`): `aggregate()` function supporting 12 aggregate functions
- **Sorter** (`compute_stats::sort`): `sort_by_in_place()`, `sort_by_custom_order_in_place()`, `SortConfig`
- **Values** (`compute_stats::values`): `cell_value_to_key()`, `cell_value_eq()`, `cell_value_is_blank()`, `kahan_sum()`

### Type System: "Parse, Don't Validate"

The types module follows a parse-don't-validate philosophy:

1. **Wire types** (`PivotFieldPlacementFlat`, `PivotFilterConditionFlat`) match the TypeScript JSON format for serde compatibility.
2. **Type-safe enums** (`PivotFieldPlacement`, `PivotFilterCondition`) make invalid states unrepresentable. Area-specific fields only exist on the correct variant.
3. **Resolved types** (`ResolvedPivotConfig`, `ResolvedAxisPlacement`, etc.) can only be constructed through validation. The engine accepts only resolved types -- zero fallback defaults.

`From` implementations convert between flat and type-safe representations at the boundary.

### Round 68 Identity and UX Contract

Pivot UX is placement-id-first. A pivot placement has stable identity independent of source field, area, position, display label, aggregate function, and show-values-as transform. This is required because a pivot can place the same field multiple times in Values, place a calculated measure beside source-field measures, or sort/filter an axis by a specific measure.

The architectural boundary is:

| Concern | Owner |
| --- | --- |
| Persistent pivot config, placement identity, calculated-field identity, expansion keys, result measure provenance | Rust domain/compute/storage |
| Public mutation API and kernel mutation receipts | Kernel worksheet pivot API / `PivotBridge` |
| User mutation entry | Spreadsheet action handlers via `dispatch(PIVOT_*)` |
| UI sessions, semantic targets, dialog drafts, range-pick drafts, command readiness receipts | `apps/spreadsheet/src/systems/pivot` |
| Presentational markup and `data-pivot-*` attributes | `apps/spreadsheet/src/components/pivot` |
| App-eval readback | Read-only model/surface/UI contracts |

Materialized grid cells own workbook-visible pivot values. The pivot overlay owns semantic affordances, hit targets, context metadata, and pivot-specific interaction UI. Expansion that changes materialized cells is persistent pivot config/kernel state; overlay-only preview expansion must be modeled separately if it is introduced later.

Command completion is layered:

```text
UI input -> dispatch(PIVOT_*) -> action handler -> ws.pivots/kernel bridge
  -> Rust config/result/materialization -> PivotKernelMutationReceipt
  -> systems/pivot UI readiness tracking -> projection/paint
  -> PivotCommandReceipt
```

App-eval keeps real UI input paths. Only readback changes: assertions should read stable model/surface/UI snapshots or visible grid snapshots, not scrape pivot overlay table structure.

---

## Computation Pipeline

The engine processes pivot computations through a 9-stage linear pipeline:

```
validate -> filter -> group(row) -> group(col) -> aggregate
         -> calc_fields -> sort -> grand_totals -> show_values_as
```

### Stage 1: Validate (`validate_and_resolve`)

Converts wire-format `PivotTableConfig` into `ResolvedPivotConfig`:
- Verifies all field references exist
- Resolves all `Option` defaults to concrete values
- Converts flat serde types to type-safe enums
- Pre-resolves field IDs to column indices
- Pre-parses calculated field formulas
- Returns `Result<ResolvedPivotConfig, PivotError>` -- engine never touches raw config

### Stage 2: Filter (`apply_filters_resolved`)

Narrows source data to surviving row indices (AND logic, O(N * F)):
1. **Include list** -- allowlist via `HashSet` membership
2. **Exclude list** -- denylist via `HashSet` membership
3. **Condition** -- per-row predicate (equals, contains, between, above/below average, etc.)
4. **showItemsWithNoData** -- removes blank rows unless explicitly included
5. **Top/Bottom N** -- ranking filter (requires aggregation, applied last)

No data is cloned -- only indices are tracked.

### Stage 3: Group Rows (`create_group_hierarchy`)

Builds the row axis hierarchy tree from surviving data:
- **Text grouping**: exact match (case-insensitive via `cell_value_to_key`)
- **Date grouping**: buckets serial dates into Year, Quarter, Month, Week, Day, Hour, Minute, Second
- **Number grouping**: equal-width bins with precision-aware labels
- **Expand/collapse**: respects `PivotExpansionState` with default-expanded flag

Week grouping uses Excel conventions: Sunday start, Week 1 contains January 1.

Each `GroupNode` contains: key, display value, field ID, depth, children, row indices, expansion state.

Safety: `MAX_GROUP_NODES = 100,000` prevents runaway grouping.

### Stage 4: Group Columns (`create_group_hierarchy`)

Same algorithm as row grouping, but builds the column axis tree.

### Stage 5: Aggregate (`compute_pivot_rows`)

Intersects row and column groups, then aggregates values for each cell:

| Function | Description |
|----------|-------------|
| `Sum` | Sum of numeric values |
| `Count` | Count of all values (including blanks) |
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

All aggregation uses Welford's algorithm (variance) and Kahan compensated summation for numerical stability.

### Stage 6: Calculated Fields (`apply_calc_fields_to_values`)

Evaluates post-aggregation formulas on the aggregated values. Expression language:
- Field references: `Revenue`, `'Cost of Goods'`
- Arithmetic: `+`, `-`, `*`, `/` with standard precedence
- Parentheses: `(Revenue - Cost) / Revenue`
- Numeric literals: `100`, `3.14`
- Unary negation: `-Revenue`

### Stage 7: Sort (`sort_rows_by_value`)

If any row/column placement has `sort_by_value` configured, rows are sorted by their aggregated values (not labels). Children sort within their parent group (hierarchy preserved).

### Stage 8: Grand Totals (`compute_grand_totals`)

Computes three types of grand totals:
- **Row grand totals** (`grand_totals.row`): bottom row, one value per column-leaf x value-field
- **Column grand totals** (`grand_totals.column`): rightmost column, `column[row_idx][value_idx]`
- **Corner grand total** (`grand_totals.grand`): overall total, one value per value field

### Stage 9: Show Values As (`apply_show_values_as_with_hierarchy`)

Post-aggregation transforms applied to the final values. See [Show Values As](#show-values-as) for full details.

### Pipeline Output: `PivotTableResult`

```rust
pub struct PivotTableResult {
    pub column_headers: Vec<PivotColumnHeader>,  // Multi-level column headers
    pub rows: Vec<PivotRow>,                     // Data rows + subtotals
    pub grand_totals: PivotGrandTotals,          // Row, column, corner totals
    pub source_row_count: usize,                 // Source data size
    pub errors: Option<Vec<String>>,             // Non-fatal errors
}
```

---

## Bridges

### PivotBridge

**Path**: [`kernel/src/bridges/pivot-bridge.ts`](../../kernel/src/bridges/pivot-bridge.ts)

The `PivotBridge` is the single entry point connecting the UI layer to the Rust pivot engine. It implements `IPivotBridge`. The former `PivotStore` was deleted in Phase 4 -- all pivot config state now lives in Rust, accessed via `ComputeBridge`.

**Key responsibilities**:
- **CRUD**: `createPivot()`, `getPivot()`, `getAllPivots()`, `updatePivot()`, `deletePivot()`, `createPivotWithSheet()` -- all delegate to ComputeBridge methods (`pivotCreate`, `pivotGet`, `pivotGetAll`, `pivotUpdate`, `pivotDelete`, `pivotCreateWithSheet`)
- **Computation**: `compute()`, `computeAll()`, `refresh()`, `refreshDependentPivots()`
- **Field detection**: `detectFields()` -- analyzes source data to infer field names/types
- **Drill-down**: `drillDown()`, `getDrillDownData()` -- retrieve source rows for a pivot cell
- **Caching**: Result cache with version-based invalidation (config version + data version)
- **Subscriptions**: `subscribe(pivotId, callback)` for reactive UI updates

**Cache invalidation strategy**:
- Config version increments on any pivot config change (via EventBus `pivot:created/updated/deleted` events)
- Data version increments on any cell change in the source sheet (via `refreshDependentPivots`)
- Cached result is valid only when both config and data versions match

**ComputeBridge methods used**:

| Method | Purpose |
|--------|---------|
| `pivotCreate(sheetId, config)` | Create a pivot table |
| `pivotGet(sheetId, pivotId)` | Get a single pivot config |
| `pivotGetAll(sheetId)` | Get all pivots on a sheet |
| `pivotUpdate(sheetId, pivotId, config)` | Update a pivot config |
| `pivotDelete(sheetId, pivotId)` | Delete a pivot table |
| `pivotCreateWithSheet(sheetName, config)` | Atomically create sheet + pivot |
| `pivotCompute(config, data, expansionState)` | Full pivot computation |
| `pivotDetectFields(data)` | Detect fields from source data |
| `pivotDrillDown(config, data, rowKey, colKey)` | Get source row indices for a pivot cell |

### PivotEventBridge

**Path**: [`kernel/src/bridges/pivot-event-bridge.ts`](../../kernel/src/bridges/pivot-event-bridge.ts)

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
    onPivotRefresh: (pivotId) => { /* trigger re-render */ },
  });
  return disconnect;
}, [activeSheetId, ctx.pivot]);
```

The `createPivotEventBridge()` factory supports dynamic sheet ID tracking -- call `setSheetId()` when the active sheet changes without reconnecting all event listeners.

---

## Contracts

**Path**: [`contracts/src/data/pivot.ts`](../../contracts/src/data/pivot.ts)

The contracts define the shared type interface between kernel, UI, and engine.

### Core Types

| Type | Location | Purpose |
|------|----------|---------|
| `PivotField` | `data/pivot.ts` | Field definition (id, name, sourceColumn, dataType) |
| `PivotFieldPlacement` | `data/pivot.ts` | Field placed in an area with config |
| `PivotFieldArea` | `data/pivot.ts` | `'row' \| 'column' \| 'value' \| 'filter'` |
| `AggregateFunction` | `data/pivot.ts` | 12 aggregation types |
| `PivotFilter` | `data/pivot.ts` | Include/exclude/condition/topBottom per field |
| `PivotTableConfig` | `data/pivot.ts` | Complete pivot definition |
| `PivotTableResult` | `data/pivot.ts` | Computed output |
| `PivotRow`, `PivotHeader` | `data/pivot.ts` | Row/header structures in results |
| `ShowValuesAs` | `data/pivot.ts` | 13 post-aggregation calculation types |
| `ShowValuesAsConfig` | `data/pivot.ts` | Calculation type + base field + base item |
| `SortByValueConfig` | `data/pivot.ts` | Sort by aggregated values |

### Bridge Interfaces

| Interface | Location | Purpose |
|-----------|----------|---------|
| `IPivotBridge` | `bridges/pivot-bridge.ts` | CRUD + computation + caching + subscription |
| `PivotResultCallback` | `bridges/pivot-bridge.ts` | Subscription callback type |
| `PivotCacheStats` | `bridges/pivot-bridge.ts` | Cache debugging info |

### Event Types

| Event | Location | Fields |
|-------|----------|--------|
| `PivotCreatedEvent` | `events/pivot-events.ts` | outputSheetId, sourceSheetId, pivotId, config |
| `PivotUpdatedEvent` | `events/pivot-events.ts` | outputSheetId, sourceSheetId, pivotId, oldConfig, newConfig |
| `PivotDeletedEvent` | `events/pivot-events.ts` | outputSheetId, sourceSheetId, pivotId |
| `PivotExpansionChangedEvent` | `events/pivot-events.ts` | sheetId, pivotId, headerKey, isExpanded, axis |

---

## UI Layer

### React Hooks

**Path**: [`apps/spreadsheet/src/hooks/data/`](../../apps/spreadsheet/src/hooks/data/)

| Hook | File | Purpose |
|------|------|---------|
| `usePivotTables` | `use-pivot-tables.ts` | Primary hook: CRUD, field management, computation, drill-down, expansion |
| `usePivotEditorActions` | `use-pivot-editor-actions.ts` | Editor panel: add/remove/move fields, aggregate change, refresh, delete |
| `usePivotContextMenuActions` | `use-pivot-context-menu-actions.ts` | Context menu: sort, expand/collapse, aggregate, Show Values As, group/ungroup |

### Dialog State (Zustand)

**Path**: [`apps/spreadsheet/src/ui-store/slices/dialogs/pivot-dialog.ts`](../../apps/spreadsheet/src/ui-store/slices/dialogs/pivot-dialog.ts)

The `PivotDialogSlice` manages UI state for pivot table creation and editing:
- `isDialogOpen`: Whether the creation dialog is open
- `selectedPivotId` / `editingPivotId`: Selection and editing state
- `locationMode`: `'newWorksheet'` (default) or `'existingWorksheet'`
- `destinationSheetId` / `destinationCellRef`: Output placement for existing worksheet mode

### Creation Flow

1. User opens pivot dialog (via menu or ribbon)
2. Dialog shows source range (auto-detected from selection) and location options
3. On create, `usePivotTables.createPivotTable()`:
   - Calls `pivotBridge.detectFields()` to analyze source data
   - **New Worksheet mode**: Creates a new sheet in a single Yjs transaction (atomic undo), then creates pivot on it
   - **Existing Worksheet mode**: Creates pivot on the specified sheet at the specified cell
4. Returns `{ config, outputSheetId }` so the caller can navigate to the output sheet

---

## Data Model

### PivotTableConfig Structure

```
PivotTableConfig
  id: string                      -- Unique identifier
  name: string                    -- Display name
  sourceSheetId: string           -- Sheet containing source data
  sourceRange: CellRange          -- { startRow, startCol, endRow, endCol }
  outputSheetId: string           -- Sheet where pivot is rendered
  outputLocation: { row, col }    -- Anchor cell (top-left corner)
  fields: PivotField[]            -- Detected fields from source header row
  placements: PivotFieldPlacement[] -- Where fields are placed
  filters: PivotFilter[]          -- Per-field filter configurations
  layout?: PivotTableLayout       -- Grand totals, subtotals, form, etc.
  style?: PivotTableStyle         -- Theme, stripes
  dataOptions?: PivotTableDataOptions -- Empty/error value display
  calculatedFields?: CalculatedField[] -- Post-aggregation formulas
  createdAt?: number              -- Unix milliseconds
  updatedAt?: number              -- Unix milliseconds
```

### Field Placement (Type-Safe Enum in Rust)

```
PivotFieldPlacement
  ::Row(AxisPlacement)     -- sortOrder, dateGrouping, numberGrouping, showSubtotals, sortByValue
  ::Column(AxisPlacement)  -- same as Row
  ::Value(ValuePlacement)  -- aggregateFunction (required), numberFormat, showValuesAs
  ::Filter(FilterPlacement) -- just identity
```

All variants share `PlacementBase { field_id, position, display_name }`.

### Storage (Rust-Backed)

Pivot configs are persisted in Rust via ComputeBridge. The `PivotBridge` delegates all CRUD to ComputeBridge methods (`pivotCreate`, `pivotGet`, `pivotGetAll`, `pivotUpdate`, `pivotDelete`). Configs are stored by **output sheet** (where they are displayed), matching Excel's model.

### Key Encoding

Headers use NUL-separated compound keys for unique identification:
- Simple: `"East"` (single-level)
- Hierarchical: `"East\0Widget"` (Widget under East)
- Subtotal: `"East\0__SUBTOTAL__"` (subtotal for East group)
- Grand total: `"__GRAND_TOTAL__"`

---

## Show Values As

The Show Values As system transforms aggregated values into derived metrics. It is one of the most complex parts of the pivot table engine, with 13 calculation types that are all hierarchy-aware.

### Entry Point

`apply_show_values_as_with_hierarchy(rows, value_configs, grand_totals, hierarchy)`

The single public entry point. Receives a `GroupHierarchy` that provides O(1) parent lookup, group-scoped iteration, and group boundary detection.

### Calculation Types

| Type | Description | Requires |
|------|-------------|----------|
| `NoCalculation` | Raw aggregated value (default) | - |
| `PercentOfGrandTotal` | `value / grand_total * 100` | - |
| `PercentOfColumnTotal` | `value / column_total * 100` | - |
| `PercentOfRowTotal` | `value / row_total * 100` | - |
| `PercentOfParentRowTotal` | `value / parent_row_total * 100` | `base_field` (optional) |
| `PercentOfParentColumnTotal` | `value / parent_column_total * 100` | `base_field` (optional) |
| `Difference` | `value - base_value` | `base_field` + `base_item` |
| `PercentDifference` | `(value - base) / base * 100` | `base_field` + `base_item` |
| `RunningTotal` | Cumulative sum, resets at group boundaries | `base_field` |
| `PercentRunningTotal` | `running_total / grand_total * 100` | `base_field` |
| `RankAscending` | Rank where 1 = smallest, scoped within group | `base_field` |
| `RankDescending` | Rank where 1 = largest, scoped within group | `base_field` |
| `Index` | `(value * grand_total) / (row_total * column_total)` | - |

### Base Field and Base Item

- `base_field`: Determines which hierarchy depth controls group scoping
  - `Some("Region")` -- scope to Region groups
  - `None` -- defaults to innermost (leaf) level
- `base_item`: Determines what to compare against
  - `Relative { position: Previous }` -- previous item in sort order
  - `Relative { position: Next }` -- next item in sort order
  - `Specific { value: CellValue }` -- a named item

### GroupHierarchy

Built in O(R) time (one pass over flattened rows). Provides:
- **O(1) parent lookup**: `row_group_paths[i]` gives the group path for row i
- **Group-scoped iteration**: `children_at_depth[depth][parent_key]` lists child row indices
- **Group boundary detection**: Check if a row is first/last in its group
- **Field depth resolution**: `depth_for_field("Region")` returns the hierarchy depth

### Numerical Accuracy

- All summations use Kahan compensated summation (`kahan_sum`)
- Tie detection in ranking uses relative epsilon (1e-12)
- Division by zero produces `CellValue::Null`

---

## Calculated Fields

**Path**: [`compute/core/crates/compute-pivot/src/calc_field.rs`](../../compute/core/crates/compute-pivot/src/calc_field.rs)

Calculated fields create derived value columns using formulas that reference other fields. Formulas operate on aggregated values -- after Sum/Average/etc. has been applied.

### Expression Language

```
Revenue / Units                    -- Simple division
(Revenue - Cost) / Revenue * 100   -- Margin percentage
'Cost of Goods' + Shipping         -- Quoted field names
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

Calculated fields are evaluated at pipeline Stage 6 (after aggregation, before sorting). Each calculated field produces one additional value column per column leaf in the pivot table.

---

## Key Design Decisions

### 1. Pure-Function Engine

The Rust engine is completely stateless: `(config, data, expansion_state) -> result`. No `CellMirror`, no document references. This enables:
- Easy testing (666 unit tests)
- Deterministic results
- No shared mutable state between calls
- Simple WASM compilation

### 2. Index-Based Filtering

Filtering operates on row indices, never on cloned data rows. This keeps memory usage proportional to the number of rows, not the data size.

### 3. Resolved Config Pattern

The engine never works with raw `PivotTableConfig`. All computation goes through `ResolvedPivotConfig`, which can only be constructed via `validate_and_resolve()`. This eliminates an entire class of bugs (missing fields, invalid references, unresolved defaults).

### 4. Hierarchy-Aware Show Values As

Running totals, ranks, and difference calculations all respect group boundaries. A `GroupHierarchy` is built once per computation and shared across all transforms. For flat (single-level) pivots, the hierarchy degenerates to a single root group -- same code path, correct behavior.

### 5. Output Sheet Storage

Pivots are stored by output sheet (where displayed), not source sheet (where data comes from). This matches Excel's mental model and simplifies queries like "what pivots are on this sheet?"

---

## Migration Status

The pivot table engine was fully ported from TypeScript to Rust.

### Completed

- Rust `compute-pivot` crate: all core modules (types, engine, grouper, filter, show_values_as, hierarchy, calc_field)
- 666 tests passing
- `PivotBridge` updated to call Rust via ComputeBridge
- `PivotStore` deleted (Phase 4) -- all config state now lives in Rust
- ComputeBridge pivot CRUD for persistence (pivotCreate, pivotGet, pivotGetAll, pivotUpdate, pivotDelete, pivotCreateWithSheet)

### Known Limitations

- Show Values As UI wiring is a placeholder (context menu logs to console, does not persist)
- Group/Ungroup UI is a placeholder (context menu logs to console)

---

## File Reference

### Rust Engine

| File | Path |
|------|------|
| Crate root | [`compute/core/crates/compute-pivot/Cargo.toml`](../../compute/core/crates/compute-pivot/Cargo.toml) |
| lib.rs | [`compute/core/crates/compute-pivot/src/lib.rs`](../../compute/core/crates/compute-pivot/src/lib.rs) |
| types/ | [`compute/core/crates/compute-pivot/src/types/`](../../compute/core/crates/compute-pivot/src/types/) |
| engine/ | [`compute/core/crates/compute-pivot/src/engine/`](../../compute/core/crates/compute-pivot/src/engine/) |
| grouper.rs | [`compute/core/crates/compute-pivot/src/grouper.rs`](../../compute/core/crates/compute-pivot/src/grouper.rs) |
| filter.rs | [`compute/core/crates/compute-pivot/src/filter.rs`](../../compute/core/crates/compute-pivot/src/filter.rs) |
| show_values_as module | [`compute/core/crates/compute-pivot/src/show_values_as/mod.rs`](../../compute/core/crates/compute-pivot/src/show_values_as/mod.rs) |
| hierarchy.rs | [`compute/core/crates/compute-pivot/src/hierarchy.rs`](../../compute/core/crates/compute-pivot/src/hierarchy.rs) |
| calc_field.rs | [`compute/core/crates/compute-pivot/src/calc_field.rs`](../../compute/core/crates/compute-pivot/src/calc_field.rs) |
| resolved.rs | [`compute/core/crates/compute-pivot/src/resolved.rs`](../../compute/core/crates/compute-pivot/src/resolved.rs) |

### TypeScript Kernel

| File | Path |
|------|------|
| PivotBridge | [`kernel/src/bridges/pivot-bridge.ts`](../../kernel/src/bridges/pivot-bridge.ts) |
| PivotEventBridge | [`kernel/src/bridges/pivot-event-bridge.ts`](../../kernel/src/bridges/pivot-event-bridge.ts) |

### Contracts

| File | Path |
|------|------|
| Pivot types | [`contracts/src/data/pivot.ts`](../../contracts/src/data/pivot.ts) |
| Bridge interface | [`contracts/src/bridges/pivot-bridge.ts`](../../contracts/src/bridges/pivot-bridge.ts) |
| Events | [`contracts/src/events/pivot-events.ts`](../../contracts/src/events/pivot-events.ts) |

### UI

| File | Path |
|------|------|
| usePivotTables | [`apps/spreadsheet/src/hooks/data/use-pivot-tables.ts`](../../apps/spreadsheet/src/hooks/data/use-pivot-tables.ts) |
| usePivotEditorActions | [`apps/spreadsheet/src/hooks/data/use-pivot-editor-actions.ts`](../../apps/spreadsheet/src/hooks/data/use-pivot-editor-actions.ts) |
| usePivotContextMenuActions | [`apps/spreadsheet/src/hooks/data/use-pivot-context-menu-actions.ts`](../../apps/spreadsheet/src/hooks/data/use-pivot-context-menu-actions.ts) |
| Pivot dialog state | [`apps/spreadsheet/src/ui-store/slices/dialogs/pivot-dialog.ts`](../../apps/spreadsheet/src/ui-store/slices/dialogs/pivot-dialog.ts) |
