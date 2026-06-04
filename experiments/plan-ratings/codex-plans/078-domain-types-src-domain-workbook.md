# 078 - Domain Types Workbook Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/domain-types/src/domain/workbook`

Queue item: 78

Scope: Rust workbook-domain models in `domain-types`, including workbook calculation settings, workbook properties, workbook views, workbook protection, file version/sharing metadata, web publishing metadata, Mog workbook identity metadata, durable sheet package inventory, and OOXML conversion implementations.

Files inspected in the source folder:

- `mod.rs`
- `calculation.rs`
- `file_metadata.rs`
- `identity.rs`
- `ooxml.rs`
- `properties.rs`
- `protection.rs`
- `view.rs`
- `web_publishing.rs`
- `tests.rs`

Adjacent production paths inspected:

- `domain-types/src/parse_output.rs`
- `domain-types/src/yrs_schema/{workbook_properties,file_version,file_sharing,web_publishing}.rs`
- `domain-types/src/yrs_schema/tests/flat_maps.rs`
- `file-io/ooxml/types/src/{workbook,protection,web_publish}.rs`
- `file-io/xlsx/parser/src/domain/workbook/read/{calc,inventory,properties,views}.rs`
- `file-io/xlsx/parser/src/domain/workbook/write/{attrs,calc,metadata,root,views,writer}.rs`
- `file-io/xlsx/parser/src/output/results/workbook.rs`
- `file-io/xlsx/parser/src/output/to_parse_output/mod.rs`
- `file-io/xlsx/parser/src/write/from_parse_output/workbook_parts.rs`
- `file-io/xlsx/parser/src/pipeline/full_parse/non_editable_sheets.rs`
- `compute/core/crates/compute-document/src/workbook_metadata.rs`
- `compute/core/src/storage/infra/hydration/workbook.rs`
- `compute/core/src/storage/engine/services/export/workbook.rs`

This is a public Mog source folder. Implementation belongs in `mog`; this plan remains internal in `mog-internal`.

## Current role of this folder in Mog

`domain-types/src/domain/workbook` is the shared persistent workbook contract between XLSX import, `ParseOutput`, Yrs hydration/export, and XLSX write. It is not only a passive set of structs.

The folder currently owns these contracts:

- `CalculationProperties`: durable workbook `calcPr` semantics, including Mog's calc-id provenance handoff through `ParseOutput::calc_id_provenance`.
- `WorkbookProperties`: full `workbookPr` state with the 18 modeled OOXML fields and spec defaults.
- `WorkbookView`: workbook window/tab/view state for one or more `<workbookView>` elements, including `xr2:uid` and raw `extLst` sidecar.
- `WorkbookProtection`: full 15-field workbook protection state, including legacy and modern password/hash fields.
- `FileVersion` and `FileSharing`: workbook-level file metadata and read-only/password sharing settings.
- `WorkbookWebPublishing`: optional workbook `<webPublishing>` attributes.
- `MogWorkbookIdentityMetadata`, `WorkbookId`, and `WorkbookLineage`: Mog-specific identity custom XML metadata, separate from runtime `compute-document` identity state.
- `WorkbookSheetPackageInfo`, `WorkbookSheetKind`, and `PackageDiagnosticRef`: durable workbook-order package inventory that links workbook sheet entries to package paths, relationship IDs, content types, sheet kinds, editable worksheet indexes, and compact diagnostics.
- `ooxml.rs`: bidirectional conversions between `ooxml-types` records and the durable domain records for the import/export path.

Observed production flow:

- The XLSX parser reads workbook XML with byte scanners into `ooxml-types` or direct domain structs, then `full_parse_result_to_parse_output` copies these models into `ParseOutput`.
- Hydration stores selected models in Yrs: `WorkbookProperties` in the existing `workbookSettings` map, file version/sharing in separate maps, web publishing in its own map, and workbook views as JSON under `workbookSettings`.
- Export reconstructs `ParseOutput` from engine storage, then `file-io/xlsx/parser` converts domain models back to workbook XML.
- Workbook sheet inventory drives editable worksheet indexing, non-editable chartsheet/dialogsheet preservation, workbook sheet order, and workbook relationship reconstruction.
- Workbook XML fidelity sidecars preserve or regenerate direct workbook children according to owner policy, while modeled children are regenerated from these domain structs.

Current strengths:

- The folder is small and already modular by workbook concern.
- Most domain structs derive serde with camelCase wire names.
- Existing unit tests cover many example round trips, default values, JSON serde names, and several enum tokens.
- The parser/writer already uses these models in the production import/export path.

Current improvement opportunities:

- Field coverage is verified mostly by hand-written examples, not by an executable contract inventory.
- Parsing, OOXML conversion, Yrs storage, and XML writing each duplicate default/token/key knowledge.
- Explicit-default attribute presence is tracked only for `iterateCount` and `iterateDelta`; other modeled attributes may be canonicalized unintentionally.
- `WorkbookView::ext_lst_raw` is `#[serde(skip)]`, so the parse/export boundary must prove exactly where raw view extension fidelity is preserved and where it is intentionally dropped.
- `WorkbookSheetPackageInfo` has important cross-field invariants but no local validation API.
- Mog workbook identity metadata in this folder and persisted runtime workbook identity in `compute-document` are related but structurally separate; the boundary is implicit.

## Improvement objectives

1. Make `domain-types/src/domain/workbook` the executable source of truth for workbook-domain field inventories, defaults, serde keys, OOXML attributes, Yrs keys, and modeled child ownership.

2. Replace ad hoc field-coverage confidence with table-driven tests that prove every modeled workbook field is covered in domain serde, OOXML conversion, parser projection, Yrs storage where applicable, and writer emission.

3. Add production validation APIs for workbook models so parse, hydration, export, and diagnostics can enforce invariants consistently without relying on test-only assertions.

4. Extend explicit-default and presence tracking from isolated calc fields to a complete modeled-workbook-child policy, so export can intentionally preserve, regenerate, or canonicalize defaults.

5. Strengthen workbook sheet package inventory as a durable identity contract: workbook order, sheet IDs, visibility, relationship identity, normalized part paths, content types, sheet kind, editable sheet index, and diagnostics should validate as one unit.

6. Normalize enum/token conversion for workbook domain enums so JSON, Yrs, OOXML writer helpers, and parser mappings cannot drift.

7. Clarify Mog workbook identity ownership: XLSX-embedded custom XML identity in `domain-types` and runtime persisted identity in `compute-document` should have explicit adapters or explicit separation.

8. Keep the production path primary: improvements should land in `domain-types`, `file-io/xlsx/parser`, and compute hydration/export code that the app actually uses.

## Production-path contracts and invariants to preserve or strengthen

Layering:

- `domain-types` must not depend on `mog-internal`, compute-core implementation modules, or XLSX parser internals.
- `file-io/xlsx/parser` may consume `domain-types` and `ooxml-types`; parser-specific byte scanning and XML writing remain in the parser crate.
- `ooxml-types` remains the low-level OOXML vocabulary; this folder remains the durable Mog workbook domain contract.
- Public serde shapes for existing fields remain camelCase unless an intentional migration is planned across ParseOutput, Yrs, bridge, and export consumers.

Workbook child ownership:

- Modeled workbook children are regenerated from typed state: `fileVersion`, `fileSharing`, `workbookPr`, `bookViews`, `workbookProtection`, `calcPr`, and `webPublishing`.
- Inert or unsupported workbook direct children remain governed by `WorkbookXmlFidelity`, not by raw passthrough hidden in these structs.
- `customWorkbookViewsXml` stays outside `WorkbookView`; it is a workbook-level direct child, not a view-field detail.
- `calcPr` export must preserve the current policy: Mog does not export `calcChain`; stale or unknown calc IDs are canonicalized and consumer recalculation flags are set when needed.

Defaults and presence:

- OOXML spec defaults must remain the semantic defaults for absent attributes.
- Explicit default attributes must be either preserved through a modeled presence contract or deliberately canonicalized with a diagnostic/policy reason. This should be complete across workbook models, not limited to `iterateCount` and `iterateDelta`.
- `WorkbookProperties::default()` must keep Excel/OOXML defaults currently used by writer omission logic, including `show_border_unselected_tables`, `show_ink_annotation`, `save_external_link_values`, and `auto_compress_pictures` as true.
- `WorkbookView::default()` must keep visible, non-minimized, scrollbars shown, sheet tabs shown, `active_tab = 0`, `first_sheet = 0`, and no geometry unless specified.

Sheet package inventory:

- `workbook_order` is workbook XML order and must be stable, unique, and sortable.
- `editable_sheet_index` must point into `ParseOutput.sheets` only for valid editable worksheets.
- Non-editable chartsheets and dialogsheets may be preserved only when package graph, content type, target mode, and diagnostics allow it.
- External targets, missing relationships, duplicate relationship IDs, duplicate targets, invalid targets, missing target parts, unsupported kinds, and relationship/content-type mismatches must remain visible as stable diagnostic codes.
- Workbook sheet IDs, names, and visibility must preserve imported state unless live sheet data has an explicit edited value.

Storage:

- `date1904` remains the sentinel key for `WorkbookProperties` in the `workbookSettings` Y.Map because existing documents rely on it.
- Workbook views stored as JSON in `workbookSettings` must be validated and versioned before that shape becomes more permanent.
- Yrs flat maps must keep stable key names for file version, file sharing, workbook properties, and web publishing.
- Optional fields that are absent in Yrs must read as domain defaults, not as malformed state.

Identity:

- `MOG_WORKBOOK_ID_CUSTOM_XML_SCHEMA`, `MOG_WORKBOOK_ID_CUSTOM_PROPERTY`, and `MOG_WORKBOOK_ID_CUSTOM_XML_REL_TYPE` are XLSX-embedded identity constants and must not be confused with Yrs runtime identity storage.
- If adapters are added between `MogWorkbookIdentityMetadata` and `compute_document::PersistedWorkbookMetadata`, they must preserve schema/version semantics and avoid silently reusing duplicate/copy lineage fields with different meanings.

Security and fidelity:

- Workbook protection hash/password fields must round-trip without logging or diagnostics that expose secrets.
- Workbook sharing/protection validation should diagnose incomplete modern hash sets but must not drop partial imported fields unless policy explicitly requires it.
- Raw `extLst` XML under a workbook view must not be replayed when it contains relationship-bearing attributes or unsafe references.
- Strict conformance must still be dropped on export when Transitional-only modeled fields are present.

## Concrete implementation plan

### 1. Add a workbook domain contract inventory

Create a source-owned contract module under `domain-types/src/domain/workbook`, for example `contract.rs`, and re-export only the stable public pieces that downstream crates need.

The inventory should define one row per modeled workbook field:

- Domain type and Rust field name.
- Serde key.
- OOXML child and attribute name, when applicable.
- OOXML default value and whether absence differs from explicit default.
- Yrs map/key, when persisted in Yrs.
- Writer emission policy: always emit, emit when non-default, emit when explicitly present, optional attribute, or raw sidecar.
- Validation category: semantic invariant, package invariant, security-sensitive field, or fidelity-only field.

Cover the complete current set:

- `CalculationProperties`: 15 fields.
- `WorkbookProperties`: 18 fields.
- `WorkbookView`: 15 fields, including `uid` and `ext_lst_raw` policy.
- `WorkbookProtection`: 15 fields.
- `FileVersion`: 5 fields.
- `FileSharing`: 7 fields.
- `WorkbookWebPublishing`: 9 fields.
- `WorkbookSheetPackageInfo`: all identity, relationship, content-type, kind, editable-index, and diagnostic fields.
- `MogWorkbookIdentityMetadata`, `WorkbookLineage`, and constants.

Use the inventory to drive tests first, then gradually route parser/writer/Yrs helpers to the same declarations. Avoid a one-off procedural macro unless simple const tables cannot express the needed data.

### 2. Centralize workbook enum token helpers

Add token helpers on domain enums or a small `tokens.rs` module for:

- `CalcMode`
- `RefMode`
- `WorkbookViewVisibility`
- `ObjectDisplayMode`
- `UpdateLinks`
- `WorkbookSheetKind` where serialized strings are part of the JSON/Yrs contract

Each helper should expose canonical JSON token, canonical OOXML token where applicable, and parser fallback policy. Then update:

- `domain-types/src/domain/workbook/ooxml.rs`
- `domain-types/src/yrs_schema/workbook_properties.rs`
- `file-io/xlsx/parser/src/domain/workbook/write/attrs.rs`
- Parser read helpers that map from byte tokens

The goal is that adding a variant breaks all relevant token tables at compile time.

### 3. Add validation APIs for durable workbook models

Add production validation types in `domain-types`, for example:

- `WorkbookDomainValidationError`
- `WorkbookDomainValidationWarning`
- `WorkbookValidationContext`
- `ValidateWorkbookDomain` trait or explicit `validate_*` functions

Validation should be callable without XLSX parser internals. It should support both local validation and context-aware validation with sheet counts/package inventory.

Initial validators:

- `CalculationProperties`: finite `iterate_delta`, nonzero `iterate_count` when iteration is enabled, coherent explicit-presence flags, and calc-id provenance compatibility checks performed by caller context.
- `WorkbookView`: `active_tab` and `first_sheet` in range when sheet count is known, `tab_ratio` finite and in expected OOXML range, nonzero geometry when provided, safe `uid` string, and relationship-free `ext_lst_raw`.
- `WorkbookProperties`: valid date system semantics and no unknown enum state.
- `WorkbookProtection`: coherent modern hash groups, legacy password fields preserved, and no accidental plaintext-password interpretation.
- `FileSharing`: coherent read-only/hash/reservation fields and valid spin count.
- `WorkbookWebPublishing`: known target screen size, valid DPI/code page ranges, and explicit optional boolean semantics.
- `WorkbookSheetPackageInfo`: relationship/content-type/kind consistency, editable index only for worksheets, external targets not editable, normalized paths present for package-owned sheets, and diagnostics matching invalid states.
- `MogWorkbookIdentityMetadata`: schema constant, supported version, non-empty workbook ID, and lineage not self-referential.

Parser imports should attach validation diagnostics without dropping recoverable state. Export should fail or canonicalize only through explicit policy, not silent field loss.

### 4. Replace ad hoc explicit-default handling with modeled child presence

Design a compact presence model rather than adding one boolean per attribute forever. Options:

- A `WorkbookModeledAttributePresence` bitset keyed by the contract inventory.
- A per-child `WorkbookModeledChildProvenance` stored alongside `WorkbookXmlFidelity`.
- A ParseOutput-level sidecar keyed by `WorkbookXmlChildKind`.

Use it to cover all modeled workbook children:

- `calcPr`: keep current `has_explicit_iterate_count` and `has_explicit_iterate_delta` behavior through the new mechanism, then deprecate those booleans only if all callers are migrated in one pass.
- `workbookPr`: preserve explicit default attributes such as `date1904="0"` or `autoCompressPictures="1"` when the child is otherwise unchanged.
- `bookViews`: preserve explicit default view attributes and raw safe child `extLst` where policy permits.
- `fileSharing`, `fileVersion`, `workbookProtection`, and `webPublishing`: preserve intentional presence of optional/default attributes where it matters for round-trip fidelity.

The writer should make an explicit decision per attribute: preserved imported default, semantic non-default, omitted canonical default, or omitted due to unsafe/stale provenance.

### 5. Route parser and writer through the domain contract

Keep the parser's byte-scanning implementation, but remove duplicated workbook schema knowledge from parser modules where possible.

Implementation steps:

1. Update `file-io/xlsx/parser/src/domain/workbook/read/{calc,properties,views}.rs` to fill domain structs plus presence/provenance using the contract inventory.
2. Keep `ooxml-types` conversions for direct vocabulary mappings, but make `domain-types` the place where persistent defaults and presence are defined.
3. Update `file-io/xlsx/parser/src/domain/workbook/write/{calc,metadata,views,attrs}.rs` to emit attributes by asking the domain contract for token/default/presence policy.
4. Update `file-io/xlsx/parser/src/output/to_parse_output/mod.rs` so projection from `FullParseResult` to `ParseOutput` preserves the new provenance.
5. Update `file-io/xlsx/parser/src/write/from_parse_output/workbook_parts.rs` so export passes provenance into `WorkbookWriter`.
6. Keep `WorkbookXmlFidelity` as the owner for direct-child ordering and inert raw child payloads; modeled child attribute presence should complement it, not replace it.

### 6. Strengthen workbook sheet package inventory as a first-class model

Move classification constants and validation expectations close to the domain model while keeping parser-specific archive reads in `xlsx-parser`.

Add domain-level helpers:

- `WorkbookSheetKind::from_relationship_and_content_type(...)`.
- `WorkbookSheetPackageInfo::is_editable_worksheet_candidate()`.
- `WorkbookSheetPackageInfo::is_preservable_non_editable_sheet()`.
- `validate_workbook_sheet_inventory(inventory, sheet_count)`.
- Stable diagnostic code constants for every `workbook_sheet_*` diagnostic currently emitted.

Then update:

- `file-io/xlsx/parser/src/domain/workbook/read/inventory.rs` to use the helper for kind classification and diagnostic codes.
- `file-io/xlsx/parser/src/pipeline/full_parse/non_editable_sheets.rs` to use the same preservability helper.
- `file-io/xlsx/parser/src/write/from_parse_output/workbook_parts.rs` to validate inventory before reconstructing workbook sheet definitions.

This keeps package I/O in the parser but makes the durable identity contract testable in `domain-types`.

### 7. Make Yrs storage coverage mechanical

Use the contract inventory to assert Yrs coverage for every workbook field that is persisted in Yrs:

- `WorkbookProperties` all 18 fields in `workbookSettings`, preserving `date1904` sentinel behavior.
- `FileVersion` all 5 fields.
- `FileSharing` all 7 fields.
- `WorkbookWebPublishing` all 9 fields.
- Workbook views JSON storage policy, including validation/versioning.

Add a storage-shape test that fails when a field exists in the domain inventory but has no declared Yrs policy. The policy may be `persisted`, `not persisted by design`, or `stored elsewhere`; it should never be implicit.

Also audit export sentinels:

- `export_workbook_properties` currently returns `Some` only if `date1904` exists. Keep that for existing documents, but document it in the contract inventory.
- `export_workbook_web_publishing` drops default web-publishing state. Keep that only if the presence sidecar proves there was no imported explicit empty element to preserve.

### 8. Clarify Mog workbook identity boundaries

Decide and document the ownership split:

- `domain-types::MogWorkbookIdentityMetadata`: XLSX embedded custom XML/document-property identity.
- `compute-document::PersistedWorkbookMetadata`: runtime persisted identity and link registry state.

If both are required, add explicit conversion/adaptation functions with tests:

- Import path: custom XML identity -> persisted metadata candidate, with schema/version validation.
- Export path: persisted metadata -> custom XML identity only when the export policy wants embedded Mog identity.
- Duplicate/copy path: lineage fields translated deliberately, not by shared names.

If XLSX embedded identity is not currently production-wired, mark it as planned-but-not-active in the contract inventory and add the smallest parser/export integration task needed to make it active.

### 9. Replace example-only tests with exhaustive contract tests

Keep the existing example tests, but add systematic coverage:

- For every contract inventory row, assert serde key presence/absence behavior.
- For every OOXML-backed field, assert import conversion and export conversion coverage.
- For every Yrs-backed field, assert `to_yrs_prelim` writes it and `from_yrs_map` reads it.
- For every enum, assert JSON token and OOXML token round trips.
- For every modeled child, assert default omission, explicit default preservation, non-default emission, and unsafe raw sidecar behavior.
- For sheet inventory, assert all relationship/content-type/kind combinations and all diagnostic codes.

Prefer small generated/table tests over giant hand-written fixtures, but run them through the same production parser/writer functions used by import/export.

## Tests and verification gates

Future implementation should run these gates before claiming done:

- `cargo test -p domain-types workbook`
- `cargo clippy -p domain-types`
- `cargo test -p domain-types yrs_schema`
- `cargo test -p xlsx-parser workbook`
- `cargo test -p xlsx-parser output::to_parse_output`
- `cargo test -p xlsx-parser write::from_parse_output`
- `cargo test -p compute-document workbook_metadata`
- `cargo test -p compute-core storage::engine::tests::test_xlsx_export`

Additional behavior gates to add with the implementation:

- A `domain-types` contract test that enumerates every workbook field and fails on missing serde, OOXML, Yrs, presence, or validation policy.
- Parser/writer round-trip fixtures for `calcPr`, `workbookPr`, `bookViews`, `workbookProtection`, `fileVersion`, `fileSharing`, `webPublishing`, chartsheet/dialogsheet inventory, external-target sheet diagnostics, duplicate relationship IDs, and explicit default attributes.
- A Yrs hydration/export test that imports workbook metadata, hydrates it, exports it, and verifies the workbook-domain fields match the production `ParseOutput` contract.
- A package-fidelity export test proving modeled workbook children respect `WorkbookXmlFidelity` child ordering while using typed regenerated content.
- A security/fidelity test proving relationship-bearing `WorkbookView.ext_lst_raw` is omitted or diagnosed, not replayed.

Do not verify by direct state mutation only. XLSX import/export tests should exercise the real parser and writer paths.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Presence tracking can easily become a second schema. Keep it generated from or keyed by the field inventory.
- Preserving explicit default attributes may conflict with current canonical export output. The plan should distinguish fidelity mode from canonicalized new-workbook export.
- `WorkbookView.ext_lst_raw` is currently skipped by serde; if preserving it through ParseOutput becomes required, the implementation needs a deliberate safe storage path rather than simply removing `#[serde(skip)]`.
- Workbook protection and file sharing fields include sensitive hashes. Tests must use synthetic values and logs/diagnostics must avoid secret-like payloads.
- Unknown or partial modern hash groups should remain recoverable imported state even if validation warns.
- `tabRatio` is modeled as `f64` because producers emit fractional values. Validation must reject NaN/infinite values without over-normalizing valid fractional values.
- Non-editable sheet preservation depends on package graph closure outside `domain-types`; domain helpers should express invariants, not read archives.
- Strict workbook conformance and Transitional-only fields interact with writer policy outside this folder. Keep the existing fail-safe behavior.
- Runtime workbook identity and XLSX embedded Mog identity may intentionally diverge. Do not collapse them without a product-level identity contract.

Non-goals:

- Do not replace the XLSX parser's byte scanner with a full XML DOM.
- Do not move package archive reads or relationship graph construction into `domain-types`.
- Do not introduce compatibility shims or test-only workbook models.
- Do not loosen dependency direction by making `domain-types` depend on compute, kernel, or internal code.
- Do not hide workbook metadata loss behind raw XML passthrough when typed state should own the production export.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the field inventory lands.

Suggested workstreams:

- Agent A: build the `domain-types/src/domain/workbook` contract inventory, token helpers, validation types, and exhaustive unit tests.
- Agent B: update `file-io/xlsx/parser/src/domain/workbook/read` and `output/to_parse_output` to populate domain provenance and validation diagnostics.
- Agent C: update `file-io/xlsx/parser/src/domain/workbook/write` and `write/from_parse_output` to consume the contract for attribute emission and inventory validation.
- Agent D: update `domain-types/src/yrs_schema` plus compute hydration/export paths for mechanical storage coverage and sentinel documentation.
- Agent E: audit Mog workbook identity integration between `domain-types` and `compute-document`, then implement adapters only if the production import/export path needs them.
- Agent F: build parser/writer fixtures and package inventory edge-case tests.

Dependencies:

- `file-io/ooxml/types/src/workbook.rs`, `protection.rs`, and `web_publish.rs` define low-level OOXML tokens and structs consumed by this folder.
- `domain-types/src/parse_output.rs` owns `ParseOutput`, `WorkbookXmlFidelity`, and calc-id provenance sidecars.
- `file-io/xlsx/parser` owns workbook XML parsing, workbook XML writing, package graph validation, and content type/relationship closure.
- `compute/core` hydration/export owns Yrs storage integration and workbook settings export.
- `compute-document` owns runtime workbook identity and link registry state.

Recommended sequencing:

1. Land inventory and tests in `domain-types`.
2. Add validation APIs and sheet-inventory helpers.
3. Wire parser read/projection to provenance and validation.
4. Wire writer emission to provenance and validation.
5. Wire Yrs storage coverage tests and compute hydration/export updates.
6. Add identity adapters or explicitly mark XLSX embedded identity as a separate inactive/active contract.
