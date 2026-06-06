# Plan 055 — Realign the XLSX TypeScript bridge to the generated Rust contract

## Source folder and scope

- **Folder:** `mog/file-io/xlsx/bridge/src`
- **Package:** `@mog/xlsx-parser` (`mog/file-io/xlsx/bridge/package.json`)
- **Files in scope (the entire `src` tree):**
  - `index.ts` — public barrel (type + value re-exports)
  - `types.ts` — 2,391 lines; mixes generated re-exports with a large hand-written type tree
  - `progress.ts` — `ProgressTracker`, progress reporters, cancellation/estimate helpers
  - `mog-sdk-wasm.d.ts` — ambient `@mog-sdk/wasm` module declaration
  - `worker/index.ts`, `worker/types.ts`, `worker/parse-worker.ts` — Web Worker / `worker_threads` orchestration
  - `xlsx-parser/core.ts`, `xlsx-parser/data-validation.ts` — small runtime helpers
- **Out of scope but referenced:** the generated single-source-of-truth `mog/infra/rust-bridge/bridge-ts/generated/xlsx-types.ts` (consumed via the `@mog/bridge-ts` workspace symlink), the Rust parser (`mog/file-io/xlsx/parser`), the unified WASM module `@mog-sdk/wasm`, and the tooling consumers under `mog/file-io/xlsx/tooling`.

This plan touches a public Mog source folder; all planning/internal commentary stays in `mog-internal`.

## Current role of this folder in Mog

`package.json` describes the package as the *"TypeScript bridge for the Rust XLSX parser — WASM lifecycle, XML/ZIP bridges, worker orchestration."* In practice the folder provides three things:

1. **A TypeScript type surface** for the XLSX parser's output (`types.ts`, re-exported through `index.ts`).
2. **A Web Worker harness** (`worker/parse-worker.ts` + `createWorkerParser`) that loads `@mog-sdk/wasm`, calls `xlsx_parse_full`, and relays progress/cancellation/result over `postMessage`.
3. **Progress/cancellation utilities** (`progress.ts`) and **misc helpers** (`xlsx-parser/core.ts`, `data-validation.ts`).

Evidence gathered for this plan shows the folder's stated role and its actual production role have diverged:

- **The production import path does not go through this package's worker.** The app imports XLSX via the kernel document lifecycle (`kernel/src/document/document-lifecycle-system.ts` → `hydrateXlsx` / `createFromXlsx`) and the transport command `xlsx_parse_full` (Tauri: `infra/platform/tauri/xlsx.ts` calls `transport.call('xlsx_parse_full')` and returns `ImportXlsxResult`, *not* the bridge's `FullParseResult`). A repo-wide search finds **zero non-tooling, non-test importers** of `createWorkerParser`, `parse-worker`, or the worker entry. The only runtime consumers of `ProgressTracker`, `estimateCellCount`, `estimateZipEntries`, and `createProgressReporter` are `mog/file-io/xlsx/tooling/tests/cancellation.test.ts` and the benchmark scripts under `mog/file-io/xlsx/tooling`.
- **The hand-written type tree has drifted from the generated contract and from real Rust output.** `types.ts` simultaneously re-exports the generated `WasmFullParseResult` / `WasmFullParsedSheet` (`types.ts:52-55`) **and** hand-maintains a separate `FullParseResult` (`types.ts:176-210`) plus ~2,000 lines of supporting interfaces. These two shapes disagree materially (see below). The hand-written `FullParseResult` is what `worker/types.ts` (`ParseSuccessMessage.result`, line 99) and `createWorkerParser` advertise to callers.

So today the package is best understood as: an authoritative-looking but partially stale **type contract** plus a **tooling-only worker harness**. The improvement target is to make the contract genuinely authoritative and the worker honest, so the package can be trusted as the single TypeScript view of the Rust XLSX parser.

## Improvement objectives

1. **Eliminate type drift.** Make the generated `mog/infra/rust-bridge/bridge-ts/generated/xlsx-types.ts` the *only* source of truth for parser output shapes. The bridge should re-export those types, not maintain a parallel hand-written copy that silently disagrees.
2. **Make the worker's result type correct.** `parse-worker.ts` and `worker/types.ts` must type the `xlsx_parse_full` return value as the real generated result, not the drifted `FullParseResult`.
3. **Make worker progress and cancellation honest.** Stop emitting fabricated progress percentages around a single synchronous WASM call; report only what is actually known, and document the cancellation semantics truthfully.
4. **Forward parse options without silent loss.** Every documented `FullParseOptions` field must reach the WASM call (or be explicitly, visibly dropped), via a single typed adapter rather than an inline ad-hoc literal.
5. **Resolve orphaned helpers.** `xlsx-parser/core.ts` and `xlsx-parser/data-validation.ts` either serve a real production consumer or leave the public surface; no duplicated, unreferenced utilities.
6. **Type the WASM boundary.** Replace `wasmModule: unknown` + `@ts-expect-error`/`@ts-ignore` dynamic property access with a declared `WasmXlsxModule` interface, so a Rust signature change surfaces as a TypeScript error at the bridge.

Non-objective: rewriting the parser, changing OOXML semantics, or changing how the app currently imports files. This plan strengthens the bridge's contract; it does not migrate the production path onto the worker (that is flagged as a separate, dependency-laden decision in *Risks*).

## Production-path contracts and invariants to preserve or strengthen

These are the externally observable guarantees the package makes; the work must preserve or tighten them, never weaken them:

- **Public export identity (preserve).** All names currently exported from `index.ts`, `worker/index.ts`, and the package `exports` map (`.`, `./progress`, `./types`, `./worker/types`, `./xlsx-parser/core`, `./xlsx-parser/data-validation`) must keep resolving. Any removal of an export is a breaking change and must be justified by proven non-use across the repo, with the removal noted explicitly (no silent drops).
- **`ParseErrorCode` enum + `XlsxParseError` (preserve).** These are consumed by `tooling/tests/cancellation.test.ts` and are the bridge's error vocabulary. Keep the string enum values (`'WASM_INIT_FAILED'`, etc.) stable; `createErrorMessage` (`worker/types.ts:279`) depends on matching `error.code` against them.
- **`CellRawValue = string | number | boolean | null` (preserve).** Documented to match `@mog-sdk/contracts`; do not narrow/widen without a contracts-side change.
- **Worker message protocol (preserve shape, tighten payload).** The discriminated unions `WorkerInboundMessage` / `WorkerOutboundMessage` and their `type` discriminators (`parse`/`cancel`/`terminate`/`progress`/`success`/`error`/`cancelled`/`ready`) and the type guards (`isReady`, `isProgress`, …) are the wire contract. Keep discriminators and guard names; only the `result` payload type changes (from drifted `FullParseResult` to the generated result type).
- **Generated-types-are-canonical invariant (strengthen).** After this work, *no* parser-output field shape may be hand-declared in `types.ts` if it also exists in the generated file. The bridge becomes a thin, additive layer (error vocabulary, option DTOs, worker protocol) on top of `@mog/bridge-ts/generated/xlsx-types`.
- **`sideEffects: false` (preserve).** The package is tree-shakeable; new code must remain side-effect free except the worker's top-level `self.onmessage` / `parentPort.on` registration, which already lives only in `parse-worker.ts`.
- **Import-boundary class `hardware` (preserve).** `tools/eslint-plugin-mog/import-boundaries.cjs:119` classifies `@mog/xlsx-parser` as `hardware`; new imports (e.g. from `@mog/bridge-ts`) must respect that layering.

### Concrete drift evidence to drive the work

The hand-written `FullParseResult` (`types.ts:176-210`) vs. the generated `FullParseResult` (`infra/rust-bridge/bridge-ts/generated/xlsx-types.ts`, the actual Rust output):

| Field | Hand-written (`types.ts`) | Generated (real Rust output) |
|---|---|---|
| `sharedStrings` | `SharedStringEntry[]` (string \| RichTextEntry) | `string[]` |
| `theme` | `ParsedTheme \| null` | `string \| null` (+ separate `themeColorScheme`, `themeFontScheme`, `themeFormatScheme`, `themePartPath`, raw `theme*Xml` byte sidecars) |
| `metadata` | required `WorkbookMetadata` | optional `MetadataOutput` |
| `calcChain` | present (`@deprecated`, always empty) | absent |
| `customProperties` / `vbaProject` / `activeSheetIndex` / `externalLinks` | present | absent (replaced by `docPropsCore`/`docPropsApp`/`docPropsCustom`, `richData`, `contentTypeDefaults`/`Overrides`) |
| `iterativeCalc` / `maxIterations` / `maxChange` | absent | present |
| `timelineCaches` | absent | present |

This table is the acceptance checklist: after the work, the bridge's exported result type must equal the generated one (the discrepancies above must vanish because the hand-written copy is gone).

## Concrete implementation plan

The work is sequenced so the type unification (highest value, lowest behavioral risk) lands first, then the worker correctness, then helper cleanup.

### Step 1 — Audit the hand-written `types.ts` surface against the generated file
- For every interface/type/enum in `types.ts`, classify it as:
  - **(a) Duplicate of a generated type** (e.g. `FullParseResult`, `FullParsedSheet`, `ParsedStyles`, `CellXf`, `ParsedFont`, conditional-formatting, data-validation, table, slicer, theme types). These get deleted and replaced by a re-export of the generated symbol (aliasing where the public name differs, mirroring the existing `WasmFullParsedSheet` alias pattern at `types.ts:52-55`).
  - **(b) Genuinely bridge-local** (`ParseErrorCode`, `XlsxParseError`, `ParserCapabilities`, `ParserConfig`, `CellRawValue`, `FullParseOptions`). These stay, but are reviewed so any *field types* inside them that reference parser-output shapes point at generated types.
  - **(c) Aliases the generated file does not expose under the public name** (e.g. `ParsedSlicerCellAnchor` at `types.ts:49`). Keep as thin `type X = ...` aliases over generated structures.
- Produce a name-by-name mapping (old public name → generated symbol) so `index.ts`'s large `export type { … }` block (lines 19-164) can be repointed without dropping any public name.

### Step 2 — Replace the duplicated type tree with re-exports
- Rewrite `types.ts` so category (a) names are `export type { GeneratedName as PublicName } from '@mog/bridge-ts/generated/xlsx-types'`. Delete the corresponding hand-written interfaces.
- Where a public name (e.g. `FullParseResult`, `FullParsedSheet`) collides with a generated name, prefer re-exporting the generated type under the public name and retiring the `Wasm*`-prefixed alias *or* keeping both as aliases of the same generated symbol (decide once, apply consistently) so `index.ts` consumers and `worker/types.ts` see one shape.
- Keep `index.ts`'s export list complete: every name it currently exports must still resolve (now sourced from generated types). This is a pure re-pointing; the barrel's shape to outside consumers is unchanged except that drifted fields become correct.

### Step 3 — Type the WASM boundary
- In `mog-sdk-wasm.d.ts` (or a new `worker/wasm-module.ts`), declare a `WasmXlsxModule` interface: `xlsx_parse_full(data: Uint8Array, options: WasmParseOptions): FullParseResult` and `xlsx_version(): string`, where `FullParseResult` is the generated result type and `WasmParseOptions` is the snake_case option DTO.
- In `parse-worker.ts`, replace `let wasmModule: unknown` (line 129) and the `@ts-expect-error` accesses (lines 272-273, 409-410) with a typed cast of the dynamic import to `WasmXlsxModule`. A future Rust signature change now fails typecheck here instead of silently producing wrong data.

### Step 4 — Centralize and complete option forwarding
- Extract the inline snake_case mapping in `parse-worker.ts` (lines 296-307) into a typed `toWasmParseOptions(options: WorkerParseOptions): WasmParseOptions` adapter (colocated with the `WasmXlsxModule` declaration).
- Audit field coverage: `maxStringBytes` is declared on `FullParseOptions` (`types.ts:2352`) but is **not** forwarded by the current literal. Either forward it (preferred, if the Rust option struct accepts it) or document in the adapter why it is intentionally dropped. The adapter's input/output types make any future omission a visible, reviewable decision rather than a silent gap.

### Step 5 — Make worker progress and cancellation honest
- The current code emits synthetic milestones (`{ phase: 'init', percentage: 0 }`, `'zip' 5`, `'xml' 20`, `'complete' 100` at `parse-worker.ts:269,279,291,316`) around a single **synchronous** `xlsx_parse_full` call that cannot yield mid-parse. These numbers are fiction.
- Replace with truthful reporting: emit `init` before the call and `complete` after, and mark intermediate phases as **indeterminate** (e.g. a single `parsing` phase with no fabricated percentage) unless/until the Rust parser exposes a real progress callback across the WASM boundary. Update `ParsePhase` / `ParseProgress` docs in `progress.ts` to state that percentages between start and completion are estimates, not measured.
- Correct the cancellation comments/semantics: the worker can only abort *before* and *after* the synchronous call (`parse-worker.ts:262-266,309-313`). Keep the `AbortController` bookkeeping (it correctly handles queued/pre-start cancels and `terminate`), but make the doc comment at lines 294-295 the authoritative, accurate description and remove any implication of mid-parse cancellation elsewhere.
- `ProgressTracker` and the `estimate*` helpers stay (they are tested and exported), but their doc comments are updated to clarify they model *estimated* progress for callers that drive their own loops, not measured parser progress.

### Step 6 — Resolve the orphaned helpers
- `xlsx-parser/core.ts` (`ParsedSheet`, `createEmptySheet`, `getCellKey`, `parseCellKey`) and `xlsx-parser/data-validation.ts` (`parseSqref`) have **no production importers**; the app has its own `parseCellKey` implementations (`apps/spreadsheet/src/domain/clipboard/clipboard-utils.ts`, `shell/src/machines/types.ts`, `apps/spreadsheet/src/systems/shared/types.ts`). The bridge's `ParsedSheet` interface is also a `Map`/`Set`-based shape that does **not** match the JSON-serializable generated `FullParsedSheet` the WASM actually returns, so it is actively misleading.
- Decision required (see *Risks → open question*): the production-correct outcome is to **remove these two modules from the public surface** (and their `exports` entries) because they neither match the real parse output nor have a consumer. If a future consumer is identified, instead move the chosen helper to that consumer's package. Do not leave a dead, shape-mismatched `ParsedSheet` advertised as the parser's sheet type.

### Step 7 — Refresh package docs to match reality
- Update the `package.json` `description` and the `@fileoverview` headers (`index.ts:1-9`, `types.ts:1-8`) so they describe the package as the *generated-contract re-export + worker harness*, not "XML/ZIP bridges" (no XML/ZIP code exists here — parsing is entirely in Rust, as the header already half-acknowledges).

## Tests and verification gates

This plan must not run build/test commands itself (planning constraint). The implementing change must pass the following gates, and the plan calls for **adding/strengthening** the listed tests where coverage is missing:

1. **Typecheck the package and the declaration rollup.** `@mog/xlsx-parser` and `@mog/bridge-ts` are composite/declaration-emitting packages; the generated types must be built before consumers typecheck (mirrors the contracts declaration-rollup gotcha). Verify the bridge typechecks against `@mog/bridge-ts/generated/xlsx-types` with no `any` leakage at the WASM boundary.
2. **Compile-time contract test (new).** Add a `// @ts-expect-error`-free assertion module (in the package's own test area, not in scope-restricted prod code) that the bridge's exported `FullParseResult` is assignable to and from the generated `WasmFullParseResult`, so future drift fails typecheck. This is the regression guard for Objective 1.
3. **Existing worker/progress tests stay green.** `mog/file-io/xlsx/tooling/tests/cancellation.test.ts` exercises `ProgressTracker`, `createProgressReporter`, `estimate*`, and the worker message guards — these must continue to pass; update them only where the honest-progress change (Step 5) intentionally alters emitted milestone values, and document each such change.
4. **Option-forwarding test (new).** Unit-test `toWasmParseOptions` so every `FullParseOptions` field maps to the expected snake_case key (and `maxStringBytes` is provably handled), guarding Objective 4.
5. **Worker round-trip smoke (tooling).** The existing tooling benchmarks/`xlsx-fidelity` scripts that call `createWorkerParser` must still parse a real fixture and return a result whose shape matches the generated type (catches a wrong-cast regression at runtime).
6. **Lint / import-boundary gate.** `eslint-plugin-mog` import-boundaries must still pass with `@mog/xlsx-parser` in the `hardware` class after the new `@mog/bridge-ts` imports.
7. **Public-surface diff review.** Diff the package `exports` map and `index.ts` export list before/after; any removed name (Step 6) must be accompanied by a repo-wide proof-of-non-use in the change description.

## Risks, edge cases, and non-goals

- **Risk: hidden runtime consumers of drifted fields.** Some tooling/test code may read fields that exist only on the hand-written type (`calcChain`, `customProperties`, `vbaProject`, `activeSheetIndex`, `theme: ParsedTheme`). Replacing the type with the generated shape will turn those reads into typecheck errors — which is the *point*, but each site must be migrated to the generated equivalent (e.g. `theme*` scheme fields, `docProps*`) rather than silenced. Enumerate these before deleting the hand-written types.
- **Edge case: `metadata` becomes optional** (`MetadataOutput?`) in the generated shape. Consumers that assume a non-null `metadata` need null handling; surface these via the typecheck.
- **Edge case: `sharedStrings` is `string[]`, not `string | RichTextEntry`.** Any consumer expecting rich-text entries in `sharedStrings` is relying on a shape the parser does not produce; migrate it to wherever rich text actually lives in the generated output.
- **Open question (needs a decision, not a workaround): should the production path adopt this worker?** Today production parses via the transport `xlsx_parse_full` command, and this package's worker is tooling-only. Two coherent end-states exist: (a) keep the worker as the canonical off-main-thread parse harness and wire the kernel import path through it, or (b) formally scope this package as "types + tooling harness" and stop implying it is the production bridge. This plan makes the package *correct and honest* under **either** choice; it does not unilaterally pick one, because (a) is a cross-folder architectural change touching the kernel document lifecycle and transport. Flagged as a dependency for the owning team.
- **Non-goals:** changing OOXML parsing/serialization semantics; modifying the Rust parser or the generated-types generator; altering how files are currently imported in the app; introducing compatibility shims or temporary re-declarations to "ease" the migration (the drift is removed outright, guarded by the compile-time contract test).

## Parallelization notes and dependencies on other folders

- **Hard dependency: `mog/infra/rust-bridge/bridge-ts` (generated types).** All re-export work depends on the generated `xlsx-types.ts` being current and built. If the Rust output structs change, regenerate there first; the bridge re-export is downstream-only and must not re-introduce hand-written copies.
- **Coordinate with `mog/file-io/xlsx/tooling`.** It is the sole runtime consumer of the worker/progress surface; the honest-progress change (Step 5) and any export removal (Step 6) must be landed together with updates to `tooling/tests/cancellation.test.ts` and the benchmark scripts.
- **Coordinate with the kernel import path owners** only if the open question above is resolved toward (a); otherwise the kernel/transport path is untouched by this plan.
- **Internal parallelism:** Steps 1-2 (type unification) and Step 6 (helper removal) are independent and can proceed in parallel. Steps 3-5 (WASM typing, option adapter, honest progress) all touch `parse-worker.ts` and should be done by one author to avoid churn. Step 7 (docs) is trivially parallel and can land last.

## Status

Not blocked. Evidence sufficient: the folder exists and was fully inspected, the generated contract was located and compared field-by-field, and the production/tooling consumer split was verified by repo-wide search. The single explicit decision deferred to owners is the open question on whether the production path should adopt the worker; the plan is valid and valuable regardless of how that is resolved.
