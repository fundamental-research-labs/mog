# Architecture Overview

> **Status: high-level orientation — use the package manifests and boundary checks as the source of truth**

Platform architecture for contributors and advanced integrators. This guide explains how Mog's packages are layered, what each layer is responsible for, and the rules governing dependencies between them.

## Prerequisites

- Familiarity with the [Quickstart](quickstart.md) or one of the embed guides
- Optional: Rust and TypeScript reading ability for code-level understanding

## Layer Diagram

```
┌───────────────────────────────────────────────────────┐
│  Runtime      Public SDK/embed facades and host setup  │
├───────────────────────────────────────────────────────┤
│  Apps         TypeScript/React — own their chrome      │
├───────────────────────────────────────────────────────┤
│  Shell/UI     Workspace chrome, focus, shared UI       │
├───────────────────────────────────────────────────────┤
│  Views        Reusable projections (SheetView)         │
├───────────────────────────────────────────────────────┤
│  Kernel       Document lifecycle, API, services        │
├───────────────────────────────────────────────────────┤
│  Hardware     Compute, transport, canvas, file I/O     │
├───────────────────────────────────────────────────────┤
│  Types        Contracts and shared type shards         │
└───────────────────────────────────────────────────────┘
```

Dependency direction is enforced by the `mog/import-boundaries` ESLint rule. In broad terms, implementation packages import downward through `types/contracts -> hardware -> kernel -> views -> shell/ui -> apps`, with runtime facades above the app-facing surface and a few documented host/test exceptions.

## Types and Contracts Layer

Shared TypeScript contracts establish the public vocabulary for cells, workbooks, rendering, events, storage, host integration, and API shapes. `@mog-sdk/contracts` re-exports the type shards and also owns small public runtime contract values such as branded ID constructors.

## Hardware and Infrastructure Layer

Lower-level implementation packages provide computation, transport, rendering, file I/O, and generated bridge artifacts. They must not import kernel, view, shell, or app packages. Includes:

- **compute-core** — Rust spreadsheet engine, storage, formula evaluation, scheduling, file import, and collaboration-related crates
- **rust-bridge** — proc-macro and TypeScript generation crates for WASM, Tauri, N-API, PyO3, and bridge type output
- **transport** — Tauri, WASM, and N-API transport implementations used by the TypeScript compute bridge
- **canvas, charts, table-engine, typeset** — rendering and domain engines used by views and apps
- **file-io** — XLSX, CSV, OOXML, PDF, and print/export packages

## Kernel Layer

The TypeScript data and lifecycle layer. The kernel exposes `DocumentFactory`, document handles, workbook APIs, event surfaces, storage/provider integration, and services such as undo, clipboard, notifications, and security plumbing. Persistent spreadsheet state and CRDT internals live in Rust compute/document crates; the kernel wires those engines through `ComputeBridge`.

## Views Layer

Reusable UI projections of data. `@mog-sdk/sheet-view` is the shipped view package: it mounts the grid, owns SheetView-specific public types, and binds through a narrow data-source boundary instead of re-exporting the kernel's canonical `Workbook` type.

## Shell and UI Layer

Shared shell packages own workspace-level chrome and UI services: focus, app/session composition, global UI state, and reusable components. Shell and UI packages sit above views and kernel, and apps compose them rather than importing shell internals upward.

## Apps Layer

End-user applications. Each app owns product-specific chrome, commands, dialogs, and workflow orchestration. The spreadsheet app composes contracts, kernel APIs, shell/UI, SheetView, and lower-level engines where an app-level integration needs them.

## Runtime Facades

Runtime packages expose public SDK and embed entry points, choose host/runtime adapters, and pass explicit transport configuration into the kernel. Browser paths use the WASM transport, Node/headless paths use N-API, and desktop paths use Tauri IPC when running in a Tauri host.

## Package Boundaries

TypeScript workspaces are declared in `pnpm-workspace.yaml`; Rust crates are declared in the root `Cargo.toml`. Public package disposition is tracked in the package inventory and manifests. Source-level import direction is enforced by `tools/eslint-plugin-mog/import-boundaries.cjs`, while package publication and export metadata are checked by the package validation tools.

## Compute Bridge

How the kernel communicates with the Rust compute engine. `ComputeBridge` is a TypeScript composition root that delegates lifecycle, sync, viewport, and mutation handling to `ComputeCore` and generated bridge methods. The transport layer provides WASM for browsers, Tauri IPC for desktop hosts, and N-API for Node/headless runtimes; callers use the same async bridge API regardless of target.

## CRDT and Collaboration

Yrs-backed CRDT state lives on the Rust compute/document side, with TypeScript lifecycle and provider code carrying update bytes, state vectors, recovery state, and host-backed storage policy. Collaboration support also includes Rust crates for sync primitives, multi-participant coordination, awareness, and locks.

## Cell Identity Model

Cells, rows, and columns have stable identities; positions are mutable. TypeScript contracts expose branded string IDs, while Rust converts UUID strings at the boundary and uses compact identity values internally. Formula references and structural edits use those identities so row/column insertion, deletion, movement, and collaboration do not require rewriting formulas as plain A1 strings.

## Related Docs

- [Architecture (detailed)](../architecture/README.md) — full architecture document
- [Compute Bridge](../architecture/compute-bridge.md) — bridge internals
- [TypeScript Package Boundaries](../architecture/typescript-package-boundaries.md) — workspace dependency rules
- [Cell Identity](../internals/spreadsheet/cell-identity.md) — identity model details
