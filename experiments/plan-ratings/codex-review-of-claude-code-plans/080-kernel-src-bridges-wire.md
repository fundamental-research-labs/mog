Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for `kernel/src/bridges/wire`. It correctly treats the folder as a production Rust-to-TypeScript boundary rather than a local TS utility module, and most of its findings are supported by the current source: `setBuffer()` parses but does not enforce the viewport wire version, the registry discriminator hardcodes `0x20`, `applyDelta()` explicitly zeros CF extras and omits positions, `encodeFormatRecord()` uses a fixed 512-byte scratch buffer, the registry lacks per-segment isolation, the overlay key path allocates strings, and the README is stale. The plan is substantially better than a bug list because it names invariants, phases, coupling to `compute-wire`, and targeted tests.

The main reason it is not a 9 or 10 is that several proposed contract changes stop just before the exact production recovery behavior. Throwing typed wire errors, changing the discriminator, and validating layouts are correct directions, but the plan needs to specify precisely how `ViewportFetchManager.refresh()`, `forceRefresh*()`, and `ComputeCore.mutateCore()` recover so a bad buffer does not become an app-level crash or a permanently stale viewport. The verification section also names the right suites but should give exact package and Rust commands.

Major strengths

- The plan is unusually evidence-driven. It cites concrete files and current behavior, and the sampled source supports the major claims.
- It keeps the Rust `compute-wire` crate as the byte-layout source of truth and correctly avoids hand-editing `constants.gen.ts`.
- It targets real production paths: viewport fetch, delta scroll merge, packed multi-viewport mutation patches, CF extras, positions, palette encoding, and coordinator overlays.
- It identifies both correctness failures and contract hygiene issues, including stale docs and ad hoc barrel/deep-import boundaries.
- The proposed sequencing mostly starts with lower-risk contract hardening before the high-risk delta-merge rewrite.

Major gaps or risks

- Error recovery is under-specified. The plan says typed errors should be thrown and "routed" through callers, but `refresh()` and `forceRefreshAllViewports()` currently call `commitFetch()`/`commitDelta()` without local recovery. The plan should define whether errors mark hydration deficit, trigger a full refetch, drop only the segment, surface telemetry, or reject the user operation.
- Mutation versioning remains ambiguous. The mutation header has no version field, and normal production mutation application flows through packed multi-viewport patches. The plan should decide whether to add an explicit mutation/envelope type+version contract in Rust, reserve bits/bytes in the existing mutation header, or limit near-term validation to viewport-binary segments. "Confirm with Rust" is a weak handoff for a contract plan.
- The delta-merge phase is the highest-risk part and needs a more mechanical acceptance contract: how data bars/icons are re-indexed, how position sentinels are merged, what happens when old and delta positions disagree, and what golden comparison proves equivalence to a Rust full fetch.
- Verification gates are directionally right but not command-exact. For this package the plan should name `pnpm --filter @mog-sdk/kernel test` and `pnpm --filter @mog-sdk/kernel typecheck`; for Rust-coupled work it should include `cargo test -p compute-wire` and the relevant generator/fixture verification.
- Sequencing has a concrete typo/logic gap: the notes say "Phase 1 -> Phase 4 -> Phase 8 numeric-key", but there is no Phase 8.
- The plan is broad. Docs, barrel normalization, test-builder exports, image metadata typing, overflow compaction, palette safety, version validation, and lossless delta merge are all useful, but they should be separated into acceptance groups so the critical correctness path cannot be delayed by surface hygiene.

Contract and verification assessment

The contract framing is the plan's strongest feature: byte-exact Rust/TS agreement, generated constants, read-only viewport projection, epoch monotonicity, overlay replay, scheduler guarantees, subscriber isolation, overflow-pool routing, and no per-cell render allocations are all the right invariants.

The missing contract is the failure-mode contract. Once TS validates version/layout, the system needs an explicit rule for each entry point: full fetch, delta fetch, packed viewport segment, packed mutation segment, and force refresh. The plan should say which errors are fatal, which are isolated per viewport, which trigger hydration deficit, and which force a full-buffer retry.

The verification plan is good at the test-case level but too vague at the command level. It should also promote the "merged delta equals full Rust fetch for the same region" check from a risk note into a required gate for Phase 2, because preserving CF extras and positions through dense-grid re-indexing is where silent visual regressions are most likely.

Concrete changes that would raise the rating

- Add an explicit recovery matrix for `WireVersionMismatchError` and `WireLayoutError` across `refresh()`, `forceRefreshAllViewports()`, `forceRefreshSheetViewports()`, and `mutateCore()`/`applyMultiViewportPatches()`.
- Replace the mutation-version "confirm" step with a concrete preferred contract: an envelope type/version byte or mutation-header version field, with Rust/TS generator changes listed if needed.
- Define delta-merge acceptance with exact re-indexing rules and a required Rust full-fetch equivalence test for CF extras and position arrays.
- Replace generic verification wording with exact gates: `pnpm --filter @mog-sdk/kernel test`, focused Jest file filters where appropriate, `pnpm --filter @mog-sdk/kernel typecheck`, repo `pnpm typecheck` if public contracts/barrels change, and `cargo test -p compute-wire` for Rust-coupled layout work.
- Fix the sequencing typo and split "critical correctness" from "surface hygiene" so implementers can land version/discriminator/layout/delta safety without bundling unrelated barrel and image-metadata cleanup.
