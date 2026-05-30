# API Design Philosophy

Workbook/Worksheet APIs use three main shapes. This document defines the categories, the rules for choosing between them, and the infrastructure that supports disposable handles.

## Status and Package Boundary

This is an internal design guide for maintaining the public API surface. The shipped public contract package is `@mog-sdk/contracts`; Workbook and Worksheet types are exported from `@mog-sdk/contracts/api` and related subpaths. Their source definitions currently live in workspace-internal type shards such as `types/api/src/api/*` and are re-exported by `contracts/src/api/*` shims.

Implementation examples below come from workspace-internal packages such as `@mog-sdk/kernel`, `@mog/types-*`, and `@mog/spreadsheet-utils`. Do not document those packages as public setup paths. Public runtime users should enter through shipped public packages such as `@mog-sdk/node`, `@mog-sdk/sheet-view`, `@mog-sdk/embed`, or `@mog-sdk/spreadsheet-app`.

---

## The Three Categories

### 1. Stateless -- Methods

Each call is self-contained. Input in, output out. No caller-owned resource or cleanup. Any consumer with the relevant workbook or worksheet object can call these according to the sync/async contract.

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

The consumer creates a resource that the kernel holds on its behalf. The resource has a lifecycle shorter than or equal to the workbook. The creation method returns a handle object, and that handle is the API for the resource.

New lifecycle APIs should prefer `IDisposable` handles with `dispose()` and `Symbol.dispose`. Existing shipped exceptions remain part of the API surface: change trackers use `close()`, `wb.on()`/`ws.on()` and some service subscriptions return `CallableDisposable`, and `wb.viewport.subscribe()` returns a plain unsubscribe function. Those are still caller-owned handles; they are just not all disposable handles.

```typescript
// Create returns a handle
const region = wb.viewport.createRegion(sheetId, bounds);

// All operations on that resource are methods on the handle
region.updateBounds(newBounds);
await region.refresh();

// Cleanup -- explicit or automatic via TC39 using declaration
region.dispose();
```

**Test:** Does the consumer say "start" and later "stop"? Then it is a consumer-scoped handle.

---

## The Three Rules

1. **Stateless operations are methods.** No handle, no cleanup.
2. **Consumer-scoped state returns typed handles.** The handle IS the API surface. Prefer `dispose()` as the cleanup path for new lifecycle APIs. Do not expose public lifecycle APIs that require callers to pass a string ID back to `unregister(id)` or `stop(id)`; internal bridge IDs are fine behind a typed handle.
3. **Disposable handles compose when they are explicitly tracked.** A parent disposes children that were registered in its `DisposableStore`. In the current workbook implementation this includes viewport region handles and specific workbook-owned internal registrations; it does not automatically include arbitrary user subscriptions or `close()`-based change trackers.

```
Workbook.dispose()
  |-- tracked ViewportRegion handles -> dispose()
  |-- cached WorksheetImpl instances -> dispose()
  |-- workbook-owned internal registrations -> dispose()
  |-- CodeExecutor -> dispose() if created
  |-- FloatingObjectManager -> dispose()
  |-- CheckpointManager -> clear()
  +-- FormControlManager -> clear() if created

WorksheetImpl.dispose()
  |-- CellMetadataCache -> destroy()/dispose() if created
  |-- WorksheetInternal caches such as cfCache -> destroy()/dispose() if created
  +-- ViewportReader reference -> cleared
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
         |           Examples: wb.history, ws.cellMetadata, ws.viewport
         |           If that property exposes a factory, classify the
         |           returned object separately.
         |
         +-- NO
              |
              Does the consumer need to start AND later stop?
                |
                +-- YES --> Consumer-scoped handle.
                |           Factory method returns a typed handle.
                |           All operations are methods on the handle.
                |           For disposable handles, track in the parent's
                |           DisposableStore when the parent owns cleanup.
                |           For existing close()/unsubscribe handles,
                |           document caller cleanup.
                |           Example: wb.viewport.createRegion()
                |
                +-- NO --> Re-examine. It is probably stateless.
```

---

## Why Handles, Not Public IDs

| Public ID-based lifecycle (avoid) | Handle-based lifecycle |
|---|---|
| `registerRegion("main", ...)` | `createRegion(...) -> handle` |
| `updateRegionBounds("main", ...)` | `handle.updateBounds(...)` |
| `unregisterRegion("main")` | `handle.dispose()` |
| Caller tracks string ID | Caller holds typed object |
| Can accidentally target a missing or wrong ID | Handle carries the resource identity |
| Separate unregister path | `using` works when the handle implements `IDisposable` |
| No type safety on the ID | Full method autocomplete on handle |

---

## Who Uses What

| Consumer | Stateless | Workbook-Scoped | Consumer-Scoped Handles |
|---|---|---|---|
| LLM-generated code | All | Rarely | Rarely (short-lived scripts) |
| Headless agent | All | Some (if rendering) | Some (viewport regions) |
| Render loop | Rarely (perf) | All (sync reads) | All (viewport regions) |
| Full app hosts | All | All | All |

All three categories are available to all consumers. The distinction is about the nature of the operation, not who is calling.

---

## Infrastructure

The public lifecycle contract is `IDisposable` from `@mog-sdk/contracts/core`. Its source currently lives in `types/core/src/disposable.ts` and is re-exported by `contracts/src/core/disposable.ts`.

Runtime helpers live in workspace-internal `spreadsheet-utils/src/disposable.ts`. Kernel and app code use that file for `DisposableBase`, `DisposableStore`, `toDisposable`, `DisposableNone`, `MutableDisposable`, and `DisposableGroup`.

### IDisposable

Interface for any resource with explicit lifecycle. Includes TC39 `Symbol.dispose` for use with `using` declarations.

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
    void this.registrationSucceeded.then((registered) => {
      if (registered) return this.computeBridge.unregisterViewportRegion(this.id);
    });
  }
}
```

### DisposableStore

Tracks child disposables. Disposing the store disposes all tracked children. `WorkbookImpl` currently uses it for viewport region handles and workbook-owned internal registrations.

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

  createRegion(sheetId, bounds, viewportId) {
    const region = new ViewportRegionImpl(sheetId, bounds, this.computeBridge, viewportId);
    this.disposables.track(region);
    return region;
  }
}
```

---

## TC39 Explicit Resource Management

Disposable handles that implement `Symbol.dispose` enable the TC39 `using` declaration (TypeScript 5.2+). `ViewportRegion` is the current workbook API example:

```typescript
{
  using region = wb.viewport.createRegion(sheetId, bounds);
  region.updateBounds(newBounds);
  await region.refresh();
} // region.dispose() called automatically here
```

This is especially useful in test code and short-lived scopes where manual `dispose()` calls are easy to forget. It does not apply to shipped `close()`-based change trackers or plain unsubscribe functions unless they are wrapped in an `IDisposable`/`CallableDisposable`.

---

## Real Examples from the Codebase

Public consumers import these contracts from `@mog-sdk/contracts/api` or through SDK package re-exports such as `@mog-sdk/node`. The source paths below are workspace-internal files that back those public exports.

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
readonly security: WorkbookSecurity;             // always-on sub-API
readonly diagnostics: WorkbookDiagnostics;       // always-on sub-API
readonly links: WorkbookLinks;                   // always-on sub-API
```

These properties are workbook-scoped. Resources returned by their methods, such as `wb.viewport.createRegion()` or `wb.changes.track()`, are classified independently as consumer-scoped handles.

From `types/api/src/api/worksheet.ts`:

```typescript
readonly cellMetadata: CellMetadataCache;        // sync metadata cache
readonly viewport: ViewportReader;               // sync viewport reader
readonly changes: WorksheetChanges;              // sub-API for tracker creation
readonly formats: WorksheetFormats;              // domain sub-API
readonly tables: WorksheetTables;                // domain sub-API
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
// ViewportRegion extends IDisposable, so it has dispose() and Symbol.dispose.
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
  subscribe(cb: (event: ViewportChangeEvent) => void): () => void;                  // caller-owned unsubscribe
  setShowFormulas(value: boolean): void;                                            // stateless
}
```

`@mog-sdk/sheet-view` creates regions when viewport layout changes, updates bounds on scroll/resize, and disposes regions on pane removal, sheet switch, and view disposal:

```typescript
// Create
const region = wb.viewport.createRegion(sheetId, bounds);

// Update on scroll
region.updateBounds(newBounds);

// Dispose on sheet switch or unmount
region.dispose();
```

### Consumer-Scoped: Existing close()-based trackers

From `types/api/src/api/workbook/changes.ts` and `types/api/src/api/worksheet/changes.ts`:

```typescript
const workbookTracker = wb.changes.track({ limit: 1000 });
await ws.setCell("A1", 42);
const workbookChanges = await workbookTracker.collectAsync();
workbookTracker.close();

const sheetTracker = ws.changes.track({ scope: "A1:B10" });
await ws.setCell("B1", 99);
const sheetChanges = sheetTracker.collect();
sheetTracker.close();
```

These trackers are shipped handles, but they do not implement `IDisposable` today and are not automatically disposed by `Workbook.dispose()`. New lifecycle APIs should prefer the disposable handle pattern unless compatibility requires otherwise.

---

## Adding a New API -- Checklist

1. **Classify** the operation using the decision flowchart above.
2. **Stateless?** Add a method. Done.
3. **Workbook-scoped?** Add a `readonly` property. Initialize lazily in the owning implementation. Done.
4. **Consumer-scoped?**
   - Define a handle interface in the contract source and export it through `@mog-sdk/contracts`; prefer extending `IDisposable` for new lifecycle APIs.
   - For disposable handles, implement it with `DisposableBase` or `toDisposable` in the workspace-internal implementation package.
   - Add a factory method (`createXxx()`) to the appropriate sub-API.
   - For disposable handles owned by a workbook/worksheet parent, track the handle in the owning `DisposableStore` before returning.
   - Call `throwIfDisposed()` at the top of every disposable handle method.
   - Document TC39 `using` support in the JSDoc when the handle implements `Symbol.dispose`.
   - Keep bridge IDs internal; do not make consumers pass IDs back to public `unregister(id)` methods.

---

## References

- Public contracts package: [`contracts/src/api/index.ts`](../../../contracts/src/api/index.ts)
- Workbook contract shim: [`contracts/src/api/workbook.ts`](../../../contracts/src/api/workbook.ts)
- Disposable interface: [`types/core/src/disposable.ts`](../../../types/core/src/disposable.ts)
- Disposable runtime helpers: [`spreadsheet-utils/src/disposable.ts`](../../../spreadsheet-utils/src/disposable.ts)
- ViewportRegion contract: [`types/api/src/api/workbook/viewport.ts`](../../../types/api/src/api/workbook/viewport.ts)
- Workbook interface: [`types/api/src/api/workbook.ts`](../../../types/api/src/api/workbook.ts)
- Workbook implementation lifecycle: [`kernel/src/api/workbook/workbook-impl.ts`](../../../kernel/src/api/workbook/workbook-impl.ts)
- Workbook viewport implementation: [`kernel/src/api/workbook/viewport.ts`](../../../kernel/src/api/workbook/viewport.ts)
- Generated API spec source: [`runtime/sdk/scripts/generate-api-spec.ts`](../../../runtime/sdk/scripts/generate-api-spec.ts)
