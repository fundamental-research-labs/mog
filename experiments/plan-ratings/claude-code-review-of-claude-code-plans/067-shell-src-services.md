Rating: 9/10

# Review of 067 — `mog/shell/src/services`


## Summary judgment

This is a strong, implementation-ready plan. Its defining quality is that the evidence section is not asserted but *located*: nearly every claim carries a file+line citation, and the ones I spot-checked all held up against the current tree. The scope is disciplined — a clear in-scope/out-of-scope edit boundary, a faithful description of the folder's four concerns, and a refusal to expand into the kernel or app layers it merely couples to. The improvement objectives are genuine production-path defects (a real security gap, real concurrency mis-granularity, dead contracts, misplaced parsing) rather than cosmetic churn, and each maps to a concrete, sequenced phase with named tests. It loses a point only for leaving two load-bearing decisions (handle-based save; pivot-relocation seam) explicitly unresolved — correctly flagged as blocked, but they cap how "ready" two of the nine phases actually are.

## Verification of evidence (spot-checked against source)

- `validatePathInProject` (`project-service.ts:127-147`): confirmed — `startsWith` on lowercased/slash-normalized strings, no `..` resolution, no boundary check; docstring does claim "Prevents path traversal attacks." Both defects are real.
- `saveMutex` (`project-service.ts:149-171`): confirmed — single global boolean+queue mutex, not per-file.
- `attachSidecar` (`create-document-manager.ts:826-833`): confirmed — always throws; `detachSidecar`/`getSidecar` are real. Interface-declares-dead-impl is accurate.
- `disposeAll` (`:942-974`): confirmed — collaboration-failure branch resets `disposedAll=false` and throws *without* clearing; non-collab branch clears all maps *then* throws. Two divergent partial-failure policies, exactly as described.
- Cache-hit option blindness (`loadDocument:421-431`): confirmed — only the collaboration `kind` is checked; `kind`/`csvOptions` are not, so an incompatible re-open returns the wrong handle.
- `lifecycle-state.setActiveDocsProvider(null)` (`:117-122`): confirmed — `null` clears the entire provider Set; the targeted unregister is returned only on the non-null path.
- `mock-ipc` barrel export (`project/index.ts:44`): confirmed.
- Duplicated `generateFileId` (`shell-service.ts:69-81`, with its self-documenting "Mirrors project-service.ts" comment): confirmed.

The accuracy rate of the citations materially raises my confidence in the claims I did not independently verify (imported-pivot ZIP reader, trap-recovery correctness, per-event `Date.now()`).

## Major strengths

- **Evidence-first, falsifiable.** Line-cited claims make the plan auditable; a reviewer or implementer can confirm each defect in seconds. This is the single biggest differentiator.
- **Security framing is correct and prioritized.** The path-traversal gap is named as the only gate on read/write/rename/delete and given Phase 1, with the specific failure modes (prefix-sibling `/p` vs `/p-evil`, unresolved `..`) called out as regression cases.
- **Contracts-to-preserve section is excellent.** It enumerates the invariants the refactor must not break (identity invariant, generation/abort protocol, per-file FIFO, collab fences, "read live never cache," capability semantics) — this is what makes the `openPipeline` extraction (Phase 5) safe to attempt rather than reckless.
- **Sequencing reflects real coupling.** Phase 3 → 5 → 6 ordered because Phase 5 absorbs Phase 3's validation and shares Phase 6's dispose machinery; the rest correctly marked parallelizable on disjoint files.
- **Honest about indecision.** Phase 2 and Phase 7 carry explicit blocked-evidence notes with the *smallest investigation* to unblock, rather than papering over the unknown.

## Major gaps or risks

- **Phase 2 is two plans wearing one number.** "Wire handle-based save" and "delete the dead handle map" are opposite changes with opposite blast radii (one touches the platform/IPC boundary and product behavior; the other is a deletion). The plan acknowledges this but still books it as a single phase. The verification gate ("handle-based save writes through the registered handle") only applies to one branch — the file should state the gate is conditional on the decision.
- **Phase 7 depends on a seam that may not exist.** The relocation's entire value (parse-once) is contingent on the import/host path exposing parsed ZIP/pivot parts. If the investigation finds no cheap seam, Phase 7 collapses to "leave it where it is" — a large stated benefit with a real chance of evaporating. The non-goal of "no behavior change to read-only pivot UI" is the right guardrail, but the phase should pre-commit to a fallback (e.g., still de-risk the silent-failure/ZIP64 gaps *in place*) so the phase delivers value even if relocation is blocked.
- **`openPipeline` extraction (Phase 5) is the highest-risk change and the plan knows it.** The abort/generation protocol is the most safety-critical logic in the folder; collapsing three copies into one parameterized helper risks subtle divergence. The mitigation (land behind existing tests + a new concurrent open+dispose test, no `await` between generation allocation and `loadingPromises.set`) is good, but "equivalence" is asserted via tests that may not cover the full abort state-space. A characterization-test pass over the *current* three pipelines before refactor would strengthen this.
- **Observability (Phase 9) is under-specified relative to the rest.** "Introduce a small shell diagnostic helper" — no statement of whether one already exists elsewhere in shell, what the tag taxonomy is, or whether it must integrate with the kernel-plan-010 equivalent it references. Lower stakes, but the least concrete phase.

## Contract and verification assessment

Contract clarity is the plan's strongest dimension. The "contracts and invariants to preserve or strengthen" section is unusually rigorous and ties each refactor to the specific behavior it must not regress. New error surface is named concretely (`DocumentModeConflictError` pattern — which already exists in the source, so this is reuse not invention). The interface-change ripple (Phase 4 dropping `attachSidecar`, Phase 2 handle surface) is correctly routed through `@mog-sdk/types-document/shell` and the contracts declaration rollup, citing the relevant memory.

Verification gates are concrete and per-phase: every existing test suite is enumerated by path (including the trap-recovery integration test that caught the re-entrancy race), and seven new regression-test families are mapped to specific phases. The static-gate note (ESLint import-boundary rules must accept the `generateFileId`/`mock-ipc` moves; shell→import direction for Phase 7) shows the plan anticipates the layering checks. The one weakness: gates are stated as acceptance criteria but, per task constraints, are not run — so "tests stay green" is a claim about intent, and the equivalence guarantee for Phase 5 rests on test coverage the plan does not characterize.

## Concrete changes that would raise the rating

1. **Split Phase 2** into 2a (per-file lock — unconditional, ship now) and 2b (handle-save: wire-or-delete, gated on the investigation), with the handle-write verification gate attached only to 2b. This removes the "two plans, one number" ambiguity.
2. **Give Phase 7 a no-seam fallback** — commit to closing the ZIP64 / data-descriptor / silent-`DOMParser` gaps *in place* if the import-layer seam doesn't exist, so the phase delivers correctness value regardless of relocation feasibility.
3. **Add a characterization-test step before Phase 5** that pins the observable abort/dedup/generation behavior of all three current pipelines, so the extraction's "equivalence" is measured against a baseline rather than asserted.
4. **Concretize Phase 9** — confirm (with a grep result) whether a shell diagnostic channel already exists, define the subsystem-tag taxonomy, and state the relationship to the kernel-010 observability work it cites.
5. **Note the realm/HMR test caveat for Phase 8c** — since `lifecycle-state` is realm-global mutable singleton state, specify how the "one provider unregistered leaves co-tenants" test isolates module state between cases (fresh module registry / explicit reset) so the test itself isn't order-dependent.
