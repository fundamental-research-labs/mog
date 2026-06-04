Rating: 8/10

Summary judgment

This is a strong plan with the right architectural center of gravity: treat `ooxml-types` as a shared wire-vocabulary contract, preserve lenient XLSX import behavior, add strict parsing as an explicit opt-in, and move drift-prone hand-written enum conversions behind a single derive-backed implementation. It is production-path relevant because the types are used by the XLSX parser and writer, and the plan correctly identifies `to_ooxml` output as the write-side wire contract.

The rating is not higher because the plan still has a few specification gaps that could cause a large migration to become ambiguous: strict-only `Option` parsers are not cleanly modeled, exact inventory numbers need to be produced by a reproducible script instead of embedded as observed counts, and the verification gates do not fully cover the macro crate and parser-side Phase 4 behavior change.

Major strengths

- Correctly frames the folder as a vocabulary crate, not an XML parser or full ECMA object model, matching `ooxml-types/src/lib.rs`.
- Preserves existing `from_ooxml` / `from_bytes` lenient semantics for external XLSX import while adding strict constructors rather than silently changing hundreds of call sites.
- Uses `xml_derive::XmlEnum` as the right abstraction point. The macro currently generates only lenient `from_bytes`, `from_ooxml`, `to_ooxml`, and `as_str`, so extending it attacks the class of drift bugs instead of isolated enum cases.
- Makes `to_ooxml` token stability an explicit acceptance criterion, which is essential for XLSX export correctness.
- Recognizes aliases as real union-type coverage and calls out defaults as part of the compatibility contract.
- Includes sequencing and parallelization boundaries that are mostly clean: macro first, file-local enum migration second, invariant harness, then parser caller migration.

Major gaps or risks

- The plan treats "every unit-variant OOXML enum" as derive-migratable, but several unit enums currently have strict `Option` semantics and no obvious default fallback, such as `ShapePreset::from_ooxml`, `PivotAxis::from_ooxml`, `MeasureUnit::from_ooxml`, and color/token helpers. A derive that always requires `Default` and generates `from_ooxml -> Self` does not preserve those APIs.
- Renaming existing strict helpers like `from_ooxml_token` to `try_from_ooxml` is underspecified. That is a compatibility decision, not just a cleanup. The plan should say whether old strict names remain as deprecated aliases, are crate-local only, or are intentionally broken.
- The inventory is not a verifiable artifact yet. I confirmed the broad shape, but simple local counts depend on query shape: for example, there are 21 files with `xml_derive::XmlEnum` and 121 exact `fn from_ooxml(` definitions, but `pub enum` and parser call counts differ from the plan's embedded numbers. The implementation needs a repeatable inventory script/output checked into the workstream.
- The proposed invariant harness cannot actually guarantee "100% of conversion enums" if enum membership is maintained only by a manual macro list plus a comment anchor. New enums can still be omitted unless a source inventory check fails on omissions.
- Serde/OOXML parity is a good requirement, but the plan does not specify how the test will extract serde tokens. This is especially important where variants use `serde(rename_all)`, explicit `serde(rename)`, or no serde rename while `to_ooxml` uses abbreviated OOXML tokens.
- Phase 5's manifest check is directionally useful but vague. Manifest rows are coarse feature/module rows, not enum declarations, so "typed_in_ooxml_types maps to a module that actually exists under src" needs a concrete row-to-module mapping field or it will become a weak existence check.

Contract and verification assessment

The contract section is one of the plan's best parts: lenient parsing remains additive, write tokens must not change, default fallback is preserved, aliases are carried forward, and hand-written holdouts are still invariant-covered. That is the right preservation model for a production OOXML vocabulary.

The verification gates need tightening. `cargo test -p ooxml-types`, `cargo test -p xml-derive`, `cargo clippy -p ooxml-types`, and the manifest checker are necessary, but not sufficient. Because Phase 1 edits the proc macro, add `cargo clippy -p xml-derive`. Because Phase 4 changes parser behavior, add parser-owner verification for the affected XLSX parser crate and targeted import/export fixtures that prove external unknown-token handling remains lenient while internal/domain conversions reject unknowns with diagnostics.

The "before/after token-set diff" acceptance criterion is important but needs to become a concrete gate: generate or snapshot the complete enum token inventory before migration, then assert after migration that every primary write token is unchanged and every alias still maps to the same variant.

Concrete changes that would raise the rating

- Add a Phase 0 deliverable: a checked-in or generated inventory file listing every conversion enum, current helper names/signatures, default behavior, aliases, serde token source, all variants, and intended migration mode.
- Extend `XmlEnum` with modes or companion attributes, not just one strict method. For example, support lenient-with-default enums, strict-only enums, deprecated strict alias names, and maybe generated `ALL_VARIANTS` / token metadata for tests.
- Preserve old strict helper names as forwarding methods unless the plan can prove they are private to this crate.
- Replace the manual invariant list with a mechanically checked inventory-to-test linkage so adding a new conversion enum without invariant coverage fails.
- Define exactly how serde parity is tested, preferably via `serde_json` serialization of every unit variant compared to the declared OOXML primary token, with explicit allowlist entries for intentional divergence.
- Strengthen Phase 5 by adding manifest fields that map coarse coverage rows to `ooxml-types/src` modules, then validate those fields rather than inferring from prose.
- Add `cargo clippy -p xml-derive` and parser-owner behavior tests to the verification gates for the phases that touch those production paths.
