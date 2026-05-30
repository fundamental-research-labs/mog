# Compute Bridge Architecture

## Overview

The compute bridge is the communication boundary between the Rust `compute-core` engine and the TypeScript UI layer. It uses two protocols:

- **JSON control plane** -- Structured RPC for commands like `compute_set_cell`, `compute_undo`, `compute_get_schema`. Handled by the `rust-bridge` framework with proc-macro code generation.
- **Binary data plane** -- Compact `Uint8Array` blobs for high-frequency viewport and mutation data. Defined in the `compute-wire` crate and consumed zero-copy via `DataView` on the TS side.

The binary data plane exists because the viewport (visible cell grid) is repainted every frame and mutation results (recalc deltas) arrive on every edit. JSON parsing at these frequencies would be too slow.

## Architecture Diagram

```
Rust                              Transport                TypeScript
────────────────────────────────  ───────────────────────  ──────────────────────────────────

compute-core                                               ComputeBridge
  │                                                          ├─────────────────────────────┐
  ├─ JSON responses ──────────► rust-bridge framework ─────► Generated client (RPC methods)│
  │   (serde_json)               #[bridge::api] codegen      ↓                             │
  │                               ↓                         transport/                     │
  │                          Tauri IPC cmd / WASM fn          │                             │
  │                                                           │                             │
  │                                                      ComputeCore            ViewportFetchManager
  │                                                      (mutation pipeline:    (viewport movement:
  │                                                       applies patches,       scroll, resize,
  │                                                       increments generation) sheet-switch fetches)
  │                                                           │                             │
  ├─ compute-wire                                             │                             │
  │   ├─ viewport.rs ──────► Uint8Array blob ─────────────► BinaryViewportBuffer ◄──────────┘
  │   │   serialize_viewport_binary()                        (DataView, CellAccessor flyweight)
  │   │                                                       │
  │   ├─ mutation.rs ──────► Uint8Array blob ─────────────► BinaryMutationReader
  │   │   serialize_mutation_result()                        (splice into viewport buffer)
  │   │                                                       │
  │   ├─ constants.rs ─────► generate_ts.rs ──────────────► constants.gen.ts
  │   └─ flags.rs                (cargo run --bin)           (shared constants)
  │                                                           │
  └─ palette.rs                                             FormatPalette (JSON section)
      (format dedup)                                          │
                                                              ↓
                                                           Canvas renderer
```

## The rust-bridge Framework

The `rust-bridge` crate (`infra/rust-bridge/bridge-core/src/lib.rs`) provides proc-macro annotations that generate both Rust command handlers and TypeScript client stubs from a single source.

**Key annotations:**

| Annotation | Purpose |
|---|---|
| `#[bridge::service]` | Marks a struct as a bridge service |
| `#[bridge::api]` | Parses an `impl` block and emits an API descriptor |
| `#[bridge::api(service = "Engine", key = "doc_id")]` | Stateful service with instance key |
| `#[bridge::pure]` | Stateless function (no `&self`) |
| `#[bridge::read]` | Read-only method (`&self`) |
| `#[bridge::lifecycle(create)]` | Instance lifecycle (create/destroy) |

The generated code handles serialization (JSON via `serde`), error mapping, and transport dispatch. On the TS side, the generated client calls through a `BridgeTransport` interface.

**Transport layer** (`infra/transport/` — `@mog/transport`):

Transport implementations live in their own package `infra/transport/` — the kernel is transport-agnostic and receives a pre-configured `BridgeTransport` via dependency injection.

- `createTransport(config?)` -- Factory in `transport/factory.ts`. Auto-detects Tauri vs WASM, returns a composed `BridgeTransport`.
- `createTauriTransport()` -- Wraps `@tauri-apps/api/core invoke()` for desktop. Lazy-loads the Tauri module.
- `createWasmTransport()` -- Calls WASM module functions directly. Converts named args to positional via `Object.values()`.
- `createTimeInjectingTransport()` -- Middleware that injects `compute_set_current_time()` before recalc-triggering commands (WASM only, since Tauri has native clock access).
- `createBytesTupleNormalizingTransport()` -- Middleware that normalizes binary tuple return format (Tauri only).
- `createNapiTransport()` / `createHeadlessNapiTransport()` -- N-API bindings for Node.js headless runtime.
- `isTauri()` -- Consolidated environment detection from `platform/tauri/detection.ts`.
- `TransportError` -- Platform-level error class (no kernel dependency). Kernel's `BridgeError.fromCommand()` wraps it as `cause`.
- `WasmInitFn[]` callbacks -- WASM loader accepts init callbacks (e.g., `initTableWasm`, `initChartWasm`) instead of hardcoding cross-bridge dependencies.

## Binary Data Plane

### Viewport Protocol

Serialized by `serialize_viewport_binary()` (`viewport.rs:66`). Produces a single `Vec<u8>` containing all data needed to render the visible grid.

**Wire layout (all little-endian):**

```
[Header 36B] [CellRecords N*32B] [StringPool] [Merges M*16B]
[RowDims R*12B] [ColDims C*12B] [FormatPaletteJSON]
```

**Header (36 bytes):**

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 | `start_row` | Top-left row of the viewport |
| 4 | 4 | `start_col` | Top-left column of the viewport |
| 8 | 4 | `cell_count` | Number of cell records (rows * cols) |
| 12 | 4 | `format_palette_len` | Bytes of FormatPalette JSON at the end |
| 16 | 4 | `string_pool_bytes` | Total bytes in the string pool |
| 20 | 2 | `viewport_rows` | Number of rows in the viewport |
| 22 | 2 | `viewport_cols` | Number of columns in the viewport |
| 24 | 2 | `merge_count` | Number of merge records |
| 26 | 2 | `row_dim_count` | Number of row dimension records |
| 28 | 2 | `col_dim_count` | Number of column dimension records |
| 30 | 1 | `flags` | Bit 0: is_delta |
| 31 | 1 | `generation` | Monotonic counter (Rust wire protocol) |
| 32 | 4 | `reserved` | Reserved / alignment padding |

**Cell Record (32 bytes, naturally aligned, `#[repr(C)]`):**

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 8 | `number_value` | f64 numeric value (NaN if non-numeric) |
| 8 | 4 | `display_off` | Byte offset into string pool (`0xFFFFFFFF` = none) |
| 12 | 4 | `error_off` | Byte offset into string pool (`0xFFFFFFFF` = none) |
| 16 | 2 | `flags` | Bitfield (see Flags table below) |
| 18 | 2 | `format_idx` | Index into the FormatPalette |
| 20 | 2 | `display_len` | Length of display string in bytes |
| 22 | 2 | `error_len` | Length of error string in bytes |
| 24 | 4 | `bg_color_override` | RGBA u32, 0 = no override (conditional formatting) |
| 28 | 4 | `font_color_override` | RGBA u32, 0 = no override (conditional formatting) |

Cells are stored in dense row-major order. The string pool is a packed UTF-8 blob referenced by `display_off`/`error_off` + `display_len`/`error_len` pairs.

**Merge Record (16 bytes):** `start_row:u32`, `start_col:u32`, `end_row:u32`, `end_col:u32`.

**Dimension Record (12 bytes):** `index:u32`, `size:f32`, `hidden:u32` (0/1).

**FormatPalette:** JSON-encoded array of `CellFormat` objects appended at the end. Deduplicated -- each unique format appears once, cells reference it by `format_idx`. Delta responses only include new palette entries (controlled by `palette_start_index`).

### Mutation Protocol

Serialized by `serialize_mutation_result()` (`mutation.rs:60`). Encodes recalc deltas so TS can splice changed cells directly into the viewport buffer.

**Wire layout (all little-endian):**

```
[Header 16B] [SheetID UTF-8] [CellPatches N*40B] [StringPool] [SpillSection?]
```

**Header (16 bytes):**

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 | `patch_count` | Number of cell patches |
| 4 | 4 | `string_bytes` | Total bytes in string pool |
| 8 | 2 | `sheet_id_len` | Length of sheet_id UTF-8 string |
| 10 | 1 | `flags` | Bit 0: `has_spill_changes`, Bit 1: `has_errors` |
| 11 | 1 | `generation` | Mutation generation counter |
| 12 | 4 | `reserved` | Reserved for future use |

**Cell Patch (40 bytes):**

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 | `row` | Zero-based row index |
| 4 | 4 | `col` | Zero-based column index |
| 8 | 32 | cell record | Same layout as ViewportCellRecord |

The 32-byte cell record within each patch is identical to the viewport cell record, so patches can be spliced directly into the viewport buffer's cell record array.

**Spill Section** (present when header `flags` bit 0 is set): `spill_count:u32` followed by `spill_count * 32` bytes of spill cell patches (same format, with `IS_SPILL_MEMBER` flag set).

### Shared Constants

All wire format constants are defined once in Rust and generated to TypeScript:

**Flag bits (`flags.rs`, `u16` bitfield):**

| Bits | Constant | Value | Description |
|------|----------|-------|-------------|
| 0-2 | `VALUE_TYPE_MASK` | `0x7` | Value type (0=null, 1=number, 2=text, 3=bool, 4=error) |
| 3 | `HAS_FORMULA` | `0x8` | Cell contains a formula |
| 4 | `HAS_COMMENT` | `0x10` | Cell has a comment |
| 5 | `HAS_SPARKLINE` | `0x20` | Cell has a sparkline |
| 6 | `HAS_HYPERLINK` | `0x40` | Cell has a hyperlink |
| 7 | `IS_CHECKBOX` | `0x80` | Cell renders as a checkbox |
| 8 | `IS_SPILL_MEMBER` | `0x100` | Cell is part of a spill/projection range |
| 9 | `HAS_VALIDATION_ERROR` | `0x200` | Cell has a validation error |

**Layout constants (`constants.rs`):**

| Constant | Value | Description |
|----------|-------|-------------|
| `VIEWPORT_HEADER_SIZE` | 36 | Viewport header bytes |
| `CELL_STRIDE` | 32 | Bytes per cell record |
| `MERGE_STRIDE` | 16 | Bytes per merge record |
| `DIM_STRIDE` | 12 | Bytes per dimension record |
| `MUTATION_HEADER_SIZE` | 16 | Mutation header bytes |
| `PATCH_STRIDE` | 40 | Bytes per cell patch (8 addr + 32 record) |
| `NO_STRING` | `0xFFFFFFFF` | Sentinel for "no string" |

The TS file `constants.gen.ts` is produced by `generate_ts.rs` and must not be edited by hand.

## TypeScript Consumption

### BinaryViewportBuffer

`binary-viewport-buffer.ts` -- Zero-copy reader for viewport binary blobs.

**Key design decisions:**

- **DataView, not deserialization.** The `Uint8Array` blob is stored as-is. Fields are read on demand via `DataView.getFloat64()`, `getUint16()`, etc. No JS objects are allocated per cell.
- **CellAccessor flyweight.** A single reusable object is repositioned to different cell offsets. The renderer calls `cellAt(row, col)` which computes `HEADER_SIZE + (row * cols + col) * CELL_STRIDE` and returns the accessor pointing at that offset.
- **Patch overlay.** Mutation patches are applied as a `Map<key, patch>` overlay on top of the immutable viewport buffer. Key = `row * 0x100000 + col`. On read, the overlay is checked first.
- **Overflow string pool.** Mutation patches may reference new strings not in the original viewport's string pool. These are appended to a growable overflow pool. `display_off >= mainPoolSize` means read from overflow. Cleared on next full viewport fetch.
- **Delta merging.** `getViewportBinaryDelta()` fetches only the changed strip (e.g., new rows after scroll). The delta is merged into the existing buffer.
- **String decode cache.** `TextDecoder.decode()` results are cached by byte offset. Invalidated per-cell on patch.

### BinaryMutationReader

`binary-mutation-reader.ts` -- Zero-allocation reader for mutation result blobs.

Parses the mutation header, computes section offsets (`_patchesStart`, `_stringPoolStart`, `_spillSectionStart`), and exposes:

- `patchCount` / `spillCount` -- number of patches
- `sheetId()` -- decoded sheet UUID
- `patchRow(i)` / `patchCol(i)` -- address of patch `i`
- `patchRecordOffset(i)` -- byte offset of the 32-byte cell record for patch `i`

Used by `BinaryViewportBuffer.applyBinaryMutation()` to splice patches into the viewport buffer without intermediate JS objects.

### CellMetadataCache

`cell-metadata-cache.ts` -- Viewport-scoped cache for spill and validation metadata.

Solves the async-in-sync-render problem: the canvas render loop is synchronous, but spill/validation queries are async. The cache:

1. `evaluateViewport()` -- batch-fetches spill + validation data asynchronously
2. Sync read methods (`isSpillMember()`, `hasValidationErrors()`) serve cached data per-cell per-frame
3. `onChange` listeners trigger re-renders when the cache is populated
4. `patchSpillChanges()` / `patchValidation()` for incremental updates from mutations

## Data Flows

### 1. Full Viewport Fetch

```
User scrolls / resize / sheet switch
  → ViewportFetchManager.refresh()
    → ComputeBridge.getViewportBinary(sheetId, startRow, startCol, endRow, endCol)
      → BridgeTransport.call("compute_get_viewport_binary", ...)
        → Rust: build_viewport_render_data() → serialize_viewport_binary(generation, is_delta=false)
      ← Uint8Array
    → Check generation: if response generation < current, discard + per-viewport retry
    → BinaryViewportBuffer.setBuffer(blob)
      → Parse header (36B)
      → Compute section offsets
      → JSON.parse FormatPalette
      → Clear patch overlay and overflow pool
    → CellMetadataCache.evaluateViewport() (async, parallel)
    → Canvas renders via CellAccessor reads
```

### 2. Scroll Delta

```
User scrolls within prefetch bounds
  → ComputeBridge.getViewportBinaryDelta(sheetId, ...)
    → Rust: serialize_viewport_binary(generation, is_delta=true, palette_start_index=N)
    ← Uint8Array (only new strip + new palette entries)
  → BinaryViewportBuffer merges delta into existing buffer
  → Canvas re-renders
```

### 3. Mutation Application

```
User edits a cell
  → ComputeCore.mutateCore(sheetId, row, col, value)
    → BridgeTransport.call("compute_set_cell", ...)
      → Rust: set_cell → recalc → serialize_mutation_result(recalcResult, sheetId, generation)
      → Rust: produce viewport patches (complete — covers all affected cells)
      → Structural changes (insert/delete row/col) produce complete structural patches
        via produce_structural_viewport_patches()
    ← Uint8Array (mutation blob) — buffer is complete after this step, no async follow-up
  → Increment generation counter
  → BinaryMutationReader(blob) parses header + section offsets
  → BinaryViewportBuffer.applyBinaryMutation(reader)
    → For each patch: write into patch overlay (numbers/flags) + overflow string pool
  → CellMetadataCache.patchSpillChanges() if has_spill_changes flag set
  → Canvas re-renders (reads overlay first, then falls through to base buffer)
```

## Key Files Map

### Rust (Source of Truth)

| File | Role |
|------|------|
| `compute/core/crates/compute-wire/src/lib.rs` | Crate root, re-exports |
| `compute/core/crates/compute-wire/src/constants.rs` | Wire layout constants (sizes, strides, offsets) |
| `compute/core/crates/compute-wire/src/flags.rs` | Cell flag bit definitions (`u16` bitfield) |
| `compute/core/crates/compute-wire/src/viewport.rs` | `serialize_viewport_binary()` -- viewport blob serializer |
| `compute/core/crates/compute-wire/src/mutation.rs` | `serialize_mutation_result()` -- mutation blob serializer |
| `compute/core/crates/compute-wire/src/palette.rs` | `FormatPalette` -- format deduplication |
| `compute/core/crates/compute-wire/src/types.rs` | `ViewportRenderData`, `ViewportRenderCell`, etc. |
| `compute/core/crates/compute-wire/src/bin/generate_ts.rs` | TS constant generator binary |

### TypeScript (Consumers)

| File | Role |
|------|------|
| `kernel/src/bridges/wire/constants.gen.ts` | **Generated** -- wire constants (do not edit) |
| `kernel/src/bridges/wire/binary-viewport-buffer.ts` | Zero-copy viewport buffer reader |
| `kernel/src/bridges/wire/binary-mutation-reader.ts` | Zero-allocation mutation reader |
| `kernel/src/bridges/wire/cell-metadata-cache.ts` | Async spill/validation cache for sync render |
| `kernel/src/bridges/compute/compute-bridge.ts` | Orchestration: viewport fetch, mutation dispatch, EventBus |
| `kernel/src/bridges/compute/viewport-fetch-manager.ts` | Viewport movement pipeline — scroll, resize, sheet switch (never triggered by mutations) |
| `infra/transport/` | Transport abstraction (Tauri IPC / WASM / N-API) — `@mog/transport` package |

### Framework

| File | Role |
|------|------|
| `infra/rust-bridge/bridge-core/src/lib.rs` | `#[bridge::api]` proc-macro for JSON control plane |

## Two-Pipeline Viewport Architecture

The viewport buffer is written by two independent pipelines that never trigger each other:

1. **Mutation pipeline (synchronous, Rust-driven).** When a user edits a cell, `ComputeCore.mutateCore()` applies the change in Rust and returns complete viewport patches in a single synchronous call. Structural changes (insert/delete row/col) produce complete structural patches via `produce_structural_viewport_patches()`. After the call returns, the buffer is fully up to date — no async follow-up is needed.

2. **Viewport movement pipeline (asynchronous, TS-driven).** When the user scrolls, resizes, or switches sheets, `ViewportFetchManager.refresh()` fetches a fresh viewport blob from Rust. Because the fetch is async, a response may arrive after a newer mutation has already been applied. Stale responses are detected and trigger a per-viewport retry.

**The generation counter is the seam between the two pipelines.** Mutations increment the generation counter on the Rust side. Viewport fetch responses carry the generation at the time they were produced. If a viewport response arrives with a generation older than the current counter, `ViewportFetchManager` discards it and retries.

This generation-counter contract is the consistency boundary: mutation responses are authoritative immediately, while viewport fetches must prove they were produced from the current generation before they can replace buffered data.

## Code Generation

To regenerate the TypeScript constants after changing `constants.rs` or `flags.rs`:

```bash
cd compute/core
cargo run -p compute-wire --bin generate-ts > ../kernel/src/bridges/wire/constants.gen.ts
```

The generated file (`constants.gen.ts`) is checked into version control so that TS builds do not require Rust tooling. The header comment in the generated file identifies the source and regeneration command.
