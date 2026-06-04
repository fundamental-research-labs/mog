Rating: 8/10

Summary judgment

This is a strong, source-aware plan for a high-leverage protocol area. It correctly identifies real production-path risks in mutation serialization: unchecked release casts, missing mutation-level versioning, stale docs around image and flag bits, weak multi-viewport envelope validation, and an asymmetric security redaction story versus viewport reads.

The plan is not quite implementation-ready because the highest-risk objectives need sharper cross-boundary contracts. In particular, the proposed security fix is framed too narrowly around mutation patch blobs even though the same packed multi-viewport channel can carry full viewport binaries from `produce_full_viewport_patches`, and the bridge-delegate wiring for write-returned `(Vec<u8>, MutationResult)` payloads is not specified. The versioning objective also assumes stronger TypeScript validation than appears to exist today.

Major strengths

- The plan is grounded in the actual wire layouts and preserves the important invariants: fixed strides, little-endian fields, shared 32-byte cell records, `forbid(unsafe_code)`, codegen as the Rust-to-TS constants authority, and empty sentinel shapes.
- The objective ordering is mostly right: release-safe length/count contracts, doc drift, image-channel documentation, robust mutation decode tests, redaction, and versioning are all relevant to mutation wire correctness.
- The plan treats codegen and fixtures as generated artifacts rather than hand edits, and it names the downstream TS and bridge macro dependencies instead of pretending the Rust crate alone can complete every boundary change.
- The verification section is much better than a generic "run tests" list. It proposes property tests, malformed-buffer checks, redaction passthrough/structure/none behavior, version mismatch checks, and constant drift gates.

Major gaps or risks

- O1 is under-specified for the actual production channel. `serialize_multi_viewport_patches` entries are not guaranteed to be mutation blobs; the TS registry explicitly handles entries that are full viewport binaries, and Rust producers such as `produce_full_viewport_patches` package `serialize_viewport_binary` output inside the same envelope. A `filter_mutation_buffer` alone would not close the write-return leak class.
- The bridge integration contract is too vague. Current bridge-delegate postfiltering is for `read` methods returning plain `Vec<u8>`, while mutation updates are mostly write/structural methods returning packed byte tuples. The plan needs an explicit output classifier and security hook for `(Vec<u8>, T)` write returns, including how it obtains a per-sheet matrix after the write and how it handles multi-sheet packed payloads.
- The plan overstates one existing gap. There is no reusable `src/deserialize.rs` mutation decoder, but there are already external mutation tests, including `tests/mutation_roundtrip.rs` and a partial mutation proptest. O4 is still valuable, but it should be framed as promoting/consolidating existing partial coverage into a bounds-safe test-utils decoder, not starting from zero.
- The versioning section assumes TypeScript already validates viewport `WIRE_VERSION`. In the inspected TS path, the viewport buffer exposes `getProtocolVersion`, while the multi-viewport registry uses a hard-coded `0x20` marker to distinguish full viewport binaries; I did not find a fail-loud general version check. O2 should include adding that validation, or avoid relying on it as precedent.
- O3 leaves the overflow policy ambiguous. "tracing::error", saturation, clamping, dropping, and `Result` are materially different protocol contracts. For a binary protocol, logging while emitting a lossy or partially corrupt buffer is not a sufficient contract unless the emitted shape is formally defined and tested.
- The plan has some scope tension. It says the production change set is confined to `compute-wire/src` plus generated artifacts, but the security and version objectives cannot be production-complete without bridge-delegate and TS reader changes. That can work only if the plan is explicitly split into in-folder primitives and required atomic downstream follow-up plans.

Contract and verification assessment

The contract list is one of the plan's best parts. C1 through C9 capture most of the wire invariants an implementer must not accidentally break, especially shared cell record layout, no-op sentinels, codegen lock-step, and redaction semantics.

The missing contract is for the packed update envelope as a production boundary: entries need an explicit type/version discriminator or validated detection rule, declared counts must equal emitted entries, each child blob must be structurally self-consistent, and filters must define behavior for both mutation patches and full viewport binaries. Without that, O1 and O7 remain local hardening rather than a complete wire-boundary contract.

The proposed gates are appropriate but should be tightened. Add explicit crate gates (`cargo test -p compute-wire` and `cargo clippy -p compute-wire`) plus the TS wire tests that consume regenerated constants and fixtures. The mutation deserializer tests should cover spills, palette deltas, image metadata, viewport bounds filtering, malformed/truncated buffers, string offsets, and trailing bytes. Redaction tests should prove redacted packed buffers still parse and that full-viewport entries in packed write results are handled, not only mutation entries.

Concrete changes that would raise the rating

- Replace O1 with a precise packed-output security contract: a `filter_packed_multi_viewport_updates`-style primitive that walks the multi-viewport envelope, validates each entry, dispatches to viewport or mutation redaction based on a versioned discriminator, and applies the correct `SheetAccessMatrix` per sheet.
- Specify the bridge-delegate integration for write returns, not just read postfilters: classify `(Vec<u8>, T)` byte tuples, fetch matrices after the write, fail closed on missing sheet identity, and add bridge macro tests for mutation/full-viewport packed outputs.
- Make the overflow/truncation behavior a single checked API contract. Prefer returning a typed serialization error or dropping overflow entries before emission so declared counts and lengths always match the bytes actually written; do not rely on logging as the primary correctness mechanism.
- Reconcile O4 with existing tests by reusing the current mutation layout helpers and external roundtrip tests, then promote them into a reusable `test-utils` decoder with negative tests.
- Add TS-side acceptance criteria for versioning: replace the hard-coded `0x20` full-viewport marker with generated `WIRE_VERSION << 4`, validate viewport, mutation, and multi-viewport versions fail-loud, and regenerate fixtures in the same coordinated change.
- Expand the doc-drift pass to include the current README usage example, which still shows the old `serialize_mutation_result` arity, and document image metadata consistently for viewport and mutation records.
