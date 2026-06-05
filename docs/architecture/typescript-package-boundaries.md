# TypeScript Package Boundary Guidelines

TypeScript packages should behave like Rust crates: one source of truth,
explicit dependencies, and an import surface that consumers cannot accidentally
bypass.

Rust gets this mostly for free from `Cargo.toml` and `rustc`. TypeScript splits
the same responsibility across `package.json`, `tools/package-inventory.jsonc`,
`tsconfig.json`, bundler config, generated declarations, packed manifests, and
workspace resolution. Those surfaces must agree.

## Status And Scope

This page is a workspace boundary guide. It is not the package inventory. The
current machine-readable source for package disposition is
`tools/package-inventory.jsonc`, with enforcement in `tools/validate-packages.mjs`
and `tools/eslint-plugin-mog/import-boundaries.cjs`.

Current TypeScript package status:

| Status | Current examples |
| --- | --- |
| public package targets | `@mog-sdk/sdk`, `@mog-sdk/contracts`, `@mog-sdk/sheet-view`, `@mog-sdk/spreadsheet-app`, and `@mog-sdk/embed` are inventory `ship-public` packages; `@mog-sdk/embed` currently exposes public-experimental entrypoints |
| shipped binary wrappers | `@mog-sdk/wasm`, `@mog-sdk/darwin-arm64`, `@mog-sdk/darwin-x64`, `@mog-sdk/linux-arm64-gnu`, `@mog-sdk/linux-arm64-musl`, `@mog-sdk/linux-x64-gnu`, `@mog-sdk/linux-x64-musl`, `@mog-sdk/win32-x64-msvc` |
| public-experimental subpaths | `@mog-sdk/embed/react`, `@mog-sdk/embed/web-component`, `@mog-sdk/embed/config`, many `@mog-sdk/contracts/*` subpaths, `@mog-sdk/spreadsheet-app/styles.css`, `@mog-sdk/spreadsheet-app/mog-embed.css` |
| workspace-internal packages | `@mog-sdk/kernel`, `@mog/kernel-host-internal`, `@mog/types-*`, `@mog-sdk/types-*`, `@mog/transport`, `@mog/charts`, `@mog/table-engine`, `@mog/spreadsheet-utils`, `@rust-bridge/client` |
| reserved packages | `@mog/shell`, `@mog/ui` |
| private product package | `@mog/app-spreadsheet` |
| bundle-only packages | `@mog/canvas-engine`, `@mog/grid-renderer`, `@mog/grid-canvas`, drawing/canvas packages |

`@mog-sdk/kernel` is the canonical TypeScript implementation package, but its
manifest is currently `private: true` and its inventory disposition is
`workspace-internal`. Public examples should use the shipped facades, especially
`@mog-sdk/sdk`, `@mog-sdk/contracts`, `@mog-sdk/sheet-view`,
`@mog-sdk/spreadsheet-app`, and `@mog-sdk/embed`.

## Core Rule

If a consumer can import it from a package boundary, it must be an intentional
`package.json` export backed by source-generated or source-projected types and
classified in `tools/package-inventory.jsonc` when the package is public.

If a subpath is not exported by `package.json`, importing it is a boundary
violation. If a subpath is exported only for workspace use, it must not appear in
the packed public manifest.

## Required Shape

Every TypeScript package must keep these surfaces aligned:

| Surface | Role |
| --- | --- |
| `tools/package-inventory.jsonc` | Package disposition (`ship-public`, `binary-wrapper`, `workspace-internal`, `reserved`, `private`, `bundle-only`, etc.) and export disposition (`public-experimental`, `workspace-private-friend`, or `reserved`) |
| `package.json` `dependencies` | Runtime/package dependency graph |
| `package.json` `exports` | Import paths, equivalent to crate module boundaries |
| packed `package.json` | Public npm surface after development conditions and private friend exports are stripped |
| `tsconfig.json` references or declaration inputs | TypeScript build graph for packages that use project references; public facades may intentionally consume built declarations |
| `src/**` | Source of truth for implementation and authored contract types |
| generated `dist/**/*.d.ts` | Compiler or generator metadata emitted from source, not a second contract |
| bundler config | Runtime JavaScript artifact graph and package-local build aliases |

These surfaces must describe the same graph. A type that exists in `src`, but is
missing from `exports`, missing from emitted declarations, leaked from an
internal package into public declarations, or manually redefined in `dist`, is a
broken package contract.

Generated package declarations must not be written back into `src/**` as public
facades. Source-side `.d.ts` files are allowed only for intentional ambient
declarations, generated bridge/binary binding files that are the package's
source artifact, or package-local test/tool declarations. Package declaration
output belongs in `dist/**` or an ignored temporary build directory.

## Non-Negotiables

### 1. Do Not Handwrite Public Declaration Facades

Public `.d.ts` files must be emitted from source or generated from a canonical
source such as TypeScript source, projected type shards, package-owned
`public-types.ts`, API Extractor output, or Rust bridge metadata. Do not maintain
parallel handwritten `dist/*.d.ts` contracts for package exports.

Allowed:

- `tsc` declaration emit from source.
- Declaration bundling that consumes source-emitted declarations.
- Projection of private type shards into a public owner, as
  `@mog-sdk/contracts` does for `@mog/types-*` declarations.
- Public facade generation from package-owned source, such as
  `runtime/spreadsheet-app/src/public-types.ts`.
- Generated TypeScript types from canonical Rust sources, such as `bridge-ts`
  output.

Not allowed:

- Simplified `dist/*.d.ts` facades that drift from `src`.
- Generated `src/**/*.d.ts` public facades beside real `.ts` sources.
- Public declarations that import workspace-internal packages such as
  `@mog/*`, `@mog/types-*`, `@mog-sdk/types-*`, or `@rust-bridge/*`.
- Consumer-side casts to compensate for stale package declarations.

### 2. One Package Owns Each Contract

A contract type has exactly one canonical owner. Other packages may re-export
it, project it into a public package, or consume it, but must not redefine an
overlapping shape.

Current ownership examples:

- Public workbook and worksheet contracts are owned by
  `@mog-sdk/contracts/api`, backed by `types/api/src/api/**`.
- Public core cell identities and values are owned by
  `@mog-sdk/contracts/core`, backed by `types/core/src/**`.
- Public spreadsheet app embed contracts are owned by
  `runtime/spreadsheet-app/src/public-types.ts` and emitted to
  `@mog-sdk/spreadsheet-app`.
- Kernel implementation types stay in `@mog-sdk/kernel` and must not leak into
  public facade declarations unless deliberately re-owned by a public contract.

If two packages need the same type, move the type to the correct lower-layer
contract package or re-export it from the public owner. Do not copy the shape.

### 3. Package Exports Are The Boundary

Use `package.json` `exports` as the authoritative import surface, with
`tools/package-inventory.jsonc` deciding whether the package or subpath is
public, public-experimental, workspace-internal, reserved, or private.

Good public imports:

```ts
import { createWorkbook } from '@mog-sdk/sdk';
import type { Workbook } from '@mog-sdk/contracts/api';
import { createSheetView } from '@mog-sdk/sheet-view';
import { createSpreadsheetRuntime } from '@mog-sdk/spreadsheet-app';
```

Good public-experimental imports:

```ts
import { MogSheet } from '@mog-sdk/embed/react';
import type { KeyboardInput } from '@mog-sdk/contracts/keyboard';
```

Bad for external consumers:

```ts
import { DocumentFactory } from '@mog-sdk/kernel/api';
import { ComputeCore } from '@mog-sdk/kernel/internal';
import { ShellHost } from '@mog/shell';
import { SpreadsheetApp } from '@mog/app-spreadsheet';
import { DocumentFactory } from '../../kernel/src/api/document/document-factory';
```

Deep imports into another package's `src`, `dist`, private implementation
folders, or unexported subpaths are boundary violations unless the importing
file belongs to that same package and the path is package-local.

### 4. Internal Surfaces Must Be Narrow Friend APIs

Internal subpaths are allowed only when there is a real trusted boundary that
cannot be public.

Rules:

- The subpath must be explicit and classified in `tools/package-inventory.jsonc`
  when it belongs to a public pack target.
- The exported symbol list must be narrow and documented.
- Allowed consumers must be named. For `workspace-private-friend` exports, the
  inventory must list allowed production, dev, or external dev consumers.
- Packed public manifests must strip `workspace-private-friend` exports.
- Apps, views, and general UI code must not import broad kernel internals.

Current friend/private examples:

| Subpath | Status | Allowed use |
| --- | --- | --- |
| `@mog-sdk/kernel/app-api` | workspace-private-friend | `@mog-sdk/spreadsheet-app` and `@mog/shell` composition code |
| `@mog-sdk/kernel/host-lifecycle-internal` | workspace-private-friend | `@mog/kernel-host-internal` and kernel host-integration tests |
| `@mog-sdk/embed/internal/views-host` | workspace-private-friend | dev/eval views-host integration only; stripped from public packs |
| `@mog-sdk/kernel/internal` | workspace-internal implementation | Monorepo implementation only; not a public or packed friend surface |

If an app or shell component repeatedly needs an internal symbol, create the
correct public contract or a narrow workspace-private-friend subpath instead of
deep-importing implementation files.

### 5. Project References Must Match Ownership

When a package uses `tsconfig.json` project references, the references must
follow package ownership and architecture direction. Do not solve reference
errors by broadening `rootDir`, adding another package's `src` to `include`, or
path-mapping package imports to source internals.

Required:

- Each package compiles only files under its own source root.
- Cross-package imports resolve through package exports and generated
  declarations.
- A package never compiles another package's implementation files as local
  source.
- Public facade packages may bundle private implementation packages only when
  their public declarations and packed manifest do not expose those private
  packages.

The source layer rule is enforced by `mog/import-boundaries`: lower layers cannot
import higher layers. Runtime facades are composition packages, but `runtime/embed`
core is still barred from importing spreadsheet app or shell chrome outside its
host-adapter boundary.

### 6. Runtime Exports And Type Exports Must Be Verified Together

For every public `package.json` export, validation should prove:

- the export target exists,
- the built JavaScript file exists,
- the built declaration file exists,
- the declaration was generated or projected from the canonical source,
- the packed manifest contains only the intended public subpaths,
- consumers can import the subpath using the package name outside the pnpm
  workspace,
- public declarations do not import workspace-internal packages.

Missing export targets, stale declarations, source-only subpaths in packed
manifests, or public declarations that mention private packages are package
contract bugs.

## Spreadsheet App Composition

`@mog-sdk/spreadsheet-app` is the important current composition case. It is a
shipped public package that packages the first-party spreadsheet app for trusted
same-origin hosts, but its source and dev build intentionally consume private
implementation packages such as `@mog/app-spreadsheet`, `@mog/shell`, and
`@mog-sdk/kernel`.

That does not make those packages public. The `@mog-sdk/spreadsheet-app`
boundary is valid only because its public package:

- exports only `.`, `./styles.css`, and `./mog-embed.css`,
- declares runtime dependencies only on public packages and third-party
  packages,
- emits public declarations from `src/public-types.ts`,
- keeps private shell, app, and kernel types out of public declarations,
- runs package-local boundary checks in `runtime/spreadsheet-app/scripts/check-boundary.mjs`.

Use this pattern only for deliberate runtime facades. It is not a general
permission for public packages to expose `@mog/*`, `@mog-sdk/kernel`, or source
deep imports.

## Fixing Type Errors

When a TypeScript error appears at a package boundary, fix the producer contract
before patching consumers.

Ask:

1. Which package owns this type or function?
2. What is its current inventory disposition: shipped, public-experimental,
   workspace-internal, reserved, private, or not shipped?
3. Is it exported by `package.json` and, for public packages, classified in
   `tools/package-inventory.jsonc`?
4. Is the declaration emitted or projected from the same canonical source?
5. Does the consumer import through the package boundary?
6. Will the packed manifest and external fixture still work outside the
   monorepo?

Do not use `as any`, `as unknown`, local aliases, or local callback annotations
to hide a broken producer declaration. Those fixes silence one consumer while
leaving the next consumer broken.

## Read-Only Boundary Checks

Relevant existing gates include:

```bash
pnpm validate:packages
pnpm lint:boundaries
pnpm build:public-artifacts
pnpm check:declaration-rollups
pnpm check:api-snapshots
pnpm check:external-fixtures -- --skip-build
```

Those commands are listed as the maintained gates, not as commands that every
small doc edit must run. For a documentation-only update, read-only checks
against the manifests, source, scripts, and fixtures are usually enough.

## Cargo-Like Target

The desired steady state is:

```text
package-inventory.jsonc = disposition and friend/public classification
package.json exports    = package import boundary
packed package.json     = npm-visible public boundary
src/**                  = source of truth
declaration emit/rollup = generated or projected metadata
tsconfig references     = compile graph where references are used
pnpm workspace deps     = package graph
bundler config          = JavaScript artifact graph
external fixtures       = consumer-visible proof
```

All surfaces must agree. When they do, TypeScript packages become predictable in
the same way Rust crates are predictable.
