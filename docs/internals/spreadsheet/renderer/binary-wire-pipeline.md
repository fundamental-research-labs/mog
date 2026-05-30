# Binary Wire Pipeline: Rust → Canvas Rendering

The binary wire pipeline is the **critical fast path** for all cell rendering. Every cell visible on the canvas is read through this path — no JSON parsing or per-cell wire-object deserialization.

## End-to-End Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  RUST: compute-core (storage engine)                                │
│                                                                      │
│  storage/engine/viewport/render.rs                                    │
│  ├─ build_viewport_render_data() → ViewportRenderData               │
│  └─ serialize via compute-wire crate                                │
│      ├─ serialize_viewport_binary() → Vec<u8>  (full or delta)     │
│      └─ serialize_mutation_result_for_viewport() → Vec<u8>          │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ Uint8Array via Tauri IPC / WASM
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  KERNEL: Both Pipelines → ViewportCoordinator                       │
│                                                                      │
│  MUTATION PIPELINE (Rust-owned)     VIEWPORT MOVEMENT (TS-owned)    │
│  ComputeCore.mutateCore()           ViewportFetchManager.refresh()  │
│  ├─ applyMultiViewportPatches()     ├─ compute_get_viewport_binary  │
│  └─ commits through coordinator     └─ commits through coordinator  │
│                                                                      │
│  ViewportCoordinator: single owner of each viewport's state         │
│  ├─ base buffer (latest full/delta viewport)                        │
│  ├─ overlay (mutation patches with epoch tagging)                   │
│  └─ epoch filtering replaces generation-based stale retries          │
│                                                                      │
│  ViewportCoordinatorRegistry: multi-viewport routing + subscription │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ commitFetch() / applyMutationPatches()
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  KERNEL: wire/ module                                               │
│  ├─ BinaryViewportBuffer  — zero-copy DataView over binary blob    │
│  ├─ CellAccessor          — flyweight: moveTo(row,col) reads cell  │
│  ├─ BinaryMutationReader  — decodes mutation patches               │
│  ├─ ViewportCoordinator   — single-owner viewport state (base+overlay) │
│  └─ ViewportCoordinatorRegistry — routes multi-viewport patches    │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ reader.moveTo(row, col)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CANVAS: grid-renderer cells layer                                  │
│  ├─ BinaryCellReader interface (duck-typed, no hard dependency)     │
│  ├─ Single source of truth — NO CellDataSource fallback path       │
│  ├─ Guard: if (!reader) return — skip cells until buffer arrives   │
│  ├─ For each visible cell: reader.moveTo(row, col)                 │
│  │   ├─ value fields via DataView; displayText lazy-decodes strings  │
│  │   ├─ format = palette[formatIdx] — lookup by u16 index          │
│  │   ├─ hasFormula, hasComment, etc. — bitwise flag extraction     │
│  │   ├─ isCellEmpty(r,c), peekFormat(r,c) — neighbor peek (no     │
│  │   │   cursor clobber) for text overflow/centerContinuous        │
│  │   └─ CF: bgColor, fontColor, dataBar, icon from binary buffer  │
│  ├─ CellDataSource remains for non-binary metadata:                │
│  │   sparklines, filters, bindings, dropdowns, validation circles  │
│  └─ no per-cell wire deserialization in the reader hot path         │
└─────────────────────────────────────────────────────────────────────┘
```

## Three Data Paths

### 1. Viewport Path (initial load + scroll)

When the viewport changes (scroll, sheet switch, resize):

> **Note**: Viewport fetches are managed exclusively by `ViewportFetchManager` and are never triggered by mutations. The mutation pipeline updates the buffer synchronously via patches — viewport movement is a separate, independent pipeline. Both pipelines commit through `ViewportCoordinator`, which uses epoch-based overlay filtering instead of generation-based stale retries.

```
Rust build_viewport_render_data()
  → serialize_viewport_binary(&data, 0, is_delta=false, palette_start=0)
  → Vec<u8> (36B header + N×32B cells + string pool + merges + dims + binary palette)
  → IPC/WASM → Uint8Array
  → BinaryViewportBuffer.setBuffer(bytes)
  → CellAccessor.moveTo(row, col) per visible cell
  → Canvas render
```

**Delta optimization**: On scroll, only the new strip of cells is fetched:
```
getViewportBinaryDelta()
  → serialize_viewport_binary(&data, 0, is_delta=true, palette_start=N)
  → Smaller buffer (only new cells + binary palette delta entries)
  → applyDelta() merges into existing buffer
```

### 2. Mutation Path (recalc after edit)

When cells change due to formula recalculation:

> **Note**: For ordinary cell/recalc mutations, Rust produces per-viewport binary patches and the TS mutation pipeline applies them synchronously. Structural changes (insert row, delete column, etc.) merge generated structural cell patches into the recalc before flushing; changes that affect viewport geometry or broad visual state can also force-refresh registered viewport buffers through `ViewportFetchManager`.

```
Rust recalc()
  → produce_viewport_patches() / flush_viewport_patches()
  → serialize_mutation_result_for_viewport(...bounds...)
  → serialize_multi_viewport_patches()
  → IPC/WASM → Uint8Array per viewport payload
  → BinaryMutationReader (decode header, iterate patches)
  → BinaryViewportBuffer.applyBinaryMutation(reader)
    → For each patch in viewport: splice 32-byte cell record in-place
    → New display/error strings → overflow string pool
  → Next render frame reads updated data
```

### 3. Multi-Viewport Path (frozen panes)

When multiple viewports exist (frozen rows/columns):

```
Rust serialize_multi_viewport_patches()
  → Packed blob: [u16 count] [u8 id_len][id][u32 len][patch bytes]...
  → ViewportCoordinatorRegistry.applyMultiViewportPatches(packed)
  → Routes each sub-blob to the correct per-viewport ViewportCoordinator
```

## Key File Inventory

### Rust: `compute/core/crates/compute-wire/`

| File | Purpose |
|------|---------|
| `src/constants.rs` | Wire layout byte sizes, strides, offsets |
| `src/flags.rs` | Cell flag bit definitions (value type, has_formula, etc.) |
| `src/types.rs` | `ViewportRenderCell`, `ViewportRenderData`, merge/dimension structs |
| `src/viewport/` | `serialize_viewport_binary()` plus cell/string/section writers |
| `src/mutation/` | `serialize_mutation_result()` + `serialize_mutation_result_for_viewport()` — patch serializers |
| `src/palette.rs` | `FormatPalette` — append-only format interning (CellFormat → u16) |
| `src/palette_binary/` | Compact binary palette serializer/deserializer |
| `src/bin/generate_ts.rs` | Code generator: emits matching TS constants |
| `src/bin/generate_test_fixtures.rs` | Generates cross-language `.bin` + `.json` test fixtures |
| [README.md](../../../../compute/core/crates/compute-wire/README.md) | Protocol notes and examples; the `src/` modules are the implementation source of truth |

### TypeScript: `kernel/src/bridges/wire/`

| File | Purpose |
|------|---------|
| `constants.gen.ts` | Auto-generated constants from Rust (**never edit manually**) |
| `binary-viewport-buffer.ts` | `BinaryViewportBuffer` + `CellAccessor` — zero-copy binary reader |
| `binary-mutation-reader.ts` | `BinaryMutationReader` — mutation decoder with typed field accessors |
| `palette-binary.ts` | Binary palette encoder/decoder used by viewport and mutation buffers |
| `viewport-coordinator.ts` | `ViewportCoordinator` — single-owner viewport state with base+overlay model |
| `viewport-coordinator-registry.ts` | Multi-viewport routing + aggregate subscription |
| `viewport-prefetch.ts` | Overscan bounds computation + delta request optimization |
| `cell-metadata-cache.ts` | Spill + validation metadata cache (async populate, sync read) |
| `range-metadata-cache.ts` | Range metadata cache for render-path range lifecycle data |
| `mutation-classifier.ts` | Three-tier mutation invalidation classifier |
| `viewport-test-builder.ts` | Test helper: builds binary viewport buffers in pure TS |
| `mutation-test-builder.ts` | Test helper: builds binary mutation buffers in pure TS |
| `index.ts` | Barrel re-exports |

**Also in `kernel/src/bridges/compute/`** (not `wire/`):

| File | Purpose |
|------|---------|
| `viewport-fetch-manager.ts` | `ViewportFetchManager` — viewport movement pipeline (scroll, resize, sheet switch) |
| `index.ts` | Barrel re-exports |

### Canvas: `canvas/grid-renderer/src/`

| File | Purpose |
|------|---------|
| `layers/cells.ts` | `BinaryCellReader` interface + render loop consuming CellAccessor |
| `cells/types.ts` | `CellRenderInfo` type |
| `layout/for-each-visible-cell.ts` | Iteration over visible cells |

## Key Design Decisions

### Zero-Copy Protocol

Binary blobs are sent as `Uint8Array` over IPC. TypeScript reads via `DataView` directly from the backing buffer — no JSON parsing or per-cell wire-object materialization. The `CellAccessor` flyweight is reused across all cells in a frame via `moveTo()`.

### Dense Row-Major Storage

Cell position is implicit from array index: `cell_index = (row - start_row) * viewport_cols + (col - start_col)`. No row/col fields needed in the 32-byte cell record.

### String Pool + Lazy Decoding

All display and error strings packed contiguously in a UTF-8 pool. Each cell record references byte ranges (`display_off`/`display_len`). Strings are decoded lazily on first access and cached. Mutation patches grow a separate overflow pool (main pool is immutable).

### Format Palette

Append-only interning of `CellFormat` objects. Each cell carries a `u16` index instead of a full format object. Typically 5–20 unique formats vs. thousands of cells. Viewport and mutation payloads serialize palette data with the compact binary palette format; delta responses only send new palette entries.

### Flag Bits

Single `u16` field encodes value type (3 bits) plus feature flags. Bitwise reads in the render loop avoid deserializing per-cell metadata objects:

```typescript
const valueType = flags & 0x7;       // 0=null, 1=number, 2=text, 3=bool, 4=error, 5=image
const hasFormula = (flags & 0x8) !== 0;
const hasComment = (flags & 0x10) !== 0;
// ... etc.
```

### Generation Counter

The wire headers still reserve a `u8` generation byte for compatibility, and the TS readers expose it. Current production consistency no longer depends on it: viewport fetches use request sequencing plus `ViewportCoordinator` fetch epochs, and mutation/fetch consistency comes from the base+overlay model. The generation byte is not used as a monotonically incremented TS consistency signal in current production paths.

### Single Source of Truth — No Dual-Path Rendering

The binary viewport buffer is the **sole data source** for per-cell rendering. There is no CellDataSource callback fallback path. When the binary buffer hasn't arrived yet (sheet switch, cold start), cells.ts skips cell rendering entirely — grid lines, selection, and headers render independently. The buffer typically arrives within 1-2 frames.

CellDataSource still exists for non-binary metadata and non-cell layers: sparklines, filters, bindings, dropdowns, validation circles, and sticky header labels. These are complex objects or sheet-level properties that don't belong in a per-cell binary record.

### Show Formulas Mode

When the user toggles "Show Formulas", the view option is stored as sheet state. `ViewportFetchManager` reads that sheet-scoped option through its resolver and includes `showFormulas: true` in viewport IPC fetches; `ComputeCore` force-refreshes registered sheet viewports when a `showFormulas` settings change is reported. Rust substitutes formula strings into the `formatted` field of each cell that has a formula. The TS side reads `reader.displayText` unconditionally — no second render path.

### Duck-Typed Render Interface

The grid-renderer defines `BinaryCellReader` as a structural interface (not an import from kernel). This avoids a hard dependency from the rendering package to the kernel package:

```typescript
// grid-renderer/src/layers/cells.ts
interface BinaryCellReader {
  moveTo(row: number, col: number): boolean;
  // Value fields
  readonly valueType: number;
  readonly numberValue: number;
  readonly displayText: FormattedText | null;
  readonly errorText: string | null;
  // Format
  readonly format: CellFormat;
  // Flag-based booleans (bits of the flags field)
  readonly hasFormula: boolean;
  readonly hasComment: boolean;
  readonly hasSparkline: boolean;
  readonly hasHyperlink: boolean;
  readonly isCheckbox: boolean;
  readonly isProjectedPosition: boolean;
  readonly hasValidationError: boolean;
  readonly hasCellImage?: boolean;
  // CF data
  getBgColorOverride(): string | null;
  getFontColorOverride(): string | null;
  getDataBar(): DataBarData | null;
  getIcon(): IconData | null;
  getCellImage?(): unknown | null;
  // Neighbor peek (no cursor clobber) — used by text overflow
  isCellEmpty(row: number, col: number): boolean;
  peekFormat(row: number, col: number): CellFormat | undefined;
}
```

### Cell Value vs. Display Text — the `FormattedText` Contract

`ViewportCellData` exposes two fields for cell content:

- **`.value`** — typed (`number | string | boolean | null | CellError`) — the semantic value from Rust compute-core
- **`.displayText`** — opaque `FormattedText | null` — the formatted representation (e.g. `"$1,234.56"`, `"50%"`)

`FormattedText` is **not assignable to `string`**. This is enforced by the type system to prevent a class of silent data-loss bugs where code parses display text (e.g. `parseFloat("$1,234.56")` → `NaN`) instead of reading the typed value.

| I need... | Use |
|-----------|-----|
| Semantic data (math, sorting, type checks) | `cell.value` |
| Formatted string for rendering/display | `displayStringOrNull(cell.displayText)` or `displayString(cell.displayText)` after a null check |
| To produce display text at a boundary | `asFormattedText(s)` |

Helpers: `displayString()`, `displayStringOrNull()`, `asFormattedText()` — all from `@mog-sdk/contracts/core`. See `contracts/src/core/formatted-text.ts`.

## Binary Protocol Quick Reference

All multi-byte values are **little-endian**.

### Viewport Buffer Layout

```
[Header 36B][CellRecords N×32B][StringPool][Merges M×16B][RowDims R×12B][ColDims C×12B][PaletteBinary][DataBars D×24B][Icons I×8B][RowPositions R×8B][ColPositions C×8B]
```

### Cell Record (32 bytes)

| Offset | Type | Field |
|--------|------|-------|
| 0 | f64 | `number_value` (NaN for non-numbers) |
| 8 | u32 | `display_off` (0xFFFFFFFF = none) |
| 12 | u32 | `error_off` (0xFFFFFFFF = none) |
| 16 | u16 | `flags` (value type + feature bits) |
| 18 | u16 | `format_idx` (palette index) |
| 20 | u16 | `display_len` |
| 22 | u16 | `error_len` |
| 24 | u32 | `bg_color_override` (RGBA, 0 = none) |
| 28 | u32 | `font_color_override` (RGBA, 0 = none) |

### Mutation Buffer Layout

```
[Header 16B][SheetID UTF-8][CellPatches N×40B][StringPool][SpillSection?][PaletteSection?]
```

Header flags byte (offset 10): `0x01` = has_projection_changes (spill section present), `0x02` = has_errors, `0x04` = has_palette (palette section present).

Each patch = 8 bytes (row u32 + col u32) + 32 bytes (same cell record as viewport).

For additional protocol detail, see the [compute-wire README](../../../../compute/core/crates/compute-wire/README.md) and the implementation modules under `compute/core/crates/compute-wire/src/`.

## Regenerating Constants

When the wire protocol changes in Rust, regenerate TS constants:

```bash
cargo run -p compute-wire --bin generate-ts > kernel/src/bridges/wire/constants.gen.ts
```

## Legacy JSON Path — Removed

The legacy `ViewportBuffer` JSON-based buffer has been removed. The binary path is the sole data path for all viewport rendering. The JSON viewport endpoint (`compute_get_viewport`) has been removed; format fidelity evaluation now reads binary viewport data directly.

## Related Documentation

- [compute-wire README](../../../../compute/core/crates/compute-wire/README.md) — Binary protocol notes (Rust)
- [Canvas & Layers](canvas.md) — Canvas rendering architecture
- [Coordinate System](coordinates.md) — Viewport math, frozen panes
- [Renderer Architecture](README.md) — State machines, coordinator, hooks
