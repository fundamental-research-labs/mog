# API Design Philosophy

Every method on the Workbook/Worksheet API falls into exactly one of three categories. This document defines the categories, the rules for choosing between them, and the infrastructure that supports them.

---

## The Three Categories

### 1. Stateless -- Methods

Each call is self-contained. Input in, output out. No cleanup needed. Any consumer (agent, headless, render loop, LLM code) can call these freely.

```typescript
await ws.setCell("A1", 42);                    // fire-and-forget mutation
const data = await ws.getRange("A1:B10");      // self-contained query
await wb.history.undo();                        // stateless command
const addr = wb.indexToAddress(0, 0);           // pure function
```

**Test:** Can you call this method, ignore the result, and have zero side effects on future calls? Then it is stateless.

### 2. Workbook-Scoped -- Always-On State

Caches and stores that exist for the workbook's entire lifetime. The consumer reads from them but never creates or destroys them. Lifecycle is bound to `wb.dispose()`.

```typescript
wb.floatingObjects.getObjectsInSheet(sheetId);     // sync read, always available
ws.cellMetadata.isProjectedPosition(row, col);      // sync read, always available
ws.viewport.getCellData(row, col);                  // sync read from binary buffer
```

**Test:** Does the consumer get this from a `readonly` property (not a factory method)? Then it is workbook-scoped.

### 3. Consumer-Scoped -- Handles

The consumer creates a resource that the kernel holds on its behalf. The resource has a lifecycle shorter than or equal to the workbook. The creation method returns a handle object. The handle is the only API for that resource. Disposing the handle is the only cleanup path.

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
2. **Consumer-scoped state returns handles.** The handle IS the API surface. `dispose()` is the only cleanup path. Never use string IDs for lifecycle management -- if you are passing an ID to `unregister(id)`, you have lost the handle pattern.
3. **Handles compose into a tree.** Every handle is tracked by its parent. Disposing a parent disposes all children. The workbook is the root. No orphans possible.

```
Workbook.dispose()
  |-- all ViewportRegion handles -> auto-disposed
  |-- all Worksheet instances -> auto-disposed
  |-- all event subscriptions -> auto-unsubscribed
  |-- FloatingObjectStore -> auto-cleared
  |-- CheckpointManager -> auto-cleared
  +-- CodeExecutor -> auto-disposed
```

---

## Decision Flowchart

Use this when adding a new method to the Workbook or Worksheet API:

```
Does the operation have side effects that persist after the call?
  |
  +-- NO --> Stateless method. Return the result directly.
  |          Examples: getRange(), setCell(), indexToAddress()
  |
  +-- YES
       |
       Is the state scoped to the workbook's lifetime (always on)?
         |
         +-- YES --> Readonly property on Workbook/Worksheet.
         |           Consumer reads but never creates or destroys.
         |           Examples: wb.floatingObjects, ws.cellMetadata
         |
         +-- NO
              |
              Does the consumer need to start AND later stop?
                |
                +-- YES --> Consumer-scoped handle.
                |           Factory method returns an IDisposable handle.
                |           All operations are methods on the handle.
                |           Track in parent's DisposableStore.
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

The handle pattern is supported by three primitives in `contracts/src/core/disposable.ts`.

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
    this.computeBridge.unregisterViewportRegion(this.id);
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

**Usage in WorkbookImpl:**

```typescript
class WorkbookImpl {
  private _disposables = new DisposableStore();

  // Every handle created by the workbook is tracked
  createRegion(sheetId, bounds) {
    const region = new ViewportRegionImpl(sheetId, bounds, this.computeBridge);
    return this._disposables.track(region);
  }

  dispose() {
    this._disposables.dispose(); // all child handles cleaned up
  }
}
```

---

## TC39 Explicit Resource Management

All handles implement `Symbol.dispose`, enabling the TC39 `using` declaration (TypeScript 5.2+). This provides automatic cleanup at block exit, similar to RAII in C++ or `with` in Python:

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

From `contracts/src/api/workbook.ts`:

```typescript
// Pure queries
wb.getSheet(sheetId);                    // sync sheet lookup by ID
wb.indexToAddress(0, 0);                 // pure conversion: (0,0) -> "A1"
wb.addressToIndex("A1");                 // pure conversion: "A1" -> {row:0, col:0}
await wb.getSheetNames();               // one-shot query

// Fire-and-forget mutations
await wb.history.undo();                // stateless command
await wb.sheets.addSheet("Sales");      // stateless command
```

### Workbook-Scoped: Readonly properties

From `contracts/src/api/workbook.ts`:

```typescript
readonly floatingObjects: FloatingObjectStore;   // always-on cache
readonly sheets: WorkbookSheets;                 // always-on sub-API
readonly history: WorkbookHistory;               // always-on sub-API
readonly viewport: WorkbookViewport;             // sub-API (contains both stateless + handle methods)
readonly pivot: IPivotBridge;                    // always-on bridge
readonly charts: IChartBridge;                   // always-on bridge
```

### Consumer-Scoped: ViewportRegion handle

From `contracts/src/api/workbook/viewport.ts`:

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
  createRegion(sheetId: string, bounds: ViewportBounds): ViewportRegion;  // handle
  resetSheetRegions(sheetId: string): void;                               // stateless
  refreshData(sheetId: string, ...): Promise<void>;                       // stateless
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
3. **Workbook-scoped?** Add a `readonly` property. Initialize lazily in WorkbookImpl. Done.
4. **Consumer-scoped?**
   - Define a handle interface extending `IDisposable` in contracts.
   - Implement it extending `DisposableBase` in the kernel.
   - Add a factory method (`createXxx()`) to the appropriate sub-API.
   - In the factory, call `this._disposables.track(handle)` before returning.
   - Call `throwIfDisposed()` at the top of every handle method.
   - Document TC39 `using` support in the JSDoc.

---

## References

- Implementation: [`contracts/src/core/disposable.ts`](../../../contracts/src/core/disposable.ts)
- ViewportRegion contract: [`contracts/src/api/workbook/viewport.ts`](../../../contracts/src/api/workbook/viewport.ts)
- Workbook interface: [`contracts/src/api/workbook.ts`](../../../contracts/src/api/workbook.ts)
