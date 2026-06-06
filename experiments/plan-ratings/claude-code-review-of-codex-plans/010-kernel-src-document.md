Rating: 8/10

# Review of `010-kernel-src-document.md`

Folder under review: `mog/kernel/src/document` — document lifecycle, providers, persistence, ownership.

## Summary judgment

This is a strong, evidence-grounded plan. Its claims about the current code are accurate to the file and, in one important case, to the line. It correctly identifies the central architectural weakness of this folder (contracts smeared across comments, parallel maps, provider-specific implementations, and adjacent consumers) and proposes to make lifecycle phase, storage state, provider identity, mutation watermark, import durability, and host authorization into explicit, executable contracts without rewriting the proven core. It is the kind of plan that could be handed to multiple implementers with confidence.

What holds it back from a 9–10 is scope and a few deferred decisions: it is effectively a 12-workstream program for an 8-agent fan-out, several objectives end with "decide whether…" rather than a committed contract, and there are no per-workstream acceptance criteria beyond "add tests." For a folder this load-bearing, that breadth is a real landing risk.

## Major strengths

- **Verified, precise grounding.** Spot checks confirm the plan read the actual code rather than guessing:
  - The duplicated `PHASE_TO_GATE_MODE` map genuinely exists in both `document-lifecycle-system.ts` and `write-gate.ts` (objective 1 / step 1).
  - `RustDocument.applyProviderUpdate()` really matches inbound updates with `p.name === envelope.providerRefId` (`rust-document.ts:587`), and `getIdentity?.()` falls back to `provider.name` (`rust-document.ts:697-783`) — exactly the identity-vs-name conflation step 3 targets.
  - `document-lifecycle-system.ts` is 2,201 lines; the plan's "2,200-line owner" is literal, not rhetorical.
  - The high-water-mark bug in step 4 is real and subtle: `HostOperationGate.authorizeExport()` (`host-operation-gate.ts:475-476`) captures `currentSnapshot = writeGate.captureHighWaterMark()` and then calls `registry.consumeProof(proofId, sessionId)` **without passing it**. `consumeProof` delegates to `validateProof` with no `currentSnapshot`, so the snapshot-mismatch branch (`high-water-mark-registry.ts:103-116`) is dead code on the export path. The plan's wording — "the current code computes a current snapshot but the validation path must actually compare it" — is exactly right. Identifying a live bug at this precision is the single best signal in the plan.
  - Provider protocol escape hatches are real: `getCapabilities?()`, `getIdentity?()`, and `storageCursor?()` are optional in `providers/provider.ts`, with `stateVector()` deprecated in favor of `storageCursor()` — matching step 6 exactly.
- **Respects the invariants instead of inventing a rewrite.** The "preserve or strengthen" section is unusually disciplined: RustDocument stays the sole implementation, the machine stays pure, Rust/Yrs stays authoritative, provider attach stays post-STARTED/post-wiring, sheet truth is post-attach, FIFO/non-reentrant fan-out is preserved. These are the load-bearing properties, and the plan refuses to trade them for tidiness.
- **Production-path discipline.** Step 4 is explicit that the correct fix is wiring the real compute mutation path in `bridges/compute/compute-core.ts`, "not to increment counters in tests." Non-goals forbid a TS persistence store, host→IndexedDB silent fallback, and `dispose()`-as-deletion. This is the right altitude.
- **Sequencing with a real critical path.** The contract table lands before extraction so all extracted modules share one transition contract; HWM depends on compute-core; export proof depends on workbook-impl. Dependencies are named, not hand-waved.
- **Edge-case catalogue is genuinely thorough** — dispose-from-every-state, replayed nonces, stale epochs, Web Lock promotion, materializer mismatch by ref/kind/role/authority/scope/fingerprint. This reads like someone who has debugged this folder.

## Major gaps or risks

- **Program-sized scope presented as one plan.** Twelve implementation sections spanning lifecycle contracts, a 2,200-line extraction, provider-identity migration across ~11 providers, cross-package HWM wiring, an import-durability sub-machine, conformance expansion, diagnostics, close/dispose/destroy semantics, collab ownership, mirror seeding, and public-export surface. The parallelization note (Agents A–H) acknowledges this, but there is no statement of what a *single landable PR* looks like, nor a minimal first slice. Risk: this becomes a long-lived branch that drifts.
- **Deferred decisions weaken contract clarity.** Two of the highest-leverage items end open: step 4 leaves "registry-issued proofs **or** a documented live-kernel proof contract" unresolved, and step 10 leaves collab as "Provider **or** explicit sidecar." Both forks materially change the contract other agents code against. The plan should pick a default and name the tripwire that would flip it, rather than leaving the decision to implementation time.
- **No definition-of-done per workstream.** Each step says "add tests," but there are no acceptance criteria (e.g., "exhaustiveness test fails to compile when a machine state is added without a gate-mode row"). For a contract-first plan, the contracts' enforcement conditions should be spelled out.
- **Adjacent-package coupling is underspecified.** The plan repeatedly says diagnostics "may require host type changes … coordinate with `@mog-sdk/types-host`," but doesn't sketch the proposed success/info diagnostic kind or confirm it's absent today. Same for the contract packages named in scope. A cross-package type change is the most likely source of a stall, and it's the least concrete part of the plan.
- **Public-surface objective is hedged.** Step 12 wants `RustDocument` and lifecycle types "internal … unless deliberately public today." They *are* currently exported from `document/index.ts` (lines 15-52). The plan should state whether those exports are deliberate or accidental before proposing package-boundary tests, otherwise it risks breaking a real consumer.

## Contract and verification assessment

- **Contracts:** The proposed `{ machineState, storagePhase, gateMode, publicStatus }` row model with exhaustiveness tests is the right shape and directly attacks the duplicated-map problem that exists in the code today. The `getProviderRefId(provider)` helper and "name is diagnostic only" rule are crisp and testable. The import-durability state enumeration (`notImport → hydratedPendingDurability → scheduled → establishingDurability → durable/failed/skippedEphemeral`) replaces the current boolean+timer coordination with something verifiable. Where the plan commits to a contract, the contract is clear; where it defers (HWM proof source, collab ownership), clarity drops.
- **Verification:** The focused test list maps onto real files (`lifecycle-conformance.test.ts`, `host-integration.test.ts`, `inbound-updates.test.ts`, `provider-conformance.test.ts`, `collab-e2e.test.ts`, etc. all exist) plus plausibly-new ones (`deferred-hydration-scheduler.test.ts` exists; some are net-new). The behavioral matrix (browser replay, XLSX/CSV deferred hydration, two-tab Web Lock, headless `awaitImportDurability`, host-backed no-globals, failure paths) is the strongest part of the verification story and is well matched to the invariants. Gaps: no gate ties a *specific* test to a *specific* contract as a merge condition, and the plan correctly flags that jsdom is insufficient for IDB/Web Lock/unload but doesn't name the real-browser harness that would close that gap.

## Concrete changes that would raise the rating

1. **Add a minimal first landable slice and a PR-decomposition.** State which one PR lands first (the lifecycle/storage/write-gate contract table + reducer + exhaustiveness test, per the stated critical path) and how the remaining workstreams attach to it. This converts a program into a sequence.
2. **Resolve the two open forks with a default + tripwire.** For HWM: commit to registry-issued proofs as the production contract and state what evidence would justify the live-kernel alternative. For collab: pick Provider-vs-sidecar (or state the spike that decides it) so dependent agents aren't blocked.
3. **Specify the export-proof fix as a concrete diff target.** The bug is pinpointed; name it: pass `currentSnapshot` from `authorizeExport` into `consumeProof`/`validateProof` so the existing `PROOF_SNAPSHOT_MISMATCH` branch becomes live, and add the regression test (issue → mutate → authorize must fail; issue → authorize-immediate must pass). Note that `currentSnapshot` is currently an unused local.
4. **Add per-workstream acceptance criteria**, especially the enforcement behavior of each new contract (compile-time exhaustiveness failure, conformance-matrix failure for an uncovered exported factory, fail-closed assertion for required host providers).
5. **Pin down the cross-package coupling.** Confirm whether `@mog-sdk/types-host` has a success/info diagnostic kind today; if not, include the proposed type addition rather than "coordinate." Do the same for the named contract packages and the `document/index.ts` public exports (state which are intentional).
6. **Name the real-browser verification harness** for IDB migration/compaction, Web Locks, and `flushSync` unload, since the plan itself flags jsdom as insufficient for final confidence.

## Verification note

Only one file was created by this review: `mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-codex-plans/010-kernel-src-document.md`. No production code, tests, fixtures, or the reviewed plan were modified.
