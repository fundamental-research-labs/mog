# Plan 029 — Unify the function-catalog metadata model and parity surface (`mog/compute/core/crates/compute-functions/src`)

## Source folder and scope

- **Folder:** `mog/compute/core/crates/compute-functions/src`
- **Crate:** `compute-functions` (`publish = false`), described as "512+ Excel-compatible pure functions for the compute engine." ~58,900 lines of Rust across 301 files; ~472 `registry.register(...)` / `register_excel(...)` calls at startup.
- **Core abstraction files in scope:**
  - `lib.rs` — module graph, the `__internal` SPI feature gate, public re-exports (`ExcelFunction`, `RegisteredFunction`, `FunctionRegistry`, `ArgRole`/`ArgSpec`/`FunctionSignature`/`VariadicSpec`, `PureFunction`).
  - `trait_def.rs` — `PureFunction` (the trait 434 functions implement): `call`, `name`, `min_args`, `max_args`, `is_volatile`, `returns_array`, `default_for_arg`, `is_scalar_arg`.
  - `excel_function.rs` — `ExcelFunction` (only **8** implementors): adds `signature() -> &'static FunctionSignature`.
  - `signature.rs` — `ArgRole` (`Range`/`Criteria`/`Scalar`/`ArrayNative`), `ArgSpec`, `VariadicSpec`, `FunctionSignature` with `role_for_arg`/`propagates_error`.
  - `registered_function.rs` — `RegisteredFunction` enum reconciling the two traits; central `call` → array-lift → `call_inner` (signature-driven error propagation) dispatch.
  - `registry.rs` — `FunctionRegistry`: `Vec<RegisteredFunction>` + `FxHashMap<String,u16>` name→id; `_xlfn.`/`_xlfn._xlws.` normalization; arity gate in `call`; `register_all` fan-out into the 11 domain modules.
  - `array_lift.rs` — element-wise / zipped broadcast of `Scalar`-role array arguments.
  - `error.rs` — `FunctionsError`.
- **Domain modules in scope (LOC):** `statistical` (13,653), `financial` (7,121), `text` (6,865), `math` (5,592) + `math_primitives.rs`, `lookup` (5,358), `engineering` (4,521), `datetime` (3,108), `information` (1,657), `database` (1,169), `logical.rs` (579, flat), `web` (144), plus shared `helpers/` (coercion, criteria, caches, date_serial, column_index, power, hashing).
- **Adjacent code touched only as dependency / cross-folder contract (not edited under this plan):**
  - `mog/compute/core/src/eval/engine/eval_primitives.rs` — inline-dispatches ~50 **context-needing** functions (SUM/AVERAGE/COUNT aggregates, IF/AND/OR/NOT, IFERROR/IFNA, INDEX/MATCH/VLOOKUP/HLOOKUP/XLOOKUP/XMATCH, OFFSET/INDIRECT/ROW/COLUMN, LET/LAMBDA/MAP/REDUCE/SCAN/BYROW/BYCOL/MAKEARRAY, CELL/FORMULATEXT…) that need an evaluation context; falls through to `FunctionRegistry` for everything else.
  - `mog/compute/core/src/eval/mod.rs` — `GLOBAL_REGISTRY: LazyLock<FunctionRegistry>` singleton.
  - `mog/spreadsheet-utils/src/function-catalog.ts` (863 lines) + `function-registry.ts` — the hand-maintained TypeScript metadata mirror that drives autocomplete and `FunctionArgumentsDialog`. Its own header states: *"Source of truth for function names: compute-core/crates/compute-functions/src/ … Source of truth for inline-dispatched functions: eval_primitives.rs."*
  - `mog/compute/core/crates/types/value-types` (`CellValue`/`CellError`/`Array`), `compute-formats`, `compute-solver` — dependencies of this crate.
  - `mog/docs/internals/spreadsheet/known-formula-discrepancies.md` — the accepted-precision-difference register (KFD-001…).

This is a **production-path** plan for the function catalog and its parity surface. It is not a test-only, shim, or reduced-scope plan. No production code is edited by writing this document; the plan describes the production changes to make.

## Current role of this folder in Mog

`compute-functions` is the **pure, context-free half of Mog's Excel-compatible function engine**. Every function here is `(&[CellValue]) -> CellValue` with no evaluation context, no cell references, and no side effects. Functions that genuinely need a context (range materialization, async dependency evaluation, lambdas, volatile reference info) live upstream in `compute-core`'s `eval_primitives.rs`; everything else is registered here and reached through the `FunctionRegistry` fall-through.

`FunctionRegistry::new()` is built once into a process-wide `LazyLock` singleton and is read-only at evaluation time. It is the runtime **authority** on: which function names exist, their arity bounds, volatility, whether they return a dynamic array, default values for omitted optional args, and per-argument error-propagation / array-lifting behavior. The 8 `ExcelFunction` implementors (the `*IF`/`*IFS` family and array-native functions) carry full declarative `FunctionSignature` metadata; the other 434 `PureFunction` implementors carry only scalar booleans and hand-written error checks in their bodies.

The catalog this folder defines is also the **parity surface**: the set and behavior of functions Mog claims to match against the reference spreadsheet semantics. That surface is consumed three ways — (1) the Rust evaluator at runtime, (2) the inline context functions in `compute-core`, and (3) a separately hand-authored TypeScript catalog that powers formula autocomplete, argument tooltips, and the insert-function dialog.

## Improvement objectives

1. **Collapse the dual, divergent argument-metadata model into one declarative source.** Today argument semantics are split three ways: `FunctionSignature`/`ArgRole` (declarative, framework-enforced, **8 functions**); `PureFunction::is_scalar_arg(index) -> bool` (a single per-index lifting flag, **434 functions**); and hand-written `check_error`/coercion guards inside each function body (everyone). Error propagation and array-lifting for the 434 pure functions are therefore *not* declared anywhere a tool can read — they are re-implemented per function and easy to get subtly wrong or forget. Make a single declarative signature the source of truth for arity, per-argument role (error propagation), array-lifting, and default values for **all** registered functions.

2. **Make this crate the single machine-readable source of truth for the catalog/parity surface, and generate the TS mirror from it.** The Rust registry exposes only `name`/`min_args`/`max_args`/`is_volatile`/`returns_array`. Category, human description, and per-argument names/hints exist **only** in the hand-maintained `function-catalog.ts` (863 lines), with no machine-checked link back to the Rust catalog. New or renamed functions, changed arity, or changed variadic shape can ship in Rust and silently diverge from autocomplete/dialog metadata. Add category + description + argument metadata to the function definitions in this crate and expose a stable `catalog()` introspection API, so `function-catalog.ts` (and any other consumer) is **generated/verified** against Rust rather than re-typed by hand.

3. **Close the catalog-fragmentation gap with the inline-dispatched context functions.** ~50 functions (the entire aggregate/logical/lookup/lambda core) live in `eval_primitives.rs` and are invisible to this crate's registry, yet they are first-class parity-surface members. Define how their catalog metadata is registered/declared so the generated catalog (objective 2) is *complete* and the registry can answer "does this name exist / what is its arity" authoritatively for the whole surface — without moving their evaluation logic (which legitimately needs context).

4. **Establish a tracked parity ledger: coverage gaps + numerical-accuracy register, wired to a golden corpus.** Numerical functions lean on series approximations (`engineering/bessel.rs` Abramowitz & Stegun, `math/combinatorics.rs` Lanczos), `statrs`, and `nalgebra`; precision differences are recorded informally in `known-formula-discrepancies.md`. Create a function-level parity ledger (per function: implemented? known-discrepancy? reference-checked?) and a golden value corpus so regressions and coverage gaps are detectable in CI rather than discovered in user workbooks.

5. **Guarantee panic-freedom on adversarial input.** This crate runs inside wasm and is driven by arbitrary user formulas; a panic is a hard correctness/availability failure. Production-reachable `unwrap()/expect()` concentrate in `datetime/calendar.rs`, `datetime/workdays.rs`, `datetime/week.rs`, `helpers/` and `logical.rs` (most other occurrences are inside inline `#[cfg(test)]` modules and are not a risk). Prove, by audit plus fuzzing of `FunctionRegistry::call`, that no production path panics on any `&[CellValue]` (including `Error`, `Null`, ragged `Array`, NaN/∞, and extreme date serials), and convert any reachable panic into the appropriate `CellError`.

6. **Route all coercion through the shared contract.** `helpers/coercion.rs` is the intended single home for number/text/bool/error coercion, but individual functions still re-implement edge handling. Converge coercion on the shared helpers so blank-vs-zero, text-numeric, boolean-numeric, and error-passthrough rules are identical across the catalog (a frequent class of parity bug).

## Production-path contracts and invariants to preserve or strengthen

- **Purity.** Every function in this crate stays `(&[CellValue]) -> CellValue`: no context, no references, no I/O, no hidden mutable state. (Preserve — the metadata work must not smuggle context in. Volatile functions like RAND/RANDARRAY remain pure-of-context; volatility is a registry flag, not a side effect.)
- **Registry is total and never panics.** `FunctionRegistry::call` returns a `CellValue` for *every* input: `#NAME?` for unknown names, `#VALUE!` for arity violations, the function result otherwise. Strengthen objective-5 coverage so this totality holds for arbitrary argument values, not just arities.
- **Name normalization.** `_xlfn.` and `_xlfn._xlws.` prefixes are stripped before lookup; lookup is case-insensitive with an uppercase fast path. (Preserve — import/round-trip parity depends on it. Any new context-function registration (objective 3) must share this normalization.)
- **Error-propagation roles.** `Range`/`Scalar` arguments short-circuit on `CellValue::Error`; `Criteria` lets errors through (so `COUNTIF(range, #N/A)` counts `#N/A`); `ArrayNative` handles arrays itself. Whatever unified signature model objective 1 produces must reproduce these exact rules for the existing 8 `ExcelFunction`s **byte-for-byte**, and must default the 434 migrated functions to behavior identical to their current `is_scalar_arg` + body-check logic.
- **Array-lift semantics.** `array_lift::try_array_lift` runs only when `!returns_array()`; single-array fast path, multi-array zipped (not cross-product) broadcast with `#VALUE!` on incompatible non-1 dimensions, and `#N/A` fill for missing cells. Dynamic-array functions (`FILTER`/`SORT`/`UNIQUE`/`SEQUENCE`/`REGEXEXTRACT`/…) must keep `returns_array() == true` and skip lifting. (Preserve exactly; this is the dynamic-array spill contract.)
- **Function id semantics.** Ids are positional (`functions.len() as u16`), re-derived on every `FunctionRegistry::new()`, and never persisted across processes. Before any refactor that reorders registration, confirm (cross-folder) that no serialized artifact (saved formula, wire payload, cache key) references a function by numeric id; if confirmed runtime-only, document it as an invariant so future work can rely on it. (Verify, then preserve.)
- **Arity-gate ordering.** `call` checks `min_args`/`max_args` *before* dispatch; `default_for_arg` supplies omitted optionals (e.g. `LEFT` arg 1 → 1, `ROUND` arg 1 → 0). The unified signature must keep arity, defaults, and the gate in one consistent place. (Preserve/strengthen.)
- **`__internal` SPI boundary.** `helpers`, `math_primitives`, and `lookup` are public only under the `__internal` feature (enabled by `compute-core`); external consumers get them crate-private. `statistical::helpers::{percentile_exc, percentile_inc}` are intentionally public unconditionally (AGGREGATE func-nums 14–19). (Preserve — do not widen the public surface; new introspection APIs from objective 2 are additive and explicitly public.)
- **Determinism (non-volatile functions).** Same inputs → same output, independent of locale/time, except the registered volatile set. (Preserve; objective 4's golden corpus depends on it.)

## Concrete implementation plan

**Phase 0 — Evidence and contract pinning (must complete before any edit):**
- Enumerate the authoritative catalog: dump `FunctionRegistry::iter()` (id, name, min/max, volatile, returns_array) and diff against (a) every `name:` entry implied by `function-catalog.ts` and (b) the inline match arms in `eval_primitives.rs`. Produce the exact three-way drift set (in-Rust-only, in-TS-only, inline-only). This is the baseline objectives 2–3 must converge.
- Confirm function-id persistence: grep wire types, cache keys, and saved-document schemas for any numeric function id. Record the verdict as the id-stability invariant above.
- Snapshot current per-argument behavior for the 8 `ExcelFunction`s and a representative sample of the 434 `PureFunction`s (which args propagate errors, which lift) to serve as the migration oracle for objective 1.
- Classify all production-reachable `unwrap()/expect()` (exclude inline `#[cfg(test)]` modules) into "provably safe" vs "input-reachable," seeding objective 5.

**Phase 1 — One declarative signature for every function (objective 1):**
- Extend the signature model so a `PureFunction` can supply a `FunctionSignature` (per-arg `ArgRole` + variadic + arity + defaults). Default the trait method to derive today's behavior from `min_args`/`max_args`/`is_scalar_arg` so unmigrated functions are unchanged.
- Migrate `RegisteredFunction::call_inner` and `is_liftable_arg` to read roles uniformly from the signature for both enum arms, deleting the `is_scalar_arg`-vs-`ArgRole` divergence.
- Migrate functions domain-by-domain (smallest first: `web`, `logical`, `information`, `database`, then `text`/`math`/`lookup`/`statistical`/`financial`/`datetime`/`engineering`), asserting behavior-identity against the Phase-0 oracle at each step. The `*IF`/`*IFS` family keeps its exact current signatures.

**Phase 2 — Catalog metadata + introspection API (objective 2):**
- Add category, description, and per-argument `{name, description, optional, type}` metadata to function definitions (co-located with each function so it cannot drift from the implementation). Reuse the compact `[name, category, description, minArgs, maxArgs]` shape already proven in `function-catalog.ts` as the field model so the TS side is a 1:1 generation target.
- Expose a public `FunctionRegistry::catalog()` returning the full metadata set, plus a stable serialized form (the same wire path `compute-core`/wasm already use to reach the registry).
- Add a build-time/CI generator (or check) that emits/verifies `function-catalog.ts` from the Rust catalog. (The generator script and its wiring live outside this folder; this crate's deliverable is the authoritative `catalog()` API and the metadata.) Mark the TS file as generated and fail CI on drift.

**Phase 3 — Context-function catalog reconciliation (objective 3):**
- Register **metadata-only** entries for the ~50 inline context functions so the registry/catalog is complete (name, arity, volatility, returns_array, category, description, args) **without** routing their evaluation here — evaluation stays in `eval_primitives.rs`. Mark them so the dispatcher still inline-handles them but `function_names()`/`catalog()`/arity answers are authoritative for the whole surface. Exact mechanism (a `ContextFunction` metadata arm vs. a shared catalog crate) chosen from Phase-0 evidence; coordinate the call-site change in `eval_primitives.rs`/`eval/mod.rs` as a cross-folder dependency.

**Phase 4 — Parity ledger + golden corpus (objective 4):**
- Build a per-function ledger (implemented / reference-checked / known-discrepancy with a KFD-id link) generated from `catalog()` so coverage is queryable.
- Add a golden value corpus (input args → expected `CellValue`) covering each function's happy path and Excel edge cases (blank coercion, error passthrough, boundary dates, NaN/∞, empty/ragged arrays). Tie accepted differences to `known-formula-discrepancies.md` entries; everything else is a hard assertion.

**Phase 5 — Panic-freedom + coercion convergence (objectives 5–6):**
- Resolve every input-reachable `unwrap()/expect()` from Phase 0 into an explicit `CellError` (prime suspects: `datetime/calendar.rs` `add_months`/serial conversions, `datetime/workdays.rs`, `datetime/week.rs`, `helpers/date_serial.rs`, `helpers/column_index.rs`).
- Add a fuzz/property harness over `FunctionRegistry::call(name, args)` for every registered name across an adversarial `CellValue` generator, asserting it always returns (never panics).
- Route remaining ad-hoc coercion through `helpers/coercion.rs`; reconcile any per-function divergence against the golden corpus.

## Tests and verification gates

- **Behavior-identity gate (Phase 1):** for the migration, a snapshot/diff test proving the unified signature produces identical error-propagation and array-lift results to the pre-migration code for every migrated function (oracle from Phase 0). No net behavior change is permitted in Phase 1.
- **Catalog-completeness & no-drift gate (Phases 2–3):** a test asserting `catalog()` covers exactly the union of registered pure functions + reconciled context functions, and a CI check that fails if generated `function-catalog.ts` differs from the committed file. A second test asserts every `eval_primitives.rs` inline match arm has a catalog entry and vice-versa.
- **Existing registry suites must stay green:** `registry/tests/{arity,array_lift,error_propagation,helpers,lookup,metadata}.rs` and `signature.rs` unit tests — extended to cover the unified model (notably: `Criteria` passthrough, `Range`/`Scalar` short-circuit, `ArrayNative` skip, zipped multi-array broadcast, `#VALUE!` on dimension mismatch).
- **Golden corpus gate (Phase 4):** parity assertions per function; accepted differences must reference a KFD id or the test fails.
- **Panic-freedom gate (Phase 5):** fuzz harness over all registered names returns for every generated input; CI denies new production `unwrap()/expect()` outside `#[cfg(test)]` in this crate (lint/grep gate).
- **Verification is delegated, not run here:** per task constraints this plan does **not** execute `cargo`/`pnpm`/build/test. Reviewers run the standard workspace gates: `cargo test -p compute-functions`, `cargo test -p compute-core` (registry fall-through + `formula_accuracy_*` suites), the catalog-generation check, and the wasm build (panic-freedom matters most there). Note `contracts` may need its declaration rollup before TS consumers typecheck the regenerated catalog.

## Risks, edge cases, and non-goals

- **Risk — silent parity regression during the 472-function migration.** Mitigation: Phase 1 is strictly behavior-preserving and gated by the Phase-0 oracle; metadata (Phase 2) is additive. Migrate per domain, smallest first, never in one sweep.
- **Risk — generator/TS coupling.** Generating `function-catalog.ts` introduces a Rust→TS build dependency. Mitigation: ship the `catalog()` API and a *checked-in generated file with a drift check* first (no hard build-time codegen dependency), so a generator outage can't block builds.
- **Risk — function-id reordering.** If Phase-0 finds any persisted id reference, registration order becomes a hard compatibility constraint and Phases 1/3 must preserve order. This is the single highest-impact unknown; resolve it before touching `register_all`.
- **Edge cases to honor:** blank (`Null`) vs zero coercion; error values as valid `Criteria`; ragged/empty arrays and zipped-broadcast dimension mismatch (`#VALUE!`); 1900 leap-year serial quirk and pre-epoch/extreme serials in datetime; NaN/∞ collapsing to `#NUM!`; `_xlfn`/`_xlws` prefixed names; volatile-set membership.
- **Numerical accuracy is bounded, not "bit-exact to the reference."** Approximation-based functions (Bessel, gamma/Lanczos, distributions via `statrs`) are validated to a documented tolerance; differences beyond tolerance are either fixed or filed as KFD entries — never silently accepted.
- **Non-goals:** (a) moving context-needing functions (LET/LAMBDA/INDEX/aggregates) into this crate — they correctly live in `eval_primitives.rs`; this plan only reconciles their *catalog metadata*. (b) Adding brand-new Excel functions beyond closing identified coverage gaps. (c) Changing the `dd-precision` default profile or any KFD-accepted result. (d) Reworking `value-types`/`compute-formats` (separate folders). (e) Compatibility shims or test-only patches.

## Parallelization notes and dependencies on other folders

- **Internally parallel:** after Phase 1's shared signature scaffolding lands, the per-domain migrations (`math`, `text`, `statistical`, `financial`, `lookup`, `datetime`, `engineering`, `database`, `information`, `logical`, `web`) are independent and can be done concurrently by different workers, each gated by its own behavior-identity snapshot. The panic audit (Phase 5) partitions cleanly by file.
- **Sequential spine:** Phase 0 (evidence + id-stability verdict) → Phase 1 scaffolding → {domain migrations ∥ Phase 5} → Phase 2 metadata/API → Phase 3 reconciliation → Phase 4 corpus. Catalog completeness (Phases 2–3) depends on the inline-function inventory from Phase 0.
- **Cross-folder dependencies (coordinate, do not edit blindly here):**
  - `compute/core/src/eval/engine/eval_primitives.rs` + `eval/mod.rs` — owns inline context dispatch; Phase 3 needs a small registration/marking change there and must keep `GLOBAL_REGISTRY` initialization correct.
  - `spreadsheet-utils/src/function-catalog.ts` + `contracts/src/utils/function-registry.ts` — become generated/verified consumers of `catalog()`; needs the `@mog-sdk/contracts` declaration rollup before typecheck.
  - `compute/wasm` — exercises the registry across the wasm boundary; panic-freedom (Phase 5) is validated most stringently here.
  - `types/value-types` — `CellValue`/`CellError`/`Array` semantics underpin coercion and array-lift; treated as a fixed contract.
  - `docs/internals/spreadsheet/known-formula-discrepancies.md` — the parity ledger (Phase 4) links to and is kept consistent with this register.
```
