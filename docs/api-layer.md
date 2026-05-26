# API Layer Architecture

The API layer spans three packages that together form the full pipeline from Rust computation to TypeScript consumption:

```
Rust compute-core              infra/rust-bridge           infra/transport              kernel/src/api/
(source of truth)              (codegen framework)         (platform transport)         (TypeScript API surface)

#[bridge::api]          -->    Proc macros emit            createTransport() -->        Workbook / Worksheet
impl Engine {                  descriptors for:                                         (high-level OOP)
  #[bridge::read]              - Tauri commands             TauriTransport
  fn get(...)                  - WASM bindings              WasmTransport               Cells / Sheets / Records
  #[bridge::write]             - N-API bindings             NapiTransport               (low-level namespace)
  fn set(...)                  - TS client + types
}                                                                                       DocumentFactory
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
import { createWorkbook } from '@mog/kernel/api';

const wb = await createWorkbook({ ctx, getActiveSheetId, setActiveSheetId, eventBus });
const ws = wb.getActiveSheet();

// Cell operations — A1 string or numeric (row, col) addressing
await ws.setCell('A1', 42);
await ws.setCell(0, 0, 42);        // equivalent

// 29 worksheet sub-APIs via lazy readonly properties
await ws.formats.set('A1', { bold: true });
await ws.charts.add({ type: 'bar', range: 'A1:D10' });
await ws.structure.insertRows(5, 3);
await ws.validation.set('B1:B100', { type: 'list', values: ['Yes', 'No'] });

// 8 workbook sub-APIs
await wb.history.undo();
wb.sheets.add('New Sheet');
```

**Design rules:**
- Single authoritative implementation (`WorkbookImpl`, `WorksheetImpl` — never exported with "Impl" suffix)
- All mutations are async (awaits Rust compute via ComputeBridge)
- Errors throw directly (no `OperationResult` wrappers in modern code)
- `batch()` groups operations into a single undo step
- Sub-APIs are lazy-initialized (zero cost if unused)

### Command Flow

```
ws.setCell("A1", value)
  → address-resolver.ts: resolveCell("A1") → { row: 0, col: 0 }
  → cell-operations.ts: CellOps.setCell(ctx, sheetId, 0, 0, value)
  → ctx.computeBridge.setCellValueParsed(sheetId, 0, 0, String(value))
  → BridgeTransport.call("compute_set_cell", ...)
  → Rust: set_cell → recalc → mutation result
  → EventBus emits change events
```

### Workbook Sub-APIs

| Sub-API | Scope | Key Methods |
|---------|-------|-------------|
| `wb.sheets` | Workbook | `add()`, `remove()`, `move()`, `rename()`, `get()`, `list()`, `copy()` |
| `wb.history` | Workbook | `undo()`, `redo()`, `canUndo()`, `canRedo()` |
| `wb.names` | Workbook | `add()`, `remove()`, `get()`, `list()`, `update()` |
| `wb.scenarios` | Workbook | `add()`, `remove()`, `get()`, `list()`, `activate()` |
| `wb.styles` | Workbook | `getStyle()`, `listStyles()`, `applyStyle()` |
| `wb.protection` | Workbook | `protect()`, `unprotect()`, `isProtected()` |
| `wb.notifications` | Workbook | `notify()`, `info()`, `success()`, `warning()`, `error()` |
| `wb.viewport` | Consumer | `createRegion()` → disposable handle |

### Worksheet Sub-APIs (21)

| Sub-API | Key Methods |
|---------|-------------|
| `ws.charts` | `add()`, `get()`, `list()`, `remove()`, `update()` |
| `ws.comments` | `addNote()`, `getNote()`, `removeNote()`, `add()` (threaded) |
| `ws.conditionalFormats` | `add()`, `remove()`, `get()`, `list()` |
| `ws.filters` | `setAutoFilter()`, `clearAutoFilter()`, `getAutoFilter()` |
| `ws.formats` | `getCellFormat()`, `getRangeFormat()`, `setCellFormat()`, `setRangeFormat()` |
| `ws.hyperlinks` | `add()`, `remove()`, `get()` |
| `ws.tables` | `add()`, `remove()`, `get()`, `list()`, `rename()`, `update()` |
| `ws.validation` | `set()`, `get()`, `remove()` |
| `ws.structure` | `insertRows()`, `deleteRows()`, `insertColumns()`, `deleteColumns()`, `mergeCells()`, `unmergeCells()` |
| `ws.layout` | Row/column dimensions, frozen panes |
| `ws.outline` | `group()`, `ungroup()`, `getLevel()` |
| `ws.pivots` | `add()`, `remove()`, `get()`, `list()` |
| `ws.slicers` | `add()`, `remove()`, `get()`, `list()` |
| `ws.sparklines` | `add()`, `remove()`, `get()`, `list()` |
| `ws.pictures` | `add()`, `remove()`, `get()`, `list()` |
| `ws.shapes` | `add()`, `remove()`, `get()`, `list()` |
| `ws.protection` | `protect()`, `unprotect()`, `isProtected()` |
| `ws.view` | `setFrozenPanes()`, `getFrozenPanes()`, `splitPane()` |
| `ws.bindings` | Named range bindings |
| `ws.print` | Print area and settings |
| `ws.settings` | Sheet visibility, tab color, etc. |

### Worksheet Core Methods

```typescript
// Cell I/O
await ws.setCell('A1', 42);
await ws.getCell('A1');                    // → CellData | undefined

// Range I/O
await ws.setRange('A1:C3', [[1,2,3],[4,5,6],[7,8,9]]);
await ws.getRange('A1:C3');                // → CellData[][]
await ws.clearRange('A1:C3');

// Metadata
ws.getName();
ws.getIndex();
ws.getSheetId();
ws.isVisible();
await ws.getUsedRange();                   // → CellRange | null

// Search
await ws.find('pattern', options);
await ws.findNext('pattern');
```

### Namespace API (Low-Level)

Stateless functions taking explicit context — used by headless/backend systems:

```typescript
import { Cells, Sheets, Records } from '@mog/kernel/api';

const data = Cells.getData(ctx, sheetId, row, col);
const name = Sheets.getName(ctx, sheetId);
const records = Records.query(ctx, sheetId, filter);
```

### Document Lifecycle

```typescript
import { DocumentFactory, createWorkbook } from '@mog/kernel/api';

// 1. Create document (bootstraps ComputeBridge, RustDocument, context wiring)
const handle = await DocumentFactory.create({ documentId });
// handle.context: IKernelContext
// handle.initialSheetId: SheetId

// 2. Create workbook
const wb = await createWorkbook({ ctx: handle.context, eventBus: handle.context.eventBus });

// 3. Use workbook...
const ws = wb.getSheet(handle.initialSheetId);

// 4. Dispose (MUST call)
wb.dispose();       // disposes all worksheets, handles, resources
handle.dispose();   // flushes persistence, releases Rust document
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

`DocumentHandle.context` returns Tier 3. Internal kernel code casts to Tier 4 where engine access is needed.

### App API (Capability-Gated)

`kernel/src/api/app/` provides a capability-gated wrapper for third-party apps:

```typescript
// Apps get scoped access — undefined for denied capabilities
const api = createAppKernelApi(ctx, capabilities);
api.tables?.add(...);    // only available if 'tables' capability granted
api.records?.query(...); // only available if 'records' capability granted
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
│   ├── history.ts, sheets.ts, names.ts, scenarios.ts, styles.ts,
│   │   protection.ts, notifications.ts, viewport.ts, theme.ts
│   └── operations/             # Sheet CRUD, scenario ops
├── worksheet/                  # Worksheet implementation + 21 sub-APIs
│   ├── worksheet-impl.ts       # THE implementation
│   ├── charts.ts, comments.ts, conditional-formats.ts, filters.ts,
│   │   formats.ts, hyperlinks.ts, tables.ts, validation.ts,
│   │   structure.ts, layout.ts, outline.ts, pivots.ts, slicers.ts,
│   │   sparklines.ts, protection.ts, view.ts, bindings.ts, print.ts,
│   │   settings.ts, objects.ts, diagrams.ts, forms.ts
│   ├── handles/                # 13 floating object handle types
│   ├── collections/            # 9 collection implementations
│   └── operations/             # 20+ mutation operation modules
├── document/                   # DocumentFactory
├── internal/                   # Address resolver, utilities, introspection
├── app/                        # Capability-gated app API
│   └── capability-gated/       # Permission enforcement
└── __tests__/                  # Integration tests
```

---

## 2. rust-bridge Framework (`infra/rust-bridge/`)

A custom multi-target bridge framework that generates bindings for three platforms from a single Rust trait annotation. This is not uniffi or wasm-bindgen — it's a purpose-built codegen system.

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

Phase 3: bridge-ts (TypeScript generation)
  → Parses Rust source for #[bridge::api] blocks
  → Parses #[derive(Serialize)] structs/enums with serde attributes
  → Emits TypeScript client factories + type definitions
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
| `#[bridge::async_read]` | `&self` | Async read |
| `#[bridge::async_write]` | `&mut self` | Async mutation |
| `#[bridge::lifecycle(create)]` | Constructor | Instance creation |
| `#[bridge::skip(wasm, tauri)]` | — | Exclude from specific targets |
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

**Client factory + interface** (from `bridge-ts`):

```typescript
// Generated: infra/rust-bridge/bridge-ts/generated/compute-client.ts
export function createComputeEngineClient(transport: BridgeTransport) {
  return {
    getViewportBinary(docId: string, sheetId: string, ...): Promise<Uint8Array> {
      return transport.call('compute_get_viewport_binary', { docId, sheetId, ... });
    },
    setCellValueParsed(docId: string, sheetId: string, row: number, col: number, value: string): Promise<...> {
      return transport.call('compute_set_cell_value_parsed', { docId, sheetId, row, col, value });
    },
    // ...
  } as const;
}
```

**Type definitions** (from Rust structs with `#[derive(Serialize)]`):

```typescript
// Generated: infra/rust-bridge/bridge-ts/generated/compute-types.ts
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
| `bridge-ts/generated/compute-types.ts` | `compute-core` structs/enums | TypeScript interfaces and string unions |
| `bridge-ts/generated/compute-client.ts` | `compute-core` `#[bridge::api]` blocks | Client factory + interface |
| `bridge-ts/generated/xlsx-types.ts` | `xlsx-parser` structs | XLSX format types |
| `bridge-ts/generated/ooxml-types.ts` | `ooxml-types` structs | OOXML vocabulary types |
| `kernel/src/bridges/compute/compute-types.gen.ts` | Copy of compute-types | Kernel-local copy |
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
├── bridge-types/       # Runtime traits: BridgeParse, BridgeError
├── bridge-derive/      # Derive macros: #[derive(BridgeError)]
├── bridge-tauri/       # Tauri command generator (parking_lot::RwLock registries)
│   └── macros/
├── bridge-napi/        # N-API binding generator (DashMap registries)
│   └── macros/
├── bridge-wasm/        # WASM binding generator (thread-local registries)
│   └── macros/
├── bridge-ts/          # TypeScript client + type generator
│   ├── src/            # Rust code that parses and emits TS
│   └── generated/      # Generated .ts output files
├── client/             # @rust-bridge/client — BridgeTransport interface (TS)
└── examples/
    └── kv-store/       # Worked example: stateless + stateful service
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
| `WasmTransport` | Web | Direct WASM function calls in a Web Worker |
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
WASM:   WasmTransport → TimeInjectingTransport
```

### Middleware

| Middleware | Purpose |
|------------|---------|
| `TimeInjectingTransport` | Injects `compute_set_current_time()` before recalc commands (WASM/NAPI — no native clock) |
| `BytesTupleNormalizingTransport` | Normalizes binary tuple returns (Tauri packs as `[4B length][bytes][JSON]`) |
### Key Files

```
infra/transport/src/
├── factory.ts                  # createTransport() — platform auto-detection
├── types.ts                    # Transport interfaces
├── tauri-transport.ts          # Desktop: Tauri IPC
├── wasm-transport.ts           # Web: direct WASM calls
├── napi-transport.ts           # Server: N-API native addon
├── composite-transport.ts      # Command-prefix routing
├── bytes-tuple.ts              # Binary return normalization
├── time-injection.ts           # Clock injection for WASM/NAPI
├── napi-loader.ts              # Native addon discovery
├── wasm-loader.ts              # Singleton WASM module loader
├── command-metadata.gen.ts     # Generated: RECALC_COMMANDS, BYTES_TUPLE_COMMANDS
└── errors.ts                   # TransportError, AddonNotFoundError
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

3. ComputeBridge:      ctx.computeBridge.setCellValueParsed(sheetId, 0, 0, "42")

4. Generated Client:   transport.call('compute_set_cell_value_parsed', { docId, sheetId, row: 0, col: 0, value: "42" })

5. Transport:          TauriTransport.call() → Tauri invoke('compute_set_cell_value_parsed', args)
                    OR  WasmTransport.call()  → wasmModule.compute_set_cell_value_parsed(...)
                    OR  NapiTransport.call()  → napiAddon.compute_set_cell_value_parsed(...)

6. Rust (generated):   #[tauri::command] / #[wasm_bindgen] / #[napi]
                         → Deserialize args
                         → Engine.set_cell_value_parsed(&mut self, sheet_id, row, col, "42")

7. Rust (compute-core): set_cell → parser("42") → recalc dependency graph
                         → serialize_mutation_result() → Uint8Array

8. Return path:        Uint8Array → BinaryMutationReader → BinaryViewportBuffer.applyBinaryMutation()
                         → Canvas re-renders
                         → EventBus emits cell:changed
```

---

## 6. Key Principles

1. **Rust is the single source of truth.** All persistent state and computation lives in `compute-core`. TypeScript never owns cell data.

2. **Types defined once in Rust, consumed in both languages.** The `bridge-ts` crate parses Rust structs and emits TypeScript interfaces. No hand-maintained type duplicates.

3. **Transport is injected, not hardcoded.** The kernel receives a `BridgeTransport` and doesn't know whether it's talking over Tauri IPC, WASM, or N-API.

4. **Three API styles for three audiences.** Unified API for apps/LLM, namespace API for headless/backend, Document Factory for lifecycle.

5. **Handle-based resource management.** All consumer-scoped resources are disposable handles, composing into a tree rooted at the workbook.

6. **Async mutations, sync reads.** All writes await Rust; viewport reads are zero-copy `DataView` into binary buffers.
