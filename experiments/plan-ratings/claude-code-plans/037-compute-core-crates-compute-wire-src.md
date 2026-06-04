# Plan 037 — Harden Mutation Serialization & Wire-Protocol Correctness (`mog/compute/core/crates/compute-wire/src`)

## Source folder and scope

- **Folder:** `mog/compute/core/crates/compute-wire/src`
- **Public Mog source.** All planning text, rationale, and internal naming live here in `mog-internal`; the production change set is confined to files inside the folder above (plus the noted cross-language `.gen.ts` regeneration, which is a *generated* artifact emitted *by* this crate's `generate-ts` binary, not a hand-edit).
- **In-scope files (hand-written):**
  - `lib.rs` (815 LOC) — crate root, re-exports, `generate_constants_ts()` TS codegen, `cell_format_json_fields()` drift anchor.
  - `mutation/mod.rs` (390 LOC) — `serialize_mutation_result`, `serialize_mutation_result_for_viewport`, `serialize_multi_viewport_patches`, `concat_multi_viewport_patches`. **Primary focus** per the queue description.
  - `mutation/patch.rs` (187 LOC) — `PatchRecord`, `build_cell_patches`, `build_spill_patches`, `write_patch_to_buf`, `write_spill_section`.
  - `mutation/helpers.rs` (109 LOC) — `CfColorOverrides`, value→f64, error/image string interning, display-text fallback, bounds.
  - `flags.rs` (249 LOC) — cell flag bits, `ValueType`, mutation header flags.
  - `constants.rs` (70 LOC) — strides, offsets, sentinels, `WIRE_VERSION`.
  - `viewport/mod.rs` + `viewport/{cells,records,sections,string_pool}.rs` — viewport serializer (shares the 32-byte cell record with mutations).
  - `security_filter.rs` (371 LOC) — `filter_viewport_buffer` in-place redaction.
  - `palette.rs`, `palette_binary/*` — `FormatPalette` interning + binary palette codec.
  - `types.rs` — render-only structs.
  - `deserialize.rs` (591 LOC, `cfg(test)`/`test-utils`) — viewport-only test decoder for proptest roundtrips.
  - `bin/generate_ts.rs`, `bin/generate_test_fixtures.rs` — codegen + fixture binaries.
- **Generated/cross-language artifacts (regenerated, never hand-edited):** `kernel/src/bridges/wire/constants.gen.ts` (emitted by `generate-ts`) and `kernel/src/bridges/wire/__tests__/fixtures/*.bin|*.json` (emitted by `generate-test-fixtures`). These live **outside** this folder; this plan only changes them by re-running the in-folder generators, and only flags that as a downstream step — it does not hand-edit them.
- **Out of scope:** the TypeScript `DataView` decoder/splicer in `kernel/src/bridges/wire/*`, the `compute-security` matrix internals, the engine call sites in `compute/core/src/storage/engine/*` that *invoke* these serializers, and `bridge-delegate` macro codegen. They are named below as upstream/downstream dependencies where the wire boundary must stay in lock-step.

## Current role of this folder in Mog

`compute-wire` is the **single source of truth** for the binary protocols that carry spreadsheet state from the Rust compute engine to the TypeScript renderer. There are two protocols and they share one 32-byte cell record:

1. **Viewport binary** (`serialize_viewport_binary`) — a full or delta snapshot of the visible grid sent on scroll/resize/recalc. Read by TS via `DataView` with zero parsing.
2. **Mutation binary** (`serialize_mutation_result*`) — after a recalc, a compact set of 40-byte cell patches (8-byte row/col prefix + the same 32-byte cell record) that TS splices directly into the existing viewport buffer without retransmitting the grid. Multi-viewport variants pack per-sheet patch blobs (`serialize_multi_viewport_patches`) and concatenate them (`concat_multi_viewport_patches`).

The crate also owns: the `FormatPalette` interning table (cells carry a `u16` index; formats are deduplicated and sent as a binary tail/delta), the flag bitfield (`ValueType` + property bits), the layout constants, the security redaction primitive (`filter_viewport_buffer`, applied in-place by the `bridge-delegate` macro on sheet-scope reads), and the TS codegen that keeps `constants.gen.ts` byte-for-byte aligned with Rust.

Correctness here is load-bearing: a single off-by-one stride, a silently truncated count, an endianness slip, or a flag/version skew corrupts every cell the renderer draws — and because the TS side reads raw bytes, a malformed buffer is a memory-safety-adjacent hazard on the consumer (out-of-range `DataView` reads) and a data-integrity hazard for the user. The crate is already disciplined (`#![forbid(unsafe_code)]`, `deny(clippy::all)`, `warn(pedantic)`, `deny(missing_docs)`, manual `to_le_bytes`), so improvements must be **surgical, invariant-preserving, and protocol-compatible** — bumping `WIRE_VERSION` where layout changes, never silently.

## Improvement objectives

Ordered by production value. Each is a real production-path fix, not a shim or test-only change.

1. **O1 — Close the mutation security-redaction gap.** `filter_viewport_buffer` redacts viewport cell records for `None`/`Structure` access, but **no equivalent exists for mutation patches**. The `bridge-delegate` read-postfilter emits `filter_viewport_buffer` only for `scope = "sheet"` reads returning `Vec<u8>`; mutation blobs carry the identical value-bearing 32-byte record (`number_value`, display/error string offsets, color overrides) and have no redaction primitive. A recalc triggered by an authorized write can cascade values into cells the actor cannot read; those values would reach the wire unredacted. Provide `filter_mutation_buffer` (and a multi-viewport/spill-aware variant) with the same `None`/`Structure`/passthrough semantics, so the security boundary is symmetric across both protocols.
2. **O2 — Give the mutation & multi-viewport protocols a version field.** The viewport header embeds `WIRE_VERSION` in flags bits 4-7 and TS validates it; the **mutation header has a `reserved: u32` that is always 0**, and the multi-viewport blob is a bare `[u16 viewport_count]` with no version at all. A breaking layout change to mutations cannot be detected by the consumer — it silently misreads. Allocate a version byte (carve it from `reserved`, keeping header size 16) and from the multi-viewport envelope, and emit/validate it in lock-step with `WIRE_VERSION`.
3. **O3 — Make protocol-bound truncation explicit instead of `debug_assert`-only.** Every count/length write (`patch_count as u32`, `string_pool.len() as u32`, `sheet_id_len as u16`, `id_bytes.len() as u8` in the multi-viewport envelope, `total_count … unwrap_or(u16::MAX)` in `concat`) is guarded **only by `debug_assert!`**. In release builds these casts silently truncate, producing a structurally corrupt blob the consumer parses as valid. Hardest cases: `concat_multi_viewport_patches` caps the count at `u16::MAX` while still appending all bodies (declared count < actual entries → the consumer's per-viewport walk runs off the end), and `serialize_multi_viewport_patches` truncates any sheet ID ≥ 256 bytes to a wrong `u8` length. Replace silent truncation with a checked contract (saturating-with-loud-`tracing::error!`, or `Result`/clamp-and-drop) at every count boundary.
4. **O4 — Add a Rust-side mutation deserializer and property-based roundtrip parity.** The folder's stated charter is "mutation serialization and wire protocol correctness," yet `deserialize.rs` decodes **only the viewport format**; mutations have no Rust decoder and therefore no proptest roundtrip the way viewports do. Add a `cfg(test)`/`test-utils` `deserialize_mutation` that mirrors the real TS splice logic (header → sheet id → patches → string pool → spill → palette section) so mutation serialization is verifiably lossless and bounds-safe against arbitrary `RecalcResult` inputs.
5. **O5 — Document and harden the overloaded `error_off` "image metadata" channel.** `intern_error_string` (helpers.rs) stuffs serialized **image JSON** into the *error* string slot for `CellValue::Image`, paired with `VALUE_TYPE_IMAGE` + `HAS_CELL_IMAGE`. This dual meaning of `error_off` is undocumented in the wire spec (README/`lib.rs` describe `error_off` as an error string only) — a hidden contract between Rust and the TS decoder. Document it as a first-class part of the protocol and add a guard so a serde failure (currently silently `(NO_STRING, 0)`) is observable rather than a silent dropped image.
6. **O6 — Fix the public wire-spec documentation drift.** Multiple authoritative doc comments are wrong or stale in a crate that is the "single source of truth":
   - `mutation/mod.rs` doc (and `lib.rs` re-doc) say a patch "becomes a **32-byte** cell patch (row + col + **24-byte** cell record)" — the real layout is a **40-byte** patch with a **32-byte** record (`PATCH_STRIDE = 40`, `CELL_STRIDE = 32`).
   - `flags.rs` module doc lists "Bit 11-15: reserved" and the `ValueType` doc omits `Image = 5`, but bit 11 = `HAS_CELL_IMAGE` and value 5 = `VALUE_TYPE_IMAGE` both exist and are emitted.
   - The `cell_flag_bits_are_disjoint` test omits `HAS_CELL_IMAGE`, so the disjointness invariant is unverified for the newest flag.
   - README header table says the viewport `flags` byte's version bits are "currently 0"; `WIRE_VERSION` is now 2.
   - README mutation spill section calls header bit 0 `has_spill_changes` while the constant is `MUT_HAS_PROJECTION_CHANGES` (bit-0 naming inconsistency).
   These are low-risk but high-value: this folder's docs are what the TS decoder authors and future maintainers trust.
7. **O7 — Harden `concat_multi_viewport_patches` against malformed inputs.** It blindly trusts each blob's first two bytes as a count and concatenates the rest with no structural validation, no minimum-length check beyond `len() < 2`, and the silent `u16::MAX` cap from O3. Give it a defined, non-corrupting behavior (validate each child envelope's self-consistency, or document and enforce that inputs are only ever this crate's own outputs) so a single bad producer cannot emit an aggregate that the consumer walks off the end of.

## Production-path contracts and invariants to preserve or strengthen

These are non-negotiable behaviors the current code and README encode; every change must keep them green.

- **C1 — Byte-exact layout & little-endian.** All multi-byte fields are LE via `to_le_bytes`. Strides are fixed (`CELL_STRIDE = 32`, `PATCH_STRIDE = 40`, `MERGE_STRIDE = 16`, `DIM_STRIDE = 12`, `MUTATION_HEADER_SIZE = 16`, `VIEWPORT_HEADER_SIZE = 36`). The `debug_assert_eq!(buf.len(), total_size)` post-condition in every serializer must remain exact after any change.
- **C2 — Shared 32-byte cell record.** The mutation patch's trailing 32 bytes are byte-identical to the viewport cell record so TS can splice patches in place. O1/O2/O3 must not perturb the record layout (only the header/envelope around it) unless `WIRE_VERSION` is bumped.
- **C3 — `#![forbid(unsafe_code)]`.** No transmute, no pointer arithmetic. All new decode/redaction code stays in safe Rust with explicit bounds checks (mirror `deserialize.rs`'s `checked_add`/`checked_mul`/`SectionOutOfBounds` discipline).
- **C4 — Versioning is the only breaking-change mechanism.** Any layout change that the TS decoder cannot read as-is MUST bump `WIRE_VERSION` (and, per O2, the new mutation/multi-viewport version) so the consumer fails loud rather than misparsing. Regenerate `constants.gen.ts` in the same change.
- **C5 — Rust ⇄ TS constant lock-step.** `generate_constants_ts()` is the single source for `constants.gen.ts`; the `cell_format_json_fields()` exhaustive struct literal + `verify_constants_gen` test catch field drift. New constants (mutation version, any new flag) must flow through codegen, not be hand-added on the TS side.
- **C6 — Security redaction happens in Rust before the bridge.** `filter_viewport_buffer` is the authoritative redactor (the TS stub is dead). O1's mutation redactor must likewise operate on the wire buffer in-place / pre-bridge, never by decoding to a domain type the bridge could leak. It must preserve non-value-revealing fields (`format_idx`, formula/sparkline/hyperlink flags) exactly as the viewport filter does, and clear value bits, `number_value`, string offsets, and color overrides for `None`; emit type placeholders for `Structure`.
- **C7 — Tolerant of degenerate/empty inputs.** Empty change sets produce header-only buffers; `serialize_multi_viewport_patches(&[])` returns the 2-byte `viewport_count = 0` sentinel that >20 engine call sites depend on (see `tables.rs`, `batch_cells.rs`, `defined_names_print_cells.rs`); `concat` skips 2-byte/zero-count blobs. Redactors and validators must keep these no-op shapes intact (the `filter_viewport_buffer` early-returns on `len < HEADER` / `cell_count == 0` are the template).
- **C8 — `ValueType` total + closed.** `ValueType::from_cell_value` is exhaustive over `CellValue`; `TryFrom<u16>` rejects discriminants outside 0-5. New value types require a version bump and codegen update. The `generation` counter is a wrapping `u8` (stale-buffer detection only) — keep it documented as best-effort.
- **C9 — Spill/projection invariants.** Spill patches always set `IS_SPILL_MEMBER`; CSE projections additionally set `HAS_FORMULA`; the `u32::MAX` row/col sentinel guard in `build_spill_patches` must remain (defense against unresolved upstream positions leaking onto the wire); spill `format_idx` is intentionally 0.

## Concrete implementation plan

### Phase 0 — Evidence & decision gate (no code change)

- **Step 0.1 — Confirm the mutation leak surface (O1).** Trace, from `bridge-delegate/macros/src/expand/gated.rs`, whether any mutation-returning method with `scope = "sheet"` reaches a `None`/`Structure` actor, and whether recalc cascades can produce patches outside the actor's read set. Capture the answer in this plan's risk log. If mutations are already gated by a write pre-check that also bounds the *returned* patch set to readable cells, O1 narrows to a defense-in-depth assertion; if not, O1 is a security fix and leads the change set. (This is the one genuinely unknown; everything else is mechanical.)
- **Step 0.2 — Confirm version-bit budget (O2).** Verify the mutation `reserved: u32` is universally written as 0 today (it is, in both `serialize_mutation_result` and `_for_viewport`) so repurposing its low byte for a version is safe, and decide whether the multi-viewport envelope gets a `[u8 version][u16 count]` prefix (bump requires coordinating the TS reader — flag as a cross-folder dependency).

### Phase 1 — In-folder hardening, no layout change (lowest risk)

- **Step 1.1 — Eliminate silent truncation (O3).** In `mutation/mod.rs` and `mutation/patch.rs`, replace each `debug_assert!(u32::try_from(...).is_ok())` + `as u32`/`as u16`/`as u8` pair with a checked path:
  - For counts/lengths that cannot realistically overflow (patch count, string-pool bytes), keep the cast but add a release-safe `if let Err(_) = u32::try_from(...) { tracing::error!(...); }` guard or saturating clamp with a logged truncation, so a violated invariant is observable, not silent.
  - For `serialize_multi_viewport_patches`, reject/clamp sheet IDs ≥ 256 bytes loudly instead of `id_bytes.len() as u8` (UUIDs are 36 bytes; a longer id is a bug, not a valid truncation).
  - For `concat_multi_viewport_patches`, when `total_count > u16::MAX`, do **not** emit a count that under-reports the appended bodies; either widen the envelope (coordinate with O2) or `tracing::error!` and drop the overflow tail so declared count == emitted entries.
- **Step 1.2 — Fix documentation drift (O6).** Correct the `32-byte/24-byte` → `40-byte/32-byte` patch description in `mutation/mod.rs` and `lib.rs`; update `flags.rs` module doc to list bit 11 = `HAS_CELL_IMAGE` and `ValueType::Image = 5`; add `HAS_CELL_IMAGE` to the `cell_flag_bits_are_disjoint` test array; fix the README version-bits note and the `has_spill_changes`/`MUT_HAS_PROJECTION_CHANGES` naming. Pure doc/test edits, no wire change.
- **Step 1.3 — Document & guard the image-metadata channel (O5).** Add a wire-spec note (README + `helpers.rs` + `mutation/mod.rs` doc) that for `VALUE_TYPE_IMAGE` cells the `error_off`/`error_len` slot carries serialized image JSON (a deliberate reuse of the error channel), and that `HAS_CELL_IMAGE` flags it. Make the serde-failure branch in `intern_error_string` observable (`tracing::warn!`) instead of silently dropping to `(NO_STRING, 0)`, so a dropped image surfaces in logs.

### Phase 2 — Mutation deserializer + roundtrip parity (test-utils only, no production layout change)

- **Step 2.1 — Build `deserialize_mutation` (O4).** In `deserialize.rs` (or a sibling `mutation_deserialize` test module behind `cfg(any(test, feature = "test-utils"))`), add a decoder that parses header (16B) → sheet id → N×40B patches → string pool → optional spill section → optional palette section, with the same `checked_*`/`SectionOutOfBounds`/`TrailingBytes` rigor as the viewport decoder. Reuse the existing `palette_binary::deserialize_palette_binary` for the palette tail.
- **Step 2.2 — Property tests.** Add proptest roundtrips over arbitrary `RecalcResult` (changed cells, projection changes, errors, palette deltas, viewport bounds) asserting `deserialize_mutation(serialize_mutation_result*(...))` reproduces every field, that bounds filtering drops exactly the out-of-range cells, and that no buffer ever has trailing bytes or out-of-range string offsets. This is the verification asset the folder currently lacks; it is additive and gates Phases 1, 3, and 4.

### Phase 3 — Mutation security redaction (O1) — sequenced after Phase 0 decision

- **Step 3.1 — `filter_mutation_buffer`.** Mirror `security_filter.rs`: an in-place walker over the mutation buffer. Unlike the viewport (dense, position-implicit) format, mutation patches carry explicit `(row, col)` in the 8-byte prefix, so the per-cell matrix lookup reads position directly from each patch rather than deriving it from header geometry — simpler and exact. Reuse `zero_cell_value`/`apply_structure_placeholder` semantics on the trailing 32-byte record (extract them into a shared `cell_record` helper module so both filters share one implementation and cannot drift). Handle the spill section and (if present) leave the palette section untouched (formats are not value-revealing, matching the viewport filter's `format_idx`-preserving stance).
- **Step 3.2 — Wire it into the boundary.** Extend `bridge-delegate`'s read/mutation postfilter so mutation-returning sheet-scope methods route through `filter_mutation_buffer` (this edit is in the macro crate — **out of this folder**, named as a dependency). Within `compute-wire`, the deliverable is the redactor + its unit/property tests proving `None` zeros all values, `Structure` emits type placeholders, and `Read/Write/Admin` is byte-identical passthrough.

### Phase 4 — Versioning (O2) — breaking, gated behind a coordinated bump

- **Step 4.1 — Carve a version byte.** Repurpose the low byte of the mutation header `reserved: u32` as `mutation_wire_version` (header size stays 16B; C1 preserved). Prefix the multi-viewport envelope with a version byte if Phase 0.2 chose to. Emit `WIRE_VERSION` there.
- **Step 4.2 — Codegen + fixtures.** Add the new constant(s) to `generate_constants_ts()`, regenerate `constants.gen.ts` via the `generate-ts` binary, regenerate cross-language fixtures via `generate-test-fixtures`, and bump `WIRE_VERSION` if the layout semantically changed. The TS decoder validating the new version is a **downstream** change in `kernel/src/bridges/wire/*` (dependency, not in scope here).

## Tests and verification gates

- **Existing suites must stay green:** `mutation/tests/*` (value types, viewport, multi-viewport, spill, header/patches, palette), `palette_binary/tests`, `viewport/tests`, the `flags` unit tests, the `cell_format_drift_tests` in `lib.rs`, and the cross-language roundtrip test (`cross-language-roundtrip.test.ts`) that fails loudly on stale fixtures.
- **New gates added by this plan:**
  - **G1 (O4):** proptest mutation roundtrip — serialize→deserialize is lossless for all `RecalcResult` shapes; bounds filtering is exact; no trailing/out-of-range bytes (Phase 2). This is the keystone gate for "mutation serialization correctness."
  - **G2 (O1):** redaction unit + property tests — `None` zeros values, `Structure` placeholders by type, `Read/Write/Admin` byte-identical; redacted buffers still deserialize cleanly via G1's decoder (no corruption introduced by the in-place edit); shared `cell_record` helper produces identical results for viewport and mutation paths.
  - **G3 (O3):** truncation guards — a constructed oversize sheet id / overflowing concat count produces a *consistent* (non-corrupting) blob and a logged error, asserted via a capturing `tracing` subscriber; declared counts always equal emitted entries.
  - **G4 (O2):** version-field tests — emitted version matches `WIRE_VERSION`; a deliberately wrong version is detectable by the decoder; `constants.gen.ts` regenerated and `verify_constants_gen` passes.
  - **G5 (O6):** `cell_flag_bits_are_disjoint` includes `HAS_CELL_IMAGE`; a doc-example/round-trip test covers `VALUE_TYPE_IMAGE`.
- **Static gates:** the crate's `deny(clippy::all)`, `warn(pedantic)`, `deny(missing_docs)`, `forbid(unsafe_code)` must all still hold; every serializer's `debug_assert_eq!(buf.len(), total_size)` must remain exact.
- **Note on running:** per task constraints this plan does **not** run cargo/clippy/codegen; the gates above are the acceptance criteria for whoever implements it. Codegen/fixture regeneration (Steps 4.2) and the TS-side version validation are explicit downstream actions.

## Risks, edge cases, and non-goals

- **Risk — O1 may be redundant or critical (resolved by Phase 0).** If mutation patch sets are already bounded to the actor's readable cells, O1 is defense-in-depth; if not, it is a live confidentiality fix and must lead. The plan front-loads this determination rather than assuming.
- **Risk — version bump coordination (O2/Phase 4).** Bumping the mutation/multi-viewport version is breaking; it must land atomically with the TS decoder's validation and regenerated fixtures, or the consumer rejects valid buffers. Sequenced last and gated on the TS-side change. Until then, O3's loud-truncation guards give immediate safety without a layout change.
- **Edge case — `u16::MAX` viewport count / >4GB string pool.** Theoretically reachable overflow points; O3 makes them loud-and-bounded rather than silently corrupt. Not expected in practice but currently undefended in release builds.
- **Edge case — `generation` u8 wrap.** Stale-buffer detection wraps every 256 generations; this is by design (best-effort) and is only documented, not changed.
- **Edge case — empty/no-op shapes (C7).** The 2-byte `viewport_count = 0` sentinel and header-only mutation buffers are depended on by many engine call sites; redactors/validators must treat them as no-ops.
- **Non-goals:** rewriting the wire format, changing the 32-byte cell record layout (outside an explicit version bump), moving redaction into TS, altering the `FormatPalette` interning strategy, touching the engine call sites or the bridge macro internals beyond wiring the new mutation filter, or any performance re-architecture. No compatibility shims — versioning is the mechanism for any breaking change.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now:** Phase 1 (O3 truncation guards, O6 docs/tests, O5 image-channel doc/guard) and Phase 2 (O4 deserializer + proptests) are entirely in-folder and can proceed concurrently — Phase 2's decoder is the verification harness that strengthens confidence in Phase 1 and Phase 3.
- **Sequenced after a decision:** Phase 3 (O1) depends on Phase 0.1's leak determination and benefits from Phase 2's decoder (G2 reuses it). The actual bridge wiring (Step 3.2) edits `infra/rust-bridge/bridge-delegate/macros` — a **separate folder**; this plan delivers the `compute-wire` primitive and tests, and names the macro change as a dependency.
- **Cross-folder dependencies:**
  - **Downstream — `kernel/src/bridges/wire/*` (TS decoder):** must learn to read any new version field (O2) and the documented image-metadata channel (O5); regenerated `constants.gen.ts` is consumed there. Coordinate the version bump atomically.
  - **Downstream — `bridge-delegate` macros:** route mutation returns through `filter_mutation_buffer` (O1).
  - **Upstream — `compute-security`:** `SheetAccessMatrix`/`AccessLevel` are reused as-is by the new mutation filter; no change expected there (the existing clean edge — no Yrs/compute-core deps — is preserved).
  - **Sibling — `snapshot-types` (`RecalcResult`, `CellChange`, `ProjectionChange`):** the proptest generators (O4) build arbitrary instances of these; no production change to that crate, but the test code takes a dev-dependency view of its shape.
