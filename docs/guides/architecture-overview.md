# Architecture Overview

> **Status: skeleton — content pending package stabilization**

Platform architecture for contributors and advanced integrators. This guide explains how Mog's packages are layered, what each layer is responsible for, and the rules governing dependencies between them.

## Prerequisites

- Familiarity with the [Quickstart](quickstart.md) or one of the embed guides
- Optional: Rust and TypeScript reading ability for code-level understanding

## Layer Diagram

```
┌───────────────────────────────────────────────────────┐
│  Apps         TypeScript/React — own their chrome      │
├───────────────────────────────────────────────────────┤
│  Views        Reusable view components (SheetView)     │
├───────────────────────────────────────────────────────┤
│  Kernel       Data layer: API, storage, events, recalc │
├───────────────────────────────────────────────────────┤
│  Hardware     Standalone computation — no Yrs, no React│
├───────────────────────────────────────────────────────┤
│  Contracts    Shared types, interfaces, constants      │
└───────────────────────────────────────────────────────┘
```

Dependency direction: `contracts -> hardware -> kernel -> views -> apps`. Each layer may only import from layers below it.

## Contracts Layer

Shared TypeScript types and Rust trait definitions that establish the vocabulary for the entire system. No runtime behavior, no side effects. Every other layer depends on contracts.

## Hardware Layer

Standalone computation packages with no framework dependencies. Includes:

- **compute-core** — Rust formula engine and recalc scheduler (22 crates)
- **rust-bridge** — proc-macro framework generating WASM, Tauri IPC, and N-API bindings
- **canvas/drawing** — Canvas-based rendering pipeline
- **xlsx** — XLSX parser (Rust) and serializer
- **pdf** — PDF export pipeline

## Kernel Layer

The data layer. Owns the Yrs CRDT document, exposes the unified API (Cells, Sheets, Tables, Records, Columns), manages services (undo, clipboard, notifications), and bridges to compute-core for formula evaluation.

## Views Layer

Reusable UI projections of data. SheetView renders a spreadsheet grid bound to a Workbook. Future views (Kanban, Timeline, Calendar, Gallery) will bind to a more general Dataset abstraction.

## Apps Layer

End-user applications. Each app owns its chrome (toolbar, sidebars, dialogs) and composes kernel + views. The spreadsheet app is the reference implementation.

## Package Boundaries

How packages are structured. Workspace layout (packages/ for TS, crates/ for Rust). Public API surface rules. What is published to npm vs. internal-only.

## Compute Bridge

How the kernel communicates with the Rust compute engine. Three bridge targets: WASM (browser), Tauri IPC (desktop), N-API (Node.js server). The bridge is transparent to callers.

## CRDT and Collaboration

Yrs (Yjs Rust port) as the storage substrate. How edits flow through the CRDT. Collaboration model (awareness, sync protocol).

## Cell Identity Model

Cells are keyed by stable UUIDs, not positions. Why this matters for formulas, concurrent editing, and structural operations.

## Related Docs

- [Architecture (detailed)](../architecture/README.md) — full architecture document
- [Compute Bridge](../architecture/compute-bridge.md) — bridge internals
