Rating: 8/10

Summary judgment

This is a strong plan for a load-bearing kernel-to-compute boundary. It correctly identifies production-path compensations in `ComputeBridge` and `ComputeCore` rather than proposing local shims, and it treats Rust compute and bridge codegen as the right owners for several current TypeScript workarounds. The plan is especially good at preserving existing invariants around the single mutation pipeline, undo atomicity, trap short-circuiting, bootstrap provenance, and viewport refresh ordering.

The rating is held below 9 because several implementation contracts are still too implicit for safe parallel execution. The biggest gaps are in the conditional-formatting refresh cache, complete coverage of cross-sheet/range invalidation cases, the exact generator contract for skipped and nonstandard-return methods, and the security typing source of truth. Those are solvable, but the plan should pin them down before implementation.

Major strengths

- The plan is grounded in the real production path. The named issues map to current code: `_forceRecomputeRefErrorCells`, `copySheet`'s follow-up recalc, manual `normalizeBytesTuple` overrides, workbook-security `any`/`unknown`, multiple `forceRefresh*` passes in `mutateCore`, `activeInstancePerDocId`, and `schemaTransport`.
- It makes the correct architectural call for O1 and O2: move sheet-delete invalidation and sheet-copy recalc into Rust mutations so the TypeScript bridge can stop papering over engine gaps.
- It clearly distinguishes hand-written bridge files from generated files and warns that `.gen.ts` shape changes must come from bridge annotations or `@mog/bridge-ts`, not manual edits.
- The invariant list is unusually useful. C1, C2, C3, C5, C6, and C8 are real contracts that could easily regress if an implementer only chased smaller code.
- Verification is not limited to compile/type gates. It names behavior tests for undo atomicity, literal `#REF!` negative cases, viewport refresh call counts, drift-guard failure, and lifecycle cleanup.
- Sequencing is mostly sound: independent in-folder work first, engine changes before TypeScript deletions for O1/O2, and generator changes separated from runtime bridge cleanup.

Major gaps or risks

- O5 needs a more precise conditional-formatting contract. The current code intentionally refreshes unconditionally because checking CF presence can cost as much as refresh. The plan says to populate `sheetsWithCfRules` from `cfChanges` and gate refresh on known CF presence, but that can miss pre-existing CF rules after import/hydration/sync or sheets whose rules existed before the current mutation. The safe contract should specify unknown-cache behavior, initial seeding, invalidation, and when to fall back to all-viewport refresh.
- O1 is directionally correct but under-enumerated. A single `=Sheet2!A1` case is not enough for the whole category. The plan should require coverage for rectangular ranges, whole-row/whole-column references, named ranges pointing to the deleted sheet, structured/table references if applicable, dynamic array/spill dependents, aggregate vs selective range deps, and formula-string cache regeneration.
- The generator work in O3 is not specified tightly enough. Methods returning `[String, MutationResult]`, `[String, PivotTableConfig, MutationResult]`, bytes tuples, void-like lifecycle writes, and `#[bridge::skip(ts_bridge)]` methods are different cases. The plan should define generated method metadata, manifest impact, return unpacking, mutation routing, and whether skipped methods become unskipped or get a new annotation class.
- The codegen gate saying `BRIDGE_METHOD_KIND` entries are unchanged is suspect for methods currently absent from generation. If skipped sheet lifecycle methods become generated, manifest contents probably should change or a separate generated-command manifest is needed.
- O4 should prefer existing public security contracts where possible. `AccessPolicy`, `AccessTarget`, `AccessPrincipal`, `AccessLevel`, `PolicyId`, and `AccessExplanation` already exist under public contract/type packages and mirror Rust shapes. Adding parallel `SecurityPolicyWire`/`SecurityTargetWire` types in the bridge risks another drift surface unless the plan explains why a separate leaf wire type is required.
- O6 is more of an audit prompt than an implementation spec. `activeInstancePerDocId` already deletes on normal destroy after `engineCreated`, and no entry exists for a never-created core. The plan should name concrete stale-entry scenarios, test hooks, HMR/test isolation expectations, and what `schemaTransport` disposal must do for active transports.
- The plan says the production change set is confined to this folder but later requires Rust compute and generator changes. It does call those dependencies out, but the scope statement should be clearer: this folder's cleanup is contingent on separate production changes outside the reviewed folder.

Contract and verification assessment

The contract section is the plan's strongest part. It correctly makes `mutateCore()` the non-bypassable write path, preserves patch-before-refresh-before-event ordering, and treats undo grouping and bootstrap provenance as externally visible behavior. It also recognizes that renderer geometry must come from Rust and that trap handling is intentionally coupled to `ComputeCore` state.

The verification gates are good but should be made more package-specific and complete. For TypeScript work, the plan should name the exact kernel package test/typecheck command expected by implementers. For Rust work, it should name the relevant compute crate tests and clippy gate. For O1/O2, it should require Rust-side tests that prove the engine emits one mutation result with recalc and viewport patches, not only kernel-side observable behavior.

The performance gate for `removeSheet` is useful, but it should define the measurement contract more concretely: assert one bridge mutation and no per-cell/per-sheet formula search or set-cell reparsing, rather than relying only on a broad O-notation statement.

Concrete changes that would raise the rating

- Replace the O5 CF cache sketch with an explicit state machine: unknown/known-present/known-absent per sheet, seed source after import/hydration, invalidation rules for local and remote CF changes, and fallback behavior that cannot miss sibling refreshes.
- Expand O1 tests and implementation contract to cover the complete cross-sheet dependency category, including all range target forms and named/table references that can point at a deleted sheet.
- Split O3 into separate generator contracts for bytes tuple mutations, multi-value mutation returns, void/lifecycle writes, and skipped bridge methods. State the expected generated TypeScript signatures and manifest changes for each.
- Rework O4 to reuse public security types unless a bridge-only wire shape is strictly necessary; if separate wire types remain, add a drift test against the public contract shapes.
- Make O6 acceptance criteria concrete: expected map state after create/destroy/supersede/trap/HMR/test teardown and an exported/resettable schema transport disposal hook if that is the intended API.
- Add exact verification commands per changed package/crate, plus a requirement that O1/O2 land only after Rust tests demonstrate atomic recalc, patch emission, and single undo-entry behavior.
