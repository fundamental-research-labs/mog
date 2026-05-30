# API Layer Architecture

The API layer spans four areas that together form the full pipeline from Rust computation to TypeScript consumption:

```
Rust compute-core/api          infra/rust-bridge           infra/transport              kernel/src/api/
(engine + bridge facade)       (codegen framework)         (platform transport)         (TypeScript API surface)

#[bridge::api]          -->    Proc macros emit            createTransport() -->        Workbook / Worksheet
impl YrsComputeEngine {        descriptors for:                                         (high-level OOP)
  #[bridge::read]              - Tauri commands             TauriTransport
  fn get(...)                  - WASM bindings              WasmTransport               Cells / Sheets / Records
  #[bridge::write]             - N-API bindings             NapiTransport               (low-level namespace)
  fn set(...)                  - PyO3 bindings
}                              - TS client + types
                               ComputeService facade
                                                                                        DocumentFactory
                                                                                        (lifecycle)
```

---

## 1. Kernel API (`kernel/src/api/`)

The TypeScript API surface that apps, LLM-generated code, and the headless runtime all consume.

### Three API Styles

| Style | Location | Audience | Pattern |
|-------|----------|----------|---------|
| **Unified API** | `workbook/`, `worksheet/` | Apps, LLM, browser UI | OOP with sub-APIs |
| **Namespace API** | `namespaces/` | Headless, backend | Stateless functions |
| **Document Factory** | `document/` | Lifecycle management | Factory returning handles |

### Unified API (Primary)

```typescript
import { createWorkbook } from '@mog-sdk/kernel/api';

const wb = await createWorkbook();
const ws = wb.activeSheet;

// Cell operations — A1 string or numeric (row, col) addressing
await ws.setCell('A1', 42);
await ws.setCell(0, 0, 42);        // equivalent

// Worksheet sub-APIs via lazy readonly properties
await ws.formats.set('A1', { bold: true });
await ws.charts.add({ type: 'bar', range: 'A1:D10' });
await ws.structure.insertRows(5, 3);
await ws.validations.set('B1:B100', { type: 'list', values: ['Yes', 'No'] });

// Workbook sub-APIs
await wb.history.undo();
await wb.sheets.add('New Sheet');
```

**Design rules:**
- Single authoritative implementation (`WorkbookImpl`, `WorksheetImpl`), exposed at the top-level API through factories and interfaces
- Compute-backed mutations are async (await Rust compute via ComputeBridge)
- Errors throw directly (no `OperationResult` wrappers in modern code)
- `batch()` groups operations into a single undo step
- Sub-APIs are lazy-initialized (zero cost if unused)

### Command Flow

```
ws.setCell("A1", value)
  → address-resolver.ts: resolveCell("A1") → { row: 0, col: 0 }
  → cell-operations.ts: CellOps.setCell(ctx, sheetId, 0, 0, value)
  → ctx.computeBridge.setCellsByPosition(sheetId, [{ row: 0, col: 0, input }])
  → BridgeTransport.call("compute_batch_set_cells_by_position", ...)
  → Rust: batch_set_cells_by_position → recalc → mutation result
  → EventBus emits change events
```

### Workbook Sub-APIs (Selected)

| Sub-API | Scope | Key Methods |
|---------|-------|-------------|
| `wb.sheets` | Workbook | `add()`, `remove()`, `move()`, `rename()`, `copy()`, `hide()`, `show()` |
| `wb.history` | Workbook | `undo()`, `redo()`, `canUndo()`, `canRedo()` |
| `wb.names` | Workbook | `add()`, `remove()`, `get()`, `list()`, `update()` |
| `wb.scenarios` | Workbook | `add()`, `remove()`, `list()`, `apply()`, `restore()` |
| `wb.cellStyles`, `wb.tableStyles`, `wb.pivotTableStyles` | Workbook | style add/get/update/default operations |
| `wb.functions` | Workbook | programmatic function invocation |
| `wb.properties` | Workbook | document properties and custom properties |
| `wb.protection` | Workbook | `protect()`, `unprotect()`, `isProtected()` |
| `wb.security` | Workbook | access-control policy operations |
| `wb.notifications` | Workbook | `notify()`, `info()`, `success()`, `warning()`, `error()` |
| `wb.viewport` | Consumer | `createRegion()` → disposable handle |
| `wb.changes`, `wb.diagnostics`, `wb.links`, `wb.records` | Workbook | change tracking, audit/status, links, table record access |

### Worksheet Sub-APIs (Selected)

| Sub-API | Key Methods |
|---------|-------------|
| `ws.charts` | `add()`, `get()`, `list()`, `remove()`, `update()` |
| `ws.comments` | `addNote()`, `getNote()`, `removeNote()`, `add()` (threaded) |
| `ws.conditionalFormats` | `add()`, `remove()`, `get()`, `list()` |
| `ws.filters` | `setAutoFilter()`, `clearAutoFilter()`, `getAutoFilter()` |
| `ws.formats` | `get()`, `set()`, `setRange()`, `clearRange()` |
| `ws.hyperlinks` | `set()`, `get()`, `has()`, `remove()`, `list()` |
| `ws.tables` | `add()`, `remove()`, `get()`, `list()`, `rename()`, `update()` |
| `ws.validations` | `set()`, `get()`, `remove()` |
| `ws.structure` | `insertRows()`, `deleteRows()`, `insertColumns()`, `deleteColumns()`, `merge()`, `unmerge()` |
| `ws.layout` | Row/column dimensions, visibility, pixel positions |
| `ws.outline` | `groupRows()`, `groupColumns()`, `toggleCollapsed()`, `getLevel()` |
| `ws.pivots` | `add()`, `remove()`, `get()`, `list()` |
| `ws.slicers` | `add()`, `remove()`, `get()`, `list()` |
| `ws.sparklines` | `add()`, `remove()`, `get()`, `list()` |
| `ws.pictures` | `add()`, `remove()`, `get()`, `list()` |
| `ws.shapes` | `add()`, `remove()`, `get()`, `list()` |
| `ws.objects`, `ws.connectors`, `ws.drawings`, `ws.equations`, `ws.textBoxes`, `ws.textEffects` | Floating object collections |
| `ws.formControls` | Checkbox, button, combo box controls |
| `ws.protection` | `protect()`, `unprotect()`, `isProtected()` |
| `ws.view` | `freezePanes()`, `getFrozenPanes()`, `setSplitConfig()` |
| `ws.bindings` | Named range bindings |
| `ws.print` | Print area and settings |
| `ws.settings` | Sheet visibility, tab color, etc. |
| `ws.changes`, `ws.customProperties`, `ws.names`, `ws.styles`, `ws.whatIf` | Change tracking, metadata, sheet names/styles, analysis |

### Worksheet Core Methods

```typescript
// Cell I/O
await ws.setCell('A1', 42);
await ws.getCell('A1');                    // → CellData

// Range I/O
await ws.setRange('A1:C3', [[1,2,3],[4,5,6],[7,8,9]]);
await ws.getRange('A1:C3');                // → CellData[][]
await ws.clear('A1:C3');

// Metadata
await ws.getName();
ws.getIndex();
ws.getSheetId();
await ws.getVisibility();
await ws.getUsedRange();                   // → CellRange | null

// Search
await ws.findInRange('A1:D20', 'pattern', options);
await ws.regexSearch(['pattern'], options);
```

### Namespace API (Low-Level)

Stateless functions taking explicit context — used by headless/backend systems:

```typescript
import { Cells, Sheets, Records } from '@mog-sdk/kernel/api';

const data = await Cells.getData(ctx, sheetId, row, col);
const name = await Sheets.getName(ctx, sheetId);
const records = await Records.query(ctx, tableId, filter);
```

### Document Lifecycle

```typescript
import { DocumentFactory, createWorkbook } from '@mog-sdk/kernel/api';

// High-level path: createWorkbook bootstraps the document handle internally.
const wb = await createWorkbook({ documentId });

// Document-first path: creates a handle and asks the handle for its workbook.
const handle = await DocumentFactory.create({ documentId });
// handle.initialSheetId: SheetId

const handledWorkbook = await handle.workbook();

// Use workbook...
const ws = handledWorkbook.getSheetById(handle.initialSheetId);

// Dispose (MUST call for document handles)
handledWorkbook.dispose();  // also disposes the owning handle for handle-created workbooks
await handle.dispose();     // idempotent; flushes persistence and releases the document
```

### Handle-Based Resource Management

Consumer-scoped resources return disposable handles:

```typescript
// Manual disposal
const region = wb.viewport.createRegion(sheetId, bounds);
region.updateBounds(newBounds);
region.dispose();

// TC39 Explicit Resource Management
using region = wb.viewport.createRegion(sheetId, bounds);
// auto-disposed at block exit
```

All handles implement `Symbol.dispose`. `wb.dispose()` cascades to all tracked handles.

### Four-Tier Context Architecture

```
IDomainContext              (Tier 1)  eventBus + undo labeling              — domain modules
IKernelContext              (Tier 2)  + services, destroy()                 — any app type
ISpreadsheetKernelContext   (Tier 3)  + all spreadsheet bridges             — spreadsheet app, shell
DocumentContext             (Tier 4)  + computeBridge, viewport buffer      — engine internals only
```

`DocumentHandleInternal.context` returns Tier 3 for trusted monorepo code. Public `DocumentHandle` exposes handle methods such as `workbook()`, `eventBus`, and `dispose()` instead of raw context access. Internal kernel code casts to Tier 4 where engine access is needed.

### App API (Capability-Gated)

`kernel/src/api/app/` provides a capability-gated wrapper for third-party apps:

```typescript
// Apps get scoped access — undefined for denied capabilities
const api = createCapabilityGatedApi({ fullApi, appId, registry });
api.tables?.add(...);    // only available if a tables capability is granted
api.records?.query(...); // only available if the app has scoped table access
```

### Directory Structure

```
kernel/src/api/
├── index.ts                    # Public barrel export
├── namespaces/                 # Low-level function-oriented APIs
│   ├── cells.ts
│   ├── sheets.ts
│   └── records.ts
├── workbook/                   # Workbook implementation + sub-APIs
│   ├── workbook-impl.ts        # THE implementation
│   ├── history.ts, sheets.ts, names.ts, scenarios.ts, protection.ts,
│   │   notifications.ts, viewport.ts, theme.ts, cell-styles.ts,
│   │   table-styles.ts, pivot-styles.ts, slicers.ts, slicer-styles.ts,
│   │   timeline-styles.ts, functions.ts, security.ts, properties.ts,
│   │   changes.ts, diagnostics.ts, styles.ts
│   └── operations/             # Sheet CRUD, scenario ops
├── worksheet/                  # Worksheet implementation + sub-APIs
│   ├── worksheet-impl.ts       # THE implementation
│   ├── charts.ts, comments.ts, conditional-formats.ts, filters.ts,
│   │   formats.ts, hyperlinks.ts, tables.ts, validation.ts,
│   │   structure.ts, layout.ts, outline.ts, pivots.ts, slicers.ts,
│   │   sparklines.ts, protection.ts, view.ts, bindings.ts, print.ts,
│   │   settings.ts, objects.ts, diagrams.ts, form-controls.ts,
│   │   changes.ts, custom-properties.ts, names.ts, styles.ts, what-if.ts
│   ├── handles/                # Floating object handle types
│   ├── collections/            # Floating object collection implementations
│   └── operations/             # Mutation/query operation modules
├── document/                   # DocumentFactory
├── internal/                   # Address resolver, utilities, introspection
├── app/                        # Capability-gated app API
│   └── capability-gated/       # Permission enforcement
└── __tests__/                  # Integration tests
```

---

## 2. rust-bridge Framework (`infra/rust-bridge/`)

A custom multi-target bridge framework that generates bindings for Tauri, WASM, N-API, and PyO3 from a single Rust trait annotation. This is not uniffi or wasm-bindgen — it's a purpose-built codegen system.

### How It Works

```
Phase 1: bridge-core (proc macro)
  #[bridge::api] on Rust impl block
    → Parses method signatures, parameter types, return types
    → Classifies params: str, prim, bytes, serde, parse
    → Emits descriptor macro (__bridge_descriptor_Engine_0!)

Phase 2: Target-specific generators (each has generate!() macro)
  bridge-tauri/  → #[tauri::command] functions + TauriRegistry<T>
  bridge-napi/   → #[napi] functions + DashMap registries
  bridge-wasm/   → #[wasm_bindgen] functions + thread-local registries
  bridge-pyo3/   → #[pyclass]/#[pymethods] Python bindings

Phase 3: bridge-ts (TypeScript generation)
  → Parses Rust source for #[bridge::api] blocks
  → Parses #[derive(Serialize)] structs/enums with serde attributes
  → Emits TypeScript bridge methods + type definitions
```

### Rust Annotations

**Stateless functions:**
```rust
#[bridge::api]
impl Utilities {
    #[bridge::pure]
    pub fn validate(input: &str) -> bool { ... }
}
```

**Stateful services:**
```rust
#[bridge::api(service = "Engine", key = "doc_id")]
impl Engine {
    #[bridge::lifecycle(create)]
    pub fn new(config: Config) -> Result<Self, MyError> { ... }

    #[bridge::read]
    pub fn get(&self, key: &str) -> Result<String, MyError> { ... }

    #[bridge::write]
    pub fn set(&mut self, key: &str, value: String) -> Result<(), MyError> { ... }
}
```

### Annotation Reference

**Impl-level attributes:**

| Attribute | Purpose |
|-----------|---------|
| `#[bridge::api]` | Parse impl block, emit API descriptor |
| `service = "TypeName"` | Marks as stateful service |
| `key = "param_name"` | Instance key parameter (e.g., `doc_id`) |
| `group = "name"` | Group multiple impl blocks into same service |
| `fn_prefix = "prefix"` | Override command name prefix |
| `crate_path = "crate_name"` | Rewrite `crate::` paths for self-contained descriptors |

**Method-level attributes:**

| Attribute | Access | Description |
|-----------|--------|-------------|
| `#[bridge::pure]` | No self | Stateless function |
| `#[bridge::read]` | `&self` | Read-only query |
| `#[bridge::write]` | `&mut self` | Mutation |
| `#[bridge::structural]` | `&mut self` | Structural mutation |
| `#[bridge::async_read]` | `&self` | Async read |
| `#[bridge::async_write]` | `&mut self` | Async mutation |
| `#[bridge::lifecycle(create)]` | Constructor | Instance creation |
| `#[bridge::skip(wasm, tauri, napi)]` | — | Exclude from specific targets |
| `#[bridge::parse]` | Parameter | String-wire param, parsed in Rust via `BridgeParse` |

**Parameter classification (auto-detected):**

| Tag | Rust Type | Wire Format |
|-----|-----------|-------------|
| `[str]` | `&str`, `String` | String |
| `[prim]` | `u32`, `f64`, `bool`, etc. | Primitive |
| `[bytes]` | `&[u8]`, `Vec<u8>` | `Uint8Array` |
| `[serde]` | Complex types | JSON |
| `[parse]` | Explicit via `#[bridge::parse]` | String → `BridgeParse::bridge_parse()` |

### Type Mapping (Rust → TypeScript)

| Rust | TypeScript |
|------|-----------|
| `&str`, `String` | `string` |
| `bool` | `boolean` |
| `u8`..`u64`, `i8`..`i64`, `f32`, `f64` | `number` |
| `&[u8]`, `Vec<u8>` | `Uint8Array` |
| `Vec<T>`, `&[T]` | `T[]` |
| `Option<T>` | `T \| null` |
| `Result<T, E>` | `T` (error → Promise rejection) |
| `HashMap<K, V>`, `BTreeMap<K, V>` | `Record<K, V>` |
| `(T1, T2, ...)` | `[T1, T2, ...]` |
| Custom named type | `TypeName` (named reference) |
| `serde_json::Value` | `unknown` |

### Generated TypeScript

**Bridge method interface + implementation** (from `bridge-ts`):

```typescript
// Generated: kernel/src/bridges/compute/compute-bridge.gen.ts
export interface GeneratedBridgeMethods {
  getViewportBinary(
    sheetId: SheetId,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    showFormulas: boolean,
  ): Promise<Uint8Array>;
  batchSetCellsByPosition(
    edits: [SheetId, number, number, CellInput][],
    skipCycleCheck: boolean,
  ): Promise<MutationResult>;
}

export class GeneratedBridgeBase implements GeneratedBridgeMethods {
  batchSetCellsByPosition(
    edits: [SheetId, number, number, CellInput][],
    skipCycleCheck: boolean,
  ): Promise<MutationResult> {
    return this.core.mutate(this.core.transport.call<[Uint8Array, MutationResult]>(
      'compute_batch_set_cells_by_position',
      { docId: this.core.docId, edits, skipCycleCheck },
    ));
  }
}
```

**Type definitions** (from Rust structs with `#[derive(Serialize)]`):

```typescript
// Generated: kernel/src/bridges/compute/compute-types.gen.ts
export interface ActiveCellData {
  cellId: string;
  value: CellValue;
  formula?: string;
  isFormulaHidden: boolean;
}

export type AggregateFunction = 'sum' | 'count' | 'average' | 'min' | 'max';

export interface AggregateOp {
  op: AggregateOpKind;
  field?: string;
  as: string;
}
```

Serde attributes (`rename_all`, `tag`, `content`, `untagged`, `skip`) are fully respected in the generated TypeScript, matching the exact JSON serialization format.

### Generated Output Files

| File | Source | Contents |
|------|--------|----------|
| `kernel/src/bridges/compute/compute-types.gen.ts` | Rust compute structs/enums | TypeScript wire interfaces and string unions |
| `kernel/src/bridges/compute/compute-bridge.gen.ts` | `ComputeService` and pure bridge descriptors | Generated bridge methods |
| `kernel/src/bridges/compute/manifest.gen.ts` | Bridge descriptors | Method access/kind metadata |
| `infra/transport/src/command-metadata.gen.ts` | Bridge descriptors | Recalc, bytes-tuple, serde, and scope metadata |
| `infra/rust-bridge/bridge-ts/generated/xlsx-types.ts` | `xlsx-parser` structs | XLSX format types |
| `infra/rust-bridge/bridge-ts/generated/ooxml-types.ts` | `ooxml-types` structs | OOXML vocabulary types |
| `infra/culture/src/cultures.gen.ts` | `compute-formats` CultureInfo | Locale/culture data |

### Runtime Traits (`bridge-types`)

```rust
// Parse types from wire strings (blanket impl on FromStr)
pub trait BridgeParse: Sized {
    fn bridge_parse(s: &str) -> Result<Self, String>;
}

// Error types crossing the bridge boundary
pub trait BridgeError: Display + Send + 'static {}

// Structured error data to TypeScript (JSON-serializable)
pub trait BridgeStructuredError: BridgeError {
    fn to_bridge_value(&self) -> serde_json::Value;
}
```

### Crate Structure

```
infra/rust-bridge/
├── bridge-core/        # Proc macro: #[bridge::api] → descriptor macros
├── bridge-ir/          # Shared parsed bridge representation
├── bridge-delegate/    # ComputeService delegate generation
├── bridge-types/       # Runtime traits: BridgeParse, BridgeError
├── bridge-describe/    # Descriptor/introspection helpers
├── bridge-derive/      # Derive macros: #[derive(BridgeError)]
├── bridge-tauri/       # Tauri command generator (parking_lot::RwLock registries)
│   └── macros/
├── bridge-napi/        # N-API binding generator (DashMap registries)
│   └── macros/
├── bridge-wasm/        # WASM binding generator (thread-local registries)
│   └── macros/
├── bridge-pyo3/        # PyO3 binding generator
│   └── macros/
├── bridge-ts/          # TypeScript client + type generator
│   ├── src/            # Rust code that parses and emits TS
│   └── generated/      # Generated .ts output files
└── client/             # @rust-bridge/client — BridgeTransport interface (TS)
```

---

## 3. Transport Layer (`infra/transport/`)

Platform-specific implementations of `BridgeTransport` that carry commands between TypeScript and Rust. Published as `@mog/transport`.

### BridgeTransport Interface

```typescript
// From @rust-bridge/client
interface BridgeTransport {
  call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T>;
}
```

All callers use this single async interface regardless of platform.

### Transports

| Transport | Platform | Mechanism |
|-----------|----------|-----------|
| `TauriTransport` | Desktop | `@tauri-apps/api/core invoke()` — Tauri IPC |
| `WasmTransport` | Web | Direct WASM module function calls |
| `NapiTransport` | Server | N-API native addon for Node.js |

### Transport Factory

```typescript
import { createTransport } from '@mog/transport';

const transport = await createTransport(config?);
// Auto-detects: NAPI (Node.js) → Tauri (desktop) → WASM (web fallback)
```

**Wrapper pipeline per platform:**

```
NAPI:   LazyNapiTransport → NapiTimeInjectingTransport → BytesTupleNormalizingTransport
Tauri:  TauriTransport → BytesTupleNormalizingTransport
WASM:   WasmTransport → TimeInjectingTransport → CaseNormalizingTransport
```

### Middleware

| Middleware | Purpose |
|------------|---------|
| `TimeInjectingTransport` / `NapiTimeInjectingTransport` | Injects `compute_set_current_time()` before recalc commands |
| `BytesTupleNormalizingTransport` | Normalizes binary tuple returns (Tauri packs as `[4B length][bytes][JSON]`) |
| `CaseNormalizingTransport` | Converts snake_case WASM serde results to camelCase TypeScript shapes |

### Key Files

```
infra/transport/src/
├── factory.ts                  # createTransport() — platform auto-detection
├── factory.browser.ts          # Browser-specific factory entry
├── types.ts                    # Transport interfaces
├── tauri-transport.ts          # Desktop: Tauri IPC
├── wasm-transport.ts           # Web: direct WASM calls
├── napi-transport.ts           # Server: N-API native addon
├── bytes-tuple.ts              # Binary return normalization
├── case-normalize.ts           # snake_case → camelCase normalization
├── time-injection.ts           # Clock injection for WASM/NAPI
├── detection.ts                # Runtime detection helpers
├── napi-loader.ts              # Native addon discovery
├── wasm-loader.ts              # Singleton WASM module loader
├── command-metadata.gen.ts     # Generated: RECALC_COMMANDS, BYTES_TUPLE_COMMANDS
├── bridge-error.ts             # Tagged bridge-error parsing
└── errors.ts                   # TransportError, TrapError
```

---

## 4. Two-Protocol IPC

Communication uses two protocols optimized for their respective use cases:

| Protocol | Format | Used For | Why |
|----------|--------|----------|-----|
| **Control plane** | JSON | RPC: `set_cell`, `undo`, `get_schema` | Flexibility, debuggability |
| **Data plane** | Binary (`Uint8Array`) | Viewport data, mutation results | 60 FPS rendering, zero-copy |

The control plane is handled by the `rust-bridge` framework. The data plane is defined in the `compute-wire` crate — see [compute-bridge.md](compute-bridge.md) for wire format details.

---

## 5. End-to-End Example

Here's how a cell edit flows through all layers:

```
1. App code:           await ws.setCell('A1', 42)

2. Kernel API:         WorksheetImpl.setCell()
                         → address-resolver resolves "A1" → { row: 0, col: 0 }
                         → CellOps.setCell(ctx, sheetId, 0, 0, 42)

3. ComputeBridge:      ctx.computeBridge.setCellsByPosition(sheetId, [{ row: 0, col: 0, input }])

4. Generated Client:   transport.call('compute_batch_set_cells_by_position', { docId, edits, skipCycleCheck: true })

5. Transport:          TauriTransport.call() → Tauri invoke('compute_batch_set_cells_by_position', args)
                    OR  WasmTransport.call()  → wasmModule.compute_batch_set_cells_by_position(...)
                    OR  NapiTransport.call()  → napiEngine.compute_batch_set_cells_by_position(...)

6. Rust (generated):   #[tauri::command] / #[wasm_bindgen] / #[napi]
                         → Deserialize args
                         → ComputeService.batch_set_cells_by_position(...)

7. Rust (compute-core): batch_set_cells_by_position → typed CellInput write → recalc dependency graph
                         → serialize_mutation_result() → Uint8Array

8. Return path:        Uint8Array → BinaryMutationReader → BinaryViewportBuffer.applyBinaryMutation()
                         → Canvas re-renders
                         → EventBus emits cell:changed
```

---

## 6. Key Principles

1. **Rust is the single source of truth.** All persistent state and computation lives in `compute-core`. TypeScript never owns cell data.

2. **Wire types are generated from Rust.** The `bridge-ts` crate parses Rust structs and emits TypeScript interfaces; public contract types can wrap or narrow those wire shapes.

3. **Transport is injected, not hardcoded.** The kernel receives a `BridgeTransport` and doesn't know whether it's talking over Tauri IPC, WASM, or N-API.

4. **Three API styles for three audiences.** Unified API for apps/LLM, namespace API for headless/backend, Document Factory for lifecycle.

5. **Handle-based resource management.** All consumer-scoped resources are disposable handles, composing into a tree rooted at the workbook.

6. **Async mutations, sync render reads.** Mutations await Rust; render-path viewport reads use binary buffers for low-latency access.
