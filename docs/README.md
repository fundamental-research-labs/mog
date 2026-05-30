# Mog

A data operating system built on spreadsheet primitives. Every app is structured data + views + event handlers. ~96 packages (46 TS + 50 Rust crates), ~950K lines TS, ~620K lines Rust.

**Start here:** [architecture/README.md](architecture/README.md) — core design decisions, subsystems, and the full documentation index.

Compatibility references to third-party spreadsheet applications, APIs, and
file formats are nominative and governed by [TRADEMARKS.md](../TRADEMARKS.md).

## System Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  APPS (TypeScript/React - import kernel & shell as libraries)               │
│  Spreadsheet │ (more apps planned)                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  WINDOW MANAGER                                                              │
│  Focus management │ Keyboard routing │ Panel layout (future)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  SHELL (UI library)                                                          │
│  Views: Grid (implemented) │ Kanban, Timeline, Calendar, Gallery, Form (planned) │
│  Components: Reusable UI primitives apps can import                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  KERNEL (data library + system services)                                     │
│  Storage: Rust/Yrs CRDT, identity (CellId, RowId, ColId)                     │
│  Services: Clipboard, Undo, Notifications                                    │
│  Events: EventBus for cross-system communication                             │
│  Recalc: ComputeBridge (Tauri IPC / WASM / N-API → Rust compute-core)       │
│  API: Cells, Sheets, Tables, Records, Columns, Relations                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  HARDWARE (standalone computation packages - no Yrs, no React)               │
│  Compute:   compute-core (Rust, 22 crates) │ table-engine (TS)             │
│  Bridge:    rust-bridge (proc-macro framework → WASM / Tauri / N-API)       │
│  Rendering: charts │ canvas (8 pkgs, incl. drawing with 6 sub-pkgs)         │
│  File I/O:  xlsx (parser=Rust, bridge+tooling=TS) │ xlsx-api │ ooxml-types  │
│  PDF:       pdf/core (Rust) │ pdf/graphics │ pdf/layout │ print-export       │
│  Platform:  typeset/math-engine                                              │
│  Desktop:   src-tauri (Rust/Tauri)                                           │
│  Runtime:   sdk                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

Dependency flow: `contracts -> hardware -> kernel -> shell -> apps`

## Quick Start

Apps are TypeScript that import kernel (data) and shell (UI) as libraries:

```typescript
// Future app example (CRM app using planned shell views):
import { useKernel } from '@mog-sdk/kernel';
import { KanbanBoard, DataGrid } from '@mog-sdk/app-platform'; // planned exports

export default function CRMApp() {
  const kernel = useKernel();
  const deals = kernel.records.query('deals', { status: 'open' });

  return (
    <KanbanBoard
      records={deals}
      groupBy="stage"
      onMove={(id, stage) => kernel.records.update('deals', id, { stage })}
    />
  );
}
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
