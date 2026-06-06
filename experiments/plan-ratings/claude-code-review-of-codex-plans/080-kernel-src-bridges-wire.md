Rating: 8/10

# Review of Plan 080 — Kernel Wire Bridge and Mutation Projection Boundary

Reviewed plan: `mog-internal/plans/active/experiments/plan-ratings/codex-plans/080-kernel-src-bridges-wire.md`
Source folder: `mog/kernel/src/bridges/wire`

## Summary judgment

This is a strong, evidence-grounded plan. Its diagnosis of the folder is accurate: I verified the headline claims against the live source and they hold. The byte-30 full-viewport detection heuristic exists exactly as described (`viewport-coordinator-registry.ts:259-268`, `VIEWPORT_WIRE_VERSION_BITS = 0x20`, `(patchBytes[30] & 0xf0)`). `classifyMutation`/`MutationTier` really are exported from `index.ts` but consumed only by `__tests__/viewport-prefetch.test.ts` (no production caller). The README really does list nonexistent `viewport-buffer.ts` and `viewport-data-provider.ts` and still calls the palette a "JSON tail" (README.md:49,55,99) even though `constants.gen.ts` defines a full binary palette format (`PALETTE_HEADER_SIZE`, `BIT_*` masks). The stale workaround comments are real and damning: `structure.ts:275-283` and `sort-operations.ts:117-121` both explicitly document that full-viewport binaries get fed to `BinaryMutationReader`, which reads `patchCount=0` and silently skips, with `forceRefreshAllViewports()` as the compensating hack. The plan correctly identifies that this is the central architectural defect to fix.

The plan reads like the output of someone who actually traced the production data plane end to end. Its contract section is the best part — it enumerates real invariants (little-endian, `NO_STRING` sentinel, single-owner coordinator, overlay epoch ordering, palette-before-render) rather than generic advice. Verification gates are concrete and correctly scoped to both TS (`@mog-sdk/kernel test`/`typecheck`) and Rust (`cargo test/clippy -p compute-wire` and `-p compute-core`), plus a realistic manual UI checklist.

The main thing holding it back from a 9–10 is scope honesty: this is an 8-agent epic presented as one plan, with under-stated sequencing dependencies and a dangling external dependency on "the broader compute-wire protocol plan."

## Major strengths

- **Accurate, falsifiable diagnosis.** Nearly every "weakness/drift" bullet is independently verifiable in the tree and I confirmed the load-bearing ones. This is not hand-waving; it is a real audit.
- **The root-cause framing is right.** It correctly ties the registry routing heuristic, the silent `BinaryMutationReader` skip, and the `forceRefreshAllViewports()` workarounds into a single causal chain, and orders the fix so the typed envelope lands before the force-refreshes are removed (Step 6 gated on Step 1). That ordering is the correct safety property.
- **Contracts as invariants, not prose.** The "contracts to preserve or strengthen" section is genuinely usable as acceptance criteria (e.g. "emit exactly one `fetch-committed` on commit, none when rejected"; "emit `cells-patched` only when an in-viewport cell is dirtied"; "palette delta applied before any cell with new `format_idx` renders").
- **Fail-closed posture.** Validation must not mutate existing buffers or emit render events on failure, with a deterministic hydration-deficit/refresh recovery path. This is the correct stance for a hot binary protocol.
- **Delta lossiness is called out and bounded.** Step 4 plus the explicit "fall back to full fetch rather than commit a lossy synthetic buffer" rule is the right answer and avoids over-engineering a perfect merge.
- **Test matrix is exhaustive and adversarial** — malformed-buffer cases per protocol error, cross-language Rust-fixture roundtrips, out-of-order fetch tokens, spill teardown, UTF-8 boundary cases. The edge-case list (same cell in regular+spill, palette gaps, frozen-pane visible-window gating, zero-row position arrays) shows real domain depth.
- **Decision branches are explicit** where uncertainty is legitimate (prefetch classifier: wire it in or remove it; validation failure: refresh vs throw). This is honest and avoids prescribing the wrong outcome.

## Major gaps or risks

- **It is an epic, not a single executable plan.** Twelve implementation steps spanning Rust schema, TS decoder, a 68 KB file split, delta rewrite, coordinator token redesign, two metadata caches, palette parity, and docs. Each of Steps 1–9 is itself a sizeable PR. There is no per-step acceptance/exit criterion beyond "tests pass," and no effort/risk sizing to help a sequencer triage.
- **Parallelization understates sequencing.** "Naturally parallelizable after the typed payload schema is agreed" is doing a lot of work: Agents B, D, E, F, and H all depend on Agent A's schema landing first, and B/E share the registry routing surface. Presenting A–H as a flat fan-out invites merge conflict and integration pain. A dependency graph (A blocks B/D/E; C is independent; H is last) would be more honest.
- **Dangling external dependency.** Step 1 says the envelope should be "aligned with the broader compute-wire protocol plan" (line 134) but that plan is neither linked nor summarized. If that plan does not exist or disagrees on envelope shape, this plan's keystone step stalls. This cross-plan coupling is a real schedule risk that is not surfaced in the Risks section.
- **Unresolved legacy-decoder decision.** Step 1's "keep old-format handling only if production bytes still require it" leaves open whether persisted/replayed bytes (the `bridge-provider-doc.applyUpdate` replay path referenced in the registry comment) can still emit pre-envelope payloads. Because this folder decodes persisted document bytes, backward compatibility may be mandatory, not optional — and if so, the "fail closed on unsupported version" rule could break loading older documents. The plan should resolve this before committing to the strict validator, not during.
- **Producer-side scope is acknowledged but thin.** The fix fundamentally requires Rust changes in `compute-wire` and `patches.rs` (the envelope writer and full-viewport-payload producer). The plan lists these as dependencies and gives Agent A the work, but the TS-folder framing slightly buries that the bulk of the contract risk lives on the Rust side. The roundtrip fixtures mitigate this, which is good.
- **`binary-viewport-buffer.ts` split risk.** Splitting a 68 KB hot-path file (Step 3) while "preserving public behavior" is high-effort, low-visible-reward refactoring that competes for the same file/region as Steps 2 and 4. Concurrent edits by Agents B/C/D to overlapping code is a likely conflict the plan does not flag.

## Contract and verification assessment

Contract clarity is the plan's strongest dimension. The packed-entry "must declare payload kind" requirement, the "registry must never infer kind from arbitrary payload bytes" rule, and the `FetchToken` shape (mutation version + request sequence + viewport id + optional visible-window sequence) are precise enough to implement and test against directly. The overlay-epoch-vs-fetch-token separation correctly identifies a real bug class the current `_version`-only scheme cannot disambiguate (two in-flight fetches at the same mutation version committed out of order — also enumerated as an edge case).

Verification gates are appropriate and complete: scoped TS test/typecheck filters, `pnpm typecheck` for cross-package boundary changes, Rust `cargo test`/`clippy` for both `compute-wire` and `compute-core`, cross-language fixture roundtrips, and a concrete manual UI script (frozen-pane scroll, spilling-formula edit, palette-delta format, CF update, sort/remove-dup). The plan correctly notes it did not run gates because output was a plan file under task prohibition — that disclosure is accurate.

One verification gap: there is no stated regression gate proving that **removing** a force-refresh did not silently break a path. Step 6 says to add production-path tests proving full-viewport payloads update cells without `forceRefreshAllViewports()`, but it should also require that each removed refresh be tied to a specific failing-then-passing test and that the broader app-eval / structural-operation suites stay green, since the original comments warn the refresh was load-bearing for sort and remove-duplicates.

## Concrete changes that would raise the rating

1. **Add a dependency graph and split into landable milestones.** Make explicit that Step 1 (Rust schema + generated constants + fixtures) is a hard prerequisite gate, then Steps 2/5 (decoder + coordinator) can proceed, with Steps 3/4 (file split + delta) and 6 (force-refresh removal) sequenced after routing is proven. Convert the flat A–H agent list into that DAG.
2. **Resolve the legacy/persisted-bytes question up front.** State definitively whether replayed/persisted document bytes can carry pre-envelope payloads. If yes, make the legacy decoder a required (not optional) path and soften "fail closed on unsupported version" for the document-load path specifically, so the strict validator cannot brick older documents.
3. **Link or inline the "broader compute-wire protocol plan."** Either cite it with a path/section or specify the envelope header layout (kind byte, version, reserved bits, offsets) directly in this plan so Step 1 is self-contained.
4. **Add per-step exit criteria and rough sizing.** One or two sentences per step: what proves it done, and S/M/L effort. This turns the epic into something a sequencer can schedule.
5. **Add an anti-regression gate for force-refresh removal.** Require each removed `forceRefreshAllViewports()` to map to a named test transition (red without the typed routing, green with it) plus passing the existing sort/remove-duplicates app-eval scenarios.
6. **Flag the concurrent-edit hazard on `binary-viewport-buffer.ts`.** Note that Steps 2/3/4 touch the same file and either serialize them or define module boundaries before the split so agents do not collide.
7. **Tighten the prefetch decision with a default.** Given no production caller exists today, state a recommended default (remove from the production barrel, keep tests near refresh policy) so the branch does not stall, while leaving the wire-it-in option documented.
