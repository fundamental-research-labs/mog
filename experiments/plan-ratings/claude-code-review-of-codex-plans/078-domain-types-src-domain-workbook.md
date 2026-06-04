Rating: 8/10

# Review of Plan 078 — Domain Types Workbook


## Summary judgment

This is a strong, unusually well-grounded improvement plan for `mog/domain-types/src/domain/workbook`. Its factual claims about the source folder are accurate to a degree most plans in this experiment are not: every field count is exact (`CalculationProperties` 15, `WorkbookProperties` 18, `WorkbookView` 15 incl. `uid`/`ext_lst_raw`, `WorkbookProtection` 15, `FileVersion` 5, `FileSharing` 7, `WorkbookWebPublishing` 9), the asserted defaults match the code (`show_border_unselected_tables`, `show_ink_annotation`, `save_external_link_values`, `auto_compress_pictures` all `true`; the `WorkbookView` default profile is exactly right), the identity constants are quoted verbatim, and the adjacent production paths it lists (`yrs_schema/{workbook_properties,file_version,file_sharing,web_publishing}`, parser `read`/`write` modules, the three compute paths) all exist. The `export_workbook_properties` `date1904` sentinel claim is verifiable in the export code. This evidentiary discipline is the plan's defining strength and earns most of its score.

The plan correctly identifies the folder's real role — not a passive struct bag but the durable contract spanning XLSX import → `ParseOutput` → Yrs hydration/export → XLSX write — and its core proposal (an executable field inventory that drives serde/OOXML/Yrs/presence/validation coverage tests, plus production validation APIs and centralized enum token helpers) is genuinely useful and addresses real drift risk.

The main weaknesses are over-ambition for a single folder and under-specification of the plan's own centerpiece mechanism.

## Major strengths

- **Accurate grounding.** Field inventories, defaults, constants, and adjacent paths are all verifiable against the tree. This makes the plan trustworthy and directly implementable.
- **Correct architectural framing.** Layering constraints (`domain-types` must not depend on compute/parser internals; `ooxml-types` stays the low-level vocabulary) are stated crisply and match the actual dependency direction.
- **The identity-boundary concern is real, not speculative.** There is a `WorkbookLineage` in `domain-types/identity.rs` *and* a separate `WorkbookLineage` in `compute-document/workbook_metadata.rs` alongside `PersistedWorkbookMetadata`. The plan's warning about "silently reusing duplicate/copy lineage fields with different meanings" is grounded in an actual name collision across crates.
- **Strong verification section.** Gates name specific, real crates/targets (`cargo test -p domain-types workbook`, `-p xlsx-parser output::to_parse_output`, `-p compute-document workbook_metadata`, `compute-core storage::engine::tests::test_xlsx_export`) and add meaningful behavior gates (round-trip fixtures, Yrs hydrate→export equivalence, fidelity ordering, the `ext_lst_raw` security test). The insistence on exercising real parser/writer paths rather than direct state mutation is the right call.
- **Risk section is concrete and security-aware** (synthetic hashes only, no secret-bearing diagnostics; NaN/inf rejection on `tab_ratio` without over-normalizing; unsafe `ext_lst_raw` replay).
- **Sensible sequencing and parallelization** keyed to the inventory landing first.

## Major gaps or risks

- **The centerpiece mechanism is under-specified.** The "executable source of truth" inventory is the load-bearing idea, but the plan defers the hardest design question — how a const-table inventory actually *drives* runtime byte-scanning parser code and Yrs helpers at compile time rather than merely being asserted against in tests. It hedges with "route ... where possible" and "avoid a one-off procedural macro unless simple const tables cannot express the needed data," which is exactly the decision that should be resolved. The plan even names the failure mode ("presence tracking can easily become a second schema") but its mitigation ("keep it generated from or keyed by the field inventory") is circular. Without a concrete binding mechanism, the realistic outcome is a parallel table that tests enforce but that drifts in spirit.
- **Scope is large for one folder.** The plan touches `domain-types`, `file-io/xlsx/parser` (read, write, output projection, from_parse_output, pipeline), `compute-core` hydration/export, and `compute-document`, with six parallel agent workstreams. That is a multi-week, multi-crate effort presented as a folder improvement. The objectives are individually sound but collectively risk never reaching "done"; there is no MVP slice identified that delivers value if later phases stall.
- **Validation/diagnostic integration is left vague.** It introduces `WorkbookDomainValidationError/Warning/Context` and a `ValidateWorkbookDomain` trait, but `PackageDiagnosticRef` already exists in the folder and the parser has its own diagnostic stream. The plan does not say how the new validation types relate to or avoid duplicating the existing diagnostic machinery, which is a concrete integration risk.
- **Two objectives are decisions, not implementations.** "Clarify Mog workbook identity ownership" and the choice among three presence-model options (bitset vs. per-child provenance vs. ParseOutput sidecar) are open design questions. The plan appropriately conditions identity adapters on "only if needed," but a reader cannot tell which presence design will actually be built, so estimating the work is hard.

## Contract and verification assessment

Contract clarity is high. The inventory row schema (Rust field, serde key, OOXML child/attr, default + absence-vs-explicit-default, Yrs key, emission policy, validation category) is the right set of columns and would, if realized, make coverage mechanical. The invariants to preserve are specific and tied to real behavior: `date1904` sentinel, `customWorkbookViewsXml` staying outside `WorkbookView`, `calcChain` non-export, editable-index pointing only into valid worksheets, stable diagnostic codes for relationship/content-type/kind mismatches. The "Yrs policy must never be implicit (`persisted` / `not persisted by design` / `stored elsewhere`)" rule is an excellent, enforceable contract.

Verification gates are above average for this experiment: they map to real test targets and add adversarial/fidelity tests, not just round-trips. The one missing piece is an explicit acceptance criterion for inventory *completeness* — the gate "fails on missing serde/OOXML/Yrs/presence/validation policy" presumes the inventory already enumerates the full field set, but nothing guards against a field being silently omitted from the inventory itself (a meta-coverage gap).

Minor factual nits (do not affect the rating much): the risks section says `tabRatio` is "modeled as `f64`" — it is actually `Option<f64>`; and `ext_lst_raw` is described as `#[serde(skip)]` when it is `#[serde(default, skip)]`. Both are trivial.

## Concrete changes that would raise the rating

1. **Commit to one inventory binding mechanism and show a worked example.** Pick const-table-plus-trait vs. macro, and demonstrate one field (e.g. `date1904`) flowing from the inventory row into the parser read, writer emit, and Yrs key — proving the table is *consumed*, not just *checked*. This is the single change that would most raise confidence.
2. **Define an MVP slice.** Identify the smallest shippable increment (e.g. inventory + coverage tests + validation for `CalculationProperties` and `WorkbookProperties` only) that delivers value independently, so the plan degrades gracefully if later phases are deferred.
3. **Specify how new validation diagnostics reconcile with the existing parser diagnostic stream and `PackageDiagnosticRef`,** including which codes are stable and where they surface, to avoid building a second diagnostic system.
4. **Pick the presence model** (bitset / per-child provenance / ParseOutput sidecar) rather than listing three, and state how it composes with `WorkbookXmlFidelity` ownership concretely.
5. **Add a meta-completeness gate** that fails when a struct field exists in the source but has no inventory row (reflection/derive-based), closing the "field omitted from the inventory" loophole.
6. **Resolve the identity boundary as a stated decision** (adapter vs. deliberate separation) with the duplicate `WorkbookLineage` name collision called out explicitly as the thing to disambiguate.
7. Fix the `tab_ratio` (`Option<f64>`) and `ext_lst_raw` (`#[serde(default, skip)]`) descriptions for precision.
