Rating: 8/10

Summary judgment

This is a strong, evidence-backed plan for a security-sensitive crate. It correctly identifies real production-path risks in `compute-security/src`: infallible tag parsing with ambiguous glob grammar, fail-open range filtering on overlong buffers, repeated candidate scans in `evaluate_sheet`, pointer-address principal identity, unenforced priority bands, incomplete `Result` redaction, explanation/evaluation drift risk, unused `arc-swap`, and the reserved row dimension. The plan also does well at preserving wire shapes and resolution semantics, which are the most important contracts in this folder.

The score is not higher because several fixes are only partially specified at the actual trust boundaries. The plan says most edits are local to `compute-security/src`, but tag-pattern rejection, priority/provenance validation, SDK error mapping, and principal cache soundness all require coordinated changes in `compute-document`, `compute-core`, and `compute-api`. It names those dependencies, but often treats them as follow-up ownership instead of part of the blocking contract needed for the local changes to solve the problem.

Major strengths

- The problem inventory is concrete and source-grounded. The plan points to real implementation behavior rather than generic hardening themes.
- It protects the critical compatibility surface: serde wire keys, `AccessLevel` discriminants, `Principal` non-serde status, `ColumnIndex` purity, SG-1/SG-2/SG-3 resolution semantics, owner clamp behavior, and template stamping.
- The proposed verification suite is appropriately broad for security work: in-crate tests, differential `evaluate_sheet` testing, wire-shape regression, benchmark coverage, clippy, and existing adversarial E2E tests.
- It recognizes that performance work must target `PolicyEngine::evaluate_sheet`, the production matrix path, not a harness-only path.
- The sequencing mostly separates independent slices and calls out parallelizable areas without mixing unrelated refactors.

Major gaps or risks

- The tag parser contract is internally muddy. `TagMatcher::try_parse` is the right direction, but the plan also keeps infallible `parse` for persisted documents and suggests making bad patterns observable via "a returned diagnostic" even though `parse(&str) -> Self` has no diagnostic return channel. If existing bad persisted policies must load, the plan needs an explicit invalid-pattern representation, load-time warning/event path, or a precise statement that legacy bad patterns remain exact literals until touched.
- Priority-band enforcement is underspecified at the trust boundary. `AccessPolicy.metadata.created_by` and `template_id` are caller-supplied wire fields today, so provenance cannot safely be inferred from policy metadata. The plan should define who stamps trusted provenance, how forged `"mog:system"` metadata is rejected, and how `add_policy`, `update_policy`, and `apply_template` differ.
- The identity fix proposes a 64-bit content hash while stating the invariant "identity equality implies tag-set equality." A hash does not provide that invariant. This needs either a pool-assigned non-reused ID, structural equality in the cache key, a collision-proof canonical handle, or an explicit probabilistic-risk acceptance. It also needs a concrete story for non-interned `Principal::from_tags`.
- The cross-crate paths in the plan are partly stale or imprecise relative to the current layout (`compute/core/src/...`, `compute/api/...`, binding crates under `compute/{napi,pyo3,wasm}`). That is easy to fix, but important for a handoff plan.
- The `filter_range_values` mismatch fix defines the overlong-buffer case but not the underlength case beyond a debug assertion. Underlength probably cannot leak extra payload, but security code should still specify whether it is allowed, denied, warned, or treated as a caller contract violation.
- The `evaluate_sheet` rewrite needs more detail on warning ordering and broader-scope candidates. Starting from `sheet_default` and grouping only matching column policies can be correct because column target specificity dominates, but this should be stated explicitly and covered in the differential oracle.
- `SecurityError` expansion is framed as lowering new validation failures to `SecurityDenied`; that may be semantically wrong for malformed tag patterns or invalid app priority. The plan should specify the bridge-visible error kind/message contract instead of relying on the existing denial shape.

Contract and verification assessment

The preservation contract is excellent for wire shape and resolution behavior. The plan names the exact serde shapes, discriminants, derived tags, tie-breaks, owner clamp, non-serde principal invariant, redaction completeness guarantee, template priority band, and column-index boundary. That is the right level of rigor for this folder.

The verification gates are good but should be tightened into executable acceptance criteria. The property test should compare old and new `evaluate_sheet` semantics through a checked oracle, including column warning order, owner clamp warnings, nonmatching column policies, deleted columns, duplicate policies, and workbook/sheet policies mixed with column policies. The benchmark gate should state an expected threshold or regression criterion for the added 500-column-policy case, not just "run cargo bench." Cross-crate verification should include the actual mutation path where policies enter Yrs, because validating constructors in the pure crate do not protect production unless those callers use them.

Concrete changes that would raise the rating

- Define a precise tag-pattern migration/load contract: new writes reject invalid patterns; existing persisted invalid patterns either remain exact literals with an emitted `SecurityEvent`, deserialize into an explicit invalid matcher that never matches and is explainable, or are surfaced by a document repair/audit API.
- Replace the priority/provenance sketch with a trusted boundary design: API/store methods stamp or classify App/Template/System provenance internally, ignore untrusted caller metadata for authority, reject forged system/template metadata, and validate update patches as well as adds.
- Strengthen `PrincipalIdentity` with a collision-proof design rather than a 64-bit hash, and specify the required changes to `AccessMatrixCache`, test backdoors, and non-interned principals.
- Make the off-crate work first-class in the deliverable instead of "by owners" follow-up, or explicitly mark the local crate plan as blocked until companion plans land.
- Add exact file paths for current repo layout and list the public APIs that must change or remain additive.
- Turn the `evaluate_sheet` rewrite into a more formal equivalence contract, including how broader workbook/sheet candidates are represented when only column-specific candidates are grouped.
- Specify bridge error shapes for invalid tag patterns and invalid priority bands, with tests through `compute-api` and at least one binding-facing path.
