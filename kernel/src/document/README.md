# Document — Lifecycle & Persistence

Manages document initialization, IndexedDB persistence, and state machine orchestration. RustDocument is the sole document implementation — all data lives in Rust compute-core, with IndexedDB as the offline persistence layer.

## Architecture

```
  CREATE / CREATE_FROM_XLSX
           |
           v
  ┌─────────────────────────────────────────────────┐
  │         DocumentLifecycleSystem                  │
  │  (owns XState actor, executes side effects)      │
  │                                                  │
  │   fromPromise actors:                            │
  │     createEngine  -> ComputeBridge + RustDocument │
  │     wireContext   -> setContext(), UndoService    │
  │     startBridge   -> RecalcResult, subscriptions  │
  │     hydrateXlsx   -> parse + hydrate (XLSX only) │
  │     disposeBridge -> teardown                     │
  └──────────────────┬──────────────────────────────┘
                     │ drives
                     v
  ┌─────────────────────────────────────────────────┐
  │      documentLifecycleMachine (XState v5)        │
  │                                                  │
  │  idle -> creating -> wiring -> starting          │
  │                                    |             │
  │                         ┌──────────┴──────────┐  │
  │                         v                     v  │
  │                     hydrating              ready  │
  │                         |                        │
  │                         └──────> ready           │
  │                                                  │
  │  (any state) --DISPOSE--> disposing -> disposed  │
  │  (any state) --error----> error                  │
  └──────────────────────────────────────────────────┘
                     │
                     v
  ┌─────────────────────────────────────────────────┐
  │              RustDocument                        │
  │                                                  │
  │  Persistence:                                    │
  │    open:  IndexedDB -> syncApply() -> Rust       │
  │    save:  Rust -> syncFullState() -> IndexedDB   │
  │    close: final syncFullState() -> IndexedDB     │
  │                                                  │
  │  Auto-save triggers:                             │
  │    - 30s idle debounce                           │
  │    - 100 mutation threshold                      │
  │                                                  │
  │  Status: connecting -> syncing -> ready | error  │
  └─────────────────────────────────────────────────┘
```

## Directory Structure

```
document/
├── index.ts                        Barrel exports
├── rust-document.ts                RustDocument — IndexedDB persistence, auto-save, status lifecycle
├── document-lifecycle-machine.ts   Pure XState v5 state machine (no side effects)
└── document-lifecycle-system.ts    System class — owns actor, implements fromPromise actors
```

## Key Design Decisions

### Pure Machine / Side-Effect System Split

The state machine (`document-lifecycle-machine.ts`) is a pure declarative XState v5 definition — no `async`, no I/O, no imports beyond types. All async work lives in `DocumentLifecycleSystem` as `fromPromise` actor implementations injected via `machine.provide()`. This makes the machine fully testable without mocking I/O.

### DeferredContext Proxy

ComputeBridge is created before DocumentContext exists (chicken-and-egg: RustDocument needs ComputeBridge, DocumentContext needs RustDocument). A `Proxy` stands in during the gap, throwing a descriptive error on any premature access instead of a null dereference.

### DISPOSE From Any State

The `DISPOSE` event can be sent from any state, ensuring cleanup always works regardless of where initialization stalled. The disposing state runs `disposeBridge` to tear down the bridge and document.

### Conditional XLSX Routing

The machine routes `starting -> hydrating -> ready` for XLSX imports, or `starting -> ready` for new/persisted documents. The hydrating state parses and applies the XLSX data after the bridge is running.

## Consumers

- **`api/app/`** — `AppKernelApi` uses `DocumentLifecycleSystem` to create and dispose documents
- **`context/`** — `DocumentContext` is wired during the `wiring` state
- **`bridges/compute/`** — `ComputeBridge` is created during the `creating` state

## Dependencies

Imports from `bridges/` (ComputeBridge), `context/` (DocumentContext), `errors/` (KernelError). Does **not** import from `api/`, `services/`, `keyboard/`, or `floating-objects/`.
