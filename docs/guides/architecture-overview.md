# Architecture Overview

> **Status: high-level public orientation.** Use `pnpm-workspace.yaml`, root
> `Cargo.toml`, package manifests, `tools/package-inventory.jsonc`, and
> `tools/eslint-plugin-mog/import-boundaries.cjs` as the source of truth for
> shipped, public-experimental, workspace-internal, reserved, and not shipped
> surfaces.

Mog is organized as public runtime packages over workspace-internal
implementation layers. This guide explains the current package stack, what each
layer owns, and the dependency rules contributors must preserve.

## Prerequisites

- Familiarity with the [Quickstart](quickstart.md) or one of the embed guides
- Optional: Rust and TypeScript reading ability for code-level understanding

## Public Entry Points

Most users should start from one of the shipped public packages rather than
from kernel or engine packages directly:

| Package | Current status | Use |
| --- | --- | --- |
| `@mog-sdk/sdk` | shipped public | Unified headless SDK; root import resolves to native N-API in Node and WASM in Workers/web-standard runtimes, with explicit `./node`, `./wasm`, and `./workerd` subpaths. |
| `@mog-sdk/embed` | shipped public root, public-experimental React/web-component/config subpaths | Read-only browser embed package. |
| `@mog-sdk/spreadsheet-app` | shipped public | Full spreadsheet app embed for trusted same-origin hosts. |
| `@mog-sdk/contracts` | shipped public, with many public-experimental subpaths | Public TypeScript contracts and small runtime values. |
| `@mog-sdk/sheet-view` | shipped public | Low-level canvas grid view package. |
| `@mog-sdk/wasm` and `@mog-sdk/*` platform binaries | public binary wrappers | Runtime implementation packages used by the public facades. |
| `@mog-sdk/kernel`, `@mog/transport`, `types/*` | workspace-internal | Monorepo implementation surfaces; do not present them as the primary external setup path. |
| `@mog/shell`, `@mog/ui` | reserved | Private workspace packages reserved for possible future public surfaces. |
| `@mog/*` engines/assets and `@mog/app-spreadsheet` | workspace-internal, bundle-only, generated-asset, or private | Implementation packages used by the public facades and workspace app. |

The copy-paste public SDK path is:

```typescript
import { createWorkbook } from '@mog-sdk/sdk';

const wb = await createWorkbook();
const ws = wb.activeSheet;

await ws.setCell('A1', 42);
await ws.setCell('A2', '=A1*2');
console.log(await ws.getValue('A2')); // 84

wb.dispose();
```

## Layer Diagram

```
Runtime      Public SDK/embed facades and host setup
Apps         Private workspace React apps own product chrome and workflows
Shell/UI     Reserved workspace chrome, focus, app/session composition, shared UI
Views        Reusable projections; SheetView is the shipped public view package
Kernel       Workspace-internal document lifecycle, API implementation, services
Hardware     Compute, transport, canvas, charts, file I/O, bridge generation
Types        Public contracts plus workspace-internal type shards
```

Allowed imports point downward. Higher layers may depend on lower layers:

```text
apps -> shell/ui -> views -> kernel -> hardware -> contracts/types
```

Lower layers must not import higher layers. The `mog/import-boundaries` ESLint
rule enforces this direction for TypeScript source. Host, test, and full-app
composition packages have narrower package-specific checks; in particular,
`@mog-sdk/spreadsheet-app` is a public bundle-composition package that uses
app/shell/kernel code internally while `runtime/spreadsheet-app/scripts/check-boundary.mjs`
checks that those internals do not leak from public declarations.

## Types and Contracts Layer

`@mog-sdk/contracts` is the shipped public contract barrel. It establishes the
public vocabulary for cells, workbooks, rendering, events, storage, host
integration, SDK types, and API shapes, and it owns small public runtime
contract values such as branded ID constructors.

The `types/*` packages are workspace-internal shards that feed contracts and
implementation packages. External docs should route users through
`@mog-sdk/contracts` or a public runtime package rather than through `types/*`.

## Hardware and Infrastructure Layer

Lower-level implementation packages provide computation, transport, rendering,
file I/O, and generated bridge artifacts. They must not import kernel, view,
shell, or app packages. Most `@mog/*` hardware packages are workspace-internal
or bundle-only; they are implementation dependencies of public facades, not
standalone public SDKs.

Includes:

- **`compute/core` and `compute/api`** - Rust spreadsheet engine, document
  model, formula evaluation, scheduling, storage, binary wire, security, and
  collaboration crates.
- **`compute/wasm`, `compute/napi`, and `compute/pyo3`** - WASM, N-API, and
  Python binding layers. The Python package source is public-experimental and
  imports as `mog`.
- **`infra/rust-bridge/*`** - workspace-internal proc-macro and bridge
  generation crates for WASM, Tauri, N-API, PyO3, and TypeScript metadata.
- **`infra/transport`** - workspace-internal Tauri, WASM, and N-API transport
  implementations used by the TypeScript compute bridge.
- **`canvas/*`, `charts`, `table-engine`, and `typeset/math-engine`** -
  rendering and domain engines used by views and apps.
- **`file-io/*`** - XLSX, CSV, OOXML, PDF, print, and export packages.

## Kernel Layer

`@mog-sdk/kernel` is `private: true` and workspace-internal in the current
manifests. It implements document lifecycle, `createWorkbook()`,
`DocumentFactory`, document handles, workbook/worksheet APIs, event surfaces,
storage/provider integration, and services such as undo, clipboard,
notifications, and security plumbing.

Public consumers should use `@mog-sdk/sdk`, `@mog-sdk/embed`, or
`@mog-sdk/spreadsheet-app`. Direct kernel imports are monorepo integration
points or advanced document-first paths, not the primary shipped public setup
path. Persistent spreadsheet state and CRDT internals live in Rust
compute/document crates; the kernel wires those engines through `ComputeBridge`.

## Views Layer

Reusable UI projections of data. `@mog-sdk/sheet-view` is the shipped public
view package: it mounts the canvas grid, owns SheetView-specific public types,
and binds through `SheetViewDataSource` or
`createSheetViewDataSourceFromWorkbook()` instead of re-exporting the canonical
Workbook type from its public package surface.

Other named views such as kanban, calendar, timeline, gallery, and chart views
are workspace app/UI experiments or reserved directions, not shipped public view
packages.

## Shell and UI Layer

`@mog/shell` and `@mog/ui` are reserved workspace packages with `private: true`.
They own workspace-level chrome and UI services: focus, app/session
composition, global UI state, and reusable components. Shell and UI sit above
views and kernel, and apps compose them through package exports rather than
through deep source imports.

## Apps Layer

Workspace applications own product-specific chrome, commands, dialogs, and
workflow orchestration. `apps/spreadsheet` (`@mog/app-spreadsheet`) is the
private default spreadsheet app. It composes contracts, kernel APIs, shell/UI,
SheetView, and lower-level engines where app-level integration needs them.

## Runtime Facades

Runtime packages expose public SDK and embed entry points, choose host/runtime
adapters, and pass explicit transport configuration into the kernel.

- `runtime/sdk` publishes `@mog-sdk/sdk` for headless automation. Package
  exports select the native Node entry in Node and WASM entries for
  Workers/web-standard runtimes; explicit `./node`, `./wasm`, and `./workerd`
  subpaths are available for hosts that need to force the binding.
- `runtime/embed` publishes `@mog-sdk/embed` for read-only browser embeds. Its
  React, web-component, and config subpaths are public-experimental.
- `runtime/spreadsheet-app` publishes `@mog-sdk/spreadsheet-app` for trusted
  same-origin full-app embeds. It is the intentional public wrapper around
  private spreadsheet app and shell implementation code.

Browser and Workers paths use WASM, Node/native paths use N-API, and desktop
paths use Tauri IPC when running inside a Tauri host.

## Package Boundaries

TypeScript workspaces are declared in `pnpm-workspace.yaml`; Rust crates are
declared in the root `Cargo.toml`. Public package disposition is tracked in
`tools/package-inventory.jsonc` and package manifests. Source-level import
direction is enforced by `tools/eslint-plugin-mog/import-boundaries.cjs`, while
package publication and export metadata are checked by the package validation
tools.

## Compute Bridge

The compute bridge is how the workspace-internal kernel communicates with the
Rust engine. `ComputeBridge` is a TypeScript composition root that delegates
lifecycle, sync, viewport, and mutation handling to `ComputeCore` and generated
bridge methods. The transport layer provides WASM for browsers, Tauri IPC for
desktop hosts, and N-API for Node/headless runtimes; callers use the same async
bridge API regardless of target.

## CRDT and Collaboration

Yrs-backed CRDT state lives on the Rust compute/document side, with TypeScript
lifecycle and provider code carrying update bytes, state vectors, recovery
state, and host-backed storage policy. Collaboration support also includes Rust
crates for sync primitives, multi-participant coordination, awareness, and
locks. Hosts are responsible for routing collaboration updates between clients.

## Cell Identity Model

Cells, rows, and columns have stable identities; positions are mutable.
TypeScript contracts expose branded string IDs, while Rust stores compact
identity values internally and serializes them as UUID strings or compact hex
keys depending on the boundary. Formula identity references are the source of
truth for structure-aware formulas. A1 text remains the user-facing display,
search, and file-format form and may be regenerated for display/export/cache as
row and column positions change.

## Related Docs

- [Architecture (detailed)](../architecture/README.md) — full architecture document
- [Compute Bridge](../architecture/compute-bridge.md) — bridge internals
- [TypeScript Package Boundaries](../architecture/typescript-package-boundaries.md) — workspace dependency rules
- [Package Structure](../architecture/os/packages.md) — package inventory overview
- [Cell Identity](../internals/spreadsheet/cell-identity.md) — identity model details
