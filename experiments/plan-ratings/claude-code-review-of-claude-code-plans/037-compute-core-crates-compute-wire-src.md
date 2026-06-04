Rating: 8/10

# Review — Plan 037: Harden Mutation Serialization & Wire-Protocol Correctness


## Summary judgment

This is a strong, unusually well-grounded plan. Almost every factual claim it
makes about the target folder is verifiable against the source, and the few I
spot-checked were exact rather than approximate: the `32-byte/24-byte` doc drift
in `mutation/mod.rs:69-71`, the `debug_assert!`-only truncation guards
(`mutation/mod.rs:109-120, 227-238`), `reserved: u32` always written as `0`
(`mutation/mod.rs:153, 279`), the `u16::MAX` cap in `concat_multi_viewport_patches`
(`mutation/mod.rs:344`) that still appends every body, the `id_bytes.len() as u8`
truncation (`mutation/mod.rs:381`), the image-JSON-into-`error_off` reuse with a
silent `(NO_STRING, 0)` fallback (`mutation/helpers.rs:65-68`), `WIRE_VERSION = 2`
(`constants.rs:8`), the `flags.rs` module doc saying "Bit 11-15: reserved" while
`HAS_CELL_IMAGE = 0x800` exists (`flags.rs:18, 165`), the `cell_flag_bits_are_disjoint`
test omitting `HAS_CELL_IMAGE` (`flags.rs:224-234`), the absence of
`filter_mutation_buffer` (only `filter_viewport_buffer` exists,
`security_filter.rs:89`), and `deserialize.rs` decoding only the viewport format
(`deserialize_viewport` at `:214`, no mutation decoder).

The objectives are real production-path concerns, ordered sensibly by value, and
the plan is honest about its single genuine unknown (O1's severity) rather than
asserting it. Phasing is risk-ascending (in-folder/no-layout-change first,
breaking version change last and gated). The contracts section (C1–C9) is
concrete and verifiable. What keeps this from a 9–10 is breadth-driven execution
risk and an unresolved headline: the plan's lead objective (O1) is also the one
whose priority it cannot settle within the read-only investigation it scopes.

## Major strengths

- **Evidence quality.** This reads like it was written against the actual code,
  not from a folder description. Line-accurate references to constants, strides,
  flag bits, and the exact silent-truncation sites make it directly actionable
  and easy to verify. This is the single best signal of a trustworthy plan.
- **Phase 0 decision gate.** Front-loading the O1 leak determination (trace from
  `bridge-delegate/macros/src/expand/gated.rs` whether any mutation-returning
  `scope = "sheet"` method reaches a `None`/`Structure` actor) before committing
  to the redactor is exactly right. It avoids building a security primitive that
  might be redundant, and it correctly identifies this as the one true unknown.
- **Versioning discipline as the breaking-change mechanism (C4, O2).** Carving a
  version byte from the always-zero `reserved: u32` while preserving the 16-byte
  header size is a clean, layout-stable move, and the plan correctly couples it
  to `constants.gen.ts` regeneration and the TS-side validation as an atomic,
  downstream-coordinated change.
- **Clean in-folder vs cross-folder boundary.** It scopes the deliverable to the
  `compute-wire` primitive + tests and explicitly names the macro wiring
  (Step 3.2) and TS decoder changes as out-of-folder dependencies, not in-scope
  edits. This respects the queue's folder constraint without pretending the
  protocol has no consumers.
- **Verification-asset thinking (O4/G1).** Recognizing that the folder's stated
  charter ("mutation serialization correctness") has no Rust mutation decoder and
  therefore no proptest roundtrip — and making that decoder the keystone gate
  that backs Phases 1/3/4 — is the highest-leverage structural insight here.

## Major gaps or risks

- **O1's severity is deferred, not resolved.** The plan's lead and highest-value
  objective is explicitly contingent on a Phase 0.1 determination it does not
  make. Given the read-only constraints that is defensible, but it means the
  headline could collapse to "defense-in-depth assertion" rather than a live
  confidentiality fix. The plan would be stronger if Phase 0.1 enumerated the
  actual candidate methods (mutation-returning + `scope = "sheet"`) so a reader
  could gauge whether O1 leads or trails.
- **A corruption angle in O1 is under-stated.** `gated.rs` routes any
  `scope = "sheet"` method returning `Vec<u8>` through `filter_viewport_buffer`
  unconditionally (confirmed at `gated.rs:39, 59-69`). If a mutation-returning
  method is already sheet-scoped, its mutation buffer is today being fed to the
  *viewport* filter, which would misparse a different header/layout — i.e. a
  potential active-corruption bug, not merely a missing redactor. The plan frames
  O1 purely as "no primitive exists" and misses this sharper framing; Phase 0.1
  should explicitly check for this case.
- **Breadth raises execution risk.** Seven objectives spanning docs, truncation
  hardening, a new deserializer + proptests, a security redactor, and a breaking
  version bump is a lot for one folder. The phasing mitigates this, but O4 alone
  (a full mutation decoder mirroring TS splice logic with `checked_*`/bounds
  rigor + proptest generators over `RecalcResult`) is substantial. The plan could
  acknowledge that O4 may warrant being its own landed change.
- **A few decisions left open.** Whether the multi-viewport envelope gets a
  version prefix is "if Phase 0.2 chose to," and the O3 remediation offers a menu
  (saturate-and-log vs `Result` vs clamp-and-drop) without committing per site.
  For `concat`'s overflow this matters: the plan rightly insists declared count
  must equal emitted entries, but leaves "widen vs drop tail" unselected.

## Contract and verification assessment

The contracts (C1–C9) are specific, tied to real invariants (byte-exact LE
layout, the shared 32-byte record, `forbid(unsafe_code)`, the empty-input
sentinel shapes that engine call sites depend on), and each maps to a gate. The
new gates (G1 roundtrip, G2 redaction parity, G3 truncation-via-tracing-capture,
G4 version detection, G5 flag-disjointness incl. `HAS_CELL_IMAGE`) are
well-matched to the objectives. The insistence that redacted buffers must still
pass G1's decoder (G2) is a good anti-corruption cross-check.

Two caveats. First, the gates are acceptance criteria the plan cannot itself run
(per task constraints), so their value depends entirely on the implementer; the
plan states this honestly. Second, G3's reliance on a capturing `tracing`
subscriber is reasonable but couples the test to logging behavior — fine, but it
means "loud truncation" must be a stable, asserted contract, not incidental.

## Concrete changes that would raise the rating

1. In Phase 0.1, enumerate the actual mutation-returning `scope = "sheet"`
   methods (or state that none exist) so O1's priority — lead security fix vs
   defense-in-depth — is resolved in the plan rather than during implementation.
2. Add the corruption framing to O1/Phase 0.1: `gated.rs` already routes
   sheet-scope `Vec<u8>` through `filter_viewport_buffer`, so a mutation buffer
   on that path is misparsed today. Confirm whether this path is live.
3. Commit to one remediation per O3 site (especially `concat`: widen-vs-drop)
   instead of presenting alternatives, and make the multi-viewport version-prefix
   decision concrete rather than conditional.
4. Flag O4 (deserializer + proptests) as independently landable, and consider
   splitting the breaking O2/Phase 4 into its own coordinated change so the
   low-risk wins (O3/O5/O6) ship without waiting on TS-decoder coordination.
5. Note the `value_type_from_cell_value` test also omits the `Image` variant
   (`flags.rs:200-221`), alongside the already-cited `cell_flag_bits_are_disjoint`
   gap, so O6's test-hardening is complete.
