Rating: 7/10

Summary judgment

This is a strong, production-aware plan with unusually good local evidence. It correctly identifies that `ClientDataFlags` and `EditAsKind` exist in `domain-types/src/domain/drawings` but are not the representation used by persistent anchor props, and it frames the work around lossless typed preservation rather than UI-only simplification. The sequencing, corpus-first raw XML policy, and tri-state client-data warning are all directionally right.

The plan is not yet a fully reliable implementation contract. It overstates some evidence, especially by implying the whole `audits.rs` surface is orphaned: line primitives are consumed by `outline.rs`, `HyperlinkRef` is consumed by `text_body.rs`, and some of those types may be production-relevant through larger drawing structures even if direct external references are absent. It also under-specifies the full migration surface: chart specs, parser writer helper structs, and other flat `edit_as` / `client_data_*` paths remain outside the five `floating_object/ooxml.rs` structs.

Major strengths

- The plan targets the production representation rather than adding more test-only typing.
- It preserves the key OOXML contract for `ClientData`: absent/default/explicit values must not collapse to a plain boolean.
- It recognizes JSON schema compatibility as a real risk when replacing flat fields with nested typed fields.
- The raw XML work is sensibly ordered by corpus frequency and fixture-backed round-trip proof, not by spec-completeness ambition.
- The implementation steps are mostly independently shippable, and the parallelization notes identify the cross-folder critical path.

Major gaps or risks

- The orphan inventory needs correction. `ClientDataFlags` and `EditAsKind` appear genuinely disconnected from tracked public consumers, but `LineDashSpec`, `LineFill`, `LineCap`, `PenAlignment`, and `HyperlinkRef` are not simply dead; they are used by `Outline` or `TextBody`.
- Step 2 is too narrow for the stated objective. `domain-types/src/domain/chart/spec.rs` still has `anchor_edit_as: Option<String>` plus the two flat client-data fields, and `file-io/xlsx/parser/src/write/drawing_writer_helpers/ooxml_props.rs` carries the same loose representation. If those remain flat, the typed primitives are not the single source of truth.
- The proposed default/serde invariant harness is underspecified. Several re-exported types are enums, tagged enums, lack `Default`, or intentionally serialize non-empty default variants. The plan names a couple of exceptions but needs a complete per-type expectation table before this is safe to implement.
- `EffectProperties` is a bigger contract issue than the plan admits: its current converters intentionally drop `EffectList` body content and turn `EffectDag` into an empty/default container. That violates the module-level From/From round-trip claim and should be audited before treating raw XML cleanup as the main effects work.
- Token preservation may require widening `ooxml_types` enum surfaces, not just changing local converters. Calls like `PresetPatternVal::from_ooxml`, `DashStyle::from_ooxml`, and `SchemeColor::from_ooxml(...).unwrap_or_default()` cannot preserve unknown tokens unless the lower type can carry them.

Contract and verification assessment

The desired contracts are the right ones: camelCase JSON, lossless parse/domain/write behavior, absent-value preservation, and fixture-backed proof before deleting raw XML. The plan needs to separate three contracts more explicitly: public JSON compatibility, Rust domain API compatibility, and XLSX round-trip fidelity. The JSON change from `clientDataLocksWithSheet` / `clientDataPrintsWithSheet` to nested `clientData` is potentially breaking even if OOXML output remains equivalent.

The verification section is solid conceptually but should name exact gates. At minimum, this work should require `cargo test -p mog-domain-types`, `cargo clippy -p mog-domain-types`, targeted `xlsx-parser` drawing/chart round-trip tests, and the downstream crate checks for every migrated consumer. The no-op serialization gate should require byte-identical or explicitly canonicalized XLSX diffs for representative drawing-heavy workbooks, not a vague exception for "deliberately-typed fields."

Concrete changes that would raise the rating

- Replace the broad "audits.rs is orphaned" framing with an inventory table: primitive, current direct consumers, production read/write route, and migration status.
- Expand Step 2 to include `ChartSpec`, chart frame props, parser writer helper structs, and any API/bridge schema that still exposes flat anchor fields.
- Add a preliminary converter audit step that classifies every `From<&ooxml_types::...>` / `From<domain>` pair as lossless, intentionally shape-only, or invalid; fix or rename the lossy ones before enforcing the invariant.
- Define the invariant harness as an explicit per-type contract table rather than assuming every default serializes to `{}`.
- Add an `ooxml_types` dependency note for unknown-token preservation wherever the target enum cannot currently carry raw tokens.
- Replace broad verification prose with concrete commands, fixture names or corpus scan locations, and acceptance criteria for JSON schema migration and XLSX no-op round trips.
