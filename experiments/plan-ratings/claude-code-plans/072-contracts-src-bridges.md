# 072 — Improve `mog/contracts/src/bridges` (public bridge re-export surface)

## Source folder and scope

- **Folder:** `mog/contracts/src/bridges`
- **Package:** `@mog-sdk/contracts` (the published SDK contract package). This folder is exposed as the subpath export `@mog-sdk/contracts/bridges` (`mog/contracts/package.json` → `"./bridges"` → `./src/bridges/index.ts`, with `dist/bridges/index.{d.ts,js}` for the built form).
- **Files in scope (9):**
  - `index.ts` — barrel.
  - `chart-bridge.ts`, `diagram-bridge.ts`, `equation-bridge.ts`, `locale-bridge.ts`, `pivot-bridge.ts`, `schema-bridge.ts`, `text-effect-rendering-bridge.ts` — type-only re-export shims (each `export type * from '@mog/types-bridges/<name>'`, 4 lines).
  - `ink-recognition-bridge.ts` — **the outlier**: 162 lines, a *verbatim copy* of `mog/types/bridges/src/ink-recognition-bridge.ts` rather than a shim.
- **In scope:** the shim/barrel wiring, the value re-export of `DEFAULT_RECOGNITION_THRESHOLDS`, and the consistency of the shim pattern across the folder.
- **Out of scope (named only for coupling, not edit targets):** the contract *source of truth* in `mog/types/bridges/src/**` (that is plan 007's folder); bridge *implementations* in `mog/kernel/src/bridges/**`, `mog/kernel/src/domain/**`, and `mog/engine/src/state/bridges/**`; consumers in `kernel`; api-extractor / rollup configs. Any change requiring those is flagged below as a cross-folder dependency.

## Current role of this folder in Mog

`@mog/types-bridges` (workspace-internal, **unpublished** — see the negative fixture `mog/fixtures/external/negative/types-star-import/smoke.ts`, which asserts `@mog/types-bridges` must fail to resolve outside the monorepo) is the source of truth for the adapter contracts between the host runtime and external engines (`IChartBridge`, `IPivotBridge`, `ISchemaBridge`, `ILocaleBridge`, `IDiagramBridge`, `IEquationBridge`, `IInkRecognitionBridge`, `ITextEffectRenderingBridge`, plus their data/result types).

`mog/contracts/src/bridges` is the **thin, published re-export surface** over that internal package: it is how external SDK consumers (and, today, `mog/kernel`) name these bridge contracts via the stable `@mog-sdk/contracts/bridges` path without importing the unpublished `@mog/types-bridges` directly. Eight of the nine files are correct one-line type-only shims. The folder therefore should carry **zero original contract definitions** — it is a façade.

This invariant is currently broken in exactly one place: `ink-recognition-bridge.ts` is a full duplicate of the upstream source (confirmed byte-identical via `diff`), and `index.ts` re-exports the runtime value `DEFAULT_RECOGNITION_THRESHOLDS` from that *local copy* (`export { DEFAULT_RECOGNITION_THRESHOLDS } from './ink-recognition-bridge'`) instead of from the package.

## Why the duplication exists (root cause)

The migration of bridge contracts into `@mog/types-bridges` converted each contracts file into `export type * from '@mog/types-bridges/<name>'`. `export type *` carries **types only** — it cannot re-export a runtime value. `ink-recognition-bridge.ts` is the only bridge module with a runtime value export (`DEFAULT_RECOGNITION_THRESHOLDS`; confirmed it is the *sole* non-type export across all of `mog/types/bridges/src/*.ts`). Because the type-only shim could not carry that value, the migration left the entire file copied in place rather than splitting the value re-export onto its own line. The result is a 162-line verbatim duplicate that is guaranteed to drift from the upstream contract over time, with no guard preventing the drift.

The comparable, correctly-handled case already exists in the same package: `mog/contracts/src/rendering/grid-renderer.ts` re-exports the runtime enum `RenderPriority` with a *separate* value statement (`export { RenderPriority }`) alongside its `export type` lines. The fix is to apply that same dual-treatment pattern to ink-recognition.

## Improvement objectives

1. **Restore the façade invariant:** `mog/contracts/src/bridges` must contain no original contract definitions — every member resolves to `@mog/types-bridges`. Eliminate the verbatim duplicate so there is a single source of truth for the ink-recognition contract.
2. **Re-export the one runtime value correctly** (`DEFAULT_RECOGNITION_THRESHOLDS`) through the package, not a local copy, using the established split-value-export pattern.
3. **Make the shim pattern uniform** across all nine files so the folder reads as one mechanical convention (type-only `export type *`, plus a separate value re-export only where a runtime value exists upstream).
4. **Add a structural guard** so a non-shim file (or a dropped value export) cannot silently reappear in this folder — closing the gap that let the duplicate persist undetected.

These are production-path changes to the published contract surface: they change what `@mog-sdk/contracts/bridges` compiles and bundles, and they remove a drift hazard on a public boundary. No behavior changes for any consumer (the re-exported symbols and their identities are unchanged).

## Production-path contracts and invariants to preserve or strengthen

- **Public API stability of `@mog-sdk/contracts/bridges`.** The set of exported symbols and their types/values must be **identical before and after**. Consumers (e.g. `mog/kernel/src/domain/drawing/ink-recognition-bridge.ts` and its test, which do `import { DEFAULT_RECOGNITION_THRESHOLDS } from '@mog-sdk/contracts/bridges'`) must continue to resolve the same value with the same shape. *Strengthen:* `DEFAULT_RECOGNITION_THRESHOLDS` becomes a single referenced constant rather than two independent literals that can diverge.
- **Value identity.** `DEFAULT_RECOGNITION_THRESHOLDS` re-exported from the package must remain the same object reference the upstream module defines (a plain re-export, not a re-declaration), so any consumer relying on identity/spread semantics is unaffected.
- **Type-only star re-export discipline.** Keep `export type *` for the pure-type modules; use a separate `export { ... }` line only for genuine runtime values. Do not switch the type modules to `export *` (would broaden emit and risk pulling values).
- **Boundary direction.** `contracts` may depend on `@mog/types-bridges`; the reverse is forbidden (enforced by `mog/tools/eslint-plugin-mog/import-boundaries.cjs`). Preserve.
- **Subpath export contract.** `mog/contracts/package.json` exposes only `./bridges` (the barrel) for this folder — there are no per-file subpath exports for `contracts/src/bridges/*` (unlike `@mog/types-bridges`, which exposes each). The fix must not require adding new subpaths.
- **Build form.** The shims compile to `dist/bridges/index.{d.ts,js}`; the fix must keep the barrel emitting the same rolled-up declarations (api-extractor rollup must still see the value export).

## Concrete implementation plan

### Step 1 — Convert `ink-recognition-bridge.ts` into a true shim (the core fix)

Replace the entire 162-line body of `mog/contracts/src/bridges/ink-recognition-bridge.ts` with the dual-treatment shim, mirroring the other eight files plus the `grid-renderer.ts` value-export precedent:

```ts
/**
 * Re-export shim. Source lives in @mog/types-bridges (types/bridges/src/ink-recognition-bridge.ts).
 */
export type * from '@mog/types-bridges/ink-recognition-bridge';
export { DEFAULT_RECOGNITION_THRESHOLDS } from '@mog/types-bridges/ink-recognition-bridge';
```

This deletes the duplicated `ShapeRecognitionResult`, `TextRecognitionResult`, `RecognitionThresholds`, `IInkRecognitionBridge`, and the literal copy of `DEFAULT_RECOGNITION_THRESHOLDS`, collapsing the file to the package's single definition. Header comment matches the format already used in the sibling shims.

### Step 2 — Point the barrel's value re-export at the package

In `mog/contracts/src/bridges/index.ts`, change:

```ts
export { DEFAULT_RECOGNITION_THRESHOLDS } from './ink-recognition-bridge';
```

Either leave it as-is (now that `./ink-recognition-bridge` re-exports the value from the package, this line is correct and consistent) **or** repoint it directly at the package for clarity:

```ts
export { DEFAULT_RECOGNITION_THRESHOLDS } from '@mog/types-bridges/ink-recognition-bridge';
```

Prefer keeping it routed through the local shim (`./ink-recognition-bridge`) so the barrel stays symmetric with how the type star (`export type * from '@mog/types-bridges/bridges'`) already aggregates everything, and so there is exactly one place naming the package subpath per concern. Document the choice in the file comment. Either way, the line `export type * from '@mog/types-bridges/bridges'` continues to provide all the types; only the value statement is in question.

### Step 3 — Verify subpath consistency

`@mog/types-bridges` exposes `./ink-recognition-bridge` as a subpath export (confirmed in `mog/types/bridges/package.json`), so the new import resolves under both the `development` condition (`./src/...`) and the built `import`/`types` conditions (`./dist/...`). No package.json edits are required in either package. (Confirm during review; do not edit package files as part of this plan.)

### Step 4 — Add a structural guard against re-introduction (production-path, in `mog-internal` test surface)

Add a lightweight repository check that asserts the façade invariant for `mog/contracts/src/bridges`:

- Every file except `index.ts` must contain only re-export statements pointing at `@mog/types-bridges/*` (no `interface`/`type X =`/`const`/`class`/`function` *declarations*).
- Any runtime (value) export in this folder must originate from a `@mog/types-bridges` re-export, not a local literal.

Implement as either (a) an entry in the existing mog eslint plugin (`mog/tools/eslint-plugin-mog/`) — preferred, since `import-boundaries.cjs` already lives there and runs in CI — restricting declarations within `contracts/src/bridges/**`; or (b) a small structural unit test in the contracts package test suite. This is the guard whose absence allowed the duplicate to persist; it is part of the production fix, not a substitute for it.

> Note on scope: per the task's edit constraints, this plan file is the only artifact this worker writes. Steps 1–4 describe the production change to be executed by an implementing change-set; they are not performed here.

## Tests and verification gates

1. **Typecheck the contracts package** (`tsc -b` for `@mog-sdk/contracts`) — the shim must resolve all previously-exported types from `@mog/types-bridges/ink-recognition-bridge`.
2. **Typecheck/build downstream consumers** — `mog/kernel` (notably `mog/kernel/src/domain/drawing/ink-recognition-bridge.ts`, which spreads `...DEFAULT_RECOGNITION_THRESHOLDS`) must compile unchanged.
3. **Existing kernel test** `mog/kernel/src/bridges/__tests__/ink-recognition-bridge.test.ts` (asserts `getThresholds().ellipse === DEFAULT_RECOGNITION_THRESHOLDS.ellipse`, etc.) must still pass, proving value identity/shape is preserved.
4. **Public-API surface diff** — run the contracts api-extractor/rollup and confirm the rolled-up `dist/bridges/index.d.ts` exports the *same* symbol set (types + the one value) as before. Zero net change to the public surface is the success criterion.
5. **New structural guard** (Step 4) passes on the fixed tree and fails on a synthetic reintroduced declaration / dropped value export.
6. **Boundary lint** (`import-boundaries.cjs`) stays green — no new disallowed import directions.

Note: this planning worker does not run any of these gates (build/test/typecheck are prohibited for this run); they are the acceptance criteria for the implementing change.

## Risks, edge cases, and non-goals

- **Risk — value re-export through `export type *` confusion.** The whole bug stems from `export type *` not carrying values. The fix must keep the value on its own `export { ... }` line; a reviewer should confirm `DEFAULT_RECOGNITION_THRESHOLDS` is still a runtime export of `@mog-sdk/contracts/bridges` (not accidentally demoted to a type) — gate 4 covers this.
- **Risk — build-condition mismatch.** Under the `development` export condition, consumers read `@mog/types-bridges/src/*` directly; under the published condition they read `dist/*`. Both must expose `ink-recognition-bridge`. Confirmed present in `mog/types/bridges/package.json`; flagged as a review check (Step 3).
- **Edge case — api-extractor rollup of a re-exported value.** Some rollup configs treat re-exported runtime values differently from in-file declarations. Gate 4 (surface diff) catches any change in how the value lands in the rollup.
- **Drift already latent.** The two ink files are byte-identical *today*; the value of this fix is preventing the next edit to the upstream contract from silently diverging from the published copy. The structural guard (Step 4) is what makes the fix durable rather than a one-time cleanup.
- **Non-goals:** Do **not** redesign the bridge interfaces, error/result models, or async conventions — those are plan 007's territory (the `@mog/types-bridges` source). Do not change the consumer import path used by kernel, add new subpath exports, or alter the threshold default values. No compatibility shim or temporary alias is needed — this is a clean, behavior-preserving consolidation.

## Parallelization notes and dependencies on other folders

- **Sequence with plan 007 (`mog/types/bridges/src`).** 007 explicitly lists `mog/contracts/src/bridges/**` as out of scope and notes the dual-treatment requirement for the one value export. This plan (072) is the complementary contracts-side fix. They touch disjoint files and can land in either order; if 007 lands first and (per its objectives) keeps the package side type-only with the single intentional value export, 072 applies cleanly on top. The only coordination point is the shared symbol `DEFAULT_RECOGNITION_THRESHOLDS` — if 007 ever renamed/moved it, 072's re-export line must follow (a rename would also ripple to kernel consumers; treat as a coordinated change).
- **No dependency on kernel/engine.** Implementations are unaffected because the public symbol set is unchanged; consumers need only recompile.
- **Independent of other contracts subfolders** (`api`, `rendering`, `runtime`, etc.). `grid-renderer.ts` is referenced only as the precedent pattern, not edited.
- **Parallelizable steps:** Step 1 (shim) and Step 4 (guard) are independent of each other and of 007; Step 2 depends on Step 1; Step 3 is a review/confirm-only check with no code change in this package.
