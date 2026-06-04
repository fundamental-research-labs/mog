Rating: 9/10

# Review of 010 — `mog/kernel/src/document`


## Summary judgment

This is a high-quality, evidence-driven plan. It demonstrates real, verifiable knowledge of the folder rather than generic refactoring boilerplate. I spot-checked the plan's most load-bearing claims against the live tree and they hold:

- The inbound-origin race is real: `rust-document.ts:617` sets `this._currentUpdateOrigin = `provider:${envelope.providerRefId}``, then yields on `await import('./providers/bridge-provider-doc')` at `:619` before `applyUpdate` at `:621`, with reset in `finally` at `:623`; the synchronous queue tag reads that shared field at `:1055`. Confirmed verbatim.
- `_appendActive` is set at `:555,864,1121` and read at `:344` but never reset (latches) — confirmed.
- `HighWaterMarkProofRegistry` uses a `Map` with only validate-time/manual `pruneExpired()` (`:31`, `:135`) — confirmed.
- `provider.ts:115` `stateVector()` is `@deprecated` in favor of `storageCursor()` yet still mandatory — confirmed, including the "not a real Yrs state vector" framing.
- `TauriFileProvider` throws `TAURI_SIDECAR_NOT_WIRED_MSG` at `:147` while remaining registered — confirmed.
- The duplicated `roleOrder` map and dual legacy/host branches in `document-lifecycle-system.ts` (`:1291` and `:1467`) and 17 `legacy` references — confirmed (plan says 18; immaterial).
- The provider-boilerplate duplication (`pendingUpdates`/`flushing`/`detached` and `flushSync` drain across `memory`/`filesystem`/`object-store`/`database-log`) — confirmed.
- README still describes RustDocument owning IndexedDB persistence + "30s idle debounce / 100 mutation threshold" auto-save (`README.md:43-53`), contradicting the orchestrator-only model — confirmed.
- Every test file cited as a verification gate exists (`legacy-bypass-guards`, `legacy-path-inventory`, `close-checkpoint`, `rust-document-orchestrator`, `inbound-updates`, `deferred-hydration-scheduler`, `host-no-globals-sentinel`, `providers/__tests__/conformance.ts`, `provider-conformance.test.ts`, etc.).

The plan correctly separates correctness defects (Phases 1–2) from hygiene/de-duplication (Phases 3–6) and contract/observability work (Phases 7–8), preserves the documented invariants explicitly, and names the cross-folder blast radius accurately.

## Major strengths

- **Evidence is concrete and accurate.** Nearly every assertion carries a file:line citation that checks out. This is the difference between a plan that understands the code and one that pattern-matches.
- **Correctly prioritizes the highest-risk seam.** It identifies the legacy/host-backed boundary and the two orchestrator concurrency windows as the highest-value targets, and explicitly refuses to collapse the two semantically-distinct paths (Phase 6 shares only mechanical sub-steps). That restraint is the right call.
- **Invariants are first-class.** The "contracts to preserve" section is unusually strong: pure-machine/side-effect split, FIFO/no-reentrancy/back-pressure, `flushSync` synchronicity-before-first-put, apply-before-emit, fail-closed host path, WriteGate phase mapping, and the collab R1 bypass are all named with citations and tied to the phases that could violate them.
- **Verification gates are real and specific.** Conformance-suite-as-equivalence-gate for the refactor phases (3–5) is the correct framing, and the four new regression tests map cleanly to the four substantive changes.
- **Honest scoping.** Out-of-scope coupling (collab → plan 011, contracts/types → 001/002/005–007, bridge → 012) is identified with the right rationale, and the contracts declaration-rollup dependency is flagged.

## Major gaps or risks

- **Phase 1/2 regression tests under-specify the hardest part: deterministically forcing the race.** Reproducing an async interleaving (two concurrent `applyProviderUpdate` calls; enqueue-mid-promotion) in a test is non-trivial — it usually requires injecting a controllable deferral at the exact yield point. The plan asserts the tests will "interleave two concurrent calls" but does not describe the seam that makes the interleaving deterministic. Without that, the regression test risks being a false-green. This is the plan's weakest verification point.
- **Phase 1 offers a menu, not a decision.** It proposes hoisting the dynamic import *and* per-call origin plumbing *and*, as a fallback, serializing inbound applies through an `applyChain`. The fallback ("if the engine callback cannot carry a parameter") hinges on the `subscribeUpdateV1` signature, which is in plan 012's folder. The plan should commit to checking that signature first and pick one mechanism; serializing inbound applies has different latency/causality implications than per-call binding and shouldn't be a silent fallback.
- **Phase 7 has a dangling reference and unresolved blocker.** The text says "(See blocked-evidence note below; investigation first.)" but there is no such note in the document. The Tauri sidecar contract availability is genuinely unknown, so Phase 7 is really "investigate, then either wire or unregister" — fine as a decision tree, but it is the one phase whose primary path (wire the IPC) is not actually specified, only gestured at.
- **Phase 5 blast radius is the largest single risk and is only partially de-risked.** Making `getCapabilities()`/`getIdentity()` mandatory and renaming `stateVector()` ripples to `sdk-storage-adapter.ts`, the `@mog-sdk/types-document` mirror, and any external SDK consumer. The mitigation (land additive presets first, rename in one coordinated commit) is sound, but the plan does not confirm whether the interface is in fact mirrored in `types-document` — it says "may be." That uncertainty should be resolved before committing to Phase 5, since the answer changes whether this is an in-folder rename or a contracts-coordinated breaking change.

## Contract and verification assessment

Strong. The plan treats the existing conformance and boundary suites as the acceptance gate and verifies (implicitly) that they cover the invariants it must not break — and those files genuinely exist. The mapping from phase → gating tests is explicit and correct. The four new regression tests are the right additions. The one weakness, noted above, is that the two correctness-fix regression tests describe *what* to assert but not *how* to make the async race deterministic, which is the actual engineering difficulty. The static gates (kernel typecheck, ESLint import-boundary rules, contracts rollup when Phase 5 touches mirrored types) are correctly enumerated, and the plan appropriately notes it does not itself run them per task constraints.

## Concrete changes that would raise the rating

1. **Specify the deterministic-interleaving seam for Phases 1 and 2.** State how the regression tests force the race — e.g., an injectable deferral/await-hook at the dynamic-import point, or a test double for `bridge-provider-doc` that resolves on command — so the new tests can actually fail before the fix.
2. **Resolve the `subscribeUpdateV1` signature question up front and commit to one Phase 1 mechanism** (per-call origin binding vs. `applyChain` serialization), noting the causality/latency trade-off, rather than presenting serialization as a conditional fallback.
3. **Confirm whether the `Provider` interface is mirrored in `@mog-sdk/types-document`** and, based on the answer, state explicitly whether Phase 5 is in-folder or a contracts-coordinated breaking change with a defined landing order.
4. **Restore the missing "blocked-evidence note" for Phase 7** (or remove the dangling reference) and define the concrete investigation step that gates wire-vs-unregister, with a default if the sidecar contract is absent.
5. **Add an explicit acceptance assertion for `flushSync` synchronicity in the Phase 3 base class** — e.g., a conformance check that fails if any `await` precedes the first durable `put`/`writeFileSync` — since the plan itself flags this as the subtlest correctness hazard of the extraction.
