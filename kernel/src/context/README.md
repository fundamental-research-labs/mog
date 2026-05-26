# Context — Kernel Context Factory

Single consolidated factory that creates the kernel context at three privilege tiers.
Every consumer declares its minimum privilege via TypeScript type narrowing.

```
  Shell (IKernelContext)      Domain (IDomainContext)      Engine (DocumentContext)
        |                           |                            |
        v                           v                            v
  ┌─────────────────────────────────────────────────────────────────────┐
  │                      context/                                       │
  │                                                                     │
  │   createDocumentContext(ComputeBridge)                               │
  │     -> eventBus          (Tier 1: IDomainContext)                    │
  │     -> + bridges/services (Tier 2: IKernelContext)                   │
  │     -> + computeBridge    (Tier 3: DocumentContext)                  │
  │     -> + viewport buffers                                           │
  └─────────────────────────────────────────────────────────────────────┘
```

## Three Context Tiers

| Tier | Interface | Visible To | Provides |
|------|-----------|------------|----------|
| 1 | `IDomainContext` | Domain modules | EventBus, undo description |
| 2 | `IKernelContext` | Shell, API layer | + all bridges + services + `destroy()` |
| 3 | `DocumentContext` | Engine internals | + ComputeBridge + BinaryViewportBuffer + selection checkpointing |

Canonical interface definitions live in `contracts/src/kernel/kernel-context.ts`.
`DocumentContext` extends `ISpreadsheetKernelContext` in `types.ts` (local).

## Directory Structure

```
context/
  kernel-context.ts          # Factory: createDocumentContext() — assembles all bridges and services
  types.ts                   # DocumentContext interface (pure types, no runtime imports from domain)
  event-bus.ts               # Global pub-sub: createEventBus() + singleton `eventBus`
  bridge-devtools-wrapper.ts # Proxy wrapper that times bridge calls for OS DevTools
  index.ts                   # Barrel re-exports
```

## Key Design Decisions

### Single factory, not builders
One function (`createDocumentContext`) creates the entire context. No step-by-step
builder, no partial contexts. Consumers narrow via TypeScript types, not runtime checks.

### Two-phase initialization
Bridges need a reference to `ctx`, but `ctx` needs the bridges. Solved with a
`Proxy` that delegates to a deferred reference (`ctxRef.current`). During
construction only `eventBus` is accessible; after the factory returns, all
properties resolve to the real context.

### Factory does NOT wire back into ComputeBridge
The caller (`DocumentLifecycleSystem.executeWireContext`) handles the reverse
wiring (`computeBridge.setContext(ctx)` and `setBinaryViewportBuffer`). This
keeps orchestration out of the factory.

### EventBus is the global event backbone
`event-bus.ts` implements `IEventBus` from contracts. Bridges translate Rust
mutations into semantic `SpreadsheetEvent`s (50+ types). Three subscription
modes: `on()` (single type), `onMany()` (multiple types), `onAll()` (wildcard).
Errors in handlers are caught and logged, never propagate to emitters.

### Headless stubs
When `environment: 'headless'`, browser-dependent bridges (text effects, diagrams)
are replaced with no-op stubs. Core bridges (compute, pivot, schema, charts)
work in both environments.

### DevTools tracing
`bridge-devtools-wrapper.ts` wraps bridges with a Proxy that times every call
and reports to `window.__OS_DEVTOOLS__`. Zero cost when devtools is not loaded.

## What the Factory Creates

The factory wires up these components in order:

1. **BinaryViewportBuffer** + CellAccessor (zero-copy binary transfer path)
2. **PivotBridge**, **SchemaValidationBridge**, **LocaleInputBridge**
3. **ChartBridge** (started immediately)
4. **Text-effects rendering bridge**, **EquationBridge**, **Diagram bridge**
5. **InkRecognitionBridge**
6. **SpreadsheetObjectManager** (floating object CRUD)
7. **Kernel Services**: clipboard, undo, notifications, queryExecutor

`destroy()` tears down in reverse order.

## Dependencies

Imports from:
- `domain/` — bridge constructors (ChartBridge, PivotBridge, etc.)
- `bridges/` — ComputeBridge, LocaleInputBridge, SchemaValidationBridge, wire/
- `services/` — clipboard, undo, notifications, query-executor
- `floating-objects/` — SpreadsheetObjectManager
- `errors/` — KernelError, DocumentNotReadyError

Does NOT import from:
- `api/` — context is below the API layer
- `keyboard/` — input handling is above context

## Consumers

- **`document/`** — `DocumentLifecycleSystem` calls `createDocumentContext()` and wires it
- **`api/`** — receives `IKernelContext` from shell, narrows to `IDomainContext` for domain calls
- **`domain/`** — every function takes `IDomainContext` or `DocumentContext` as first arg
- **`bridges/`** — capture `ctx` reference at construction, access properties lazily
