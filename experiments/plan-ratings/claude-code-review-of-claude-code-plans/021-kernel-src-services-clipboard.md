Rating: 8/10

# Review — 021 Kernel Clipboard Service

## Summary judgment

This is a strong, evidence-grounded plan. Every concrete claim I spot-checked against the source holds: the local `ClipboardOperation = 'copy' | 'cut'` vs. contracts `'copy' | 'cut' | null` divergence (`types.ts:93` vs `types/api/src/services/index.ts:19`); the strong-vs-structural payload typing (`CellValue[][]` vs `unknown[][]`, `Partial<CellFormat>` vs `Record<string, unknown>`); byte-identical `clearAfterCut`/`clearAll` (`clipboard-service.ts:70-84`); write-only `timestamp` (written at `:54`/`:66`, absent from `getClipboardServiceSnapshot` at `:246`); the unconditional `actor.subscribe(() => this.emitChange())` (`:280`); the caller set in `clipboard-machine.ts` (only `copy`/`cut`/`clear`/`markStale`/`markFresh` at lines 550/575/600/625/686/712/734/743 — no paste-lifecycle calls); and the scoped API surface omitting the paste methods (`scoped-clipboard-api.ts`). The plan correctly identifies that `IKernelServices.clipboard` is already typed as the contracts `IClipboardService` (`types/api/src/services/index.ts:337`), which sharpens INV-3.

The decomposition into Track A (folder-local type/hygiene, low risk) and Track B (cross-app paste wiring, behaviorally significant) with an explicit "A de-risks B" ordering is exactly right. The invariants (INV-1…INV-5) are crisp and individually testable, and the test matrix maps onto them. This is well above the median plan in this set.

The reason it is not a 9–10 is that its headline production fix (Track B) rests on a consumer the plan never actually locates, and it is honest enough to say so — which is good practice but leaves the central justification unproven.

## Major strengths

- **Verified, not asserted.** The plan reads like it traced every caller. The "write-only mirror" characterization of the kernel service is accurate and is the key insight that reframes the whole folder.
- **Honest framing of the contract dishonesty.** Calling out that the service advertises a full copy/cut/paste lifecycle while production drives only half — "dead code that silently breaks the cross-app cut contract" — is the correct diagnosis, and the "wire it or remove it, never leave it dangling" non-goal (line 124) prevents a cosmetic fix.
- **Type unification is concretely specified.** Re-export-from-contracts, keep `ClipboardContext`/`ClipboardEvent` kernel-local, reconcile the `null` discrepancy by typing the context operation as nullable for pass-through projection — this is implementable as written, not hand-wavy.
- **Risk awareness is real.** The contracts-dependency-direction caveat (can `@mog/types-api` depend on `core`/`views`? verify first) and the "type-tightening may surface latent `unknown[][]→CellValue[][]` mismatches — fix, don't re-widen" guidance show genuine understanding of the package graph.
- **Verification gates are named and specific:** the contracts API snapshot diff (`tools/api-snapshots/@mog-sdk__contracts.api.txt`) "should show removal, not new surface" is a precise, falsifiable gate.

## Major gaps or risks

- **Track B's live consumer is never established.** The plan's own analysis says the kernel service's cross-app purpose "is exercised only through `AppClipboardAPI.getPayload()`," and Track B step B1 is still *"Trace which app paste path calls `getPayload()`."* In other words, at planning time no confirmed cross-app paste consumer is shown to exist. If none does, INV-1 is unobservable in production today and the honest choice tilts toward *remove*, not *wire* — yet the plan pre-commits to wiring ("the production-correct choice is to wire it"). The decision is correctly framed as open but the recommendation runs ahead of the evidence. The plan would be stronger if B1 were a hard gate: *if no caller of `getPayload()` drives a paste, default to removing the lifecycle.*
- **User-visible impact of the "broken cut contract" is asserted but not demonstrated.** The plan concedes marching-ants and cut-source clearing are driven by the *app* machine, not the kernel snapshot (lines 28, 83, 114). That containment is reassuring for risk, but it also means the described defect ("snapshot keeps reporting `hasCut` forever") may have no current reader and thus no user symptom. The plan should distinguish "latent contract bug" from "active user-facing bug" rather than implying the latter.
- **The cross-app app-eval acceptance gate is conditional on a harness that may not exist.** Line 109 hedges ("pick the existing cross-app clipboard harness if present"). If there is no two-surface cut/paste harness, the single most important Track B gate is unspecified, and authoring one is non-trivial. This should be scoped explicitly, not left to "if present."
- **Pre-emptible `pasting` introduces a new policy with thin justification.** Step B3 proposes letting `COPY`/`CUT`/`CLEAR` pre-empt `pasting` to avoid a wedged machine, then B4 offers the alternative (tolerate out-of-state completions, no timers). Both are reasonable, but the plan picks "default to pre-emptible" while also warning it "could mask a stuck paste." Given no production driver exists yet, adding state-machine policy for a race that cannot occur today is speculative; this is fine to defer until B is actually wired.

## Contract and verification assessment

Contract clarity is high. The preserve/strengthen split is the right structure, and the preserved-surface list matches the actual consumers (`app-kernel-api.ts`, `scoped-clipboard-api.ts`). INV-2/INV-3 (single type source, static conformance) are the most valuable invariants here — they convert a class of silent drift into build errors, and INV-3 is nearly free given `IKernelServices.clipboard` already references the contracts interface. INV-4 (notification minimality) is correctly flagged as strictly safe because the forwarded payload (`hasData`, `operation`) is idempotent.

Verification gates are above average: typecheck across the contracts→kernel→app graph, the API-snapshot diff, continued compilation of the capability-gated surface, and a per-invariant unit-test matrix. The one soft gate is the cross-app app-eval (above). The plan appropriately states it will not run build/test itself and treats tests as a gate, not the fix.

One small contract nuance the plan handles well: it notes the snapshot `operation` is nullable while the *stored* operation is non-null only while data is held, and resolves it by typing the context field nullable for straight pass-through. That avoids a narrowing footgun in the projection.

## Concrete changes that would raise the rating

1. **Make B1 a decision gate, not a step.** Restructure Track B so that the *first* deliverable is the trace result: enumerate every caller of `getPayload()` and state plainly whether a cross-app paste consumer exists. If it does not, the plan's default flips to *remove the lifecycle* (Track A-only), and Track B becomes contingent. This removes the one place where the recommendation outruns the evidence.
2. **Separate "latent contract bug" from "user-facing regression."** State explicitly that, given app-machine-driven marching ants, there is likely no current user symptom, so Track B's value is contract correctness / future-consumer enablement, not a live bug fix. This calibrates urgency honestly.
3. **Resolve the app-eval harness question up front.** Confirm whether a cross-app cut→paste app-eval harness exists; if not, either scope authoring one as part of Track B or downgrade the gate to a unit/integration test against the kernel snapshot and say so.
4. **Defer the `pasting` pre-emption policy until a driver exists.** Fold B3/B4 into "decide when wiring; until then, document that out-of-`pasting` completions are ignored." Don't add machine policy for an unreachable race.
5. **Name the `timestamp` decision-maker.** INV-5 offers expose-or-delete but leaves the choice to "if product has no consumer." Since the plan can see no reader today, default to *delete* (removing write-only state with zero behavioral risk) and note that adding it back is trivial if a "copied N seconds ago" UI is ever requested — rather than expanding `KernelClipboardSnapshot` speculatively.
