Rating: 8/10

Summary judgment

This is a strong, production-aware plan. It correctly identifies that `domain/formatting` is currently split between an advisory, non-executable format registry and merge orchestration wrappers that still contain TypeScript-side loops/stubs despite compute bridge support. The plan is especially good at treating formatting as a cross-surface contract rather than a UI-only concern, and it calls out the right adjacent owners: TS/Rust `CellFormat`, wire drift, XLSX import/export, compute storage, canvas/PDF/clipboard projection, worksheet APIs, and spreadsheet UI merge flows.

The main reason it is not a 9 or 10 is that several work items remain plan-shaped rather than contract-shaped. The plan says to create an executable coverage matrix and normalize merge receipts/semantics, but it does not fully specify the exact schemas, allowed status values, result payloads, public import paths, or compatibility transition rules implementers must converge on. It also misses one existing bridge fact: there is already a `getMergesInViewportSpatial` production bridge method, so the range/viewport query section should explicitly reuse or reconcile that method instead of implying both viewport and range bridge methods need to be added from scratch.

Major strengths

- The scope is grounded in the actual folder: `format-registry.ts` is hand-maintained and only locally consumed, while `merges.ts` still performs range filtering, row-by-row `mergeAcross`, `clearAll` loops, no-op `validateAndClean`, no-op `subscribe`, and a false-negative `checkMergeDataLoss`.
- It frames the registry as an executable contract tied to evidence, not documentation. That is the right architectural direction for formatting semantics shared by UI, compute, and file IO.
- It preserves the correct ownership boundary: compute/Rust remains authoritative for merge validity, identity-backed storage, data-loss detection, and persisted format state; the TS domain layer should adapt, orchestrate, and expose metadata.
- It identifies real production-path gaps across worksheet structure, operation helpers, spreadsheet action handlers, viewport refresh, and user-visible merge warning behavior.
- Verification guidance is appropriately broad and includes TS typecheck, package/API checks, Rust compute gates when compute changes, file-IO roundtrip tests, and real UI exercise for UI-visible merge behavior.
- The parallelization notes are plausible and separate registry inventory, evidence audit, merge bridge consolidation, viewport/API cleanup, and UI verification.

Major gaps or risks

- The executable registry schema is under-specified. Fields like `ooxmlReadPath`, `computeStorage`, `canvasRender`, `evidence`, and `notes` need precise types and status enums so "supported", "preserved only", "derived", "not applicable", and "unknown gap" cannot be conflated.
- The evidence model needs a stricter contract. A list of file paths or comments will not by itself prove import/export/render support unless tests assert those paths or fixture names in a stable way.
- The merge query plan should account for existing `getMergesInViewportSpatial`. The likely work is to route domain viewport callers to that method and add only the missing range-shaped bridge if needed, or define why a new public method name replaces the spatial one.
- Merge mutation result contracts are not detailed enough. The plan asks receipts to come from actual mutation data and removed counts, but does not specify the `MutationResult.data` shape or how row-skipped `mergeAcross` results map back to requested rows.
- The all-or-nothing versus best-effort behavior for `mergeAcross` is correctly flagged, but it should be resolved before implementation begins. Leaving it as "prefer" risks agents making incompatible choices across compute, API receipts, and UI undo labels.
- `checkMergeDataLoss` currently returns only `[boolean, number]` from compute, while the UI dialog stores cell coordinates. The plan mentions adding coordinates if needed, but should choose a contract now: count-only warning text, representative coordinates, or complete coordinates with limits.
- The packaging item is directionally right, but needs a concrete decision about whether runtime registry imports are public API, kernel-internal API, or publish-readiness-only tooling.
- The plan combines two large workstreams: formatting coverage registry and merge orchestration. That is acceptable, but it needs milestone boundaries so registry failures do not block merge correctness fixes, or vice versa.

Contract and verification assessment

The contract assessment is strong on invariants: sparse `CellFormat`, compute-owned cascade and merge validation, zero-based inclusive merge coordinates, no TS shadow state, no manual domain events, and public dependency direction are all explicitly preserved. The plan also correctly connects registry exhaustiveness to the existing TS/Rust drift infrastructure and calls for allowlists with reasons.

The verification plan is strong but should be made more enforceable. Registry exhaustiveness tests, wire drift tests, merge unit tests, XLSX roundtrip fixtures, and UI E2E tests through real input paths are the right gates. Missing pieces are exact package commands per affected package, expected fixture names or coverage dimensions for registry evidence, publish-readiness checks for the selected runtime import path, and a browser scenario that proves off-viewport merge data loss is detected through compute rather than viewport reads.

Concrete changes that would raise the rating

- Define the exact `FormatPropertyDef` replacement type, including status enums, allowed evidence kinds, allowed exception categories, and how nested border paths are represented.
- Add a registry inventory table before implementation: all current TS `CellFormat` fields, Rust-only fields, aliases/renames, nested border subfields, and OOXML-preservation-only fields.
- Decide the public runtime import path for the registry and name the package/API or publish-readiness test that will enforce it.
- Rework the merge query step to say whether `getMergesInViewportSpatial` is reused, renamed, wrapped by `domain/formatting/merges.getInViewport`, or superseded.
- Specify `MutationResult.data` payloads for merge range, merge across, clear all, validate/clean, and no-op cases, then require public receipts to be derived from those payloads.
- Choose the `mergeAcross` failure model before coding: transactional all-or-nothing, best-effort with explicit skipped-row reporting, or compute error on any overlapping row.
- Choose the merge warning data-loss contract now, especially whether UI gets full coordinates, capped coordinates, or count-only copy from compute.
- Split sequencing into two independently shippable phases: executable formatting coverage registry, then merge compute/API/UI consolidation, each with its own required gates.
