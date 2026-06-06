Rating: 8/10

Summary judgment

This is a strong, production-relevant plan for `kernel/src/document`. It correctly identifies the folder as the document session spine and ties the work to real lifecycle, provider, import durability, host authorization, export, SDK, and browser app paths. The best parts are the explicit invariants, the insistence on preserving Rust/Yrs authority, and the concrete production bugs/contract smells it targets: optional provider identity, inbound updates matching `Provider.name`, high-water-mark validation not using the current snapshot on consume, host success diagnostics emitted as denial/failure events, and boolean/timer-driven deferred import durability.

The rating is not higher because the plan is very broad and sometimes names the desired end state without fully pinning the migration contract. It should more explicitly separate type-contract changes from module extraction, define the dependency order for public status/storage mappings, and add verification gates for the adjacent type/host packages it proposes to touch.

Major strengths

- The source assessment is accurate. `DocumentLifecycleSystem` is a 2,201-line side-effect owner, the XState machine is pure, provider attach really runs after bridge start/context wiring, `RustDocument.applyProviderUpdate()` currently matches `p.name === envelope.providerRefId`, provider identity/capability methods are still optional on the `Provider` interface, and host diagnostics currently reuse `storage.failure` / `documentAuthorization.denied` for successes.
- The plan keeps changes on the production path: document factory, SDK boot, workbook export, compute mutation, host-backed construction, provider attach/checkpoint/close, browser import, and collaboration sidecars are all treated as real consumers rather than test-only surfaces.
- The contract inventory is unusually good. It calls out lifecycle phase, storage phase, gate mode, public status, provider identity, import-initialize staging, high-water-mark proof validity, host nonce/source validation, and local dispose versus destructive host operations.
- The sequencing starts with a canonical lifecycle/storage/write-gate table before extraction, which is the right prerequisite for making the later module split safe.
- The verification section includes focused document tests, broader kernel/SDK gates, and behavioral browser scenarios instead of relying only on typecheck.

Major gaps or risks

- The plan should distinguish the two existing `PHASE_TO_GATE_MODE` concepts more carefully. One map is machine-state oriented and one is storage-phase oriented; unifying them is right, but the plan needs to say which domain is canonical and how `DocumentStoragePhase`, `MogDocumentStatus`, and write-gate mode derive from it.
- Public and package-boundary impacts are under-specified. Changes to diagnostics, lifecycle phase/status, provider identity, and host-backed inputs likely touch `@mog-sdk/types-document`, `@mog-sdk/types-host`, `@mog/kernel-host-internal`, `@mog-sdk/kernel/storage`, and SDK conformance fixtures. The plan mentions some of these but does not make them explicit implementation slices or gates.
- The high-water-mark section identifies the right bug, but it needs a crisper rule for which mutations advance the public watermark. `syncApply()` uses the same compute mutation pipeline as public edits, so provider replay, collaboration inbound updates, import hydration, undo/redo, and public user mutations need an explicit origin taxonomy before wiring `advanceWatermark()`.
- The provider conformance expansion is good but should require a discovered provider matrix as the first deliverable. Existing shared conformance covers some providers through per-provider tests, while the central extended suite only covers Memory/Test; the plan should avoid assuming a single harness shape works for read-only snapshot, host callback, IndexedDB, filesystem, Tauri, object store, and database log providers without explicit exemptions.
- The extraction of `DocumentLifecycleSystem` into several orchestrators is architecturally reasonable but risky without a stated "no behavior change" first pass and fixture-backed actor input/output contracts for each extracted module.
- Collaboration is correctly flagged, but the plan leaves the provider-versus-sidecar decision open. That is acceptable for research, but an implementation plan should define the decision checkpoint and the minimum contract that must exist before touching collab lifecycle code.

Contract and verification assessment

The contract focus is the plan's strongest feature. It does not propose a TypeScript document store, does not move state authority out of Rust/Yrs, keeps the lifecycle machine pure, preserves provider replay ordering, treats host-backed storage as fail-closed, and separates local cleanup from host-authorized destructive operations.

The verification list is good for `@mog-sdk/kernel`, but incomplete for the cross-package contracts the plan names. Add gates for `@mog-sdk/types-document`, `@mog-sdk/types-host`, `@mog/kernel-host-internal`, and SDK public boundary/conformance tests when those contracts move. For browser behavior, the plan correctly requires real app import/reload/two-tab checks, but it should also require host-backed import/export proof scenarios through the actual host-internal construction path, not only direct unit tests.

No implementation commands were run for this review.

Concrete changes that would raise the rating

- Add a first milestone that produces an explicit transition table: machine state, storage phase, public document status, write-gate mode, import durability state, allowed mutation origins, and allowed public operations.
- Define a mutation-origin taxonomy for high-water marks: public user mutation, undo/redo, provider replay, provider inbound update, collaboration inbound update, XLSX/CSV import hydration, default-sheet bootstrap, and recovery. State exactly which origins advance export-invalidating watermarks.
- Add package gates for contract changes: `pnpm --filter @mog-sdk/types-document typecheck`, `pnpm --filter @mog-sdk/types-host typecheck`, `pnpm --filter @mog/kernel-host-internal typecheck`, plus the relevant SDK conformance suites.
- Require a provider coverage matrix generated from `providers/index.ts`, with each provider marked shared-conformance, provider-specific-conformance, read-only-exempt, runtime-exempt, or intentionally unsupported.
- Split the `DocumentLifecycleSystem` extraction into a behavior-preserving pass before semantic changes, with typed actor input/output fixture tests for each new orchestrator module.
- Replace the open-ended collab decision with a required architecture decision record before implementation: either register websocket collab as a provider or define a lifecycle-owned sidecar contract with explicit write-gate, identity, attach/detach, and diagnostics rules.
