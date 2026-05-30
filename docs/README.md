# Mog

A data operating system built on spreadsheet primitives. The public repo is a
TypeScript and Rust monorepo spanning SDKs, runtime packages, kernel services,
view components, compute crates, and file I/O.

**Start here:** [architecture/README.md](architecture/README.md) — core design decisions, subsystems, and the full documentation index.

Compatibility references to third-party spreadsheet applications, APIs, and
file formats are nominative and governed by [TRADEMARKS.md](../TRADEMARKS.md).

## System Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  APPS (TypeScript/React - import kernel, shell, and views as libraries)     │
│  Spreadsheet app and published spreadsheet runtime packages                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  WINDOW MANAGER                                                              │
│  Focus management │ Keyboard routing │ Panel layout (future)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  SHELL (host + UI library)                                                   │
│  App hosting │ Session/workspace services │ Reusable UI primitives           │
├─────────────────────────────────────────────────────────────────────────────┤
│  VIEWS                                                                       │
│  SheetView package │ Spreadsheet app views: Grid, Kanban, Timeline,          │
│  Calendar, Gallery, Form                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  KERNEL (data library + system services)                                     │
│  Storage: Rust/Yrs CRDT, identity (CellId, RowId, ColId)                     │
│  Services: Clipboard, Undo, Notifications                                    │
│  Events: EventBus for cross-system communication                             │
│  Recalc: ComputeBridge (Tauri IPC / WASM / N-API → Rust compute-core)       │
│  API: Cells, Sheets, Tables, Records, Columns, Relations                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  HARDWARE (low-level computation, rendering, platform, and I/O packages)     │
│  Compute:   compute-core (Rust) │ table-engine (TS)                         │
│  Bridge:    rust-bridge (proc-macro framework → WASM / Tauri / N-API)       │
│  Rendering: charts │ canvas/grid and drawing packages                        │
│  File I/O:  xlsx (parser=Rust, bridge+tooling=TS) │ xlsx-api │ ooxml-types  │
│  PDF:       pdf/core (Rust) │ pdf/graphics │ pdf/layout │ print-export       │
│  Platform:  infra/platform (web + Tauri helpers) │ typeset/math-engine       │
│  Runtime:   sdk │ embed │ spreadsheet-app                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

Primary dependency flow: `contracts -> hardware -> kernel -> views -> apps`
(shell runs parallel to views; apps import both).

## Quick Start

For library usage, start with the public Node SDK or embed packages:

```typescript
import { createWorkbook } from '@mog-sdk/node';

const wb = await createWorkbook();
const ws = wb.activeSheet;

await ws.setCell('A1', 42);
await ws.setCell('A2', '=A1*2');

console.log(await ws.getCell('A2'));
await wb.dispose();
```

## Documentation

| Topic | Document |
|-------|----------|
| **Architecture & design decisions** | [architecture/README.md](architecture/README.md) |
| Trademark notices | [../TRADEMARKS.md](../TRADEMARKS.md) |
| OS layers | [architecture/os/README.md](architecture/os/README.md) |
| TypeScript package boundaries | [architecture/typescript-package-boundaries.md](architecture/typescript-package-boundaries.md) |
| API layer (kernel API, rust-bridge, transport) | [architecture/api-layer.md](architecture/api-layer.md) |
| Compute bridge | [architecture/compute-bridge.md](architecture/compute-bridge.md) |
| Access control (principals, policies, redaction) | [security/ACCESS-CONTROL.md](security/ACCESS-CONTROL.md) |
| Compute-core (Rust) | [../compute/core/README.md](../compute/core/README.md) |
| Spreadsheet engine | [internals/spreadsheet/README.md](internals/spreadsheet/README.md) |
| Drawing system | [../canvas/drawing/README.md](../canvas/drawing/README.md) |
