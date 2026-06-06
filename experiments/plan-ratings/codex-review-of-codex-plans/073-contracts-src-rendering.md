Rating: 8/10

Summary judgment

This is a strong, production-relevant plan for `mog/contracts/src/rendering`. It correctly treats the folder as a public projection layer rather than as renderer implementation, and it identifies the real architectural problem: the current surface is split across contracts-owned runtime values, locally composed contract types, and broad type-only shims into `@mog/types-rendering` and `@mog/types-viewport`. The plan is especially good at naming the surrounding production consumers that must be moved with the contracts, including `grid-canvas`, `grid-renderer`, SheetView, spreadsheet renderer/input/coordinator systems, kernel, and print/export.

The rating is not higher because the plan still leaves several critical contracts underspecified. It says to build inventories and exhaustiveness gates, but it does not define the manifest schema, expected symbol list, allowed public leaf stability class, field-by-field `RenderContextConfig` semantics, or exact acceptance tests for UI/browser behavior. Those omissions matter because this work is explicitly about public contract clarity. The plan is directionally right and likely valuable, but an implementation team could still make incompatible choices while believing they followed it.

Major strengths

- The plan is grounded in the actual source shape. `contracts/src/rendering/index.ts` currently has a broad `export type * from '@mog/types-rendering'`, while package exports only expose `./rendering`, `./rendering/sheet-view-skin`, `./rendering/coordinates`, and `./rendering/constants`. The plan correctly targets the mismatch between a wide root barrel and sparse public leaf subpaths.
- It distinguishes runtime ownership from type-only projection, which is the core architectural issue for a public SDK package. The runtime constants and defaults live locally in contracts, while many leaf contracts are shims into private type shards.
- The plan finds real production-path defects, not cosmetic issues. For example, branded coordinate factories currently live in `@mog/spreadsheet-utils/rendering/coordinates`, not in the public contracts leaf, and the production `CoordinateSystemImpl.rangeToViewport()` still collapses to one bounding rect even though the contract returns `ViewportRect[]` and comments mention frozen-boundary splits.
- It correctly prioritizes `RenderContextConfig` patch semantics. Current production code routes `updateContext(config: Partial<RenderContextConfig>)` through a hot-path field handler table, and callers clear some data sources by passing `undefined`. The plan's demand for explicit omitted/undefined/null semantics is exactly the right contract-level fix.
- The hit-test and interactive-element work is concrete and justified. `OutlineGutterHitResult` is part of the hit-test union but is not listed in the public `types/rendering/src/index.ts` exports, and `InteractiveElementType` includes future arms like `sparkline-edit` and `hyperlink` while `InteractiveElementMetadata` does not include corresponding metadata arms.
- The verification section is unusually complete for a plan review item. It includes package tests, typechecks, runtime inventory checks, API snapshots, external fixtures, and browser verification through real user input paths.
- The parallelization notes are useful. They put the export/source-of-truth inventory first and separate parity, coordinate factories, render-context semantics, data-source alignment, hit-test exhaustiveness, external fixtures, and browser verification into slices that can be independently staffed.

Major gaps or risks

- The plan's key artifact, the "executable rendering contract inventory," is not specified enough. It should define the manifest filename, schema, symbol identity format, allowed `runtime` vs `type-only` values, allowed ownership categories, leaf module naming rules, and how the test derives "every exported symbol." Without that, agents can produce incompatible inventories.
- The public API expansion is not classified precisely. Adding leaf subpaths such as `data-sources`, `grid-renderer`, `hit-test`, `render-context`, and `interactive-elements` is public package surface area. The plan says "public-experimental surface" once, but it does not state whether these leaves are stable, experimental, internal-but-exported, or snapshot-only, nor how root barrel compatibility is preserved.
- The sequencing around broad barrel replacement is risky. Replacing `export type * from '@mog/types-rendering'` with explicit exports is correct, but the plan should require an expected root export list before edits begin and should preserve public symbols unless an intentional API snapshot deletion is listed by name.
- Runtime source-of-truth resolution remains ambiguous. The plan asks for parity tests across contracts, `types/rendering`, and `types/viewport`, but also says the right end state is either generated/projected or byte-for-byte parity. That is too open-ended for a contract plan. It should decide which package owns each runtime value and whether duplicate runtime values are eliminated or retained temporarily under a named gate.
- `RenderContextConfig` redesign is under-specified for the size of the change. "Replace ambiguous optional fields where needed with explicit nullable fields or patch wrapper types" leaves the main type design unresolved. The plan should include, or require as the first implementation output, a field disposition table covering every current key and each key's dirty scope, clear value, default, and producer.
- The data-source alignment step is valid but vague. It should enumerate the data-source interfaces and expected patch fields that must correspond, and it should explicitly separate pure read data sources from side-effecting bridges such as chart rendering and object scene graph updates.
- The default immutability goal needs more design. Freezing public defaults can be right, but `DEFAULT_RESOLVED_SHEET_VIEW_SKIN` nests `DEFAULT_CHROME_THEME`; the plan should say whether to deep-freeze, clone-on-resolve, or both, and how to avoid breaking code paths that intentionally merge default objects into mutable resolved state.
- The browser verification requirement is broad but not executable. It lists features to exercise, but not named scenarios, expected observations, viewport states, or whether this becomes Playwright coverage, manual verification, or both.

Contract and verification assessment

Contract clarity is the plan's main strength and also its main unfinished piece. It identifies the right contract seams: public rendering imports, type-only projections, runtime values, branded coordinates, multi-region viewport geometry, hit-test unions, interactive elements, `GridRenderer`, `RenderScheduler`, SheetView skin DTOs, and `RenderContextConfig` patch semantics. The invariants are technically sound and reflect production behavior in the inspected code.

The strongest contract proposals are the public coordinate factories, hit-test exhaustiveness tests, interactive-element metadata exhaustiveness tests, public runtime fixture imports, and render-context field disposition inventory. Those would turn current comments and implicit behavior into enforceable contracts.

The weakest contract proposal is export inventory because it is described as a goal rather than a fully specified artifact. This matters because the folder's root barrel currently imports a large type surface from `@mog/types-rendering`, while only a few rendering leaves are package exports. A correct inventory must distinguish symbols available from the root from symbols available from package leaf subpaths, and it must not confuse source package with source of truth.

The verification gates are mostly appropriate and tied to production paths. `cd mog/contracts && pnpm test`, `pnpm typecheck`, grid-canvas/grid-renderer tests and typechecks, SheetView/spreadsheet tests, runtime inventory, API snapshots, external fixtures, and browser coverage are the right families of checks. The plan should tighten the order: build or prepare public artifacts before `check:external-fixtures -- --skip-build`, run API snapshot checks only after the intended export diff is recorded, and add at least one named browser or E2E scenario for freeze panes, hidden headers, hit testing, and data-source clearing.

Concrete changes that would raise the rating

- Add the exact contract inventory schema and initial expected inventory for the current `contracts/src/rendering` public root plus existing leaf subpaths.
- Add a proposed final export matrix listing each new `@mog-sdk/contracts/rendering/*` leaf, every symbol it exports, whether it is type-only or runtime, and whether it is stable public API or public-experimental.
- Define the `RenderContextConfig` patch model before implementation: either a `RenderContextPatch` type with explicit clear/default semantics or a generated field-disposition table that drives both types and tests.
- List every current `RenderContextConfig` key with owner data source, producer package, dirty scope, default, clear value, and whether `undefined` is allowed.
- Decide source-of-truth ownership for constants/defaults/enums instead of leaving parity-vs-generation open.
- Specify the exact multi-rect geometry contract, including names for "all visible rects," "primary anchor rect," and "bounding rect," then map `rangeToViewport` and `getRangePageBounds` to those names.
- Convert the browser verification paragraph into named scenarios with setup, real input path, and expected visible result.
- Add an explicit API compatibility rule: no public root symbol deletion unless the plan names it and the API snapshot diff is approved as intentional.
