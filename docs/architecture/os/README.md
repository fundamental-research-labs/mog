# OS Architecture

> **Status: architecture orientation.** Use `pnpm-workspace.yaml`,
> package manifests, `tools/package-inventory.jsonc`, and
> `tools/eslint-plugin-mog/import-boundaries.cjs` as the source of truth for
> package membership, publication status, and dependency direction.

The Spreadsheet OS is a layered system. Public runtime packages expose SDK and
embed entry points; workspace apps own product UI; shell hosts apps and shared
chrome; views render reusable projections; the kernel owns document lifecycle,
APIs, state services, and bridge wiring; hardware packages provide compute,
rendering, file I/O, transport, and supporting engines.

## Layer Overview

```
Runtime facades     Shipped public: @mog-sdk/node, @mog-sdk/embed,
                    @mog-sdk/spreadsheet-app. Browser compute is exposed
                    through the @mog-sdk/wasm binary wrapper.
        |
Apps                Workspace-private React apps. The current first-party app
                    is apps/spreadsheet (@mog/app-spreadsheet).
        |
Shell/UI            Workspace-private app host, focus, app launch, platform
                    contexts, shared shell components, and @mog/ui.
        |
Views               Shipped public view package: @mog-sdk/sheet-view.
        |
Kernel              Workspace-internal @mog-sdk/kernel root package:
                    DocumentFactory, Workbook/Worksheet implementation,
                    services, EventBus, compute bridges, selectors, and
                    app-platform scaffolding.
        |
Hardware/engines    compute/core, compute/api, compute/wasm, compute/napi,
                    compute/pyo3, file-io/*, canvas/*, charts, table-engine,
                    spreadsheet-utils, typeset/math-engine, infra/*.
        |
Types/contracts     Shipped public @mog-sdk/contracts plus workspace type
                    shards under types/*.
```

Lower layers provide contracts, engines, adapters, and primitives. Higher
layers compose those pieces into shipped runtime facades or workspace UI.
Implementation packages import downward through the layer stack; runtime and
host/test packages have explicit boundary checks for their special cases.

## Key Architectural Decisions

### 1. Public APIs by Consumer

External JavaScript and TypeScript consumers should enter through the shipped
runtime packages, especially `@mog-sdk/node` for headless workbook automation.
The `@mog-sdk/kernel` root package exists in the monorepo but is marked
workspace-internal and `private: true`.

```typescript
import { createWorkbook } from '@mog-sdk/node';

const wb = await createWorkbook();

// Workbook-level: sheets, names, history, security, diagnostics, links, etc.
await wb.sheets.add('Sales');
const ws = await wb.getSheet('Sales');

// Worksheet-level: cells, tables, formatting, charts, pivots, validation, etc.
await ws.setCell('A1', 42);
await ws.tables.add('A1:D10', { name: 'Sales', hasHeaders: true });
await wb.history.undo();

wb.dispose();
```

Workspace app-platform code has a separate capability-gated API surface under
`kernel/src/api/app` and `@mog-sdk/contracts/apps`. That surface is
workspace-internal scaffolding for a future third-party app platform. The
spreadsheet app is trusted OS-level code and uses the unified Workbook/Worksheet
API directly; it may receive `AppProps.kernel` from shell, but it does not use
that prop as its primary data path.

When shell-hosted app scaffolding is used, capabilities are exposed only when
granted:

```typescript
if (api.tables?.list) {
  const tables = await api.tables.list();
}

if (api.records?.list) {
  const records = await api.records.list(tableId);
}
```

### 2. Apps Own Their Chrome

Shell provides hosting, contexts, launch flow, and reusable UI primitives. Apps
compose those pieces with their own chrome and workflows. In the current
workspace, `apps/spreadsheet` owns the spreadsheet toolbar, formula bar, sheet
tabs, status bar, dialogs, command routing, and grid workflow orchestration.

```typescript
function SpreadsheetApp() {
  return (
    <>
      <ToolbarContainer />
      <FormulaBarContainer />
      <SpreadsheetGrid />
      <TabStrip />
      <StatusBar />
    </>
  );
}
```

Public consumers that need the full app should use
`@mog-sdk/spreadsheet-app`, which is a shipped same-origin embed composition
package. Public consumers that need only a grid projection should use
`@mog-sdk/sheet-view` or the higher-level `@mog-sdk/embed` package.

### 3. System Services Live in Kernel

`IKernelServices` currently contains the cross-app services that must survive
app switches:

| Service | Data | Location | UI owner |
| --- | --- | --- | --- |
| Clipboard | Canonical clipboard payload and state machine | Kernel | Apps decide paste/render behavior |
| Undo | Rust compute-core undo/redo state and cached service state | Kernel | Apps/shell render commands |
| Notifications | Toast/notification queue | Kernel | App or shell UI renders |
| Query executor | External query registry, execution, and cache | Kernel | Calling feature owns UI |

Other kernel service directories support capabilities, filesystem permissions,
checkpointing, workbook links, security event relay, table registry, and
protection, but those are not all members of `IKernelServices`.

### 4. Machine Placement Follows State Scope

| Scope | Location | Examples |
| --- | --- | --- |
| App-specific | App package | selection, editor, clipboard, pane focus, and workflow state in `apps/spreadsheet` |
| Shell-level | `shell/src/machines` | `focusMachine` |
| Kernel-level | `kernel/src/services` | Clipboard, undo, notifications, query executor |
| Focus/routing | Shell plus app input systems | shell focus plus app pane/grid focus |

The practical test is: does this state need to survive switching apps?

- Yes: kernel service or document lifecycle state.
- No: app or shell state.

### 5. View Surfaces Are Deliberately Narrow

The shipped low-level view package is `@mog-sdk/sheet-view`. It mounts a grid
projection into a DOM container, attaches through a SheetView data-source
boundary, and returns a capability handle for viewport, render state, events,
commands, skinning, and host-owned extensions.

```typescript
import {
  createSheetView,
  createSheetViewDataSourceFromWorkbook,
} from '@mog-sdk/sheet-view';

const view = createSheetView({
  container,
  showHeaders: true,
  showGridlines: true,
  scrollable: true,
});

view.attach(createSheetViewDataSourceFromWorkbook(workbook));
view.start();
```

`GridCanvas` is a workspace-private spreadsheet-app component exported from
`apps/spreadsheet/src/views/grid`; it is not the public embed surface. Its
`preset` and `features` props are useful inside the spreadsheet app codebase,
but public integrations should prefer `@mog-sdk/sheet-view`,
`@mog-sdk/embed`, or `@mog-sdk/spreadsheet-app`.

## Data Flow

```
User action: keyboard, pointer, host command, or SDK call
        |
        v
[1] Shell/app/runtime routes to the active app or public Workbook/Worksheet API
        |
        v
[2] App/API performs a worksheet, workbook, or app-gated operation
        |
        v
[3] Kernel calls ComputeBridge; Rust compute-core mutates Yrs-backed state
    and recalculates formulas or dependent features as needed
        |
        +--> [4] MutationResultHandler updates mirrors/caches and emits events
        |         |
        |         +--> EventBus subscribers
        |         +--> feature bridges: validation, tables, pivots, slicers,
        |             charts, floating objects, and related domains
        |         +--> app hooks/views re-render or invalidate
        |
        +--> [5] RustDocument subscribes to update_v1 and fans updates to
                  attached storage providers. Collaboration WebSocket sidecars
                  subscribe to the ComputeBridge separately and exchange CRDT
                  diffs with the room coordinator.
```

Headless Node SDK workbooks use the same Workbook/Worksheet API and compute
bridge, but the default headless path attaches no browser storage provider.

## Abstraction Levels

Not all workflows need the same data shape. The public Workbook/Worksheet API
lets callers work at the lowest useful level, while app-platform scaffolding
adds capability-gated table/record views for workspace apps.

| Level | What exists | Use case | Current API |
| --- | --- | --- | --- |
| 0 | Sheets and cells | Quick calculations, formulas, scratch data | Public `Worksheet.*`; app-gated `cells` is workspace-internal |
| 1 | Tables | Headered ranges, filters, sort, styles | Public `Worksheet.tables`; app-gated `tables` is workspace-internal |
| 2 | Validation/schema-like constraints | Data validation and typed app table columns | Public `Worksheet.validations`; app `columns` is workspace-internal |
| 3 | Records | Treat table rows as entities for views and automation | Public `Workbook.records`; app `records` is workspace-internal |

Each level builds on the previous one. Callers can always drop down to sheets,
cells, and tables when record or app-platform abstractions are unnecessary.

## Cross-App Operations

Clipboard and undo are kernel services so app switches do not lose shared
state. Public SDK consumers normally use workbook history:

```typescript
await wb.history.undo();
await wb.history.redo();
```

Workspace app-platform code can receive gated service handles when the relevant
capabilities are granted:

```typescript
api.clipboard?.copy?.(payload);
const payload = api.clipboard?.getPayload?.();

await api.undo?.undo?.();
await api.undo?.redo?.();
```

These are same-process service boundaries, not a sandbox or remote isolation
guarantee. Public plugin, iframe, and self-hosted service surfaces remain
reserved unless their guide says otherwise.

## Detailed Documentation

| Document | Purpose |
| --- | --- |
| [kernel.md](kernel.md) | Kernel APIs and system services |
| [shell.md](shell.md) | Shell views and UI components |
| [apps.md](apps.md) | App structure and app-platform scaffolding |
| [packages.md](packages.md) | Package inventory and import rules |
