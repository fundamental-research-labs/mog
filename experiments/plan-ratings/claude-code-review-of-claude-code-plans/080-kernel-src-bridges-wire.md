Rating: 8/10

# Review — 080 `mog/kernel/src/bridges/wire`

## Summary judgment

This is a strong, evidence-grounded plan for a high-stakes folder: the TS side of a byte-exact Rust→TS wire contract on the 60fps render fast path. I spot-checked the plan's evidence against the live tree and it holds up with unusual precision — the claims are not paraphrase, they cite real line numbers and real code:

- `getProtocolVersion()` exists at `binary-viewport-buffer.ts:470-472` and is never compared against `WIRE_VERSION` (confirmed `WIRE_VERSION = 2` at `constants.gen.ts:12`).
- The registry discriminator hardcodes `const VIEWPORT_WIRE_VERSION_BITS = 0x20` and tests `(patchBytes[30] & 0xf0) === 0x20` with no link to `constants.gen.ts` (`viewport-coordinator-registry.ts`), and the segment loop has no per-segment try/catch.
- `applyDelta()` writes `data_bar_count: 0` / `icon_count: 0` with the literal comment "CF extras not preserved in delta merge", and `totalSize` omits the CF-extras and position sections.
- `encodeFormatRecord` allocates `const tmp = new Uint8Array(512)` (`palette-binary.ts:477`) with variable-length writes after it.
- `cellKey(row,col)` produces `"${row},${col}"`, is stored into `_cellOverlay` and re-`parseInt`-ed on re-application (`viewport-coordinator.ts:176,375,399,578-579`), while `PATCH_KEY_COL_BITS = 0x100000` is exported/barrelled but unused in production.
- README lists `viewport-buffer.ts` and `viewport-data-provider.ts` (neither exists), omits `palette-binary.ts`, and still says the palette is a "JSON tail" (`README.md:49,55,99`).
- `index.ts` re-exports `buildTestViewportBuffer`/`buildTestMutationBuffer`/`buildPackedMultiViewportPatches`, and does **not** export `ViewportCoordinator`, the registry, or `RangeMetadataCache`.

The diagnosis is accurate and the objectives map cleanly onto it. The plan respects the most important constraint of this folder — that byte layout is owned by Rust and `constants.gen.ts` is generated — and explicitly routes any layout-touching work through the generator and the cross-language roundtrip gate. That discipline is the single biggest reason to trust this plan.

It is not a 9–10 because two of its workstreams (the lossless delta merge and the overflow-pool compaction) are materially riskier and less concretely specified than the rest, and one finding (unbounded memory growth) is asserted without measurement. These are flagged below.

## Major strengths

- **Evidence integrity.** Every claim I checked is true and precisely located. This is the rare plan where the "Evidence" section is a verifiable audit, not a narrative. It earns the right to its conclusions.
- **Correct contract framing.** It treats the Rust `compute-wire` crate as the source of truth, marks layout changes as bilateral, and names the exact generator binaries (`generate-ts`, `generate-test-fixtures`) and the roundtrip test as the gate. It never proposes hand-editing `constants.gen.ts`.
- **Right-sized version-safety fix.** Objective 1/Phase 1.1 puts the version check at the *single* parse boundary, explicitly "one comparison per buffer/blob — not per cell," which honors the no-per-cell-allocation invariant. Deriving the discriminator's `0x20` from `WIRE_VERSION << 4` (Phase 1.2) is the obviously-correct fix and removes a genuine latent footgun.
- **Failure-isolation reasoning is principled.** Phase 1.3 explicitly models the segment-isolation fix on the existing `_emit` subscriber isolation (`viewport-coordinator.ts:627-637`) and ties a thrown segment to arming `_hydrationDeficit` for backfill — i.e., it reuses an existing recovery mechanism rather than inventing one.
- **Honest risk register.** It self-identifies the delta-merge re-indexing as "the highest-risk phase," proposes a Rust-side fallback, and refuses to "reduce scope by simply disabling the path." It also calls out the mutation-header-version uncertainty as a Rust-coupled TBD rather than papering over it.
- **Sequencing is defensible.** Phase 1 → 4 → numeric-key → 2, with palette safety and surface hygiene parallelizable, lands the cheap correctness/safety wins before the risky rebuild. The "independent, can land first" list correctly identifies the genuinely self-contained items.

## Major gaps or risks

- **Phase 5 (overflow-pool / string-cache compaction) is the weakest spec and rests on an unmeasured claim.** The evidence says growth is "bounded-only-by-refetch," which is a real but possibly-benign property. The plan offers no measurement that this is observed in practice, and the proposed threshold ("a multiple of the cell-count's string footprint") is hand-wavy. Compaction that rewrites `display_off`/`error_off` across live cells is itself a correctness hazard on the hot path; the plan flags the in-flight-overlay edge case but does not specify the safe sequencing point concretely (it suggests "start of `setBuffer`/idle" — but `setBuffer` already resets the pool, so compaction there is moot). This phase reads as the lowest-confidence, highest-effort item and should arguably be demoted to "measure first, then decide."
- **Phase 2's "merge == full-fetch" assertion is the load-bearing test but is underspecified.** The plan promises a roundtrip "assert merged == fetched" against a Rust full fetch, which is exactly the right gate — but doesn't say where that fixture comes from or whether the harness can produce a deterministic full-fetch of the same region to diff against. Without that, the delta tests only check "data bars survive," not byte-equivalence. Given this is the declared highest-risk phase, the verification needs to be as concrete as the risk.
- **Throwing changes alter production failure mode without a rollout plan.** Converting silent garbage reads into thrown `WireVersionMismatchError`/`WireLayoutError` is correct, but it turns latent mis-decodes into visible crashes/refetch storms. The plan says callers "need a catch that triggers refetch/hydration-deficit" and to "land the throw and the catch together or behind a flag" — but doesn't commit to the flag, nor define what the user-visible behavior is when a throw fires repeatedly (refetch loop guard? backoff?). For a 60fps path this is a real operational risk that deserves a concrete fallback policy, not an either/or.
- **Phase 6.12 (memoize `getCellImage` + `CellImageMetadata` contracts type) is scope creep relative to its value.** It is explicitly "minor," yet it pulls in the contracts declaration rollup and cross-folder coupling (`[[mog-contracts-declaration-rollup]]`). Bundling a contracts-type change into an otherwise self-contained hygiene phase adds a build dependency for a per-image-cell micro-optimization. This should either be dropped or split out.
- **Mutation-header version validation is left genuinely open.** Phase 1.1 admits the mutation header has no version field and defers to "confirm with the Rust crate." Until resolved, mutation-blob version safety lives only at the registry byte-30 sniff — which is precisely the untyped heuristic the plan elsewhere criticizes. The plan is honest about this, but it means objective 1 is only partially achievable in the TS-only slice.

## Contract and verification assessment

The contract section is the best part of the plan. It correctly enumerates the invariants that must survive: byte-identical layout vs `compute-wire`, the cross-language roundtrip as the source-of-truth gate, `ReadonlyBinaryViewportBuffer` write/read split, epoch monotonicity / stale-fetch rejection, the scheduler no-contradictory-patch guarantee (with its `spill.rs` backing), per-subscriber isolation, the overflow-pool offset-routing invariant, and no new per-cell allocations. Each is tied to a concrete code location, and the plan states whether it is preserved or strengthened.

Verification gates are mostly excellent: the roundtrip stays green, layout changes regenerate fixtures + `constants.gen.ts` via named binaries, a per-objective new-test list, an explicit "existing suites pass unchanged" list, and an app-eval manual check for the CF-extras-through-scroll regression. Within the experiment's hard constraints (no build/test execution), specifying these as gates rather than running them is the correct posture.

Two verification weaknesses: (1) the Phase 2 "merged == fetched" diff is named but not made executable (fixture provenance unspecified); (2) Phase 5's compaction test ("preserves all decoded strings and offset routing") is asserted but there is no stated trigger to *reach* the compaction threshold deterministically in a unit test, so the test as described may never exercise the path it guards.

## Concrete changes that would raise the rating

1. **De-risk or defer Phase 5.** Replace the speculative compaction design with a "measure first" step: instrument pool/cache size in a long fetch-free editing app-eval, report actual growth, and only then commit to compaction vs. a coordinator-triggered refetch. If kept, specify the exact safe sequencing point (not `setBuffer`, which already resets) and a concrete threshold tied to a measured number.
2. **Make the Phase 2 equivalence gate executable.** Specify how a deterministic Rust full-fetch fixture for the merged region is produced and how the byte/semantic diff is asserted (which fields are compared, how dense re-indexing is normalized). This is the test that actually retires the highest risk.
3. **Commit to a rollout policy for the new throws.** Decide on the flag (yes/no), and define the caller behavior on repeated throws: refetch-with-backoff and a loop guard, with telemetry, so a version-skew or corruption event degrades to a recoverable refetch rather than a crash loop on the render path.
4. **Resolve or formally bound the mutation-header version question** before Phase 1 lands: either add the Rust field (bilateral, named as such) or state explicitly that mutation version safety is intentionally registry-boundary-only for this slice, with a follow-up ticket.
5. **Split or drop Phase 6.12.** Keep the README/barrel/test-builder-relocation hygiene self-contained; move the `CellImageMetadata` contracts change to its own item so the hygiene phase keeps zero cross-folder build coupling.
6. **State the test-builder relocation's consumer impact.** Moving `buildTest*` to a `wire/testing` subpath changes import paths for `__tests__` and any external test importers — name the affected callers (or confirm there are none outside `__tests__`) so the move is mechanical and reviewable.
