# Compute Bridge Architecture

## Overview

The compute bridge is the communication boundary between the Rust `compute-core` engine and the TypeScript UI layer. It uses two protocols:

- **JSON control plane** -- Structured RPC for commands like `compute_set_cell`, `compute_undo`, `compute_get_column_schema`. Handled by the `rust-bridge` framework with proc-macro code generation.
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
  │                          Tauri IPC / WASM fn / N-API      │                             │
  │                                                           │                             │
  │                                                      ComputeCore            ViewportFetchManager
  │                                                      (mutation pipeline:    (viewport movement:
  │                                                       applies patches,       scroll, resize,
  │                                                       updates overlays)      sheet-switch fetches)
  │                                                           │                             │
  ├─ compute-wire                                             │                             │
  │   ├─ viewport/ ────────► Uint8Array blob ─────────────► BinaryViewportBuffer ◄──────────┘
  │   │   serialize_viewport_binary()                        (DataView, CellAccessor flyweight)
  │   │                                                       │
  │   ├─ mutation/ ────────► Uint8Array blob ─────────────► BinaryMutationReader
  │   │   serialize_mutation_result()                        (in-place buffer patching)
  │   │                                                       │
  │   ├─ constants.rs ─────► generate_ts.rs ──────────────► constants.gen.ts
  │   └─ flags.rs                (cargo run --bin)           (shared constants)
  │                                                           │
  └─ palette.rs + palette_binary/                           FormatPalette (binary section)
      (format dedup + binary encoding)                        │
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

- `createTransport(config?)` -- Factory in `transport/factory.ts`. Auto-detects N-API, Tauri, then WASM, and returns a composed `BridgeTransport`.
- `createTauriTransport()` -- Wraps `@tauri-apps/api/core invoke()` for desktop. Lazy-loads the Tauri module.
- `createWasmTransport()` -- Calls WASM module functions directly. Converts named args to positional via `Object.values()`.
- `createTimeInjectingTransport()` / `createNapiTimeInjectingTransport()` -- Middleware that injects `compute_set_current_time()` before recalc-triggering commands in WASM and N-API runtimes.
- `createBytesTupleNormalizingTransport()` -- Middleware that normalizes packed binary tuple return format from Tauri and N-API.
- `createNapiTransport()` / `createLazyNapiTransport()` / `createHeadlessNapiTransport()` -- N-API bindings for Node.js and headless runtimes.
- `isTauri()` -- Consolidated environment detection from `infra/transport/src/detection.ts`.
- `TransportError` -- Platform-level error class (no kernel dependency). Kernel's `BridgeError.fromCommand()` wraps it as `cause`.
- `WasmInitFn[]` callbacks -- WASM loader accepts init callbacks (e.g., `initTableWasm`, `initChartWasm`) instead of hardcoding cross-bridge dependencies.

## Binary Data Plane

### Viewport Protocol

Serialized by `serialize_viewport_binary()` (`compute-wire/src/viewport/mod.rs`). Produces a single `Vec<u8>` containing all data needed to render the visible grid.

**Wire layout (all little-endian):**

```
[Header 36B] [CellRecords N*32B] [StringPool] [Merges M*16B]
[RowDims R*12B] [ColDims C*12B] [FormatPaletteBinary]
[DataBars D*24B] [Icons I*8B] [RowPositions] [ColPositions]
```

**Header (36 bytes):**

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 | `start_row` | Top-left row of the viewport |
| 4 | 4 | `start_col` | Top-left column of the viewport |
| 8 | 4 | `cell_count` | Number of cell records (rows * cols) |
| 12 | 4 | `format_palette_len` | Bytes of binary FormatPalette section |
| 16 | 4 | `string_pool_bytes` | Total bytes in the string pool |
| 20 | 2 | `viewport_rows` | Number of rows in the viewport |
| 22 | 2 | `viewport_cols` | Number of columns in the viewport |
| 24 | 2 | `merge_count` | Number of merge records |
| 26 | 2 | `row_dim_count` | Number of row dimension records |
| 28 | 2 | `col_dim_count` | Number of column dimension records |
| 30 | 1 | `flags` | Bit 0: is_delta; bits 4-7: wire protocol version |
| 31 | 1 | `generation` | Mutation/fetch generation byte carried on the wire |
| 32 | 2 | `data_bar_count` | Number of data bar CF entries |
| 34 | 2 | `icon_count` | Number of icon CF entries |

**Cell Record (32 bytes, serialized manually):**

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

**FormatPalette:** Binary-encoded `CellFormat` section appended after dimensions. Deduplicated -- each unique format appears once, cells reference it by `format_idx`. Delta responses only include new palette entries (controlled by `palette_start_index`).

**CF extras and positions:** Data bar and icon sections are sparse by dense `cell_index`. Row/column position arrays carry `f64` pixel positions, including a trailing sentinel when layout-index data is available.

### Mutation Protocol

Serialized by `serialize_mutation_result()` / `serialize_mutation_result_for_viewport()` (`compute-wire/src/mutation/mod.rs`). Encodes recalc deltas so TS can splice changed cells directly into the viewport buffer.

**Wire layout (all little-endian):**

```
[Header 16B] [SheetID UTF-8] [CellPatches N*40B] [StringPool] [SpillSection?] [PaletteSection?]
```

**Header (16 bytes):**

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 | `patch_count` | Number of cell patches |
| 4 | 4 | `string_bytes` | Total bytes in string pool |
| 8 | 2 | `sheet_id_len` | Length of sheet_id UTF-8 string |
| 10 | 1 | `flags` | Bit 0: `has_projection_changes`, Bit 1: `has_errors`, Bit 2: `has_palette` |
| 11 | 1 | `generation` | Mutation generation counter |
| 12 | 4 | `reserved` | Reserved for future use |

**Cell Patch (40 bytes):**

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 | `row` | Zero-based row index |
| 4 | 4 | `col` | Zero-based column index |
| 8 | 32 | cell record | Same layout as ViewportCellRecord |

The 32-byte cell record within each patch is identical to the viewport cell record, so patches can be spliced directly into the viewport buffer's cell record array.

**Spill Section** (present when header `flags` bit 0 is set): `proj_count:u32` followed by `proj_count * 40` bytes of spill/projection cell patches (same patch format, with `IS_SPILL_MEMBER` flag set).

**Palette Section** (present when header `flags` bit 2 is set): `palette_start_idx:u16`, `palette_bytes_len:u32`, followed by binary palette bytes.

### Shared Constants

All wire format constants are defined once in Rust and generated to TypeScript:

**Flag bits (`flags.rs`, `u16` bitfield):**

| Bits | Constant | Value | Description |
|------|----------|-------|-------------|
| 0-2 | `VALUE_TYPE_MASK` | `0x7` | Value type (0=null, 1=number, 2=text, 3=bool, 4=error, 5=image) |
| 3 | `HAS_FORMULA` | `0x8` | Cell contains a formula |
| 4 | `HAS_COMMENT` | `0x10` | Cell has a comment |
| 5 | `HAS_SPARKLINE` | `0x20` | Cell has a sparkline |
| 6 | `HAS_HYPERLINK` | `0x40` | Cell has a hyperlink |
| 7 | `IS_CHECKBOX` | `0x80` | Cell renders as a checkbox |
| 8 | `IS_SPILL_MEMBER` | `0x100` | Cell is part of a spill/projection range |
| 9 | `HAS_VALIDATION_ERROR` | `0x200` | Cell has a validation error |
| 10 | `HAS_CF_EXTRAS` | `0x400` | Cell has CF extras in trailing sections |
| 11 | `HAS_CELL_IMAGE` | `0x800` | Cell has structured in-cell image metadata |

**Layout constants (`constants.rs`):**

| Constant | Value | Description |
|----------|-------|-------------|
| `VIEWPORT_HEADER_SIZE` | 36 | Viewport header bytes |
| `WIRE_VERSION` | 2 | Viewport protocol version encoded in header flags bits 4-7 |
| `CELL_STRIDE` | 32 | Bytes per cell record |
| `MERGE_STRIDE` | 16 | Bytes per merge record |
| `DIM_STRIDE` | 12 | Bytes per dimension record |
| `MUTATION_HEADER_SIZE` | 16 | Mutation header bytes |
| `PATCH_STRIDE` | 40 | Bytes per cell patch (8 addr + 32 record) |
| `DATA_BAR_ENTRY_STRIDE` | 24 | Bytes per data bar entry |
| `ICON_ENTRY_STRIDE` | 8 | Bytes per icon entry |
| `POSITION_ENTRY_SIZE` | 8 | Bytes per row/column position entry |
| `NO_STRING` | `0xFFFFFFFF` | Sentinel for "no string" |

The TS file `constants.gen.ts` is produced by `generate_ts.rs` and must not be edited by hand.

## TypeScript Consumption

### BinaryViewportBuffer

`binary-viewport-buffer.ts` -- Zero-copy reader for viewport binary blobs.

**Key design decisions:**

- **DataView, not deserialization.** The `Uint8Array` blob is stored as-is. Fields are read on demand via `DataView.getFloat64()`, `getUint16()`, etc. No JS objects are allocated per cell.
- **CellAccessor flyweight.** A single reusable object is repositioned to different cell offsets. The renderer calls `cellAt(row, col)` which computes `HEADER_SIZE + (row * cols + col) * CELL_STRIDE` and returns the accessor pointing at that offset.
- **In-place mutation patching.** Mutation patches write directly into the viewport buffer's cell record area. `ViewportCoordinator` separately stores decoded overlay entries only so mutations that arrive during an async fetch can be re-applied after fetch commit.
- **Overflow string pool.** Mutation patches may reference new strings not in the original viewport's string pool. These are appended to a growable overflow pool. `display_off >= mainPoolSize` means read from overflow. Cleared on next full viewport fetch.
- **Delta merging.** `getViewportBinaryDelta()` fetches only the changed strip (e.g., new rows after scroll). The delta is merged into the existing buffer, including string-pool and binary palette rebasing.
- **String decode cache.** `TextDecoder.decode()` results are cached by byte offset. Invalidated per-cell on patch.

### BinaryMutationReader

`binary-mutation-reader.ts` -- Zero-allocation reader for mutation result blobs.

Parses the mutation header, computes section offsets (`_patchesStart`, `_stringPoolStart`, `_projSectionStart`), and exposes:

- `patchCount` / `spillPatchCount` -- number of regular and spill/projection patches
- `sheetId()` -- decoded sheet UUID
- `patchRow(i)` / `patchCol(i)` -- address of patch `i`
- `patchRecordOffset(i)` -- byte offset of the 32-byte cell record for patch `i`
- `hasPalette`, `paletteStartIndex`, `paletteFormats` -- optional palette delta data

Used by `BinaryViewportBuffer.applyBinaryMutation()` to splice patches into the viewport buffer without intermediate JS objects.

### CellMetadataCache

`cell-metadata-cache.ts` -- Viewport-scoped cache for projection/spill and validation metadata.

Solves the async-in-sync-render problem: the canvas render loop is synchronous, but spill/validation queries are async. The cache:

1. `evaluateViewport()` -- batch-fetches projection + validation data asynchronously
2. Sync read methods (`isProjectedPosition()`, `getProjectionRange()`, `hasValidationErrors()`) serve cached data per-cell per-frame
3. `onChange` listeners trigger re-renders when the cache is populated
4. `patchProjectionChanges()` / `patchValidation()` for incremental updates from mutations

## Data Flows

### 1. Full Viewport Fetch

```
User scrolls / resize / sheet switch
  → ViewportFetchManager.refresh()
    → compute_register_viewport(viewportId, bounds)
    → coordinator.startFetch() captures fetch epoch
    → BridgeTransport.call("compute_get_viewport_binary", ...)
      → Rust: build_viewport_render_data() → serialize_viewport_binary(is_delta=false)
    ← Uint8Array
    → Discard only if a newer movement fetch superseded this response
    → ViewportCoordinator.commitFetch(blob, fetchEpoch)
      → BinaryViewportBuffer.setBuffer(blob)
      → Parse header (36B)
      → Compute section offsets
      → Decode binary FormatPalette, CF extras, and position arrays
      → Clear overflow pool and decode caches
      → Re-apply overlay entries with epoch > fetchEpoch
    → CellMetadataCache.evaluateViewport() (async, parallel)
    → Canvas renders via CellAccessor reads
```

### 2. Scroll Delta

```
User scrolls within prefetch bounds
  → BridgeTransport.call("compute_get_viewport_binary_delta", ...)
    → Rust: serialize_viewport_binary(is_delta=true, palette_start_index=N)
    ← Uint8Array (only new strip + new palette entries)
  → ViewportCoordinator.commitDelta(...)
  → BinaryViewportBuffer merges delta into existing buffer and re-applies retained overlays
  → Canvas re-renders
```

### 3. Mutation Application

```
User edits a cell
  → ComputeBridge.setCell(...) delegates to ComputeCore.mutateCore(...)
    → BridgeTransport.call("compute_set_cell", ...)
      → Rust: set_cell → recalc → produce_viewport_patches()
      → Rust: serialize_mutation_result_for_viewport(...) per registered viewport
    ← packed multi-viewport Uint8Array + MutationResult
  → ViewportCoordinatorRegistry.applyMultiViewportPatches(blob)
    → BinaryMutationReader parses each viewport patch header + sections
    → ViewportCoordinator.applyMutationPatches(reader)
      → BinaryViewportBuffer.applyBinaryMutation(reader)
        → For each in-viewport patch: write cell bytes in place + append overflow strings
      → Store decoded overlay entries for fetch-commit re-application
  → CellMetadataCache.patchProjectionChanges() if projection changes are present
  → Canvas re-renders via coordinator subscription events
```

## Key Files Map

### Rust (Source of Truth)

| File | Role |
|------|------|
| `compute/core/crates/compute-wire/src/lib.rs` | Crate root, re-exports |
| `compute/core/crates/compute-wire/src/constants.rs` | Wire layout constants (sizes, strides, offsets) |
| `compute/core/crates/compute-wire/src/flags.rs` | Cell flag bit definitions (`u16` bitfield) |
| `compute/core/crates/compute-wire/src/viewport/mod.rs` | `serialize_viewport_binary()` -- viewport blob serializer |
| `compute/core/crates/compute-wire/src/mutation/mod.rs` | `serialize_mutation_result()` / `serialize_mutation_result_for_viewport()` -- mutation blob serializers |
| `compute/core/crates/compute-wire/src/palette.rs` | `FormatPalette` -- format deduplication |
| `compute/core/crates/compute-wire/src/palette_binary/` | Binary palette encoder/decoder |
| `compute/core/crates/compute-wire/src/types.rs` | `ViewportRenderData`, `ViewportRenderCell`, etc. |
| `compute/core/crates/compute-wire/src/bin/generate_ts.rs` | TS constant generator binary |

### TypeScript (Consumers)

| File | Role |
|------|------|
| `kernel/src/bridges/wire/constants.gen.ts` | **Generated** -- wire constants (do not edit) |
| `kernel/src/bridges/wire/binary-viewport-buffer.ts` | Zero-copy viewport buffer reader |
| `kernel/src/bridges/wire/binary-mutation-reader.ts` | Zero-allocation mutation reader |
| `kernel/src/bridges/wire/cell-metadata-cache.ts` | Async projection/spill and validation cache for sync render |
| `kernel/src/bridges/wire/viewport-coordinator.ts` | Owns each viewport buffer, epoch overlays, and subscriber events |
| `kernel/src/bridges/wire/viewport-coordinator-registry.ts` | Routes packed multi-viewport patch blobs to coordinators |
| `kernel/src/bridges/compute/compute-core.ts` | Lifecycle, mutation pipeline, viewport manager wiring, EventBus |
| `kernel/src/bridges/compute/compute-bridge.ts` | Generated-bridge facade and hand-written overrides |
| `kernel/src/bridges/compute/viewport-fetch-manager.ts` | Viewport movement and force-refresh pipeline — scroll, resize, sheet switch, targeted re-fetches |
| `infra/transport/` | Transport abstraction (Tauri IPC / WASM / N-API) — `@mog/transport` package |

### Framework

| File | Role |
|------|------|
| `infra/rust-bridge/bridge-core/src/lib.rs` | `#[bridge::api]` proc-macro for JSON control plane |

## Two-Pipeline Viewport Architecture

The viewport buffer is written by two primary paths with different triggers and consistency rules:

1. **Mutation pipeline (synchronous, Rust-driven).** When a user edits a cell, `ComputeCore.mutateCore()` applies the change in Rust and returns packed multi-viewport patches in the same call. `ViewportCoordinatorRegistry` routes those patches to coordinators, which patch base buffers in place and retain decoded overlay entries for later fetch commits. Some broad visual or geometry changes emit full viewport binaries or trigger targeted force-refreshes of registered viewports.

2. **Viewport movement pipeline (asynchronous, TS-driven).** When the user scrolls, resizes, or switches sheets, `ViewportFetchManager.refresh()` registers the viewport bounds, captures the coordinator's fetch epoch, and fetches a fresh viewport blob from Rust. Superseded movement fetches are discarded with per-viewport sequence tokens.

**Coordinator epochs are the seam between the two pipelines.** A mutation applied during an async fetch receives an overlay epoch greater than the fetch epoch. When the fetch response commits, `ViewportCoordinator` replaces the base buffer, drops overlay entries already covered by the fetch, and re-applies entries with `epoch > fetchEpoch`.

This epoch contract is the consistency boundary: mutation responses are authoritative immediately, while viewport fetches can replace buffered data without losing mutations that landed during their round trip.

## Code Generation

To regenerate the TypeScript constants after changing `constants.rs` or `flags.rs`:

```bash
cargo run -p compute-wire --bin generate-ts > kernel/src/bridges/wire/constants.gen.ts
```

The generated file (`constants.gen.ts`) is checked into version control so that TS builds do not require Rust tooling. The header comment in the generated file identifies the source and regeneration command.
