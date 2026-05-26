# TypeScript Package Boundary Guidelines

TypeScript packages should behave like Rust crates: one source of truth, explicit dependencies, and a public API that consumers cannot accidentally bypass.

Rust gets this mostly for free from `Cargo.toml` and `rustc`. TypeScript splits the same responsibility across `package.json`, `tsconfig.json`, bundler config, generated declarations, and workspace resolution. That split is historical, not architectural permission to let them disagree.

## Core Rule

If a consumer can import it, it must be an intentional package export backed by source-generated types.

If it is not exported by `package.json`, importing it is a boundary violation.

## Required Shape

Every TypeScript package must keep these surfaces aligned:

| Surface | Role |
| --- | --- |
| `package.json` `dependencies` | Runtime/package dependency graph |
| `package.json` `exports` | Public import paths, equivalent to crate module boundaries |
| `tsconfig.json` `references` | TypeScript build graph matching package dependencies |
| `src/**` | Source of truth for implementation and types |
| generated `dist/**/*.d.ts` | Compiler metadata emitted from source, not a second contract |
| bundler config | Runtime JavaScript output only, not type-contract authority |

These surfaces must describe the same graph. A type that exists in `src`, but is missing from `exports`, missing from emitted declarations, or manually redefined in `dist`, is a broken package contract.

Generated declarations must not be written back into `src/**`. Source-side `.d.ts` files are allowed only for intentional hand-authored ambient declarations that are tracked and owned as source. Package declaration output belongs in `dist/**` or in an ignored temporary build directory.

## Non-Negotiables

### 1. Do Not Handwrite Public Declaration Facades

Public `.d.ts` files must be emitted from source or generated from a canonical source such as Rust bridge metadata. Do not manually maintain parallel TypeScript type definitions for package exports.

Handwritten declaration facades create a second source of truth. They are the TypeScript equivalent of hand-writing Rust crate metadata.

Allowed:

- `tsc` declaration emit from source.
- Declaration bundling that consumes source-emitted declarations.
- Generated TypeScript types from canonical Rust sources, such as `bridge-ts`.

Not allowed:

- Manually defining public API shapes in scripts.
- Simplified `dist/*.d.ts` facades that drift from `src`.
- Generated `src/**/*.d.ts` facades beside real `.ts` sources.
- Consumer-side casts to compensate for stale package declarations.

### 2. One Package Owns Each Contract

A contract type has exactly one canonical owner. Other packages may re-export it, but must not redefine an overlapping shape.

Examples:

- Capability types should not be independently defined in `types/api`, `contracts`, `kernel/src`, and `kernel/dist`.
- App platform manifest types should not have separate shell-local and shared-package enum sets.
- Storage metadata types should be exported from the storage owner, not duplicated in shell.

If two packages need the same type, move the type to the correct lower-layer contract package and import it from there.

### 3. Package Exports Are The Boundary

Use `package.json` `exports` as the authoritative import surface.

Good:

```ts
import { KeyboardEventProcessor } from '@mog-sdk/kernel/keyboard';
import type { KeyboardInput } from '@mog-sdk/contracts/keyboard';
```

Bad:

```ts
import { KeyboardEventProcessor } from '@mog-sdk/kernel/internal';
import { DocumentFactory } from '../../kernel/src/api/document/document-factory';
```

Deep imports into another package's `src`, `dist`, or internal implementation folders are boundary violations unless the importing package is the same package.

### 4. Internal Surfaces Must Be Narrow Friend APIs

Internal subpaths are allowed only when there is a real trusted boundary that cannot be public.

Rules:

- The subpath must be explicit, such as `@mog-sdk/kernel/internal`.
- The exported symbol list must be narrow and documented.
- Consumers must be limited to trusted infrastructure packages such as shell host adapters, runtime adapters, or tests.
- Apps, views, and general UI code must not import internal kernel surfaces.

If an app or shell component repeatedly needs an internal symbol, create the correct public or workspace-private subpath instead.

### 5. Project References Must Match Ownership

`tsconfig.json` references must follow the same direction as package dependencies and architecture layers.

Do not solve reference errors by broadening `rootDir`, adding another package's `src` to `include`, or path-mapping package imports to source internals.

Required:

- Each package compiles only files under its own source root.
- Cross-package imports resolve through package exports and generated declarations.
- A package never compiles another package's implementation files as local source.

### 6. Runtime Exports And Type Exports Must Be Verified Together

For every `package.json` export, CI or package validation should prove:

- the export target exists in source,
- the built JavaScript file exists,
- the built declaration file exists,
- the declaration was generated from the canonical source,
- consumers can import the subpath using the package name.

Missing export targets, stale declarations, or source-only subpaths are package contract bugs.

## Fixing Type Errors

When a TypeScript error appears at a package boundary, fix the producer contract before patching consumers.

Ask:

1. Which package owns this type or function?
2. Is it exported by `package.json`?
3. Is the declaration emitted from the same source implementation?
4. Does the consumer import through the package boundary?
5. Is this public API, workspace-private API, or package-internal implementation?

Do not use `as any`, `as unknown`, local aliases, or local callback annotations to hide a broken producer declaration. Those fixes silence one consumer while leaving the next consumer broken.

## Cargo-Like Target

The desired steady state is:

```text
package.json exports  = public API boundary
src/**                = source of truth
tsc declaration emit  = generated metadata
tsconfig references   = compile graph
pnpm workspace deps   = package graph
bundler config        = JavaScript artifact graph
```

All six must agree. When they do, TypeScript packages become predictable in the same way Rust crates are predictable.
