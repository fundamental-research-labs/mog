# API Design Philosophy

Workbook/Worksheet APIs use three main shapes. This document defines the categories, the rules for choosing between them, and the infrastructure that supports disposable handles.

---

## The Three Categories

### 1. Stateless -- Methods

Each call is self-contained. Input in, output out. No caller-owned resource or cleanup. Any consumer (agent, headless, render loop, LLM code) can call these freely.

```typescript
await ws.setCell("A1", 42);                    // fire-and-forget mutation
const data = await ws.getRange("A1:B10");      // self-contained query
await wb.history.undo();                        // stateless command
const addr = wb.indexToAddress(0, 0);           // pure function
```

**Test:** After the method resolves, is there no caller-owned resource to manage? Then it is stateless. The method may still mutate the workbook.

### 2. Workbook-Scoped -- Always-On State

Sub-APIs, caches, and stores owned by the workbook or worksheet. They may be created lazily, but the consumer reads from a `readonly` property and never creates or destroys them directly. Lifecycle is bound to `wb.dispose()` or worksheet disposal.

```typescript
wb.history.canUndo();                          // sync read from workbook history state
ws.cellMetadata.isProjectedPosition(row, col); // sync read from worksheet metadata cache
ws.viewport.getCellData(row, col);             // sync read from binary viewport buffer
```

**Test:** Does the consumer get this from a `readonly` property (not a factory method)? Then it is workbook-scoped.

### 3. Consumer-Scoped -- Handles

The consumer creates a resource that the kernel holds on its behalf. The resource has a lifecycle shorter than or equal to the workbook. The creation method returns a handle object, and that handle is the API for the resource. New lifecycle APIs should use disposable handles; existing change trackers use `close()` and some subscriptions return unsubscribe functions, but they still keep identity on the returned object rather than a string ID.

```typescript
// Create returns a handle
const region = wb.viewport.createRegion(sheetId, bounds);

// All operations on that resource are methods on the handle
region.updateBounds(newBounds);
region.refresh();

// Cleanup -- explicit or automatic via TC39 using declaration
region.dispose();
```

**Test:** Does the consumer say "start" and later "stop"? Then it is a consumer-scoped handle.

---

## The Three Rules

1. **Stateless operations are methods.** No handle, no cleanup.
2. **Consumer-scoped state returns handles.** The handle IS the API surface. Prefer `dispose()` as the cleanup path for new lifecycle APIs. Never use string IDs for lifecycle management -- if you are passing an ID to `unregister(id)`, you have lost the handle pattern.
3. **Disposable handles compose into a tree.** Every disposable handle is tracked by its parent. Disposing a parent disposes all tracked children. The workbook is the root for workbook-level handles.

```
Workbook.dispose()
  |-- all ViewportRegion handles -> auto-disposed
  |-- all Worksheet instances -> auto-disposed
  |-- tracked event subscriptions -> auto-unsubscribed
  |-- FloatingObjectManager -> disposed
  |-- CheckpointManager -> auto-cleared
  |-- CodeExecutor -> auto-disposed
  +-- FormControlManager -> auto-cleared if created
```

---

## Decision Flowchart

Use this when adding a new method to the Workbook or Worksheet API:

```
Does the operation create a caller-owned resource that lives after the call?
  |
  +-- NO --> Stateless method. Return the result directly.
  |          Examples: getRange(), setCell(), indexToAddress()
  |
  +-- YES
       |
       Is the state scoped to the workbook/worksheet lifetime?
         |
         +-- YES --> Readonly property on Workbook/Worksheet.
         |           Consumer reads but never creates or destroys.
         |           Examples: wb.history, ws.cellMetadata
         |
         +-- NO
              |
              Does the consumer need to start AND later stop?
                |
                +-- YES --> Consumer-scoped handle.
                |           Factory method returns a typed handle.
                |           All operations are methods on the handle.
                |           For disposable handles, track in the parent's DisposableStore.
                |           Example: wb.viewport.createRegion()
                |
                +-- NO --> Re-examine. It is probably stateless.
```

---

## Why Handles, Not IDs

| ID-based (wrong) | Handle-based (right) |
|---|---|
| `registerRegion("main", ...)` | `createRegion(...) -> handle` |
| `updateRegionBounds("main", ...)` | `handle.updateBounds(...)` |
| `unregisterRegion("main")` | `handle.dispose()` |
| Caller tracks string ID | Caller holds typed object |
| Can call update on non-existent ID (silent fail) | Cannot -- handle IS the identity |
| Must remember to unregister (leak risk) | `using` keyword auto-disposes |
| No type safety on the ID | Full method autocomplete on handle |

---

## Who Uses What

| Consumer | Stateless | Workbook-Scoped | Consumer-Scoped Handles |
|---|---|---|---|
| LLM-generated code | All | Rarely | Rarely (short-lived scripts) |
| Headless agent | All | Some (if rendering) | Some (viewport regions) |
| Render loop | Rarely (perf) | All (sync reads) | All (viewport regions) |
| OS apps | All | All | All |

All three categories are available to all consumers. The distinction is about the nature of the operation, not who is calling.

---

## Infrastructure

The disposable handle pattern is supported by `IDisposable` in `types/core/src/disposable.ts` (re-exported by `contracts/src/core/disposable.ts`) and runtime primitives in `spreadsheet-utils/src/disposable.ts`.

### IDisposable

Interface for any resource with explicit lifecycle. Implements TC39 `Symbol.dispose` for use with `using` declarations.

```typescript
interface IDisposable {
  dispose(): void;
  [Symbol.dispose](): void;
}
```

### DisposableBase

Abstract base class for handle implementations. Provides:

- **Idempotent dispose** -- calling `dispose()` multiple times is safe (only the first call runs cleanup).
- **TC39 Symbol.dispose** -- enables `using` declarations.
- **isDisposed** -- readonly boolean for guard checks.
- **throwIfDisposed()** -- call at the top of handle methods to prevent use-after-dispose.

Subclass and override `_dispose()` for cleanup logic:

```typescript
class ViewportRegionImpl extends DisposableBase {
  protected _dispose(): void {
    void this.computeBridge.unregisterViewportRegion(this.id);
  }
}
```

### DisposableStore

Tracks child disposables. Disposing the store disposes all children. Used by `WorkbookImpl` to auto-cleanup all created handles.

```typescript
class DisposableStore implements IDisposable {
  track<T extends IDisposable>(disposable: T): T;   // register + return for chaining
  untrack(disposable: IDisposable): void;            // remove without disposing
  dispose(): void;                                    // dispose all children + clear
}
```

**Usage in WorkbookViewportImpl:**

```typescript
class WorkbookViewportImpl {
  constructor(private computeBridge, private disposables: DisposableStore) {}

  createRegion(sheetId, bounds) {
    const region = new ViewportRegionImpl(sheetId, bounds, this.computeBridge);
    this.disposables.track(region);
    return region;
  }
}
```

---

## TC39 Explicit Resource Management

Disposable handles implement `Symbol.dispose`, enabling the TC39 `using` declaration (TypeScript 5.2+). This provides automatic cleanup at block exit, similar to RAII in C++ or `with` in Python:

```typescript
{
  using region = wb.viewport.createRegion(sheetId, bounds);
  region.updateBounds(newBounds);
  await region.refresh();
} // region.dispose() called automatically here
```

This is especially useful in test code and short-lived scopes where manual `dispose()` calls are easy to forget.

---

## Real Examples from the Codebase

### Stateless: Workbook methods

From `types/api/src/api/workbook.ts`:

```typescript
// Pure queries
wb.getSheetById(sheetId);                // sync sheet lookup by ID
wb.indexToAddress(0, 0);                 // pure conversion: (0,0) -> "A1"
wb.addressToIndex("A1");                 // pure conversion: "A1" -> {row:0, col:0}
await wb.getSheetNames();               // one-shot query

// Fire-and-forget mutations
await wb.history.undo();                // stateless command
await wb.sheets.add("Sales");           // stateless command
```

### Workbook-Scoped: Readonly properties

From `types/api/src/api/workbook.ts`:

```typescript
readonly sheets: WorkbookSheets;                 // always-on sub-API
readonly history: WorkbookHistory;               // always-on sub-API
readonly viewport: WorkbookViewport;             // sub-API (contains both stateless + handle methods)
readonly changes: WorkbookChanges;               // always-on sub-API for tracker creation
readonly links: WorkbookLinks;                   // always-on sub-API
```

Infrastructure-only properties live on `WorkbookInternal`:

```typescript
readonly floatingObjects: IFloatingObjectManager; // internal manager
readonly pivot: IPivotBridge;                     // internal bridge
readonly charts: IChartBridge;                    // internal bridge
```

### Consumer-Scoped: ViewportRegion handle

From `types/api/src/api/workbook/viewport.ts`:

```typescript
// ViewportRegion extends IDisposable
interface ViewportRegion extends IDisposable {
  readonly id: string;
  readonly sheetId: string;
  updateBounds(bounds: ViewportBounds): void;
  refresh(scrollBehavior?: unknown): Promise<void>;
}

// WorkbookViewport mixes stateless + handle-based methods
interface WorkbookViewport {
  createRegion(sheetId: string, bounds: ViewportBounds, viewportId?: string): ViewportRegion; // handle
  resetSheetRegions(sheetId: string): void;                                          // stateless
  setRenderScheduler(scheduler: RenderScheduler | null): void;                      // stateless
  subscribe(cb: (event: ViewportChangeEvent) => void): () => void;                  // subscription
  setShowFormulas(value: boolean): void;                                            // stateless
}
```

The render system creates regions on mount, updates bounds on scroll, and disposes on unmount or sheet switch:

```typescript
// Create
const region = wb.viewport.createRegion(sheetId, bounds);

// Update on scroll
region.updateBounds(newBounds);

// Dispose on sheet switch or unmount
region.dispose();
```

---

## Adding a New API -- Checklist

1. **Classify** the operation using the decision flowchart above.
2. **Stateless?** Add a method. Done.
3. **Workbook-scoped?** Add a `readonly` property. Initialize lazily in the owning implementation. Done.
4. **Consumer-scoped?**
   - Define a handle interface in the public contract source; prefer extending `IDisposable` for new lifecycle APIs.
   - For disposable handles, implement it extending `DisposableBase` in the kernel.
   - Add a factory method (`createXxx()`) to the appropriate sub-API.
   - For disposable handles, track the handle in the owning `DisposableStore` before returning.
   - Call `throwIfDisposed()` at the top of every disposable handle method.
   - Document TC39 `using` support in the JSDoc when the handle implements `Symbol.dispose`.

---

## References

- Disposable interface: [`types/core/src/disposable.ts`](../../../types/core/src/disposable.ts)
- Disposable runtime helpers: [`spreadsheet-utils/src/disposable.ts`](../../../spreadsheet-utils/src/disposable.ts)
- ViewportRegion contract: [`types/api/src/api/workbook/viewport.ts`](../../../types/api/src/api/workbook/viewport.ts)
- Workbook interface: [`types/api/src/api/workbook.ts`](../../../types/api/src/api/workbook.ts)
