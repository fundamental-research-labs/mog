# Data Model

## Overview

Persistent spreadsheet state lives in the Rust compute/document storage layer. Workspace-internal kernel code talks to it through `ComputeBridge`, using WASM in browsers, Tauri IPC in desktop hosts, and N-API in Node/headless runtimes. Rust owns cell storage, formula evaluation, dependency tracking, recalculation, CRDT sync bytes, and undo origins.

The spreadsheet uses the **Identity Model** for cells, rows, and columns. Cells are keyed by stable `CellId` values, while row and column order is tracked separately by stable `RowId` and `ColId` values. Structural edits update identity/order indexes instead of rewriting cell keys.

This page documents the internal storage contract. Public consumers should use shipped public packages such as `@mog-sdk/sdk`, `@mog-sdk/embed`, `@mog-sdk/spreadsheet-app`, `@mog-sdk/sheet-view`, and `@mog-sdk/contracts`; `@mog-sdk/kernel` and direct `ComputeBridge` access are workspace-internal integration surfaces.

```
Yrs document
│
├── workbook: Y.Map
│   ├── sheetOrder: Y.Array<SheetId>
│   ├── schemaVersion: u32 schema-version sentinel stored as Yrs BigInt
│   ├── workbookSettings: Y.Map
│   ├── workbookIdentity: Y.Map
│   ├── workbookLinks: Y.Map
│   ├── workbookConnections: Y.Map
│   ├── importedExternalCache / importedExternalUsageProvenance: Y.Map
│   ├── importedExternalPackageArtifacts / packageFidelityMetadata: Y.Map
│   ├── namedRanges: Y.Map                         ◄── Defined names
│   ├── tables: Y.Map                              ◄── Workbook-level table registry
│   ├── customTableStyles / xlsxTableStyles: Y.Map
│   ├── dataTableRegions: Y.Map
│   ├── slicers: Y.Map                             ◄── Workbook-level slicer registry
│   ├── timelines: Y.Map
│   ├── powerQuery: Y.Map
│   ├── scenarios: Y.Map
│   ├── pivotSpecs: Y.Map
│   ├── pivotCacheSources: Y.Map
│   ├── pivotCacheRecords: Y.Map
│   ├── theme: Y.Map
│   ├── custom_cell_styles: Y.Map
│   ├── rangeBindings: Y.Map
│   ├── stylePalette / workbookStylesheet / differentialFormatRegistry: Y.Map
│   ├── sharedStringHints: Y.Map
│   ├── documentProperties / extendedDocumentProperties: Y.Map
│   ├── xlsxMetadata / fileVersion / fileSharing / webPublishing: Y.Map
│   └── threadedCommentPersons: Y.Map / threadedCommentPersonsPartPresent: bool
│
├── security: Y.Map
│   ├── policies: Y.Map
│   ├── templates: Y.Map
│   └── version: number                            ◄── Created on first security write
│
└── sheets: Y.Map<SheetId, Y.Map>
    └── {sheetId}: Y.Map
        ├── properties: Y.Map                      ◄── Sheet metadata/settings
        ├── cells: Y.Map<CellId, Y.Map>            ◄── Cell values and formulas
        ├── cellProperties: Y.Map<CellId, Y.Map>   ◄── Formatting and non-compute metadata
        ├── gridIndex: Y.Map
        │   ├── posToId: Y.Map<"rowIdHex:colIdHex", CellId>
        │   ├── idToPos: Y.Map<CellId, "rowIdHex:colIdHex">
        │   └── rowAxis / colAxis: compact identity stores when present
        ├── rowOrder: Y.Array<RowId>
        ├── colOrder: Y.Array<ColId>
        ├── rowHeights: Y.Map<RowId, number>
        ├── colWidths: Y.Map<ColId, number>
        ├── rowFormats: Y.Map<RowId, CellFormat>
        ├── colFormats: Y.Map<ColId, CellFormat>
        ├── schemas: Y.Map
        ├── validationRules: Y.Map
        ├── ranges: Y.Map
        ├── rangePayloads: Y.Map
        ├── rangeFormats: Y.Map
        ├── rangeBindings: Y.Map
        ├── merges: Y.Map
        ├── mergeBackups: Y.Map
        ├── manualHiddenRows: Y.Map<RowId, true>
        ├── filterHiddenRows: Y.Map<filterId, Y.Map<RowId, true>>
        ├── hiddenRows / hiddenCols: Y.Map
        ├── comments: Y.Map
        ├── filters: Y.Map
        ├── sparklines: Y.Map
        ├── conditionalFormat: Y.Map
        ├── cfRules: Y.Map
        ├── bindings: Y.Map<bindingId, SheetDataBinding>
        ├── grouping: Y.Map
        ├── sorting: Y.Map
        ├── pivotTables: Y.Map
        ├── floatingObjects: Y.Map                 ◄── Charts, pictures, shapes, etc.
        └── floatingObjectGroups: Y.Map
```

`compute/core/crates/compute-document/src/schema.rs` defines the key names and the current schema version sentinel. New canonical collaboration state pre-creates root maps and high-churn workbook/sheet maps needed for deterministic Yrs type IDs. Some workbook maps, especially style, document-property, file-sharing, threaded-comment-person, data-table, and custom table-style maps, are still created lazily by hydration/export/service paths when data is present.

## Identity Model

**Key architectural decision**: cells, rows, and columns have stable identities; positions are mutable.

| Position-keyed model                | Identity model                                             |
| ----------------------------------- | ---------------------------------------------------------- |
| Insert column remaps cell keys      | Insert column updates order/index state, not cell keys     |
| Row/column properties shift by key  | Row/column properties stay keyed by `RowId` / `ColId`      |
| Formula references require rewrites | Formula refs can point at stable identities                |
| Concurrent structural edits collide | CRDT merges compose over stable identities and Yrs arrays  |

### Core Sheet Indexes

| Structure        | Storage key                  | Purpose                                      |
| ---------------- | ---------------------------- | -------------------------------------------- |
| `cells`          | `CellId`                     | Primary cell value/formula storage           |
| `cellProperties` | `CellId`                     | Sparse formatting and non-compute metadata   |
| `gridIndex`      | `rowIdHex:colIdHex` / CellId | Position-to-cell, cell-to-position, and optional compact-axis identity state |
| `rowOrder`       | array index                  | Current visual row order                     |
| `colOrder`       | array index                  | Current visual column order                  |
| `rowHeights`     | `RowId`                      | Custom row heights                           |
| `colWidths`      | `ColId`                      | Custom column widths                         |
| `rowFormats`     | `RowId`                      | Row-level format inheritance                 |
| `colFormats`     | `ColId`                      | Column-level format inheritance              |

`gridIndex/posToId` and `gridIndex/idToPos` are the authoritative Yrs-side cell identity mirrors. Optional `gridIndex/rowAxis` and `gridIndex/colAxis` entries store compact row/column identity payloads; when they are absent, readers fall back to dense `rowOrder` and `colOrder`. Runtime read paths usually use the in-memory `GridIndex` and `CellMirror` for speed, then fall back to Yrs when rebuilding from sync or undo.

For the full design, see [Cell Identity](cell-identity.md).

## Sheet Structure

### Sheet Metadata

**Locations:**

- `compute/core/crates/compute-document/src/schema.rs` - canonical Yrs key names
- `types/api/src/store/store-types.ts` - TypeScript store/snapshot view
- `contracts/src/store/store-types.ts` - public re-export shim

Rust stores per-sheet metadata under the sheet's `properties` map. Row and column counts are derived from `rowOrder.len()` and `colOrder.len()` rather than from metadata counters.

The TypeScript store view includes the user-facing fields:

```typescript
interface SheetMeta {
  id: SheetId;
  name: string;
  defaultRowHeight: number;
  defaultColWidth: number;
  frozenRows: number;
  frozenCols: number;
  tabColor?: string | null;
  hidden?: boolean;
  usedRange?: { endRow: number; endCol: number } | null;
}
```

Extended per-sheet settings such as `showGridlines`, `showRowHeaders`, `showColumnHeaders`, `isProtected`, `showZeroValues`, `gridlineColor`, `rightToLeft`, `showFormulas`, and `zoomScale` are tracked separately in the sheet settings contracts and bridge types.

### Cell Storage

**Locations:**

- `compute/core/crates/compute-document/src/cell_serde.rs` - Yrs cell-map serialization
- `compute/core/crates/compute-document/src/schema.rs` - compact cell keys
- `types/api/src/store/store-types.ts` - TypeScript compatibility shape

In the Yrs document, each `cells` entry is a nested map keyed by `CellId`. Important compact keys include:

| Key  | Meaning                                      |
| ---- | -------------------------------------------- |
| `v`  | Stored cell value                            |
| `f`  | A1 formula body, without the leading `=`     |
| `ft` | identity-formula template                    |
| `fr` | identity-formula refs JSON                   |
| `fda` | dynamic-array formula flag                  |
| `fv` | volatile formula flag                        |
| `fa` | aggregate formula flag                       |
| `fm` | original OOXML formula metadata              |
| `ar` | CSE array-formula range                      |
| `rt` | rich shared-string state                     |

The TypeScript `SerializedCellData` shape is a store/bridge view, not the literal Rust Yrs cell map:

```typescript
interface SerializedCellData {
  id: CellId;
  row: number;
  col: number;
  r: CellRawValue;
  f?: string;
  idf?: IdentityFormula;
  c?: CellValue;
  n?: string;
  h?: string;
  spillRange?: { rows: number; cols: number };
  spillAnchor?: CellId;
  isCSE?: boolean;
}
```

When reading values, formula cells must use the computed result, including `null` when that is the computed result. Do not use `computed ?? raw` for formula cells.

### CellProperties

**Locations:**

- `types/core/src/core.ts` - public TypeScript contract shape
- `domain-types/src/yrs_schema/cell_properties.rs` - flat Yrs map field codec
- `compute/core/src/storage/properties.rs` - Rust storage helpers and inheritance

`cellProperties` is the canonical per-sheet map for non-computational cell state. The public TypeScript `CellProperties` type includes formatting plus provenance, validation, data-connection, formula-auditing, and extension fields:

```typescript
interface CellProperties {
  format?: CellFormat;
  modifiedBy?: string;
  modifiedAt?: number;
  dataSource?: CellDataSource;
  validationErrors?: ValidationError[];
  connectionId?: string;
  staleness?: 'fresh' | 'stale' | 'error';
  lastFetched?: number;
  isArrayFormula?: boolean;
  extensions?: Record<string, unknown>;
}
```

The Rust/Yrs storage shape is not a literal copy of that public interface. It is a flat structured Y.Map keyed by `CellId`: `CellFormat` fields use the short keys from `yrs_schema::cell_format`, and metadata uses compact keys such as `pv`, `vl`, `ci`, `si`, `cm`, `vm`, `frt`, `ecv`, `fcp`, `sst`, and `ov`. XLSX hydration may store compact JSON strings that reference the workbook-level `stylePalette`; user edits expand those entries into structured Y.Map fields.

The generated compute bridge `CellProperties` type is the Rust snapshot/domain view. It carries `format`, `provenance`, `validation`, `connectionId`, style palette indexes, formula-cache provenance, SST/original-value fidelity fields, and CSE flags. Do not assume that public TypeScript metadata fields such as `modifiedBy` or `validationErrors` are persisted with the same field names in Yrs.

### CellFormat

**Location:** `types/core/src/core.ts` (re-exported by `contracts/src/core/core.ts`)

`CellFormat` covers Excel-compatible number formats, fonts, fills, borders, alignment, protection, forced text mode, and extension data. The complete interface lives in the source file; keep docs and API snippets in sync with that file rather than duplicating the full shape here.

## Sheet-Level Maps Reference

| Map                    | Key                  | Purpose                                  |
| ---------------------- | -------------------- | ---------------------------------------- |
| `properties`           | field name           | Sheet metadata and sheet-scoped settings |
| `cells`                | `CellId`             | Cell value/formula maps                  |
| `cellProperties`       | `CellId`             | Sparse formatting and metadata           |
| `gridIndex`            | `posToId` / `idToPos` / optional `rowAxis` / `colAxis` | Yrs-side cell and axis identity state |
| `rowOrder`             | array index          | Current row identity order               |
| `colOrder`             | array index          | Current column identity order            |
| `rowHeights`           | `RowId`              | Custom row heights                       |
| `colWidths`            | `ColId`              | Custom column widths                     |
| `rowFormats`           | `RowId`              | Row formatting inheritance               |
| `colFormats`           | `ColId`              | Column formatting inheritance            |
| `schemas`              | schema key           | Column/schema metadata                   |
| `validationRules`      | rule ID              | Data-validation rule bodies              |
| `ranges`               | `RangeId`            | Range identity records                   |
| `rangePayloads`        | `RangeId`            | Range payload data                       |
| `rangeFormats`         | `RangeId`            | Range-backed formatting                  |
| `rangeBindings`        | binding key          | Sheet/range binding metadata             |
| `merges`               | merge key            | Merged cell regions                      |
| `manualHiddenRows`     | `RowId`              | Manually hidden rows                     |
| `filterHiddenRows`     | filter ID            | Rows hidden by filters                   |
| `hiddenRows` / `hiddenCols` | storage key     | Compatibility/effective hidden state     |
| `comments`             | comment ID           | Notes and threaded comments              |
| `filters`              | filter ID            | Auto/table/advanced filter state         |
| `sparklines`           | sparkline key        | Sparkline state                          |
| `conditionalFormat`    | rule key             | Per-sheet conditional-format entries     |
| `cfRules`              | rule ID              | Shared conditional-format rule bodies    |
| `bindings`             | binding ID           | Sheet data bindings                      |
| `grouping`             | grouping key         | Row/column outline grouping              |
| `sorting`              | sorting key          | Sort state                               |
| `pivotTables`          | pivot ID             | Per-sheet pivot table configs            |
| `floatingObjects`      | object ID            | Charts, pictures, shapes, OLE, controls  |
| `floatingObjectGroups` | group ID             | Grouped floating objects                 |

## Document-Level Structures

### Workbook

Workbook-level maps are under the root `workbook` map. The active set includes `sheetOrder`, `schemaVersion`, settings/identity/link/connection maps, named ranges, workbook-level table and slicer registries, custom table styles, pivot cache/spec maps, Power Query/scenario/theme metadata, custom cell styles, document properties, imported external-data caches, data-table regions, style palettes, shared-string hints, threaded-comment persons, and package-fidelity metadata.

Tables and slicers are workbook-level registries even though their APIs can query by sheet. Conditional formats and pivot table instances are sheet-level maps (`conditionalFormat`, `cfRules`, `pivotTables`), with workbook-level pivot cache/spec data stored separately.

### Defined Names

**Locations:**

- `types/data/src/data/named-ranges.ts`
- `domain-types/src/yrs_schema/named_range.rs`
- `kernel/src/bridges/compute/compute-types.gen.ts`
- `compute/core/src/storage/workbook/named_ranges/`
- `compute/core/src/storage/engine/construction/named_ranges.rs`

Defined names are stored under `workbook.namedRanges` as structured Y.Map entries. The `refersTo` Yrs field is a string field; in the current engine-loaded canonical form that string contains JSON-serialized `IdentityFormula`. XLSX hydration can initially write A1 text, then `normalize_named_range_refs` canonicalizes it before engine readers use the data. Opaque or unsupported references can be preserved in `rawRefersTo` for export fidelity.

The typed bridge view exposes the decoded identity formula:

```typescript
interface DefinedNameWire {
  id: string;
  name: string;
  refersTo: IdentityFormula;
  scope: Scope;
  comment?: string;
  visible: boolean;
}
```

The generated bridge also exposes a display-oriented `DefinedName` with `refersTo: string`, `rawRefersTo?: string`, and additional OOXML fidelity flags. Storage keys are uppercase name keys for workbook scope and `NAME:sheetId` keys for sheet scope.

### Connections & Bindings

Workbook connection definitions live under the workbook connection storage (`workbookConnections` when present). Sheet data bindings live per sheet under `bindings` and are keyed by binding ID, not by `CellId`.

```typescript
interface SheetDataBinding {
  id: string;
  sheetId: string;
  connectionId: string;
  columnMappings: ColumnMapping[];
  autoGenerateRows: boolean;
  headerRow: number;
  dataStartRow: number;
  preserveHeaderFormatting: boolean;
  lastRefresh: number | null;
  lastRowCount: number | null;
}
```

### FilterState

Filter ranges use stable cell IDs for their range corners. Runtime filter state exposes parsed column filters and resolved positions; the Yrs codec stores a structured map and serializes complex filter criteria as JSON strings inside that map.

```typescript
interface FilterState {
  id: string;
  type: FilterKind;
  headerStartCellId: string;
  headerEndCellId: string;
  dataEndCellId: string;
  columnFilters: Record<string, ColumnFilter>;
  advancedFilter?: AdvancedFilterState;
  sortState?: FilterSortState;
  tableId?: string;
  createdAt?: number;
  updatedAt?: number;
  startRow: number | null;
  startCol: number | null;
  endRow: number | null;
  endCol: number | null;
}
```

### Comments

Comments are sheet-level entries keyed by comment ID. Runtime-created comments reference cells through `cellRef` (`CellId`) so comments survive structural edits; import/export paths also preserve OOXML comment and note metadata on the same structured Y.Map entry.

```typescript
interface Comment {
  id: string;
  cellRef: string;
  author: string;
  authorId?: string;
  authorEmail?: string;
  content: string | null;
  runs: RichTextRun[];
  threadId: string | null;
  parentId: string | null;
  resolved?: boolean;
  createdAt: number | null;
  modifiedAt: number | null;
  commentType: 'note' | 'threadedComment';
}
```

The compute wire type carries additional OOXML fields such as rich-text runs, author email/person IDs, shape anchors, and visibility data.

## Grid Index

**Locations:**

- `compute/core/src/storage/cells/values/storage_methods.rs`
- `compute/core/src/storage/cells/values.rs`
- `kernel/src/domain/grid-index.ts`

The Yrs grid index stores row/column identity keys, not plain numeric positions:

```text
gridIndex/posToId: "rowIdHex:colIdHex" -> cellIdHex
gridIndex/idToPos: cellIdHex -> "rowIdHex:colIdHex"
gridIndex/rowAxis: JSON AxisIdentityStore<RowId> when compact axis storage is present
gridIndex/colAxis: JSON AxisIdentityStore<ColId> when compact axis storage is present
```

When callers ask for row/column numbers, Rust resolves row and column identities through the compact axis stores when present, or through `rowOrder` and `colOrder` otherwise.

Kernel helpers delegate to `ComputeBridge` rather than reading Yrs maps directly:

```typescript
getCellIdAtPosition(ctx, sheetId, row, col): Promise<CellId | null>;
getCellDataByPosition(ctx, sheetId, row, col): Promise<SerializedCellData | undefined>;
setCell(ctx, sheetId, row, col, data): void;
getReverseIndex(ctx): Promise<Map<CellId, SheetId>>;
```

The generated bridge surface also exposes lower-level calls such as `getCellIdAt(sheetId, row, col)`, `getCellPosition(sheetId, cellIdHex)`, `setCellValueParsed(sheetId, row, col, rawInput)`, and `queryRange(...)`.

## Accessing Data

Public consumers should use the workbook/worksheet APIs from shipped public packages such as `@mog-sdk/sdk`. Inside the workspace, use `ComputeBridge` methods or kernel domain helpers. Direct Yrs access is storage-internal and must preserve the identity invariants described above.

Common internal access patterns:

```typescript
// Position -> CellId
await ctx.computeBridge.getCellIdAt(sheetId, row, col);

// CellId -> current position
await ctx.computeBridge.getCellPosition(sheetId, cellIdHex);

// User-style edit parsing
await ctx.computeBridge.setCellValueParsed(sheetId, row, col, '=SUM(A1:A10)');

// View/range query
await ctx.computeBridge.queryRange(sheetId, startRow, startCol, endRow, endCol);
```

For UI formatting and metadata, prefer worksheet format APIs or kernel domain helpers that delegate to the bridge. React UI code can use hooks such as `useCellProperties(...)` where the spreadsheet app exports them.

## Structure Operations

Insert/delete row/column operations coordinate three pieces:

1. `GridIndex` updates identity-to-position mappings.
2. The Yrs document updates `rowOrder` / `colOrder` and removes cells deleted by the operation.
3. `CellMirror` updates its fast read indexes.

Each structural operation commits as one Yrs transaction with the structural undo origin. Row and column counts are derived from `rowOrder` and `colOrder`; no metadata row/column counters are maintained.

Formula identity refs remain stable across these operations. Some display-oriented A1 formula strings are refreshed after structural changes so cold rebuild/export paths see the current display text, but the identity formula fields remain the durable reference model.

## Undo Scope

`UndoRedoManager` wraps `yrs::undo::UndoManager` and tracks only transactions marked with user-edit or structural origins. Formula result writes, bootstrap writes, remote updates, and UI-state writes are intentionally excluded.

The undo manager is scoped to shared Yrs collections and can expand its scope for additional workbook maps such as named ranges or tables when those should be undoable.

## Syncing

Collaboration is based on Yrs state vectors and update bytes exposed by the Rust engine and compute coordinator. Transports such as WebSocket, HTTP, or in-process N-API wrappers route those bytes; the storage model does not require a specific network transport.

`SyncCoordinator` provides multi-participant coordination, awareness bytes, sheet-level locks, and structural locks. Clients apply remote Yrs updates back through the compute sync bridge so mirrors, indexes, and viewport patches can be rebuilt consistently.

## Snapshot and Import Views

`WorkbookSnapshot` and `SheetSnapshot` are bridge/import/export views used to initialize engines, import XLSX parse output, and expose SDK snapshots. They are not a `versioning` subtree in the Yrs document.

The old `DiffCellData`/versioning package path was removed; current cell storage and snapshot paths use the compute bridge and snapshot types.

## Related Documentation

- [Cell Identity](cell-identity.md) - Identity model details
- [State Management](state.md) - Spreadsheet state and UI state
- [Packages](packages.md) - Packages and dependencies
