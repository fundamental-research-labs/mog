# 078 — Improve `mog/domain-types/src/domain/workbook` (persistent workbook domain models & schema mapping)

## Source folder and scope

- **Folder:** `mog/domain-types/src/domain/workbook`
- **Crate:** `domain-types` (`mog/domain-types`), the single source of truth for spreadsheet domain data structures — "parser produces, Yrs stores, writer consumes" (`mog/domain-types/Cargo.toml` description; `mog/domain-types/src/domain/README.md`).
- **Files in scope (11):**
  - `mod.rs` (module wiring; `pub use <module>::*`)
  - `calculation.rs` (`CalcMode`, `RefMode`, `CalculationProperties`)
  - `properties.rs` (`ObjectDisplayMode`, `UpdateLinks`, `WorkbookProperties` — full `CT_WorkbookPr`)
  - `protection.rs` (`WorkbookProtection`, re-exports `HashAlgorithm`)
  - `view.rs` (`WorkbookViewVisibility`, `WorkbookView`)
  - `file_metadata.rs` (`FileVersion`, `FileSharing`)
  - `web_publishing.rs` (`WorkbookWebPublishing`)
  - `identity.rs` (`WorkbookId`, `WorkbookLineage`, `MogWorkbookIdentityMetadata`, `WorkbookSheetKind`, `PackageDiagnosticRef`, `WorkbookSheetPackageInfo`, plus the `MOG_WORKBOOK_ID_*` constants)
  - `ooxml.rs` (bidirectional `From` impls between these domain types and `ooxml_types::{workbook,protection}`)
  - `tests.rs` (round-trip + serde unit tests)
- **In scope:** the struct/enum field surface; defaults; the `From`/`Into` OOXML conversion contract; serde attributes (`rename_all`, `skip`, `skip_serializing_if`, `default`); encapsulation of `ooxml_types` behind the domain API; bridge/`DescribeSchema` participation; doc comments describing these contracts.
- **Out of scope (named only to describe coupling / ripple — do not edit):**
  - `ooxml_types` (`mog/file-io/ooxml/types/src/{workbook,protection,web_publish}.rs`) — the OOXML vocabulary these types convert to/from.
  - The XLSX parser read/write paths (`mog/file-io/xlsx/parser/src/domain/workbook/**`), which call these conversions and which currently hand-build `WorkbookWebPublishing`.
  - The Yrs mapping layer (`mog/domain-types/src/yrs_schema/{workbook_properties,protection,file_sharing,file_version,web_publishing}.rs`).
  - The runtime workbook-identity store `compute/core/crates/compute-document/src/workbook_metadata.rs` (a *separate* `WorkbookId`/`WorkbookLineage`).
  - `compute/core/src/storage/workbook/settings/**` (a second persistence mapping for calc/protection settings).
  - The bridge codegen consumers (`infra/rust-bridge/bridge-ts`, `compute/api/src/workbook*`).

## Current role of this folder in Mog

This folder defines the **canonical, persistence-facing representation of workbook-level (not sheet-level) state**: calculation engine settings, the `CT_WorkbookPr` property bag, structure/window protection, the workbook view/window geometry, file-version and file-sharing metadata, web-publishing settings, and Mog's own workbook identity/lineage and package-inventory contract. Every struct is a pure data definition (`Debug, Clone, PartialEq, Serialize, Deserialize`, `#[serde(rename_all = "camelCase")]`) with no behavior beyond `serde` and OOXML `From` conversions. It sits at the hub of three pipelines:

1. **Import:** XLSX parser reads `workbook.xml`/rels → `ooxml_types` → (`ooxml.rs` `From`) → these domain types.
2. **Persistence/collaboration:** these types ⇄ Yrs `Y.Map` documents via `yrs_schema/*` and/or `compute-core` storage.
3. **Export:** these types → (`ooxml.rs` `Into`) → `ooxml_types` → writer emits `workbook.xml`.

Because it is a pure-type hub, "improvement" means making the contracts **complete (every OOXML field has a round-trip), consistent (one encapsulation rule, one identity model), and loss-free across *all three* pipelines** — not just the in-memory OOXML pair that `tests.rs` exercises.

## Improvement objectives

1. **Close the `WorkbookWebPublishing` conversion gap and stop leaking `ooxml_types` through the public domain API.** Every other type in this folder has a bidirectional `From` pair centralized in `ooxml.rs`; `WorkbookWebPublishing` has **none** — the OOXML mapping is hand-written in the parser (`file-io/xlsx/parser/src/domain/workbook/read/properties.rs`), and the domain struct embeds `Option<ooxml_types::web_publish::TargetScreenSize>` directly (`web_publishing.rs:23`). That contradicts the convention `protection.rs:6` sets ("Re-export `HashAlgorithm` so consumers do not need a direct `ooxml_types` dependency"). The same leak exists at `identity.rs:91` (`visibility: ooxml_types::workbook::SheetState`).
2. **Fix the silent extension-list data loss on `WorkbookView` through the serde/CRDT pipeline.** `WorkbookView.ext_lst_raw` is `#[serde(default, skip)]` (`view.rs:48`) — `skip`, not `skip_serializing_if`. The raw extension XML survives the in-memory OOXML round-trip (it is carried by the `From` impls, `ooxml.rs:122,292`) but is **unconditionally dropped** whenever the view is serialized to JSON / stored in Yrs. Any workbook that round-trips through persistence silently loses `bookView` extension data.
3. **Reconcile the two divergent workbook-identity models.** This folder defines `WorkbookId(pub String)` + `WorkbookLineage { duplicated_from, copied_from }` + `MogWorkbookIdentityMetadata` (`identity.rs`), while `compute/core/crates/compute-document/src/workbook_metadata.rs` defines an independent `WorkbookId` (numeric, `from_raw`/`from_uuid_str`) + `WorkbookLineage { origin_workbook_id, duplicated_from, duplicated_at }` + `WorkbookCreationMetadata`. The lineage shapes do not match (`copied_from` vs `origin_workbook_id`/`duplicated_at`), so identity/lineage cannot round-trip faithfully between the OOXML custom-XML carrier (this folder) and the persisted runtime identity. Define and document the canonical mapping.
4. **Bring workbook types into the bridge `DescribeSchema` contract (or document why they are exempt).** The crate README lists "bridge codegen" as a consumer, and `pivot`, `validation`, `chart`, `conditional_format`, and `drawings` derive `DescribeSchema`. **No** workbook type does. Determine whether workbook settings cross the TS bridge (they appear in `compute/api/src/workbook*` and `infra/rust-bridge/bridge-ts` tests); if so, add `DescribeSchema`; if not, record the exemption.
5. **Harden `MogWorkbookIdentityMetadata` schema/version validation.** `new()` hardcodes `version: 1` and the `schema` URL constant (`identity.rs:40-48`), but deserialization accepts any `schema`/`version` with no validation or migration hook. A future schema bump silently round-trips as v1. Add explicit validation/version-gating at the parse boundary.
6. **Document and lock the `WorkbookSheetPackageInfo::default()` divergence.** Its manual `Default` sets `kind: WorkbookSheetKind::Invalid` (`identity.rs:124`) while `WorkbookSheetKind::default()` is `Worksheet` (`identity.rs:56`). The divergence is intentional ("invalid until classified") but a future switch to `#[derive(Default)]` would silently flip unclassified entries to `Worksheet`. Make the intent explicit and test-guarded.
7. **Evaluate the round-trip-fidelity sidecar booleans.** `CalculationProperties.has_explicit_iterate_count` / `has_explicit_iterate_delta` (`calculation.rs:59-60`) encode "was this attribute present in source" as parallel booleans next to the values — a shape that lets the flag and the value drift independently. Assess converging on `Option<u32>`/`Option<f64>` (a cross-folder change touching `ooxml_types::CalcPr`); if rejected, document why the booleans are load-bearing.

These are production-path contract improvements to the types the parser, compute-core, Yrs layer, and bridge compile against — not test scaffolding.

## Production-path contracts and invariants to preserve or strengthen

- **Three-way loss-free round-trip.** The binding invariant is `OOXML → domain → OOXML` *and* `domain → JSON/Yrs → domain` both preserve every field. `tests.rs` only proves the first for most types and the second for a subset; objective 2 exists precisely because the second silently fails for `WorkbookView.ext_lst_raw`. Strengthen, never weaken.
- **`serde(rename_all = "camelCase")` + `skip_serializing_if = "Option::is_none"` on optionals.** This is the crate-wide wire contract (README "Conventions"). Any new field must follow it; the default-equals-empty-JSON property (`tests.rs:541-548`, `workbook_web_publishing_optional_fields_omitted`) must hold for additive changes.
- **OOXML-spec-accurate defaults.** `Default` impls intentionally diverge from `#[derive(Default)]` to match the OOXML spec (e.g. `WorkbookProperties::show_border_unselected_tables = true`, `auto_compress_pictures = true`; `CalculationProperties::iterate_count = 100`). `defaults_match_ooxml_spec` (`tests.rs:170`) guards these — extend it for any new field.
- **`ooxml_types` stays an implementation detail.** The public domain surface should not require consumers to depend on `ooxml_types` (the `protection.rs:6` re-export rule). Objective 1 strengthens this; do not regress it elsewhere.
- **Identity stability.** `MogWorkbookIdentityMetadata` and `WorkbookId` are durable workbook identity — changes must be backward-compatible with already-persisted workbooks (no field renames that break existing JSON; additive + `#[serde(default)]` only).
- **`WorkbookSheetPackageInfo` is the package/order identity contract.** Per its doc comment (`identity.rs:77-83`), workbook order, relationship identity, resolved part path, content type, and sheet kind must remain explicit (never re-inferred from vector position). Preserve that explicitness.

## Concrete implementation plan

1. **Add the `WorkbookWebPublishing` ⇄ OOXML conversion to `ooxml.rs` and encapsulate the enum.**
   - Introduce a domain-side `TargetScreenSize` enum (mirroring `ooxml_types::web_publish::TargetScreenSize`) in `web_publishing.rs`, or re-export it the way `protection.rs:6` re-exports `HashAlgorithm` — pick the form already preferred elsewhere in the crate and apply it consistently.
   - Add `impl From<ooxml_types::web_publish::WebPublishing> for WorkbookWebPublishing` and the reverse in `ooxml.rs`, matching the existing field-by-field style (`ooxml.rs:127-150`).
   - This is the in-folder half; a follow-up in the parser (out of scope here, flagged below) replaces the hand-built construction in `read/properties.rs` with the centralized `From`. Keep the domain change parser-compatible so the parser swap is mechanical.
2. **Fix `WorkbookView.ext_lst_raw` persistence.** Change `#[serde(default, skip)]` to `#[serde(default, skip_serializing_if = "Option::is_none")]` (`view.rs:48`) so extension XML survives JSON/Yrs serialization while still defaulting to absent. Add a serde round-trip test with a populated `ext_lst_raw` (the existing `serde_roundtrip_workbook_view_all_fields`, `tests.rs:290`, sets it to `None` and so never caught this). Confirm there is no intentional reason (e.g. size/PII) to drop it — if there is, replace `skip` with an explicit, documented transient marker rather than leaving the silent-loss footgun.
3. **Encapsulate `ooxml_types::workbook::SheetState` in `WorkbookSheetPackageInfo`.** Re-export `SheetState` from this folder (mirroring the `HashAlgorithm` pattern) so consumers of `identity.rs:91` need no direct `ooxml_types` dependency. Pure re-export — no wire change.
4. **Reconcile workbook identity (objective 3).** Author a short identity-mapping doc comment in `identity.rs` and a conversion (or an explicitly documented "no automated conversion; fields X/Y are dropped/minted at boundary Z" statement) tying `MogWorkbookIdentityMetadata`/`WorkbookLineage` (string/custom-XML carrier) to `compute-document`'s `PersistedWorkbookMetadata`/`WorkbookLineage` (numeric runtime identity). Specifically resolve: does `copied_from` map to `origin_workbook_id` or `duplicated_from`? Where is `duplicated_at`/`created_by`/`imported_from` sourced when exporting to custom XML? Add tests pinning the agreed mapping. (Any field addition to make the mapping total is additive + `#[serde(default)]`.)
5. **`DescribeSchema` participation (objective 4).** First gather evidence (grep the bridge-ts generation tests and `compute/api/src/workbook*` to confirm whether these structs are bridged). If bridged: add `#[derive(DescribeSchema)]` (via the existing `bridge-types` dependency already in `Cargo.toml`) to the public structs/enums, matching the pivot/validation pattern. If not bridged: add a one-line module doc in `mod.rs` recording that workbook settings are intentionally outside the TS bridge surface, so the inconsistency is not mistaken for an omission.
6. **Schema/version validation for identity (objective 5).** Add a `MogWorkbookIdentityMetadata::validate()` (or a `TryFrom`/parse helper) that checks `schema == MOG_WORKBOOK_ID_CUSTOM_XML_SCHEMA` and `version` is a supported value, returning a typed error rather than silently accepting. Wire the expectation into the import-boundary contract (parser change is out of scope but the helper lives here). Keep `Deserialize` permissive (forward-compat) but make validation an explicit, callable step.
7. **Lock the `WorkbookSheetPackageInfo` default divergence (objective 6).** Add a doc comment on the manual `Default` explaining why `kind` is `Invalid` (not the field type's `Worksheet` default), and a unit test asserting `WorkbookSheetPackageInfo::default().kind == WorkbookSheetKind::Invalid` so a future `#[derive(Default)]` refactor fails loudly.
8. **Resolve the calc fidelity-flag shape (objective 7).** Investigate whether `ooxml_types::CalcPr` can express explicit-presence via `Option` instead of paired booleans. If yes, propose the cross-folder change (note it ripples into `ooxml_types` and the parser — outside this folder); if the booleans must stay (e.g. they mirror a fixed wire shape), add a doc comment on `calculation.rs:58-60` stating the flags are authoritative for serialization presence and must be kept in sync with their values, and add a test asserting a `From<CalcPr>` round-trip preserves both flags independently of the values.

## Tests and verification gates

All additions go in `tests.rs` (the only test surface in scope). Do **not** run build/test commands as part of producing this plan; the gates below are for the implementing change.

- **New: `WorkbookWebPublishing` OOXML round-trip** — `ooxml → domain → ooxml` equality across all 9 fields including `target_screen_size` (parallels `book_view_roundtrip`, `tests.rs:93`). This is the regression that proves objective 1.
- **New: `WorkbookView` ext-list serde round-trip** — populate `ext_lst_raw = Some(<raw xml>)`, serialize → deserialize → assert preserved (proves objective 2; the current `tests.rs:290` uses `None` and would still pass with the bug).
- **New: identity-mapping round-trip** — construct a `MogWorkbookIdentityMetadata` with lineage, map to the runtime identity shape and back per the objective-4 mapping, assert no field is silently lost (or assert the documented, intentional drop).
- **New: identity schema/version validation** — assert `validate()` rejects an unknown `schema`/unsupported `version` and accepts the canonical pair.
- **New: package-info default guard** — `assert_eq!(WorkbookSheetPackageInfo::default().kind, WorkbookSheetKind::Invalid)`.
- **Extend `defaults_match_ooxml_spec` (`tests.rs:170`)** for any newly added field's spec default.
- **Existing serde/`skip_serializing_if`/enum-camelCase tests must continue to pass unchanged** — they encode the wire contract; treat any required edit to them as a wire-compat regression to be justified.
- **Standard gates (run by the implementer, not here):** `cargo test -p domain-types`; `cargo build` of the parser and `compute-core` to catch ripple from re-exports/`From` additions; bridge-ts codegen test if `DescribeSchema` is added; `cargo clippy`/`fmt`.

## Risks, edge cases, and non-goals

- **Wire-compat risk (highest).** This crate's serde output is the JSON/Yrs persistence format. Any `rename_all`, field-rename, or non-additive change can break already-persisted workbooks. Constrain to: additive fields with `#[serde(default)]`; `skip → skip_serializing_if` (strictly widens what is written, safe for readers); pure re-exports. The `ext_lst_raw` change *adds* a key that was previously never written — verify older readers tolerate unknown keys (serde does by default; confirm Yrs mapping does too).
- **`ooxml_types` is out of scope** — objective 7's `Option`-vs-boolean change and any new `ooxml_types::web_publish` field would require edits there; this plan only prepares the domain side and flags the dependency.
- **Identity reconciliation may be intentional separation.** The two `WorkbookId` types may be deliberately distinct (durable custom-XML string vs runtime numeric). If so, the deliverable for objective 3 is the *documented* boundary mapping, not a merge. Do not collapse them without confirming with the compute-document owners.
- **`DescribeSchema` may be intentionally absent.** If workbook settings never cross the bridge, adding the derive is needless surface; the gate is "bridged?" — answer it first.
- **Non-goals:** no reduced-scope or test-only fix; no compatibility shim or temporary workaround; no behavioral change to calculation/protection semantics; no edits to the parser, `ooxml_types`, `yrs_schema`, or `compute-core` (those are dependent follow-ups, enumerated below); no renaming of existing serde keys.

## Parallelization notes and dependencies on other folders

- **Independent, can land first (in-folder only):** objectives 1 (domain half), 2, 3-doc, 6, 7-doc, and the new tests. These touch only files in this folder and have no external ripple beyond recompilation.
- **Ripple follow-ups (separate PRs, other folders — coordinate, do not edit here):**
  - Parser swap to the new `WorkbookWebPublishing` `From` (`file-io/xlsx/parser/src/domain/workbook/read/properties.rs`, `write/metadata.rs`) — depends on objective 1 landing.
  - `yrs_schema/web_publishing.rs` and any `WorkbookView` Yrs mapping — must adopt the `ext_lst_raw` change from objective 2; confirm no Yrs mapping for workbook *view* exists today (only `sheet_view` does) and decide whether view persistence needs one.
  - `compute-document/src/workbook_metadata.rs` owners — sign-off on the objective-3 identity mapping.
  - `bridge-ts` codegen — regenerate if objective 4 adds `DescribeSchema`.
  - `ooxml_types` — only if objective 7 converges the fidelity flags onto `Option`.
- **Recommended sequencing:** (1) land in-folder changes + tests → (2) parser/yrs adopt the new conversions → (3) identity-mapping doc/tests after compute-document sign-off → (4) optional `DescribeSchema` + `ooxml_types` fidelity-flag change last, as they have the widest blast radius.
