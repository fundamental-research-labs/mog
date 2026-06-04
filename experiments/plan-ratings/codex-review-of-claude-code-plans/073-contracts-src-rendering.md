Rating: 6/10

Summary judgment

The plan identifies a real and important split-brain in `mog/contracts/src/rendering`: type surfaces are increasingly sourced from private leaf packages, while several runtime values and local copies still live in contracts. Its evidence for `GridRenderer` drift and stale `DEFAULT_RESOLVED_SHEET_VIEW_SKIN` values is concrete, and the desired public-surface invariants are unusually clear.

The rating is limited because the proposed implementation path is likely invalid for the current contracts architecture. It repeatedly proposes runtime `export *` / named value re-exports from `@mog/types-rendering` and `@mog/types-viewport`, but the contracts package has explicit gates requiring published runtime JS to be self-contained and not import private `@mog/types-*` shards. Today `tools/contracts-runtime-inventory.json` also marks the rendering runtime values as `contracts-owned` with `sourceOfTruth: contracts/src/rendering`, not as moved private runtime. That means the plan's main "single source of truth in leaf packages" direction conflicts with the current public package contract unless it also changes the projection/ownership architecture.

Major strengths

- Strong problem statement: it distinguishes type drift, runtime value drift, subpath stability, and consumer-visible skin changes.
- Good evidence appendix: the missing `getCellRenderedSize` and the exact skin color/default differences are specific enough to verify.
- Good preservation list: exported names, subpaths, `RenderPriority` numeric values, row/column defaults, and shimmer/chrome defaults are called out.
- Good sequencing intent: read-only provenance checks precede edits, identical-file de-duplication is separated from behavior-changing skin convergence, and downstream typechecks are sequenced after contracts rebuild.
- Good production relevance: it focuses on the published `@mog-sdk/contracts/rendering` surface and real consumers in kernel/shell/views rather than test-only paths.

Major gaps or risks

- The runtime re-export strategy conflicts with `tools/check-contract-runtime-imports.mjs`, which explicitly forbids compiled contracts JS from importing `@mog/types-*` packages. The plan mentions this gate in the build pipeline but does not account for the fact that its Phase 1/2 value shims would fail it.
- The runtime inventory already encodes the opposite ownership model for rendering: `@mog/types-rendering` rendering values are classified as public contract runtime values with `ownership: contracts-owned` and `sourceOfTruth: contracts/src/rendering`. The plan proposes changing that ownership but does not specify the inventory migration, public publish story, or whether private packages can ever become runtime dependencies.
- The existing one-line shim pattern is mostly type-only. The plan treats that as precedent for value-bearing shims, but constants, enums, and default objects are materially different because they emit runtime imports.
- Phase 3 is underspecified. `check-contracts-declaration-identity.mjs` currently guards duplicate unique-symbol brand owners, not general interface drift or default-object literal equality. `check-contracts-runtime-inventory.mjs` detects private runtime leaks and disposition metadata, not value equivalence between contracts and leaf packages. The plan says to "extend / configure" them but does not define the new contract or fixture.
- The plan states Phase 1 is "zero behavior change", but changing local runtime values to private-package re-exports changes emitted JS topology and package dependency semantics even if the literal values are byte-identical.
- The plan does not resolve the core architectural choice: either contracts remains the runtime projection owner and leaf packages stop owning runtime literals, or the public package model changes so private leaf runtime values are publishable/bundled. Without that decision, implementation agents could do the wrong consolidation.

Contract and verification assessment

The contract preservation section is strong for names and values, but weak on ownership. For public contracts, "same exported value" is not enough; the compiled artifact must also avoid private runtime imports. The plan should make `check-contract-runtime-imports` a first-class invariant and require inspecting emitted `dist/rendering/*.js`, not only declaration output.

The verification gates are directionally good but need sharper acceptance criteria. A useful gate set would include the contracts build, the existing runtime import and runtime inventory checks, a declaration diff, an explicit runtime import scan for `@mog/types-*`, and external fixture coverage for the rendering values. The proposed visual regression for skin convergence is appropriate because the default skin change is user-visible.

Concrete changes that would raise the rating

- Decide and specify the runtime ownership model. If contracts must remain self-contained, keep or generate runtime value projections in `contracts/src/rendering` and make leaf packages import/type-reference the canonical contracts-owned values only where dependency direction allows. If leaf packages should own runtime values, explicitly change publishability, dependency, bundling, and runtime-import gates.
- Replace the Phase 1/2 value re-export instructions with a design that passes `check-contract-runtime-imports`; type-only shims can remain, but value exports need projection or an approved ownership migration.
- Define exact gate changes: which JSON inventory entries change, which script checks value equivalence or source ownership, and what fixture proves `DEFAULT_CHROME_THEME`, `DEFAULT_SHIMMER_CONFIG`, `DEFAULT_RESOLVED_SHEET_VIEW_SKIN`, constants, and `RenderPriority` cannot drift again.
- Add a before/after emitted-JS check for `dist/rendering/index.js`, `dist/rendering/constants.js`, and `dist/rendering/sheet-view-skin.js` to prove no forbidden private runtime specifier remains.
- Clarify the public subpath story for non-exported files such as `grid-renderer.ts`: whether they are source-internal only, generated declaration internals, or intentionally unsupported deep imports.
