Rating: 8/10

Summary judgment

This is a strong, production-relevant plan. It accurately identifies that `kernel/src/domain/sheets` is currently a partial TypeScript facade while lifecycle, layout, view, mirror, generated bridge, and Rust compute contracts are spread across adjacent surfaces. The plan is especially good at naming invariants that must not be lost: Rust remains the durable owner, lifecycle operations must await mutations, hidden/veryHidden visibility needs one governed rule, sync rendering reads must stay O(1), and structural edits must remain Rust-owned.

The rating is not higher because several central contracts are still framed as decisions to be made during implementation rather than plan-level decisions. The plan also proposes a very broad canonical facade migration without enough phase boundaries, acceptance criteria per phase, or exact error/result type names. It is directionally right, but an implementer could still make incompatible choices around visibility, used range, print settings, cache invalidation, and public error mapping while claiming to follow the plan.

Major strengths

- The source inventory is accurate and useful. It names the direct files in `domain/sheets` and the real production owners in workbook APIs, worksheet APIs, state mirror, generated compute bridge, Rust sheet storage, and public type contracts.
- The plan correctly distinguishes Rust durable state from TypeScript adaptation. It explicitly avoids TypeScript formula rewrites, grid mutation, test-only adapters, and duplicate compatibility paths.
- The problem statements match the current code: `dimensions.ts` has fire-and-forget writes and module-level caches, hidden-row/column enumeration scans data bounds despite bulk bridge APIs existing, `sheet-meta.ts` composes multiple bridge calls and has a no-op `setUsedRange`, and `structures.ts` is thin with narrow awaiting tests.
- The invariants section is unusually valuable. It covers lifecycle, visibility, metadata/defaults, dimensions, structural edits, view/print state, and async/error behavior in terms that are testable.
- Verification is broad and mostly production-path oriented: public workbook/worksheet APIs, state mirror hydration, generated bridge parity, Rust compute-core behavior, and real spreadsheet UI flows are all represented.
- Parallelization notes are credible. The proposed worker boundaries map to coherent ownership slices and call out cross-slice dependencies.

Major gaps or risks

- Scope is very large for one plan and needs stricter sequencing. Moving lifecycle into `domain/sheets`, changing dimension cache ownership, consolidating view/print state, touching generated bridge contracts, and migrating public callers are all substantial. The plan should define phase gates such as "lifecycle only", "dimension bulk reads only", and "view/print only", with exact exit criteria for each.
- The canonical facade boundary is plausible but under-specified. `WorksheetViewImpl` already uses mirror-first reads for frozen panes, split config, view options, and scroll position, while `WorksheetLayoutImpl` awaits Rust directly for async layout. The plan should state exactly which reads stay mirror/viewport-only, which writes route through `domain/sheets`, and which public APIs intentionally remain direct bridge callers.
- Error contracts are too vague. "Throw a typed error" and "public APIs map typed errors" is not enough for a cross-package migration. The plan should name the error variants, receipt behavior, and whether current `false`/`null` collapse sites become `KernelError`, `OperationResult`, or domain-specific result unions.
- Visibility needs a firmer API contract. The plan identifies boolean `hidden` plus tri-state `visible | hidden | veryHidden`, but still mixes `setSheetHidden` and `setSheetVisibility` shapes. It should define the canonical domain method, how public workbook hide/show differs from worksheet `setVisibility`, and how veryHidden is preserved through import/export, copy, show, and last-visible-sheet checks.
- Used range and print settings are left as open choices. The plan says either add `usedRange` to metadata or document it as separate, and either use first-class Rust print state or add bridge contracts. Those are foundational choices; the plan should make them explicit or mark them as a required design preflight before implementation starts.
- Dimension cache invalidation is directionally correct but not contractual enough. It should specify the owning object, key shape, document disposal behavior, and exact mutation-result or document-lifecycle events that clear row/column caches.
- Some verification gates are too broad without being phase-tied. The UI scenarios are good, but the plan should identify the minimum required UI path per implementation slice so verification does not become an unbounded final checklist.

Contract and verification assessment

Contract clarity is high for invariants and medium for concrete API shapes. The lifecycle result sketches are useful, but they need exact TypeScript types, error names, and public mapping rules. Metadata is well analyzed, especially the distinction between public `SheetMeta`, runtime `SHEET_META_SCHEMA`, generated bridge `SheetMeta`, Rust `SheetMeta`, and mirror `MirrorSheetMeta`; however, the plan should decide the `usedRange` contract rather than leave it to implementation. Visibility and print settings have the same issue.

Architectural fit is strong overall. Keeping Rust compute as the durable source of truth and using `domain/sheets` as a TypeScript adaptation boundary fits the existing package direction. The main architectural risk is over-centralization: not every read should be forced through the domain facade if the production hot path already has a correct mirror or viewport-buffer read model.

Production-path relevance is strong. The plan targets public workbook/worksheet APIs, generated bridge contracts, mirror hydration, Rust compute-core, renderer dimension reads, app sheet tabs, import/export, undo/redo, and collaboration replay. It does not spend effort on mock-only improvements.

Verification is comprehensive but should be tightened. For Rust changes, the repo instructions expect `cargo test -p <crate>` and `cargo clippy -p <crate>`; the plan lists `cargo test -p compute-core` but should also include the matching clippy gate when compute-core is changed. For TypeScript, the kernel package test/typecheck gates are appropriate, and public export changes correctly trigger repo-level typecheck and publish-readiness checks. UI changes correctly require real browser exercise through real input paths.

Concrete changes that would raise the rating

- Add a phase-zero contract section that decides canonical method names and exact TypeScript result/error types for lifecycle, visibility, dimensions, frozen panes, used range, and print settings.
- Split implementation into explicit phases with entry dependencies, owned files, production callers to migrate, and required verification gates for each phase.
- Define which APIs stay mirror/viewport sync reads, which become async Rust reads, and which writes must route through the domain facade.
- Replace open-ended used-range and print-setting alternatives with a chosen contract, or make them blocking design decisions that must be resolved before coding.
- Specify exact cache invalidation hooks for document identity, sheet deletion/copy, undo/redo, hydration, remote sync, and document disposal.
- Add `cargo clippy -p compute-core` to the Rust verification gates for compute-core changes, and name the bridge generation/parity command expected by this repo.
- Add acceptance tests that prove every migrated public caller uses the canonical facade where intended, while allowing documented exceptions for performance-critical mirror/viewport reads.
