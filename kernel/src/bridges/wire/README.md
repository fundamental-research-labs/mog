# Wire Module — Binary Viewport & Mutation Protocol (TS)

Zero-copy binary protocol readers for the Rust-to-TypeScript rendering pipeline.
This is the critical fast path for all cell rendering on the sheet canvas.

## Data Flow

### Viewport Path (initial render + scroll)

```
Rust build_viewport_render_data()
  -> serialize_viewport_binary()
  -> WASM/Tauri Uint8Array
  -> ViewportCoordinator.commitFetch(buffer, fetchEpoch)
     -> sets new BinaryViewportBuffer
     -> filters overlays: keeps entries with epoch > fetchEpoch
     -> re-applies surviving overlays onto the new buffer
  -> CellAccessor.moveTo(row, col)
  -> CellsLayer.render()
```

### Mutation Path (recalc after edits)

```
Rust recalc engine
  -> serialize_mutation_result()
  -> BinaryMutationReader
  -> ViewportCoordinator.applyMutation(reader)
     -> patches BinaryViewportBuffer in-place
     -> stores cell changes as epoch-stamped overlay entries
  -> next render frame reads updated data
```

### Multi-Viewport Path (frozen panes)

```
Rust serialize_multi_viewport_patches()
  -> ViewportCoordinatorRegistry.applyMultiViewportPatches()
  -> routes to per-viewport ViewportCoordinator
  -> coordinator applies patches as epoch-stamped overlays
```

## File Inventory

| File | Purpose |
|------|---------|
| `binary-viewport-buffer.ts` | Zero-copy binary buffer reader + `CellAccessor` flyweight pattern. Reads fields on demand via `DataView` without deserializing into JS objects. |
| `binary-mutation-reader.ts` | Zero-allocation mutation blob decoder with typed field accessors. Used by `applyBinaryMutation()` to splice cell patches directly into the viewport buffer. |
| `viewport-buffer.ts` | Legacy JSON-based viewport buffer. Holds visible cells + buffer zone, active cell properties, sheet metadata, and merge regions. Still used during migration. |
| `viewport-coordinator.ts` | Single-owner coordinator per viewport region. Owns the `BinaryViewportBuffer`, manages epoch-based overlay filtering for mutation/fetch consistency, and notifies subscribers of changes. |
| `viewport-coordinator-registry.ts` | Multi-viewport coordinator registry. Owns per-viewport `ViewportCoordinator` instances, demuxes packed multi-viewport blobs by viewport ID. |
| `viewport-test-builder.ts` | Test helper: builds binary viewport buffers in pure TS (no Rust/WASM needed). |
| `mutation-test-builder.ts` | Test helper: builds binary mutation buffers + packed multi-viewport blobs in pure TS. |
| `viewport-prefetch.ts` | Overscan bounds computation for prefetching adjacent viewport data. Per-viewport prefetch with scroll-direction-aware overscan to avoid unnecessary Rust IPC calls. |
| `viewport-data-provider.ts` | Narrow interface for render-path caches (conditional formatting). Async pre-fetch, synchronous per-cell reads at 60fps. |
| `cell-metadata-cache.ts` | Viewport-scoped cache for spill + validation metadata. Solves the async-in-sync-render-loop problem by batch-fetching data asynchronously, then serving it synchronously per cell per frame. |
| `mutation-classifier.ts` | Three-tier mutation invalidation classifier: `patch` (visible area, already applied), `dirty` (prefetch zone, stale but usable), `invalidate` (structural change, full refresh needed). |
| `constants.gen.ts` | Auto-generated constants from Rust (layout sizes, byte offsets, flag bits). **DO NOT EDIT** — regenerate from Rust. |
| `index.ts` | Barrel re-exports. |

## Writing Tests

Use the test builders to construct binary buffers in pure TS:

```typescript
import { BinaryViewportBuffer, CellAccessor } from './binary-viewport-buffer';
import { BinaryMutationReader } from './binary-mutation-reader';
import { buildTestViewportBuffer } from './viewport-test-builder';
import { buildTestMutationBuffer } from './mutation-test-builder';

// Build and load a viewport
const vb = new BinaryViewportBuffer();
vb.setBuffer(buildTestViewportBuffer({
  rows: 3, cols: 4,
  cells: [{ numberValue: 42, display: '42', flags: 1 /* NUMBER */ }],
}));

// Read via accessor
const acc = vb.createAccessor();
acc.moveTo(0, 0);
console.log(acc.numberValue, acc.displayText);

// Apply a mutation
const reader = new BinaryMutationReader(buildTestMutationBuffer({
  patches: [{ row: 0, col: 0, numberValue: 100, display: '100' }],
}));
vb.applyBinaryMutation(reader);
```

## Binary Protocol Spec

See [`compute-wire/README.md`](../../../../compute/core/crates/compute-wire/README.md) for the full binary protocol specification including byte offsets, field sizes, flag bits, and section layouts.

Key facts:
- All multi-byte values are **little-endian**
- Viewport header: 36 bytes, cell records: 32 bytes each (dense row-major)
- Mutation header: 16 bytes, cell patches: 40 bytes each (8-byte position prefix + 32-byte cell record)
- String pool: packed UTF-8, referenced by offset + length pairs
- Format palette: JSON tail with append-only deduplication and delta support

## Constants

`constants.gen.ts` is auto-generated from Rust to keep both sides in sync. Regenerate with:

```bash
cargo run -p compute-wire --bin generate-ts > kernel/src/bridges/wire/constants.gen.ts
```

Source of truth: `compute/core/crates/compute-wire/src/{constants,flags}.rs`
