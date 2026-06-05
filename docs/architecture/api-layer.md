# API Layer Architecture

> **Status: architecture reference.** Public consumers should start with
> `@mog-sdk/sdk` for headless Node.js usage and the embed packages for browser
> usage. `@mog-sdk/kernel`, `@mog/transport`, and `infra/rust-bridge/*` are
> workspace-internal implementation packages in the current manifests, even
> though they define most of the API-layer mechanics described here.

The API layer connects public SDK calls to the Rust spreadsheet engine through a
TypeScript kernel, generated bridge methods, and platform-specific transports.

```
Public SDK / runtime facade        Workspace TS kernel              Bridge + transport                Rust engine
@mog-sdk/sdk                      @mog-sdk/kernel (private)        @mog/transport (private)          compute-api / compute-core
runtime/sdk/src/boot.ts      ->    kernel/src/api/            ->    BridgeTransport.call(...)   ->    ComputeService
createWorkbook()                   Workbook / Worksheet             N-API / Tauri / WASM              YrsComputeEngine

Contracts and generated metadata:
@mog-sdk/contracts                 runtime/sdk/src/generated/api-spec.json
types/api/src/api/*                kernel/src/bridges/compute/*.gen.ts
```

## Package Disposition

| Package or path | Current status | Role |
| --- | --- | --- |
| `runtime/sdk` (`@mog-sdk/sdk`) | public shipped | Headless Node.js SDK. Exports `createWorkbook`, contract types, SDK errors/events, `MogDocumentFactory`, and API introspection metadata. |
| `contracts` (`@mog-sdk/contracts`) | public shipped | Public type and small runtime-value barrel for workbook, worksheet, events, core cell types, document, SDK, and app contracts. |
| `runtime/embed` (`@mog-sdk/embed`) | public shipped | Read-only sheet/view embed package. |
| `runtime/spreadsheet-app` (`@mog-sdk/spreadsheet-app`) | public shipped | Full spreadsheet app embed for trusted same-origin hosts. |
| `views/sheet-view` (`@mog-sdk/sheet-view`) | public shipped | Reusable sheet view package. It binds through a SheetView data-source boundary rather than re-exporting kernel internals. |
| `kernel` (`@mog-sdk/kernel`) | workspace-internal | Canonical TypeScript implementation of document lifecycle, `createWorkbook`, `WorkbookImpl`, `WorksheetImpl`, app-scoped APIs, and compute bridge wiring. The package manifest is `private: true`. |
| `infra/transport` (`@mog/transport`) | workspace-internal | `BridgeTransport` implementations for N-API, Tauri, and WASM. The package manifest is `private: true`. |
| `infra/rust-bridge/*` | workspace-internal | Rust proc macros, bridge IR, target generators, and the TypeScript bridge client interface. |
| `compute/pyo3` (`mog-sdk`, import `mog`) | public-experimental source | Native Python SDK source exists and is marked alpha in `pyproject.toml`; release status should be confirmed before documenting it as shipped. |

## Public Node Path

The current copy-paste public API path is `@mog-sdk/sdk`:

```typescript
import { createWorkbook } from '@mog-sdk/sdk';

const wb = await createWorkbook({ userTimezone: 'UTC' });
const ws = wb.activeSheet;

await ws.setCell('A1', 42);
await ws.setCell(1, 0, '=A1*2'); // A2 by zero-based row/column

console.log(await ws.getValue('A2')); // 84

wb.dispose();
```

The SDK accepts blank workbooks, `Uint8Array` XLSX bytes, file paths, and
an options object. Internally it creates a host-backed headless document,
loads the N-API addon through the optional platform packages, registers the
Node chart exporter, asks the document handle for its cached workbook, and
chains workbook disposal to document and host disposal.

External SDK users should prefer this public facade. Direct imports from
`@mog-sdk/kernel` are monorepo/workspace integration points, not a published npm
contract in the current package manifest.

## API Sources of Truth

The high-level workbook/worksheet contract is defined in TypeScript contract
files. Generated SDK metadata is derived from those contracts; this document is
not a contract source.

| Source | Purpose |
| --- | --- |
| `types/api/src/api/workbook.ts` | `Workbook` root contract and workbook sub-API accessors. |
| `types/api/src/api/worksheet.ts` | `Worksheet` root contract and worksheet sub-API accessors. |
| `types/api/src/api/workbook/*` | Workbook sub-API interfaces. |
| `types/api/src/api/worksheet/*` | Worksheet sub-API interfaces. |
| `kernel/src/api/workbook/workbook-impl.ts` | Canonical workbook implementation. |
| `kernel/src/api/worksheet/worksheet-impl.ts` | Canonical worksheet implementation. |
| `runtime/sdk/src/generated/api-spec.json` | Generated public SDK metadata used for API introspection. |
| `runtime/sdk/src/api-describe.ts` | Programmatic SDK API discovery over the generated spec. |

Generated API metadata currently lists these workbook sub-APIs:

```
cellStyles, changes, diagnostics, functions, history, links, names,
notifications, pivotTableStyles, properties, protection, scenarios, security,
sheets, slicerStyles, slicers, tableStyles, theme, timelineStyles, viewport
```

And these worksheet sub-APIs:

```
bindings, cells, changes, charts, comments, conditionalFormats, connectors,
customProperties, diagrams, drawings, equations, filters, formControls,
formats, hyperlinks, layout, names, objects, outline, pictures, pivots, print,
protection, settings, shapes, slicers, sparklines, structure, styles, tables,
textBoxes, textEffects, validations, view, whatIf
```

Those lists should be regenerated from `runtime/sdk/src/generated/api-spec.json`
or the `types/api` contracts when they drift.

## Kernel API

`kernel/src/api/index.ts` documents three API styles with explicit stability
labels:

| Style | Status in kernel source | Audience |
| --- | --- | --- |
| Unified API, `createWorkbook()` | stable implementation surface | Public facades and monorepo integrations. |
| Namespace APIs, `Cells`, `Sheets`, `Records` | experimental | Low-level function-oriented calls that take an explicit `IKernelContext`. |
| `DocumentFactory` lifecycle | internal in the kernel API barrel | Document-first monorepo paths and SDK facades. Public root-barrel access is narrowed separately. |

The primary implementation path is the unified API:

```typescript
import { createWorkbook } from '@mog-sdk/sdk';

const wb = await createWorkbook();
const ws = wb.activeSheet;

await ws.setCell('A1', 42);
await ws.setRange('B1:C2', [
  [1, 2],
  [3, 4],
]);

const value = await ws.getValue('A1');
const cell = await ws.getCell('A1');
const range = await ws.getRange('B1:C2');

await wb.batch('bulk update', async (workbook) => {
  await workbook.activeSheet.setCell('D1', '=SUM(B1:C2)');
});

wb.dispose();
```

Important contract details:

- `Workbook.activeSheet`, `Workbook.sheetCount`, `Worksheet.sheetId`,
  `Worksheet.name`, and `Worksheet.index` are synchronous contract members.
- Cell and range mutations are async because they call the Rust compute engine
  and may trigger recalculation.
- `Worksheet.setCell`, `getCell`, `getValue`, `setRange`, and `getRange`
  support A1 strings and numeric row/column overloads where declared by the
  `Worksheet` contract.
- Errors throw directly from the API surface. The modern workbook/worksheet API
  does not expose `OperationResult` wrappers.
- `Workbook.batch(label, fn)` groups operations into one undo step. The older
  `undoGroup(fn)` helper is still present in the generated metadata.
- Sub-APIs are exposed as readonly properties and are lazily initialized by the
  implementation.

### Cell Write Flow

Current `ws.setCell('A1', 42)` flow:

```
WorksheetImpl.setCell(...)
  -> address-resolver.ts resolves "A1" to { row: 0, col: 0 }
  -> CellOps.setCell(ctx, sheetId, 0, 0, 42)
  -> prepareExternalFormulaWrite(...) and toCellInput(...)
  -> ctx.computeBridge.setCellsByPosition(sheetId, [{ row, col, input }])
  -> ComputeBridge batches as [sheetId, row, col, input]
  -> BridgeTransport.call("compute_batch_set_cells_by_position", ...)
  -> generated N-API / Tauri / WASM binding
  -> compute_api::ComputeService / compute-core mutation and recalculation
  -> [Uint8Array, MutationResult] return
  -> ComputeCore.mutate(...) applies mutation data and emits events
```

The binary `Uint8Array` in mutation results is the high-frequency data plane
used by viewport buffers and render-path consumers. Structured metadata remains
available through the JSON control plane.

### Namespace APIs

The namespace APIs are real, but they are explicitly experimental and require a
kernel context:

```typescript
import { Cells, Sheets, Records } from '@mog-sdk/kernel/api';

const value = await Cells.getValue(ctx, sheetId, 0, 0);
const name = await Sheets.getName(ctx, sheetId);
const rows = await Records.query(ctx, tableId, { field: 'Status', equals: 'Open' });
```

Use these for monorepo/headless implementation work that already owns an
`IKernelContext`. Public SDK examples should use `createWorkbook()` and the
workbook/worksheet object model instead.

### Document Lifecycle

`DocumentFactory` creates document handles. The direct document-first path is
an internal or advanced integration path; `createWorkbook()` is the stable
application-facing path.

```typescript
import { DocumentFactory } from '@mog-sdk/kernel/api';

const handle = await DocumentFactory.create({
  documentId: 'doc-example',
  environment: 'headless',
  userTimezone: 'UTC',
});

const workbook = await handle.workbook();

await workbook.activeSheet.setCell('A1', 'created through a handle');

workbook.dispose();
await handle.dispose(); // idempotent
```

The public `DocumentHandle` exposes handle methods such as `workbook()`,
`eventBus`, provider registration helpers, storage-state accessors, and
`dispose()`. Raw `context` access is on `DocumentHandleInternal` for trusted
kernel/monorepo code.

## Context Tiers

Context types are defined in `types/api/src/kernel/kernel-context.ts`; the
engine-internal extension is in `kernel/src/context/types.ts`.

```
IDomainContext              eventBus + undo labeling
IKernelContext              + services, security principal resolver, userTimezone, destroy()
ISpreadsheetKernelContext   + spreadsheet bridges, object manager, state mirror
DocumentContext             + write/operation gates, workbook links, ComputeBridge, selection checkpoints
```

Domain modules should request the narrowest context type they need. Kernel
internals cast to `DocumentContext` only where direct compute bridge or
engine-internal services are required.

## App API

`kernel/src/api/app/` is a monorepo-internal bridge from spreadsheet documents
to app-facing APIs. `createAppKernelAPIFromHandle()` requires a trusted
`DocumentHandleInternal` with raw context access. `runtime/spreadsheet-app`
uses this path while composing the public full-app embed runtime.

The capability-gated layer returns only interfaces granted to an app:

```typescript
const gated = createCapabilityGatedApi({ fullApi, appId, registry });

gated.tables?.add(...);
gated.records?.query(...);
gated.network?.fetch(...);
```

Missing capabilities usually mean the corresponding sub-API property is absent,
not that callers receive a late "permission denied" error from that property.

## Rust Bridge Framework

`infra/rust-bridge/` is the workspace-internal code generation framework. It is
not UniFFI or raw `wasm-bindgen` hand-written glue. It parses Rust bridge
annotations, emits descriptors, and lets target-specific generators produce
N-API, WASM, Tauri, PyO3, TypeScript client, and metadata artifacts.

### Core Annotation Shape

```rust
#[bridge::api(service = "ComputeService", key = "doc_id", fn_prefix = "compute")]
impl ComputeService {
    #[bridge::lifecycle(create)]
    pub fn init(snapshot: WorkbookSnapshot) -> Result<(Self, RecalcResult), ComputeError> {
        // ...
    }

    #[bridge::read]
    pub fn active_principal(&self) -> Option<Vec<String>> {
        // ...
    }

    #[bridge::write]
    pub fn full_recalc(&mut self, options: RecalcOptions) -> Result<RecalcResult, ComputeError> {
        // ...
    }
}
```

Stateless bridge functions use `#[bridge::api]` plus `#[bridge::pure]` on
plain associated functions. Compute also uses access-attribute metadata such as
`scope = "cell" | "range" | "sheet" | "workbook"`, `needs_principal`, and
`kind = "subscribe"` for downstream metadata and gated delegate generation.

Current bridge-core supports these public annotation categories in source:

| Annotation | Purpose |
| --- | --- |
| `#[bridge::api(...)]` | Parses an impl block and emits an API descriptor macro. |
| `#[bridge::pure]` | Stateless function. |
| `#[bridge::read]` | Read query. |
| `#[bridge::write]` | Mutation. |
| `#[bridge::structural]` | Structural mutation, with stricter scope validation in delegate codegen. |
| `#[bridge::lifecycle(create)]` / `create_from = "..."` | Service constructor paths. |
| `#[bridge::async_read]` / `#[bridge::async_write]` | Async target method classification. |
| `#[bridge::skip(...)]` | Exclude a method from selected targets. |
| `#[bridge::parse]` | Parse a string-wire parameter through `BridgeParse`. |

### Generated Artifacts

| File | Current purpose |
| --- | --- |
| `kernel/src/bridges/compute/compute-bridge.gen.ts` | Generated TypeScript bridge methods that call `BridgeTransport`. |
| `kernel/src/bridges/compute/compute-types.gen.ts` | Generated wire interfaces and unions from Rust/serde shapes. |
| `kernel/src/bridges/compute/manifest.gen.ts` | Generated read/write/lifecycle method-kind metadata. |
| `infra/transport/src/command-metadata.gen.ts` | Generated command metadata for recalc and binary tuple normalization. |
| `infra/rust-bridge/bridge-ts/generated/xlsx-types.ts` | Generated XLSX parser TypeScript types. |
| `infra/rust-bridge/bridge-ts/generated/ooxml-types.ts` | Generated OOXML vocabulary TypeScript types. |
| `infra/culture/src/cultures.gen.ts` | Generated culture registry data. |

Generated bridge methods look like this in `compute-bridge.gen.ts`:

```typescript
batchSetCellsByPosition(
  edits: [SheetId, number, number, CellInput][],
  skipCycleCheck: boolean,
): Promise<MutationResult> {
  return this.core.mutate(
    this.core.transport.call<[Uint8Array, MutationResult]>(
      'compute_batch_set_cells_by_position',
      { docId: this.core.docId, edits, skipCycleCheck },
    ),
  );
}
```

The hand-written `ComputeBridge` wraps generated methods when it needs higher
level behavior such as direct-edit tracking, mutation handling, date/format
compatibility, viewport coordination, trap recovery, or chart/table adapters.

## Transport Layer

The `BridgeTransport` interface is deliberately small:

```typescript
interface BridgeTransport {
  call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T>;
}
```

`infra/transport/src/factory.ts` auto-detects backends in this order when no
explicit runtime is provided:

1. N-API in Node.js if the native addon can be loaded.
2. Tauri when running in a Tauri desktop host.
3. WASM as the browser/web fallback.

Explicit runtime configuration can force `napi`, `tauri`, or `wasm`. The
current wrapper pipelines are:

```
N-API:  LazyNapiTransport -> NapiTimeInjectingTransport -> BytesTupleNormalizingTransport
Tauri:  TauriTransport -> BytesTupleNormalizingTransport
WASM:   WasmTransport -> TimeInjectingTransport -> CaseNormalizingTransport
```

Important middleware:

| Middleware | Purpose |
| --- | --- |
| `TimeInjectingTransport` / `NapiTimeInjectingTransport` | Sends the current workbook-session time before recalc-triggering commands. |
| `BytesTupleNormalizingTransport` | Normalizes `[Uint8Array, MutationResult]` binary tuple returns from N-API and Tauri. |
| `CaseNormalizingTransport` | Normalizes WASM serde `snake_case` results to the camelCase shapes consumed by TypeScript. |

## IPC Protocols

Mog uses two bridge protocols:

| Protocol | Format | Used for |
| --- | --- | --- |
| Control plane | JSON over generated bridge calls | RPC commands, metadata, query responses, import/export coordination. |
| Data plane | Binary `Uint8Array` | Viewport payloads and mutation patches on render-sensitive paths. |

The control plane is generated by the rust-bridge framework. The data plane is
defined by the Rust `compute-wire` crate and consumed in TypeScript by wire
readers and viewport buffers. See [compute-bridge.md](compute-bridge.md) for
binary layout details.

## End-to-End Cell Edit

```
1. Public code
   await ws.setCell('A1', 42)

2. Kernel API
   WorksheetImpl.setCell()
     -> resolveCell('A1')
     -> CellOps.setCell(ctx, sheetId, row, col, value)

3. Compute bridge
   ComputeBridge.setCellsByPosition(...)
     -> GeneratedBridgeBase.batchSetCellsByPosition(...)
     -> BridgeTransport.call('compute_batch_set_cells_by_position', ...)

4. Platform backend
   N-API ComputeEngine method
   or Tauri command
   or WASM exported function

5. Rust
   generated binding
     -> compute_api::ComputeService
     -> compute-core YrsComputeEngine mutation
     -> recalculation
     -> MutationResult + binary mutation bytes

6. TypeScript return path
   ComputeCore.mutate(...)
     -> MutationResultHandler / state mirror / event bus
     -> BinaryViewportBuffer applies relevant binary patches
     -> renderers observe invalidation and repaint
```

## Principles That Match Current Code

1. The Rust compute engine is the source of truth for spreadsheet state,
   formula evaluation, recalculation, identity-aware structural edits, and
   workbook serialization.
2. Public JavaScript consumers should enter through public runtime facades such
   as `@mog-sdk/sdk`, not private workspace packages.
3. The TypeScript kernel owns the workbook/worksheet object model, lifecycle
   wrappers, event surfaces, state mirror, services, and bridge composition.
4. Generated bridge artifacts keep Rust wire methods and TypeScript transport
   calls aligned; hand-written kernel code wraps those artifacts for higher
   level API semantics.
5. Transport choice is injected/detected at runtime. Kernel code calls the same
   async `BridgeTransport` interface for N-API, Tauri, and WASM.
6. Render-sensitive state uses binary viewport/mutation payloads; ordinary
   command and query data uses structured JSON.
