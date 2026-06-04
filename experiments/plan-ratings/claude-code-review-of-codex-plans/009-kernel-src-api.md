Rating: 8/10

# Review of 009 - Kernel API Gateway Improvement Plan


## Summary judgment

This is a strong, evidence-grounded plan for `mog/kernel/src/api`. Nearly every concrete
claim I spot-checked against the source is accurate, the architectural framing matches how the
folder actually works, and the sequencing/dependency reasoning is sound. Its headline idea —
replacing reviewer-memory with an executable contract-inventory gate derived from the same
`types/api` source the SDK spec generator uses — is exactly the right structural lever for a
behavior gateway that has demonstrably drifted from its docs. It loses points for very large,
under-phased scope, several real product/contract decisions deferred to "decide during
implementation," an undercounted `OperationResult` enumeration, and performance work that is
asserted as a bottleneck without a profiling gate to prove it.

## Verification of the plan's factual claims

I inspected the public source folder read-only. Findings:

- Folder layout (`index.ts`, `workbook/`, `worksheet/`, `document/`, `app/`, `namespaces/`,
  `internal/`, `__tests__/`) matches the plan exactly.
- `index.ts` classification of root exports (stable unified API, experimental namespaces,
  internal document lifecycle, introspection, cell-conversion helpers) matches the file.
- All nine enumerated `OperationResult` operation modules exist. The mixed error model is real:
  `OperationResult` appears in 25 files including facade code (`worksheet-impl.ts`,
  `workbook-impl.ts`) and sub-APIs (`charts.ts`, `tables.ts`, `pivots.ts`, `hyperlinks.ts`).
- The dead-config claim is correct and well-targeted: `create-workbook.ts:81` forwards
  `writeFile: options.writeFile`, `types.ts:74-77,149-151` advertises injection, yet
  `workbook-impl.ts:1645-1658` `save(path)` imports `node:fs/promises` directly and never
  consults the injected `writeFile`. The contract truly advertises a path that the
  implementation ignores.
- The README-staleness claim is correct: `README.md` documents a `sheet/` directory ("35
  modules of raw mutation logic … return `OperationResult`") and a `worksheet/ vs sheet/`
  section, but no `sheet/` directory exists — operations live in `worksheet/operations/`.
  `unwrap.ts` is likewise absent. The README is the source-of-truth-shaped artifact the plan
  rightly wants demoted to generated facts.
- `ensureRangeEditable` (worksheet-impl.ts:591) and `copyRangeFrom` (workbook-impl.ts:1399)
  exist as named in the performance section.
- External dependencies referenced are real: `runtime/sdk/scripts/generate-api-spec.ts`,
  `types/api/src/api/workbook.ts`, `types/api/src/api/worksheet.ts`, and the
  `document/__tests__/sdk-conformance/` suite all exist. The proposed
  `internal/api-execution.ts` correctly does not yet exist.

This level of accuracy is the plan's strongest credential.

## Major strengths

- **Contract-as-source-of-truth gate.** Building an AST-driven API inventory that fails when a
  contract member lacks an implementation owner, when an implementation exposes an undeclared
  public method, or when public/friend code returns `OperationResult` — and routing it through
  the *same* discovery the SDK spec generator uses — directly attacks the observed drift
  (stale README, hand-maintained sub-API lists). This converts a class of regressions into CI.
- **Correct invariant inventory.** The "contracts and invariants to preserve" section reads like
  it was written from the code: referential stability of cached workbook/sub-APIs, sync
  semantics of `activeSheet`/`sheetCount`/viewport, Rust-as-source-of-truth with JS read-model
  caches, "denied capability = absent interface," idempotent close/dispose. These are the real
  load-bearing contracts.
- **React-stability risk called out explicitly.** The biggest practical hazard of splitting the
  coordinator classes is breaking referential stability the spreadsheet UI depends on; the plan
  names it and requires identity tests. This matches how the consumer actually behaves.
- **Layered verification gates.** Gates are correctly conditioned by blast radius: kernel
  test/typecheck/build always; snapshot/declaration-rollup/publish-readiness only when public
  types move; shell/spreadsheet/runtime caller suites only when callers are touched; cargo/clippy
  only if bridge methods are added. The declaration-rollup and contracts-declaration-identity
  gates are exactly the right ones for this folder.
- **Good non-goals and sequencing.** Not redesigning the public shape, refusing `OperationResult`
  compatibility shims (convert the whole category), not optimizing mocks, not making `mog` depend
  on `mog-internal`. Dependency ordering (inventory → envelope → normalization → coordinator
  split → lifecycle) is logical and justified.

## Major gaps or risks

- **Scope is a program, not a plan.** Taken together this is a near-total refactor of the API
  folder plus contract source plus docs/reference generation plus shell/runtime callers plus a
  compute-bridge change. The "parallelizable workstreams" framing is reasonable, but there is no
  phasing into independently shippable, separately-mergeable increments with per-phase acceptance
  beyond the shared gates. Risk of a long-lived divergent branch is high and unaddressed (no
  rollback/incremental-merge strategy).
- **Multiple real decisions deferred to implementation.** "Decide and enforce the headless
  timezone rule," "honor or remove `WorkbookConfig.writeFile`," and "graduate or retire the app
  friend path" leave product/contract choices open. For an executable spec these are precisely
  the decisions that should be made *before* coding, because each forks the work substantially.
  The app-path question gates an entire workstream on an undocumented product decision the plan
  itself flags as a blocker — yet proposes no mechanism to resolve it.
- **`OperationResult` enumeration undercounts.** The "Target at least" list names nine modules,
  but `OperationResult` also appears in `floating-object-operations.ts`,
  `drawing-operations.ts`, `equation-operations.ts`, `shape-operations.ts`,
  `text-effects-operations.ts`, and sub-API facades (`charts.ts`, `tables.ts`, `pivots.ts`,
  `hyperlinks.ts`, `structure.ts`, `outline.ts`, `print.ts`). The "convert the complete category
  in one pass" instruction is correct in spirit, but the partial list could mislead an
  implementer into scoping to nine. The plan should instruct discovery (grep/AST) rather than a
  hand list, or explicitly mark the list non-exhaustive.
- **Performance items asserted without measurement.** Objective 7 says "only where the API layer
  is the actual bottleneck," but no profiling/benchmark step is included to establish that
  `ensureRangeEditable` per-cell loops or `copyRangeFrom` cell-by-cell copy are real production
  hot paths. Both fixes require compute-bridge changes (the most expensive, cross-team part of
  the plan) and are the least specified — no proposed bridge method signatures, no threshold.
  This is the section most likely to expand unboundedly or be skipped.
- **Inventory-gate hinges on visibility metadata that may not exist.** The gate's "public-looking
  method not in contracts" check and noise-avoidance depend on explicit visibility metadata, but
  the plan does not pin down its source (JSDoc `@stability` tags as in `index.ts`? naming
  convention? a new annotation?). This is the crux of the whole contract-driven approach and is
  underspecified; the gate's value collapses if visibility cannot be derived reliably.

## Contract and verification assessment

Contract clarity is above average. The API-matrix schema (canonical path, root, kind, async
model, visibility, deprecation, owner file, implementation file) is concrete and testable, and
the invariant list is accurate to the code. The verification gates are the plan's second
strongest feature: correctly layered, naming real repo gates
(`check:api-snapshots`, `check:declaration-rollups`, `check:contracts-declaration-identity`,
`check:publish-readiness:fast`), and including UI smoke paths for the consumer that relies on
sync reads and stable sub-APIs.

Two weaknesses keep this from full marks. First, the inventory gate's dependency on
visibility/stability metadata is unspecified — the single most important new gate rests on an
undefined input. Second, there is no profiling gate backing the performance claims, so Objective
7's own "only where it is the actual bottleneck" guard is unenforced. Error-code stability is
handled well (explicit assertion tests for code/operation/cause/JSON serialization), which is the
right guard against the normalization pass silently changing `MogSdkError` codes.

## Concrete changes that would raise the rating

1. **Phase the program into mergeable slices** with explicit acceptance per phase. Minimum:
   (a) inventory gate + README demotion; (b) execution envelope; (c) `OperationResult`
   normalization; (d) coordinator split + lifecycle; (e) app path; (f) performance. State which
   phases can land independently behind the inventory gate, and a rollback story for the
   coordinator split.
2. **Resolve the deferred decisions up front, or make them explicit gating questions** with a
   default: headless-timezone enforcement, `WorkbookConfig.writeFile` honor-vs-remove (the
   evidence above shows it is currently dead — recommend a default and verify no host passes it),
   and the app-path keep/retire decision with a named owner.
3. **Replace the hand list of `OperationResult` modules with a discovery instruction** and state
   that the conversion target is "every module the inventory gate flags," noting the additional
   modules above so the one-pass scope is not undercounted.
4. **Add a profiling step before the performance workstream** that demonstrates the per-cell
   protection loop and cell-by-cell copy are real bottlenecks at representative range sizes, and
   sketch the proposed bridge method signatures so the cross-team cost is scoped.
5. **Specify the source of visibility metadata** for the inventory gate (e.g., the existing
   `@stability` JSDoc tags visible in `index.ts`) and how friend/internal members are
   distinguished from public, since the gate's correctness depends entirely on this.
6. **Enumerate which sub-APIs must be referentially stable vs may be freshly created**, rather
   than "where the contract and UI expect stability," so the identity tests have a precise oracle.

## Files inspected (read-only)

`mog/kernel/src/api/{index.ts, README.md, app/README.md}`,
`workbook/{workbook-impl.ts, create-workbook.ts, types.ts}`,
`worksheet/worksheet-impl.ts`, `worksheet/operations/*`, `internal/`,
and existence checks against `types/api/src/api/*`,
`runtime/sdk/scripts/generate-api-spec.ts`, and `document/__tests__/sdk-conformance/`.
