# Kernel API

Public interface for all kernel operations. Three API styles, one directory per role.

## Directory Structure

```
api/
├── index.ts           Barrel — re-exports createWorkbook, WorkbookConfig, namespaces, utils
├── namespaces/        Low-level function-oriented API (Cells, Sheets, Records)
├── workbook/          High-level class API — createWorkbook() + sub-APIs (viewport, history, etc.)
├── worksheet/         High-level class API — WorksheetImpl + sub-APIs
├── document/          Document lifecycle — creation and import
├── sheet/             Internal operation modules (the actual mutation logic)
├── internal/          Shared utilities (not public API)
├── app/               App-scoped, capability-gated API
└── __tests__/         Integration tests
```

## API Styles

### Namespace APIs (`namespaces/`)

Stateless functions. Each call takes an explicit context:

```ts
import { Cells, Sheets } from '@mog/kernel/api';

const data = Cells.getData(ctx, sheetId, row, col);
const name = Sheets.getName(ctx, sheetId);
```

### Unified API (`workbook/`, `worksheet/`)

Object-oriented. `createWorkbook()` returns a `Workbook` (contract interface). `WorkbookImpl` is kernel-internal — never exported.

```ts
import { createWorkbook } from '@mog/kernel/api';

const wb = await createWorkbook({ ctx, getActiveSheetId, setActiveSheetId, eventBus });
const ws = wb.getSheet(sheetId);
await ws.setCell('A1', 42);
await ws.charts.add({ ... });
```

#### API Categories

Every method on the Workbook/Worksheet API falls into one of three categories:

| Category | Pattern | Example |
|----------|---------|---------|
| **Stateless** | Methods — input in, output out | `await ws.setCell("A1", 42)` |
| **Workbook-scoped** | Readonly properties — always-on caches | `wb.history.undo()` |
| **Consumer-scoped** | Handle factories — create, use, dispose | `wb.viewport.createRegion(sheetId, bounds)` |

Consumer-scoped APIs return **handles** (typed objects implementing `IDisposable`). Handles support TC39 Explicit Resource Management:

```ts
// Manual dispose
const region = wb.viewport.createRegion(sheetId, bounds);
region.updateBounds(newBounds);
region.dispose();

// Or automatic via `using` (TS 5.2+)
using region = wb.viewport.createRegion(sheetId, bounds);
// auto-disposed at block exit
```

All handles are tracked by the workbook. `wb.dispose()` disposes everything — no leaks possible.

See [`docs/internals/spreadsheet/API-DESIGN-PHILOSOPHY.md`](../../../docs/internals/spreadsheet/API-DESIGN-PHILOSOPHY.md) for the full design philosophy.

#### Sub-APIs

Workbook sub-APIs are accessed via readonly properties:

| Sub-API | Access | Purpose |
|---------|--------|---------|
| `wb.sheets` | Workbook-scoped | Sheet CRUD (add, remove, move, rename) |
| `wb.names` | Workbook-scoped | Named range CRUD |
| `wb.scenarios` | Workbook-scoped | What-if scenario CRUD |
| `wb.history` | Workbook-scoped | Undo/redo/history traversal |
| `wb.styles` | Workbook-scoped | Table styles and format lookup |
| `wb.protection` | Workbook-scoped | Workbook-level protection |
| `wb.notifications` | Workbook-scoped | Toast/notification queue |
| `wb.viewport` | Consumer-scoped | Viewport region lifecycle (handle-based) |

WorksheetImpl delegates to 21 sub-API classes (charts, comments, filters, etc.) that live alongside it in `worksheet/`.

### Document Lifecycle (`document/`)

Factory for creating and importing documents. Returns a `DocumentHandle` with a narrowed `IKernelContext` (Tier 2) — apps get bridges + services but NOT engine internals like `computeBridge` or viewport buffers.

```ts
import { DocumentFactory, createWorkbook } from '@mog/kernel/api';

// Create a blank document
const handle = await DocumentFactory.create({ documentId: 'my-doc' });

// handle.context: IKernelContext — bridges, services, eventBus (NOT DocumentContext)
// handle.initialSheetId — first sheet ID, synchronous
// handle.dispose() — MUST call when done

// Create workbook with the context
const workbook = await createWorkbook({
  ctx: handle.context,
  getActiveSheetId: () => activeSheetId,
  setActiveSheetId: (id) => { activeSheetId = id; },
  eventBus: handle.context.eventBus
});

// Import from XLSX
const result = await DocumentFactory.createFromXlsx(file);
if (result.success && result.handle) { ... }
```

**Context tiers** (what each layer sees):

| Tier | Type | Audience | Exposes |
|------|------|----------|---------|
| 1 | `IDomainContext` | Domain modules | eventBus, undo labeling |
| 2 | `IKernelContext` | Apps, Shell | + all bridges, services |
| 3 | `DocumentContext` | Engine internals | + computeBridge, viewport buffer |

`DocumentHandle.context` returns Tier 2. Internal kernel code (WorkbookImpl) casts to Tier 3 where needed. Apps NEVER access Tier 3 — enforced by ESLint rules.

## worksheet/ vs sheet/

These are different layers:

- **`worksheet/`** is the public API surface. WorksheetImpl resolves A1 strings, unwraps errors, and delegates downward.
- **`sheet/`** is the internal operation layer. 35 modules of raw mutation logic that take explicit `(ctx, sheetId, row, col)` parameters and return `OperationResult`.

```
ws.mergeCells("A1:B2")          ← worksheet/ (public)
  → resolves "A1:B2" to numeric
  → MergeOps.merge(ctx, ...)    ← sheet/ (internal)
```

## internal/

Shared utilities consumed by impl classes and sub-APIs. Not part of the public API contract:

- `utils.ts` — A1 parsing, range helpers, column conversion
- `address-resolver.ts` — Overload resolution (string A1 vs numeric row/col)
- `format-utils.ts` — LLM-optimized formatting helpers
- `unwrap.ts` — OperationResult error unwrapping
- `introspection.ts` — Workbook snapshot, function catalog

## app/

Capability-gated API for OS apps. Each app gets a sandboxed API scoped to its granted permissions.

## Lifecycle & Disposal

`wb.dispose()` cleans up all resources in the correct order:

1. `DisposableStore` — all tracked handles (viewport regions, etc.)
2. `CodeExecutor` — if lazily created
3. `FloatingObjectManager` — document-scoped singleton
4. `WorksheetImpl` instances — each disposes its CellMetadataCache, ConditionalFormatCache
5. `CheckpointManager` — clears in-memory checkpoint state
6. `FormControlManager` — clears form control registry (if created)

Infrastructure wiring (position lookup, connection resolver) happens inside `createWorkbook()` / `WorkbookImpl._init()`. Apps never wire kernel internals — they use the public Workbook API exclusively.
