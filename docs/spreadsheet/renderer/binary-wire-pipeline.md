# Binary Wire Pipeline: Rust → Canvas Rendering

The binary wire pipeline is the **critical fast path** for all cell rendering. Every cell visible on the canvas is read through this path — zero JSON parsing, zero object allocation per cell.

## End-to-End Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  RUST: compute-core (storage engine)                                │
│                                                                      │
│  storage/engine/viewport_render.rs                                    │
│  ├─ build_viewport_render_data() → ViewportRenderData               │
│  └─ serialize via compute-wire crate                                │
│      ├─ serialize_viewport_binary() → Vec<u8>  (full or delta)     │
│      └─ serialize_mutation_result() → Vec<u8>  (recalc patches)    │
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
│  └─ epoch-based filtering ensures consistency (no stale checks)     │
│                                                                      │
│  ViewportCoordinatorRegistry: multi-viewport routing + subscription │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ coordinator.commit() / overlay.apply()
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  KERNEL: wire/ module                                               │
│  ├─ BinaryViewportBuffer  — zero-copy DataView over binary blob    │
│  ├─ CellAccessor          — flyweight: moveTo(row,col) reads cell  │
│  ├─ BinaryMutationReader  — decodes recalc patches                 │
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
│  │   ├─ valueType, numberValue, displayText — pure field reads     │
│  │   ├─ format = palette[formatIdx] — lookup by u16 index          │
│  │   ├─ hasFormula, hasComment, etc. — bitwise flag extraction     │
│  │   ├─ isCellEmpty(r,c), peekFormat(r,c) — neighbor peek (no     │
│  │   │   cursor clobber) for text overflow/centerContinuous        │
│  │   └─ CF: bgColor, fontColor, dataBar, icon from binary buffer  │
│  ├─ CellDataSource only for non-binary metadata:                   │
│  │   sparklines, filters, bindings, dropdowns, validation circles  │
│  └─ 0 allocations per cell in hot path → 60 FPS                   │
└─────────────────────────────────────────────────────────────────────┘
```

## Three Data Paths

### 1. Viewport Path (initial load + scroll)

When the viewport changes (scroll, sheet switch, resize):

> **Note**: Viewport fetches are managed exclusively by `ViewportFetchManager` and are never triggered by mutations. The mutation pipeline updates the buffer synchronously via patches — viewport movement is a separate, independent pipeline. Both pipelines commit through `ViewportCoordinator`, which uses epoch-based overlay filtering to ensure consistency without stale checks or retries.

```
Rust build_viewport_render_data()
  → serialize_viewport_binary(&data, generation, is_delta=false, palette_start=0)
  → Vec<u8> (36B header + N×32B cells + string pool + merges + dims + palette JSON)
  → IPC/WASM → Uint8Array
  → BinaryViewportBuffer.setBuffer(bytes)
  → CellAccessor.moveTo(row, col) per visible cell
  → Canvas render
```

**Delta optimization**: On scroll, only the new strip of cells is fetched:
```
getViewportBinaryDelta()
  → serialize_viewport_binary(&data, generation, is_delta=true, palette_start=N)
  → Smaller buffer (only new cells + new palette entries)
  → applyDelta() merges into existing buffer
```

### 2. Mutation Path (recalc after edit)

When cells change due to formula recalculation:

> **Note**: After mutation patches are applied, the viewport buffer is complete — no async follow-up is needed. Structural changes (insert row, delete column, etc.) produce complete structural viewport patches via `produce_structural_viewport_patches()`, which rebuild affected viewport regions in-place. The mutation pipeline is fully synchronous: once patches are applied, the buffer is ready for the next render frame.

```
Rust recalc()
  → serialize_mutation_result(&result, &sheet_id, generation)
  → Vec<u8> (16B header + sheet ID + N×40B patches + string pool + spill section)
  → IPC/WASM → Uint8Array
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
| `src/viewport.rs` | `serialize_viewport_binary()` — 10-phase serializer |
| `src/mutation.rs` | `serialize_mutation_result()` + `serialize_mutation_result_for_viewport()` — patch serializers |
| `src/palette.rs` | `FormatPalette` — append-only format interning (CellFormat → u16) |
| `src/bin/generate_ts.rs` | Code generator: emits matching TS constants |
| `src/bin/generate_test_fixtures.rs` | Generates cross-language `.bin` + `.json` test fixtures |
| [README.md](../../../compute/core/crates/compute-wire/README.md) | **Full binary protocol spec** (byte layouts, flag bits, offsets) |

### TypeScript: `kernel/src/bridges/wire/`

| File | Lines | Purpose |
|------|-------|---------|
| `constants.gen.ts` | 85 | Auto-generated constants from Rust (**never edit manually**) |
| `binary-viewport-buffer.ts` | 1687 | `BinaryViewportBuffer` + `CellAccessor` — zero-copy binary reader |
| `binary-mutation-reader.ts` | 414 | `BinaryMutationReader` — zero-allocation mutation decoder |
| `viewport-coordinator.ts` | 590 | `ViewportCoordinator` — single-owner viewport state with base+overlay model |
| `viewport-coordinator-registry.ts` | 184 | Multi-viewport routing + aggregate subscription |
| `viewport-prefetch.ts` | 192 | Overscan bounds computation + delta request optimization |
| `cell-metadata-cache.ts` | 489 | Spill + validation metadata cache (async populate, sync read) |
| `mutation-classifier.ts` | 79 | Three-tier mutation invalidation classifier |
| `viewport-test-builder.ts` | 286 | Test helper: builds binary viewport buffers in pure TS |
| `mutation-test-builder.ts` | 326 | Test helper: builds binary mutation buffers in pure TS |
| `index.ts` | 42 | Barrel re-exports |

**Also in `kernel/src/bridges/compute/`** (not `wire/`):

| File | Lines | Purpose |
|------|-------|---------|
| `viewport-fetch-manager.ts` | 359 | `ViewportFetchManager` — viewport movement pipeline (scroll, resize, sheet switch) |
| `index.ts` | 40 | Barrel re-exports |

### Canvas: `canvas/grid-renderer/src/`

| File | Purpose |
|------|---------|
| `layers/cells.ts` | `BinaryCellReader` interface + render loop consuming CellAccessor |
| `cells/types.ts` | `CellRenderInfo` type |
| `layout/for-each-visible-cell.ts` | Iteration over visible cells |

## Key Design Decisions

### Zero-Copy Protocol

Binary blobs sent as `Uint8Array` over IPC. TypeScript reads via `DataView` directly from the backing buffer — no deserialization step, no object allocation. The `CellAccessor` flyweight is reused across all cells in a frame via `moveTo()`.

### Dense Row-Major Storage

Cell position is implicit from array index: `cell_index = (row - start_row) * viewport_cols + (col - start_col)`. No row/col fields needed in the 32-byte cell record.

### String Pool + Lazy Decoding

All display and error strings packed contiguously in a UTF-8 pool. Each cell record references byte ranges (`display_off`/`display_len`). Strings are decoded lazily on first access and cached. Mutation patches grow a separate overflow pool (main pool is immutable).

### Format Palette

Append-only interning of `CellFormat` objects. Each cell carries a `u16` index instead of a full format object. Typically 5–20 unique formats vs. thousands of cells. Delta viewport responses only send new palette entries.

### Flag Bits

Single `u16` field encodes value type (3 bits) + 7 feature flags. Bitwise reads in the render loop — zero allocations:

```typescript
const valueType = flags & 0x7;       // 0=null, 1=number, 2=text, 3=bool, 4=error
const hasFormula = (flags & 0x8) !== 0;
const hasComment = (flags & 0x10) !== 0;
// ... etc.
```

### Generation Counter

Monotonic `u8` counter embedded in the Rust wire protocol. Both viewport and mutation blobs carry the generation.

- **Still exists in Rust**: incremented on every mutation in `ComputeCore` and included in serialized blobs.
- **No longer used for TS-side stale detection**: the `ViewportCoordinator`'s epoch-based overlay model replaced the old pattern where `ViewportFetchManager` compared generations and retried on mismatch. The coordinator commits viewport fetches and mutation patches through a unified base+overlay model, using epoch tags to filter outdated overlays when a new base arrives.
- **Wraps at 255** (`u8`): this is safe because a single IPC round-trip never spans 256 mutations.

### Single Source of Truth — No Dual-Path Rendering

The binary viewport buffer is the **sole data source** for per-cell rendering. There is no CellDataSource callback fallback path. When the binary buffer hasn't arrived yet (sheet switch, cold start), cells.ts skips cell rendering entirely — grid lines, selection, and headers render independently. The buffer typically arrives within 1-2 frames.

CellDataSource still exists but only serves non-binary metadata: sparklines, filters, bindings, dropdowns, validation circles, and sticky header labels. These are complex objects or sheet-level properties that don't belong in a per-cell binary record.

### Show Formulas Mode

When the user toggles "Show Formulas", the kernel calls `ViewportFetchManager.setShowFormulas(true)`, which invalidates all prefetch and includes `show_formulas: true` in the next IPC fetch. Rust substitutes formula strings into the `formatted` field of each cell that has a formula. The TS side reads `reader.displayText` unconditionally — zero branching, zero second code path.

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
  // CF data
  getBgColorOverride(): string | null;
  getFontColorOverride(): string | null;
  getDataBar(): DataBarData | null;
  getIcon(): IconData | null;
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
| Formatted string for rendering/display | `displayString(cell.displayText)` |
| To produce display text at a boundary | `asFormattedText(s)` |

Helpers: `displayString()`, `displayStringOrNull()`, `asFormattedText()` — all from `@mog/spreadsheet-contracts/core`. See `contracts/src/core/formatted-text.ts`.

## Binary Protocol Quick Reference

All multi-byte values are **little-endian**.

### Viewport Buffer Layout

```
[Header 36B][CellRecords N×32B][StringPool][Merges M×16B][RowDims R×12B][ColDims C×12B][PaletteJSON][DataBars D×24B][Icons I×8B][RowPositions R×8B][ColPositions C×8B]
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

For the full protocol spec with all byte offsets, see the [compute-wire README](../../../compute/core/crates/compute-wire/README.md).

## Regenerating Constants

When the wire protocol changes in Rust, regenerate TS constants:

```bash
cargo run -p compute-wire --bin generate-ts > kernel/src/bridges/wire/constants.gen.ts
```

## Legacy JSON Path — Removed

The legacy `ViewportBuffer` JSON-based buffer was removed in round 11. The binary path is the sole data path for all viewport rendering. The JSON viewport endpoint (`compute_get_viewport`) has been removed; format fidelity evaluation now reads binary viewport data directly.

## Related Documentation

- [compute-wire README](../../../compute/core/crates/compute-wire/README.md) — Full binary protocol spec (Rust)
- [Canvas & Layers](canvas.md) — Canvas rendering architecture
- [Coordinate System](coordinates.md) — Viewport math, frozen panes
- [Renderer Architecture](README.md) — State machines, coordinator, hooks
