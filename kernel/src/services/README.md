# Services — Cross-App System Services

Stateful services that survive app switches, with observable lifecycle and disposable subscriptions.

```
  DocumentFactory                          Kernel singleton
       |                                        |
       v                                        v
  ┌─────────────────────────────────┐   ┌──────────────┐
  │  Per-document services          │   │  Global       │
  │                                 │   │              │
  │  Clipboard  (XState machine)    │   │  TableRegistry│
  │  Undo       (Subscribable)      │   └──────────────┘
  │  Checkpoint (Subscribable)      │
  │  Notifications (Subscribable)   │          Stateless
  │  QueryExecutor                  │        ┌──────────┐
  │  Filesystem                     │        │Protection│
  │  Capabilities (EventEmitter)    │        │(pure fns)│
  └───────────┬─────────────────────┘        └──────────┘
              │
              │ subscribe() → IDisposable
              │ on(event) → IDisposable
              v
         App / Shell consumers
```

## Directory Structure

```
services/
├── clipboard/        XState machine managing copy/paste state
├── undo/             Delegates to ComputeBridge (Rust undo stack), extends Subscribable
├── checkpoint/       Version control snapshots
├── notifications/    Toast/notification queue, observable
├── capabilities/     Permission management with vector clocks and audit logging
├── query-executor/   External data queries with caching
├── table-registry/   Global singleton for table ID → metadata mapping
├── filesystem/       Cross-platform file I/O with watch callbacks
├── protection/       Pure password hashing/verification (no lifecycle)
├── primitives/       Subscribable<T>, TypedEventEmitter, DisposableStore, Result<T,E>
└── index.ts          Barrel re-exports
```

## Lifecycle Model

| Lifetime | Services | Created by | Disposed by |
|----------|----------|------------|-------------|
| Per-document | Clipboard, Undo, Checkpoint, Notifications, QueryExecutor, Filesystem, Capabilities | `DocumentFactory` | Document close |
| Global singleton | TableRegistry | `getTableRegistry()` (lazy) | `resetTableRegistry()` |
| Stateless | Protection | n/a (pure functions) | n/a |

## Key Design Decisions

1. **Factory functions, not constructors.** All stateful services are obtained via
   `createXxxService()` factories. No direct `new` — this keeps creation logic
   encapsulated and testable.

2. **Observable via Subscribable or TypedEventEmitter.**
   - `Subscribable<T>` — single state snapshot, `subscribe()` fires immediately
     with current state, then on every `emitChange()`.
   - `TypedEventEmitter<TEventMap>` — multiple named events, `on(event, handler)`
     fires only when `emit(event, data)` is called.
   - Both return `IDisposable` from subscribe/on — composable with `DisposableStore.track()`.

3. **Result<T, E> for fallible operations.** Services return `ok(value)` or
   `err(error)` — never throw, never return bare booleans. Imported from
   `primitives/` which re-exports from `@mog-sdk/contracts/core`.

4. **Error isolation.** Both `Subscribable` and `TypedEventEmitter` wrap every
   listener call in try-catch. One bad listener never crashes other listeners
   or the emitting service.

5. **Clipboard uses XState.** The clipboard service is a finite state machine
   (`clipboardServiceMachine`) — not a plain Subscribable — because copy/paste
   has complex intermediate states (idle, copying, pasting, marching-ants).

6. **Undo delegates to Rust.** `UndoService` extends `Subscribable<UndoServiceState>`
   but all real undo/redo logic lives in Rust compute-core via `ComputeBridge`.
   The TS service is a thin observable wrapper.

## Primitives

The `primitives/` directory provides the building blocks used by all services:

| Export | Source | Purpose |
|--------|--------|---------|
| `Subscribable<T>` | kernel | Observable state container — `subscribe()`, `once()`, `getSnapshot()` |
| `TypedEventEmitter<TEventMap>` | kernel | Multi-event emitter — `on()`, `once()`, `emit()` |
| `DisposableBase`, `DisposableStore`, `DisposableGroup` | contracts | Lifecycle management |
| `MutableDisposable`, `DisposableNone`, `toDisposable` | contracts | Disposal helpers |
| `Result<T,E>`, `ok()`, `err()` | contracts | Fallible return type |
| `IDisposable`, `Listener<T>` | contracts | Core interfaces |

## Dependencies

```
services/ imports from:
  ├── bridges/         (ComputeBridge — undo delegates to Rust)
  ├── contracts        (@mog-sdk/contracts)
  └── primitives/      (Subscribable, TypedEventEmitter, Disposable, Result)

services/ does NOT import from:
  ├── api/
  ├── domain/
  ├── floating-objects/
  ├── keyboard/
  └── document/
```

## Consumers

- **`api/`** — `WorkbookImpl`, `WorksheetImpl` expose services to apps
- **`document/`** — `DocumentFactory` creates per-document service instances
- **Apps** — `@mog/spreadsheet` reads clipboard/undo/notification state via subscriptions
- **Shell** — file-open/save flows use `FilesystemService`
