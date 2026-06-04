Rating: 8/10

Summary judgment

This is a strong, source-aware plan for `compute-wire` mutation serialization and wire protocol correctness. It correctly identifies the production risk profile: unversioned mutation blobs, heuristic multi-viewport routing, release-mode integer truncation, a capped-but-not-truncated concat envelope, positional optional sections, the phantom `MUT_HAS_ERRORS` signal, and weak TS-side malformed-buffer validation. The plan also keeps the work on the real Rust writer and TypeScript reader/renderer path instead of treating fixtures or test decoders as the product.

The main reason it is not a 9 or 10 is that it stops one level short of being an executable protocol contract. It asks implementers to design the vNext payload header, section directory, string policy, legacy handling, and error section during implementation. Those are the highest-risk decisions in the work, so the plan is excellent as an architectural work order but not yet a complete byte-level specification.

Major strengths

- The current-state audit is accurate and grounded in the actual code paths. `serialize_mutation_result_for_viewport`, `serialize_multi_viewport_patches`, and `concat_multi_viewport_patches` really do rely on debug assertions and casts for protocol-sized fields, and the registry really routes full viewport payloads by inspecting version bits at byte 30.
- The plan covers both ends of the contract: Rust producers, generated constants, test fixtures, TS mutation reader, viewport buffer application, registry routing, palette deltas, security filtering, and storage-engine production callers.
- It defines the right invariants: little-endian fields, exact section lengths, explicit payload kind/version, no release-mode wrap/truncation, palette-before-cell semantics, shared cell-record semantics, and no public dependency on `mog-internal`.
- The verification section is broad and production-relevant. It includes `compute-wire`, storage-engine callers, TS wire tests, `pnpm typecheck`, cross-language fixtures, and a UI smoke through real editing and formatting paths.
- The parallelization notes are useful because the work naturally spans Rust schema/writers, envelope routing, TS validation, fixtures/constants, production caller migration, and docs.

Major gaps or risks

- The vNext protocol is not specified. The plan says to add a payload header or section directory, but does not define exact bytes, field widths, section ids, required vs optional section semantics, unknown-section behavior, version values, or max lengths.
- Several product-level choices are deferred: whether long strings widen or truncate, whether `RecalcResult.errors` gets a real binary section or the flag is removed, and when oversized encodes force full viewport refresh versus mutation failure. Those choices need owners and acceptance criteria before parallel agents implement against them.
- Backward compatibility is underspecified. The plan mentions a bounded legacy reader if needed, but does not say whether old mutation blobs can appear through provider replay, persisted updates, fixtures, or only tests.
- Error propagation is directionally right but incomplete. `WireEncodeError` and `BinaryMutationProtocolError` are named, but the plan does not define error variants, payload context, or how errors cross the compute-core bridge/NAPI/TS boundary.
- The sequencing is high-level for a change that must land atomically across Rust, generated constants, fixtures, TS readers, and registry routing. It needs a stricter integration order and rollback/fallback strategy.
- Because this is a hot path, the plan should add explicit size/performance acceptance checks for the new header/section-directory format, even though correctness should remain first.

Contract and verification assessment

The contract assessment is the plan's strongest area. It identifies the real byte-level invariants that need to become enforceable, especially exact buffer lengths, string references, section bounds, unsupported versions, unknown required sections, and typed packed-envelope payload kind. It also correctly treats Rust-generated constants and fixtures as part of the cross-language contract.

Verification is also strong, but it should be sharpened into explicit gates for stale generated files and malformed fixture coverage. The proposed tests cover the right classes, yet the plan should require at least one real Rust-produced fixture for each positive mutation section combination and one TS malformed-buffer test per `BinaryMutationProtocolError` code. It should also define how the UI smoke detects whether a full refresh was intentionally requested versus an accidental patch drop.

Concrete changes that would raise the rating

- Add a byte table for the vNext mutation blob and packed multi-viewport envelope: magic/kind/version fields, header size, section directory layout, section ids, required/optional bits, max values, alignment if any, and exact reader rejection rules.
- Decide the long-string and mutation-error policies in the plan instead of leaving them as implementation-time choices.
- Define `WireEncodeError` and `BinaryMutationProtocolError` variants with required context fields and the production caller behavior for each major class.
- Specify legacy handling: whether old mutation blobs are rejected, decoded only in tests, or accepted during a bounded migration window.
- Add an integration sequence that lands schema/constants/fixtures, Rust writers, TS readers, registry routing, and production caller migration in a verifiable order.
- Add hot-path performance/size checks for typical edit, spill, and format-palette mutation payloads so the new protocol remains acceptable after the correctness fix.
