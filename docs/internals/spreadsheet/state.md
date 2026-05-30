# State Management

## Architecture Overview

Mog keeps authoritative live workbook state in the Rust compute engine and
keeps TypeScript responsible for lifecycle, services, events, UI state, and
feature coordination.

```
Consumers
  React components, hooks, app systems, workbook APIs, namespace APIs
      |
      | reads and writes
      v
DocumentContext
  services, event bus, bridges, state mirror, write/operation gates
      |
      | ComputeBridge / ComputeCore
      v
Rust compute engine
  workbook stores, dependency graph, mutation dispatch, recalculation
      |
      | viewport patches + MutationResult
      v
MutationResultHandler
  applies mirrored state, emits semantic events, refreshes subscribers
      |
      v
UI systems
  XState actors, Zustand UIStore slices, coordinator subscriptions
```

The important boundary is the mutation boundary. User-facing writes eventually
flow through `ComputeBridge` methods, `ComputeCore.mutate(...)`, and Rust
`apply_mutation(...)`. Rust returns binary viewport patches and a
`MutationResult`. TypeScript applies those results and emits semantic events
after the Rust state has already changed.

## DocumentContext

**Primary files:**

- `kernel/src/context/kernel-context.ts`
- `kernel/src/context/types.ts`
- `types/api/src/kernel/kernel-context.ts`
- `contracts/src/kernel/kernel-context.ts`

`DocumentContext` is the per-document dependency container for kernel and app
code. It replaces the older `StoreContext` terminology.

The context contract is layered:

| Layer | Purpose |
| --- | --- |
| `IDomainContext` | Event bus and pending undo label state for domain helpers |
| `IKernelContext` | Document/session metadata, services, security policy, destruction |
| `ISpreadsheetKernelContext` | Spreadsheet bridges, state mirror, floating object manager |
| `DocumentContext` | Kernel-local compute bridge, write gate, operation gate, workbook links, selection checkpoints |

`createDocumentContext(computeBridge, options)` creates the event bus, state
mirror, range metadata cache, feature bridges, services, write gate, operation
gate, workbook link service/scope, and `destroy()` cleanup path. It does not
fully start the document on its own.

Document creation is owned by the document lifecycle system:

```
DocumentFactory.create()
  -> DocumentLifecycleSystem
     -> creates ComputeBridge with DeferredContext
     -> creates RustDocument and waits for rustDocument.ready
     -> creates DocumentContext
     -> calls computeBridge.setContext(context)
     -> calls computeBridge.initMutationHandler()
     -> starts computeBridge
     -> installs the compute-bridge WriteGate
     -> starts SchemaValidationBridge in app/browser mode
     -> attaches Providers after the bridge reaches STARTED
  -> returns DocumentHandle
```

Shipped public package consumers should use the public runtime facade that
matches their host, such as `createWorkbook(...)` from `@mog-sdk/node`,
`@mog-sdk/embed`, or `@mog-sdk/spreadsheet-app`. `@mog-sdk/kernel` is
`private: true`; its `DocumentFactory` is a workspace-internal document
lifecycle surface used by the app, SDK boot path, and tests. A workspace
`DocumentHandle` exposes `workbook()`, `eventBus`, `undoService`,
storage/checkpoint methods, collaboration attachment hooks, and disposal
methods. The raw context is only on `DocumentHandleInternal`, not on the public
application API.

Disposal follows the same ownership path. `DocumentHandle.dispose()` enters the
document lifecycle disposal state, destroys the `DocumentContext`, destroys the
`RustDocument`, and destroys the `ComputeBridge`.

## Domain Modules

**Location:** `kernel/src/domain/`

Domain modules are primarily a thin delegation layer over `DocumentContext` and
`ComputeBridge`. Durable workbook reads await compute bridge calls. Durable
workbook writes should delegate to compute bridge mutations and let the mutation
pipeline emit workbook-data events. Feature bridges and feature-specific domain
helpers that own derived cache/UI projections, such as schema, slicer, or
diagram helpers, may emit semantic invalidation events, but they should not
become a second workbook state store or bypass the Rust mutation path for
workbook data.

Common domain areas include:

| Area | Examples |
| --- | --- |
| Core workbook data | cells, sheets, workbook, dimensions, merges |
| Feature state | charts, conditional formats, comments, filters, notes, pivots, tables |
| Data integration | bindings, records, schemas, workbook links |
| Formula support | named ranges, structured references, formula helpers |
| UI-adjacent helpers | clipboard, selection, viewport helpers |

The low-level namespace facade in `kernel/src/api/index.ts` currently exposes
experimental workspace `Cells`, `Sheets`, and `Records` namespaces. The stable
high-level public Node entry point is the workbook API created by
`createWorkbook(...)` from `@mog-sdk/node`; the kernel `createWorkbook(...)` is
the workspace implementation behind that SDK surface.

## Mutation Pipeline

**TypeScript files:**

- `kernel/src/bridges/compute/compute-bridge.ts`
- `kernel/src/bridges/compute/compute-core.ts`
- `kernel/src/bridges/compute/compute-bridge.gen.ts`
- `kernel/src/bridges/mutation-result-handler.ts`

**Rust files:**

- `compute/core/src/storage/engine/mutation.rs`
- `compute/core/src/storage/engine/mutation_dispatch.rs`

The current mutation path is:

1. A workbook API, namespace API, domain helper, or app system requests a write.
2. The write reaches a generated or hand-written `ComputeBridge` method.
3. The bridge calls `ComputeCore.mutate(...)`.
4. `ComputeCore` calls the Rust transport.
5. Rust dispatches an `EngineMutation` through `apply_mutation(...)`.
6. Rust updates workbook stores, dependency state, and recalculation state.
7. Rust returns binary viewport patches and a `MutationResult`.
8. `ComputeCore` applies viewport patches.
9. `MutationResultHandler.applyAndNotify(...)` updates mirrored state and emits
   semantic events.
10. Compute services refresh validation annotations, conditional formats,
    viewports, geometry, and provider update buffers as needed.

This gives one primary write path for workbook state. The app-level
`apps/spreadsheet/src/coordinator/mutations/` directory is not the general cell
mutation layer. It contains feature-specific coordinators for diagram, equation,
and table actions.

## RustDocument

**File:** `kernel/src/document/rust-document.ts`

`RustDocument` is a Provider Protocol orchestrator around an already-created
`ComputeBridge`. It is not the workbook state store and it does not contain the
general mutation pipeline.

Main responsibilities:

| Responsibility | Description |
| --- | --- |
| Engine readiness | Tracks Rust engine initialization and lifecycle status |
| Provider fanout | Subscribes once to `bridge.subscribeUpdateV1(...)` and forwards updates to attached providers |
| Provider management | Attaches, detaches, and destroys persistence/collaboration providers |
| Provider updates | Applies provider-originated updates back through the compute bridge |
| Checkpoints | Coordinates checkpoint, structured checkpoint, full-state checkpoint, close, and flush operations |
| Cleanup | Destroys providers and bridge subscriptions during document disposal |

Persistence and collaboration behavior lives in providers. The document
lifecycle system owns creation and disposal ordering for `RustDocument`,
`ComputeBridge`, and `DocumentContext`.

## UIStore

**Location:** `apps/spreadsheet/src/ui-store/`

`UIStore` is a per-document Zustand store for ephemeral UI state. It is not the
source of truth for workbook contents.

Use the state tool that matches the kind of state:

| State type | Owner |
| --- | --- |
| Workbook data, formulas, formats, structure | Rust compute engine |
| Document services, bridges, event bus | `DocumentContext` |
| Complex interaction modes and async workflows | XState machines |
| Dialogs, toggles, panels, recent UI selections | `UIStore` |
| Session-local rendering and side effects | Spreadsheet systems/coordinator |

The current UIStore slices are grouped by area:

- `charts/`
- `clipboard/`
- `core/`
- `data-tools/`
- `dialogs/`
- `editing/`
- `formulas/`
- `navigation/`
- `nl-formula/`
- `objects/`
- `pickers/`
- `ribbon/`
- `selection/`
- `sheets/`
- `tables/`
- `view/`

## Reactive Hooks

Hooks should read from the workbook/viewport APIs and subscribe through the
coordinator or event bus only for invalidation. They should not mirror durable
workbook data into React state as a second source of truth.

For example, cell property hooks read the active cell from viewport-backed
workbook APIs and subscribe through the grid coordinator. The grid subscription
layer listens for semantic events such as `cell:format-changed` and
`cell:metadata-changed`, then invalidates the relevant hook subscribers.

```
React hook
  -> workbook/viewport read
  -> grid coordinator subscription
  -> workbook event bus
  -> MutationResultHandler event emission
  -> Rust mutation result
```

## EventBus

**File:** `kernel/src/context/event-bus.ts`

The event bus is a semantic notification layer. It is downstream from the Rust
mutation pipeline for workbook writes. It should not be treated as the mechanism
that causes persistent state changes or recalculation.

API shape:

| Method | Purpose |
| --- | --- |
| `on(type, handler)` | Subscribe to one event type |
| `onMany(types, handler)` | Subscribe to several event types |
| `onAll(handler)` | Subscribe to every event |
| `emit(event)` | Emit one typed event object |
| `emitBatch(events)` | Emit a transaction-scoped batch |
| `clear()` | Remove all subscriptions |

Common event families include:

| Family | Examples |
| --- | --- |
| Cell data | `cell:changed`, `cells:batch-changed` |
| Cell properties | `cell:format-changed`, `cell:metadata-changed` |
| Workbook structure | `rows:inserted`, `columns:deleted`, `sheet:created`, `sheet:deleted` |
| Validation | `validation:recalc-annotations`, `validation:failed`, `validation:passed` |
| Recalculation | `recalc:completed` |

Consumers should subscribe to the narrowest semantic event that matches their
invalidation need.

## Bridges

**Location:** `kernel/src/bridges/`

Bridges connect `DocumentContext` to stateful subsystems. Important bridges and
bridge-like services include:

| Bridge | Role |
| --- | --- |
| `ComputeBridge` / `ComputeCore` | Transport, generated read/write APIs, mutation orchestration, viewport refresh |
| `MutationResultHandler` | Converts Rust mutation results into state mirror updates and semantic events |
| `SchemaValidationBridge` | Tracks schemas, validation annotations, and validation events |
| `PivotBridge` / `PivotEventBridge` | Coordinates pivot invalidation, materialization, and event-driven refresh |
| `TableBridge` | Exported table bridge utility with table-engine cache/invalidation behavior; not currently instantiated by `createDocumentContext(...)` |
| `LocaleInputBridge` | Locale-aware parsing and input normalization |
| Chart, diagram, ink, equation, and text-effect bridges | Feature integration attached through the document context |

Context-wired bridge creation is centralized in `createDocumentContext(...)`;
bridge startup that depends on a fully wired compute bridge is handled by the
document lifecycle system.

## Dependency Graph

**Primary file:** `compute/core/crates/compute-graph/src/lib.rs`

The Rust compute graph uses a `DependencyGraph` keyed by stable cell IDs. It
tracks formula cells, normal cell dependencies, range dependencies, volatile
cells, dirty sets, topological ordering, and cycle information.

Stable cell IDs mean that row and column moves do not require dependency edges
to be rebuilt purely because visual coordinates changed. Structural operations
still go through Rust structure-change handling. That handling updates position
indexes, shifts formulas and named ranges where needed, prepares recalculation,
and returns mutation results that can refresh viewports and subscribers.

## Recalculation

Recalculation is Rust-side state, not an EventBus-driven TypeScript process.

For normal edits, the mutation dispatcher updates stores and prepares a
recalculation result before the mutation is flushed back to TypeScript. Dirty
sets are seeded from changed cells and volatile formulas, then dependents are
walked through the graph. Full recalculation paths are used for explicit
workbook recalculation and initialization-style flows.

For structural changes, the structure-change service updates compute indexes,
formula strings, named references, and affected workbook stores, then merges the
structural patches with recalculation output before returning a `MutationResult`.

EventBus notifications are emitted after these Rust operations complete so UI
systems can invalidate or refresh.

## Feature-Based Coordinator Organization

**Primary files:**

- `apps/spreadsheet/src/coordinator/sheet-coordinator.ts`
- `apps/spreadsheet/src/systems/`
- `apps/spreadsheet/src/coordinator/features/index.ts`

`SheetCoordinator` is now a composition root for systems rather than a single
large feature owner. It creates and starts:

| System | Responsibility |
| --- | --- |
| `GridEditingSystem` | Selection, editing, fill, resize, validation, structure, table editing, toolbar integration |
| `RenderSystem` | Canvas rendering, viewport subscriptions, renderer-facing actors |
| `ObjectSystem` | Floating objects such as charts, diagrams, shapes, and related selection behavior |
| `InputSystem` | Keyboard, focus, pointer, scroll, and input orchestration |
| `InkSystem` | Ink-specific interaction and rendering coordination |

`apps/spreadsheet/src/coordinator/features/index.ts` is mostly a compatibility
barrel that re-exports modules from `systems/*`.

## Actor Access Layer

**Public contracts:**

- `contracts/src/actors/index.ts`
- `types/machines/src/actors/`

**Application composition:**

- `apps/spreadsheet/src/coordinator/actor-access/index.ts`
- `apps/spreadsheet/src/systems/*/actor-access/`

Actor access separates reads from commands:

| Concept | Purpose |
| --- | --- |
| Accessors | Point-in-time reads from XState actors and related state |
| Commands | Fire-and-forget writes that send actor events |
| Selectors | Reusable read selectors; app actor access currently imports local selector modules under `apps/spreadsheet/src/selectors/` after kernel export tightening |

The coordinator-level actor-access module composes accessors from the system
implementations. New system-specific actor access should live with the owning
system and be re-exported through the coordinator only when another system needs
that boundary.

## Unified Action System

**Files:**

- `contracts/src/actions/`
- `apps/spreadsheet/src/actions/dispatcher.ts`
- `apps/spreadsheet/src/actions/handlers/`

The action system routes UI and command-surface actions through one dispatcher.
Action dependency/result contracts live in `contracts/src/actions/`; the action
type unions are re-exported there from `@mog/types-editor`. Application handlers
live under `apps/spreadsheet/src/actions/handlers/`.

`dispatch(action, deps, payload?)` receives an `ActionDependencies` object and
uses `HANDLER_MAP` to route each action type to its handler. Handlers should use
domain/workbook APIs, coordinator commands, actor commands, or UIStore actions
instead of reaching around the state architecture.

## Implementation Files

| Area | Files |
| --- | --- |
| Document context | `kernel/src/context/kernel-context.ts`, `kernel/src/context/types.ts`, `types/api/src/kernel/kernel-context.ts` |
| Document lifecycle | `kernel/src/document/document-lifecycle-system.ts`, `kernel/src/document/document-lifecycle-machine.ts`, `kernel/src/api/document/document-factory.ts` |
| Rust provider orchestration | `kernel/src/document/rust-document.ts` |
| Compute bridge | `kernel/src/bridges/compute/compute-bridge.ts`, `kernel/src/bridges/compute/compute-core.ts`, `kernel/src/bridges/compute/compute-bridge.gen.ts` |
| Mutation result events | `kernel/src/bridges/mutation-result-handler.ts`, `kernel/src/context/event-bus.ts`, `types/events/src/` |
| Rust mutations | `compute/core/src/storage/engine/mutation.rs`, `compute/core/src/storage/engine/mutation_dispatch.rs` |
| Rust recalculation | `compute/core/src/storage/engine/recalc.rs`, `compute/core/crates/compute-graph/src/` |
| Domain helpers | `kernel/src/domain/`, `kernel/src/api/index.ts` |
| UIStore | `apps/spreadsheet/src/ui-store/` |
| App systems | `apps/spreadsheet/src/systems/`, `apps/spreadsheet/src/coordinator/sheet-coordinator.ts` |
| Actor access | `types/machines/src/actors/`, `contracts/src/actors/index.ts`, `apps/spreadsheet/src/selectors/`, `apps/spreadsheet/src/systems/*/actor-access/` |
| Actions | `contracts/src/actions/`, `apps/spreadsheet/src/actions/` |

## Related Documents

- [Architecture](./ARCHITECTURE.md)
- [Cell Identity](./cell-identity.md)
- [Data Model](./data-model.md)
- [Renderer Binary Wire Pipeline](./renderer/binary-wire-pipeline.md)
- [Renderer Canvas](./renderer/canvas.md)
- [Renderer XState](./renderer/xstate.md)
