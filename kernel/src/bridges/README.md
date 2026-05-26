# Bridges — External Engine Integration Layer

Translates between the kernel and external computation engines (Rust compute-core, table-engine, pivot, schema). Two-protocol IPC: JSON control plane for commands, binary data plane for 60 FPS rendering.

## Architecture

```
                    Kernel (TypeScript)
                         │
        ┌────────────────┼────────────────────┐
        │                │                    │
        ▼                ▼                    ▼
  ┌───────────┐   ┌────────────┐    ┌──────────────┐
  │ Compute   │   │  Domain    │    │   Feature    │
  │ Bridge    │   │  Bridges   │    │   Bridges    │
  │           │   │            │    │              │
  │ lifecycle │   │ table      │    │ pivot        │
  │ mutation  │   │ schema     │    │ slicer       │
  │ viewport  │   │ locale     │    │ condformat   │
  │ sync      │   │            │    │ pivot-event  │
  └─────┬─────┘   └─────┬──────┘    └──────┬───────┘
        │                │                  │
        ▼                ▼                  ▼
  ┌──────────────────────────────────────────────┐
  │         MutationResultHandler                │
  │  MutationResult → EventBus semantic events   │
  └──────────────────┬───────────────────────────┘
                     │
     ┌───────────────┼───────────────┐
     ▼               ▼               ▼
 JSON IPC       Binary Wire      EventBus
 (commands)     (viewport +      (reactive
              mutations)        rendering)
     │               │
     ▼               ▼
         Rust compute-core
```

## Directory Structure

```
bridges/
├── index.ts                  Barrel — re-exports all bridges and types
├── mutation-result-handler.ts  Event gateway: MutationResult → EventBus events
├── compute/                  Rust compute-core connection
│   ├── compute-bridge.ts     Composition root (~200 lines), mixes in generated methods
│   ├── compute-bridge.gen.ts ~400 generated passthrough methods via transport
│   ├── compute-core.ts       Hand-written infra: lifecycle, mutation pipeline, sync
│   ├── viewport-fetch-manager.ts  Viewport movement pipeline (scroll, resize, sheet switch)
│   ├── compute-types.gen.ts  Auto-generated TS types from Rust snapshot-types
│   ├── compute-wire-types.ts Wire type definitions
│   ├── compute-wire-converters.ts  Type conversions between wire and kernel formats
│   └── index.ts              Barrel + transport re-exports for backward compat
├── wire/                     Binary protocol readers (zero-copy, zero-alloc)
│   ├── binary-viewport-buffer.ts   CellAccessor flyweight — reads DataView on demand
│   ├── binary-mutation-reader.ts   Mutation blob decoder, splices patches into viewport
│   ├── viewport-prefetch.ts        Scroll-direction-aware overscan bounds
│   ├── viewport-data-provider.ts   Async prefetch + sync per-cell reads at 60 FPS
│   ├── cell-metadata-cache.ts      Viewport-scoped spill + validation metadata cache
│   ├── mutation-classifier.ts      Three-tier invalidation: patch / dirty / invalidate
│   ├── viewport-test-builder.ts    Pure-TS binary viewport builder (no Rust needed)
│   ├── mutation-test-builder.ts    Pure-TS binary mutation builder
│   ├── constants.gen.ts            Auto-generated from Rust — DO NOT EDIT
│   └── index.ts
├── table-bridge.ts           Table engine: type conversion + per-column bitmap caching
├── schema-bridge.ts          Schema validation via @mog/schema-engine
├── pivot-bridge.ts           Pivot table computation via ComputeBridge
├── pivot-event-bridge.ts     EventBus integration for reactive pivot updates
├── slicer-table-bridge.ts    Slicer → table filter integration
├── slicer-pivot-bridge.ts    Slicer → pivot filter integration
├── locale-bridge.ts          Locale-aware input normalization
├── condformat-cache.ts       Conditional formatting evaluation via Rust compute-core
└── __tests__/
    ├── table-bridge.test.ts
    ├── schema-bridge.test.ts
    ├── condformat-cache.test.ts
    └── ink-recognition-bridge.test.ts
```

## Key Design Decisions

### Two-Protocol IPC

Commands flow through **JSON** (create workbook, set cell, undo). Viewport data and mutation patches flow through a **binary wire protocol** for zero-copy rendering. The JSON path is simple and debuggable; the binary path eliminates GC pressure on the render hot path.

### MutationResultHandler as Event Gateway

Every Rust mutation returns a `MutationResult` containing change sets (cells, dimensions, merges, filters, charts, etc.). The handler processes each change set and emits typed `EventBus` events. This is the **single point** where Rust state changes become observable to the reactive rendering layer. No bridge emits events directly — all flow through the handler.

### Event Emission

All domains are now fully served by Rust. The `MutationResultHandler` is the sole event source — it processes `MutationResult` change sets and emits typed `EventBus` events for all domains unconditionally.

### ComputeBridge: Composition Root

The `ComputeBridge` class is a thin composition root (~200 lines) that:
1. Delegates lifecycle/sync to `ComputeCore`; viewport movement is delegated to `ViewportFetchManager`
2. Mixes in ~400 generated passthrough methods via `Object.assign` from `compute-bridge.gen.ts`
3. Provides hand-written overrides for methods needing special logic

Generated methods call `this.core.mutate()` / `this.core.query()` which handle transport, error recovery, and mutation result processing uniformly.

### Stateless Engine Pattern (Domain Bridges)

Domain bridges (table, schema, slicer, pivot) follow the same pattern: the external engine is **stateless** — the bridge owns caching, type conversion, CellId translation, and EventBus subscriptions. The engine computes; the bridge integrates.

### Two Independent Pipelines

The binary data plane carries two independent pipelines that never trigger each other:

- **Mutation pipeline**: Sync patches applied by `ComputeCore`. A cell edit returns a binary mutation blob that is spliced directly into the current viewport buffer — no fetch required.
- **Viewport movement pipeline**: Async fetches managed by `ViewportFetchManager`. Scroll, resize, and sheet-switch events request a new viewport from Rust and swap the buffer on completion.

This separation means mutations never cause viewport fetches, and viewport movements never replay mutations.

### Binary Wire Protocol

The `wire/` subdirectory implements zero-copy binary readers. Key performance characteristics:
- **Viewport**: 32-byte header + 24-byte cell records, dense row-major, read via `DataView` (no deserialization)
- **Mutations**: 16-byte header + 32-byte cell patches, spliced directly into viewport buffer
- **String pool**: packed UTF-8 referenced by offset + length
- **Constants**: auto-generated from Rust to keep byte offsets in sync

See [`wire/README.md`](wire/README.md) for the full binary protocol specification.

## Dependencies

Bridges import **inward** only:

| Imports from | Purpose |
|-------------|---------|
| `context/` | `DocumentContext`, `IKernelContext` |
| `errors/` | `BridgeError` |
| `domain/` | Schema sync delegation |
| `floating-objects/` | Object type mappings |
| `@mog-sdk/contracts` | Shared type definitions |
| `@mog/table-engine` | Stateless table computation |
| `@rust-bridge/client` | Transport abstraction |
| `platform/transport/` | Transport factory (Tauri IPC / WASM) |

Does **not** import from: `api/`, `services/`, `keyboard/`, `document/`.

## Consumers

- **`api/`** — WorkbookImpl and WorksheetImpl hold a `ComputeBridge` reference via `DocumentContext`
- **`domain/`** — Every domain function delegates to `ctx.computeBridge.*`
- **`services/`** — Clipboard, history, code execution read from bridges
- **Apps** — Spreadsheet grid reads `BinaryViewportBuffer` via viewport regions
- **Headless server** — Creates `ComputeBridge` with NAPI transport for server-side rendering
