Rating: 8/10

# Review of Plan 037 — Compute Wire Mutation Serialization and Protocol Correctness

Source folder: `mog/compute/core/crates/compute-wire/src`
Plan reviewed: `mog-internal/plans/active/experiments/plan-ratings/codex-plans/037-compute-core-crates-compute-wire-src.md`

## Summary judgment

This is a strong, evidence-grounded plan. I spot-checked every major factual claim against the live source and they all hold:

- `as u16` / `as u32` / `as u8` casts guarded only by `debug_assert!` are present in the mutation writers (`mutation/mod.rs:148-150`, `:274-276`, `:377-383`; `mutation/patch.rs:177-181`). In release builds these wrap/truncate silently, exactly as the plan states.
- `concat_multi_viewport_patches` caps the count with `u16::try_from(total_count).unwrap_or(u16::MAX)` (`mutation/mod.rs:344`) while still appending every entry's bytes — the precise count/body mismatch the plan flags.
- `MUT_HAS_ERRORS` is set in the header (`mutation/mod.rs:143`, `:266`) with no corresponding errors section emitted by the writer — a phantom signal, as claimed.
- `WIRE_VERSION = 2` (`constants.rs:8`) is embedded only in the viewport header flags byte (byte 30, bits 4-7); mutation blobs carry no version.
- The TS routing heuristic is real: `viewport-coordinator-registry.ts:266-268` distinguishes full-viewport from mutation binaries by `patchBytes[30] & 0xf0 === 0x20`, not by any contractual marker.
- `BinaryMutationReader`'s constructor (`binary-mutation-reader.ts:75-111`) reads header counts and section offsets straight from the `DataView` with no whole-buffer validation, so malformed data surfaces as late range errors or silently-empty sections.
- Doc drift is confirmed (the binary-mutation-reader header comment references a stale Rust file name).

Because the diagnosis is accurate, the objectives and the production-path invariants section are credible and well-targeted. The plan correctly identifies the central architectural defect — the protocol is not self-identifying, so cross-language routing and decoding are heuristic rather than contractual — and frames the fix as a versioned, tagged, checked protocol with one authoritative schema. The sequencing, parallelization split, verification gates, and risk/edge-case enumeration are all above the bar I'd expect for a wire-protocol change touching a Rust↔TS hot path.

The reason this is an 8 and not a 9-10 is that, for a plan whose entire subject is byte layout, it stops short of proposing the concrete new layout and leaves two pivotal contracts as open "decide" items rather than recommending a default. More below.

## Major strengths

- **Accurate, falsifiable diagnosis.** Every "observed gap" maps to a real line of code, not a vibe. This is the single best predictor that the implementation will land on the right targets.
- **Correct root-cause framing.** It treats the byte-30 heuristic and the missing version/kind marker as the architectural crux, and makes "self-identifying + versioned + tagged sections" the spine of the fix rather than patching symptoms.
- **Production-path discipline.** It explicitly bans test-only fixes, requires migrating production callers to the checked entrypoints in the same change set ("the old infallible path should not remain the production path"), and names the real consumers (`storage/engine/viewport/patches.rs`, structural/range/format paths, the TS coordinators, fixture generators).
- **Strong invariant section.** Little-endian, cell-record parity between viewport and mutation, palette-delta-before-render ordering, `NO_STRING` sentinel semantics, `mog` must not depend on `mog-internal` — these are the load-bearing contracts and they're enumerated crisply.
- **Concrete, layered verification gates.** `cargo test/clippy -p compute-wire` and `-p compute-core`, kernel wire tests, `pnpm typecheck`, plus a scripted UI smoke (edit value, spilling formula, format mutation emitting a palette delta) that actually exercises the routing change end to end.
- **Coherent parallelization.** The A-F split is realistic and the dependency note that the schema/version contract must be written first before fan-out is the right gate.
- **Closes the phantom-flag loop.** Forcing a decision on `MUT_HAS_ERRORS` (encode a real section vs. remove the flag and regenerate constants/docs/tests) is exactly the kind of contract hygiene that prevents future consumers from inferring nonexistent data.

## Major gaps or risks

- **No concrete proposed byte layout.** This is the biggest weakness. The plan says "design the next mutation format … prefer an explicit payload header or section directory" and lists the Rust types to add, but never proposes the actual header bytes, field offsets, or section-directory encoding. For a protocol-correctness plan this is the crux that should at least have a strawman: where does the version/kind byte live, how many bytes, how does it coexist with the existing 16-byte header, and how does the packed multi-viewport entry carry its kind/version. Leaving this fully open pushes the highest-risk design decision into implementation time and weakens the otherwise-tight "one authoritative schema" objective.
- **Two pivotal contracts left as open decisions without a recommended default.** The string-length policy (step 7: widen to `u32`/string table vs. keep `u16` with explicit truncation) and the error-section question (step 6) are both framed as "decide X or Y." Deferring the product call is defensible, but the plan should state a recommended default and the decision criteria so a reviewer/implementer isn't blocked. As written, an agent could legitimately pick either branch, and the branches imply materially different cell-record format bumps.
- **Mega-change / blast-radius risk is acknowledged but not bounded.** The plan correctly says the Rust writer, generated constants, TS reader, packed routing, fixtures, and storage-engine callers must "land together," but offers no staging strategy (e.g., dual-read/legacy-decoder window, feature flag, or a sequenced PR train) to keep the landing reviewable. A single PR touching the entire Rust↔TS hot path plus generated artifacts is hard to review and risky to revert. The "bounded legacy reader" idea is mentioned only conditionally.
- **Backward-compatibility trigger is under-specified.** Step 3 hinges on "if backward compatibility is required for persisted/local test buffers." Whether mutation blobs are ever persisted (vs. always transient and regenerated per recalc) determines whether a legacy decoder is needed at all. The plan should resolve this factual question up front, since it gates a whole compatibility surface and a named risk.
- **Performance claim is hand-waved.** The plan rightly notes section directories / wider lengths can hurt cache locality and says "the new layout should still be measured," but specifies no benchmark, baseline, or regression threshold. For a hot path this should name the bench harness or at least the metric.
- **`generation` byte not addressed.** The reader reads `_generation = getUint8(11)` but the plan's header/section discussion never mentions the generation field's role in the new versioned header. A schema-from-scratch effort should account for every existing header byte to avoid reintroducing the same "what is byte N" ambiguity it's trying to kill.

## Contract and verification assessment

Contract clarity is high on invariants and intent, but partial on the new wire format itself. The plan is unambiguous about *properties* the new protocol must satisfy (self-identifying, versioned, tagged sections, checked writers, reader rejects trailing/underflow/overflow/bad UTF-8/unknown version) and about *behavioral* contracts on the boundary (palette-before-render, deterministic patch order, absolute zero-based coords, `NO_STRING` sentinel, security-filter string-pool update). What it does not pin down is the *concrete encoding* that realizes those properties — so two competent implementers could produce incompatible layouts that both "satisfy the plan."

Verification gates are the strongest part of the plan. The Rust negative-test list mirrors the existing `deserialize_errors.rs` pattern (short header, unsupported version, bad section order, section beyond buffer, string ref beyond pool, invalid UTF-8, trailing bytes, count-multiplication overflow), the proptest loop (production writer → Rust validator → assert every count/record/length) is exactly the right closed loop, and the TS side requires real Rust-produced fixtures for all positive cases plus a `constants.gen.ts` freshness test. The UI smoke is concrete and maps to the routing change. The one gap is the missing performance gate noted above; correctness gates are otherwise comprehensive.

## Concrete changes that would raise the rating

1. **Propose the actual vNext byte layout.** Add a strawman header (version byte, payload-kind byte, where they sit relative to the current 16-byte header), the section-directory or tagged-section encoding (tag, length, offset per section), and the new packed multi-viewport entry header with kind+version. Account for every currently-used header byte, including `generation` (byte 11) and the existing flags byte. This single addition would move the plan toward a 9-10.
2. **Recommend defaults for the two open contracts.** For strings, state a recommended branch (e.g., keep `u16` with explicit shared `WireStringPool` truncation + metrics, or commit to `u32` widening) with the decision criterion. For errors, recommend encode-vs-remove based on whether any production TS consumer reads `hasErrors` today (the audit the plan already calls for — fold the likely answer in).
3. **Resolve the persistence question up front** (are mutation blobs ever persisted/cached, or always regenerated?) and let that explicitly decide whether the legacy decoder is in-scope, rather than leaving it conditional.
4. **Add a staging/landing strategy.** Even a brief "PR1: schema + checked writers behind new entrypoint; PR2: TS reader + routing; PR3: flip producers + regenerate fixtures; PR4: remove legacy path" would de-risk the mega-change without weakening the "land together" correctness requirement.
5. **Name a performance gate.** Specify the bench harness and an acceptable regression bound for the mutation hot path under the new layout.
