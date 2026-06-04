Rating: 8/10

Summary judgment

This is a strong, production-path plan. It understands the folder's two main responsibilities: the top-level chart ownership/conversion layer and the render bridge/resolved-spec pipeline. The evidence is mostly grounded in the current tree: `seriesConfigToWire` does emit optional fields directly, `chart-store.update` casts a partial update to a full `ChartFloatingObject`, import-status classification is token/string based, cell errors are silently converted to `null`, the liveness contract is spread across `isLive()` checks plus `ChartRenderCache.acceptsCommits`, and the two resolved-spec/family files are genuinely large monoliths.

The plan is not a 9 or 10 because some important contracts are still left as implementation-time discovery rather than explicit specification. The biggest issues are the wrong package name in the stated scope and verification command (`@mog/kernel` vs the actual `@mog-sdk/kernel`), the optional-field fix being described too loosely, and the cell-error/liveness/type-reader work needing clearer data shapes and ownership boundaries before implementation.

Major strengths

- The plan targets the real production path, not mocks: SDK chart updates, compute-bridge persistence, render-cache painting, import fidelity, resolved-spec snapshots, and chart diagnostics.
- It preserves the right architectural boundaries: Rust compute remains persistence/identity owner; `IChartBridge` stays fixed; resolved ranges remain render-time; `renderCached` stays synchronous; wire/config conversion remains the sanctioned crossing.
- The evidence is unusually concrete. The cited modules and rough line locations match the current code for converter optional emission, partial update casting, structural casts, import-status tokenization, monolithic resolved-spec files, cell-error coercion, and cache/liveness behavior.
- The sequencing is mostly sound: fix the live converter/persistence bug first, centralize loose import-data reads before structured status classification, and keep decomposition behind unchanged entry points.
- The verification section is materially useful. It names existing local tests that can serve as equivalence oracles and adds targeted tests for omitted own properties, import-status mapping, liveness-after-stop, and resolved-spec decomposition.

Major gaps or risks

- The package identity is wrong in two places. `kernel/package.json` names the package `@mog-sdk/kernel`, not `@mog/kernel`, so the plan's scope sentence and `pnpm --filter @mog/kernel typecheck` gate would fail or hit nothing. This is easy to fix but important in a plan-rating context because verification commands must be executable.
- The optional-field contract is under-specified. The plan correctly identifies `projectionDiagnostics` in `seriesConfigToWire`, but Rust defines `projection_diagnostics` as `Vec<...>` with `#[serde(default, skip_serializing_if = "Vec::is_empty")]`, not as `Option`. Many sibling fields are true `Option`s, while some are defaulted vecs/bools. The plan should require an explicit inventory from generated TS wire type to Rust serde field category: omit undefined optionals, omit empty default vecs where appropriate, and preserve explicit false/0/empty-string values.
- The stated root cause says explicit `undefined`/`null` breaks Rust serde. That may be true for the bridge transport if `undefined` becomes `null`, and it is definitely dangerous for non-Option fields like default vecs, but the plan should name the actual serialization path and failing payload shape. JavaScript JSON serialization normally omits `undefined` object fields, so this needs a sharper contract than "undefined/null".
- `chart-store.update` is called out correctly, but the planned fix is vague. Mapping a `Partial<ChartFloatingObject>` through the converter boundary is not a simple mechanical replacement; chart floating objects include geometry, common floating-object metadata, chart config, import status, and wire fields. The plan should specify the partial-update mapper's input/output shape and how it avoids dropping unrelated partial fields.
- Typed imported-data readers are a good objective, but the plan does not define the reader result contract. "Narrow typed value or typed absent/invalid result" should become named discriminated unions with accepted field names, fallback behavior, and diagnostic policy. Without that, implementers may centralize casts but still preserve silent failure modes.
- The cell-error diagnostic objective is underspecified. `createCellAccessor` currently returns only a `CellDataAccessor`, so surfacing cell errors through resolved-spec diagnostics requires a side channel or a resolver contract change. The plan should define where diagnostics are collected, how row/col/sheet/source-series context is attached, and whether this requires changes outside this folder or to `@mog/charts`.
- The decomposition steps are architecturally reasonable but broad. Moving roughly 7k lines across plot/family support is high churn; the plan should explicitly require logic-free commits or patches, stable re-export shims, and byte-for-byte snapshot equivalence before any behavior change lands in those files.
- The liveness work may be more abstraction than strictly necessary unless it names the exact races to close. The existing cache already gates commits after `stop()`. A strong plan would specify the failing interleaving, the API for the proposed `LivenessGate`, and which code paths must consume it.

Contract and verification assessment

The plan is contract-aware and preserves the most important public and cross-package boundaries. Its strongest contracts are synchronous `renderCached`, Rust-owned persistence/identity, the wire/config crossing, render-time range resolution, and import-authority vocabulary. These are the right invariants for this folder.

Verification is good but needs correction and more precision. Replace `pnpm --filter @mog/kernel typecheck` with `pnpm --filter @mog-sdk/kernel typecheck`, and name the kernel test gate as an executable command, likely `pnpm --filter @mog-sdk/kernel test` or a focused Jest invocation if the repo supports one. For the converter bug, add tests that assert `Object.hasOwn(output, field) === false` for omitted fields and include a bridge/update regression that exercises the actual `charts.update({ series })` path. For the decomposition, snapshot tests are appropriate, but the plan should also require no public import-path changes and no mixed behavior edits in movement patches.

Concrete changes that would raise the rating

- Correct the package name and verification commands to `@mog-sdk/kernel`, and make the unit-test command exact.
- Add a table of every converter field touched: contract field, generated wire field, Rust serde field type, omit rule, and preservation rule for false/0/empty arrays.
- Specify the partial update conversion contract for `chart-store.update`, including which fields pass through unchanged and which nested chart fields are normalized through converter helpers.
- Define `imported-data-readers.ts` with concrete function signatures and discriminated return types before implementation begins.
- Define the cell-error diagnostic data shape and collection path from `chart-cell-accessor.ts` through resolved-spec diagnostics.
- Split the plan into explicit behavior-changing patches and mechanical decomposition patches, with snapshot equivalence required between them.
- Add an import-boundary verification check that can be run mechanically, rather than relying only on the instruction that no non-converter file imports both `*Data` and `*Config`.
