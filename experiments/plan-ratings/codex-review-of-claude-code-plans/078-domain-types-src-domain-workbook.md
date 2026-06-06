Rating: 7/10

Summary judgment

This is a strong, production-oriented plan with several real findings and a good mental model of `domain-types/src/domain/workbook` as a parser/Yrs/export contract hub. The `WorkbookView.ext_lst_raw` serde loss, direct `ooxml_types` leakage through public workbook fields, package-info default divergence, and identity/version validation gaps are all legitimate concerns.

The rating is capped because the plan is not fully executable as written. Its central first implementation step names `ooxml_types::web_publish::WebPublishing`, but that type does not appear to exist in the current source; `ooxml_types::workbook::Workbook` stores `web_publishing` as raw `ExtensionList`, while `web_publish.rs` defines `TargetScreenSize` and web-publish item types. Since the plan also declares `ooxml_types` out of scope, the proposed bidirectional `From` pair has no valid target. Several other objectives are framed as in-folder work while their contracts actually require parser, Yrs, compute-document, or bridge decisions.

Major strengths

- Correctly identifies `WorkbookView.ext_lst_raw` as a real persistence bug: OOXML conversion carries it, but `#[serde(default, skip)]` drops it through JSON/Yrs.
- Treats defaults, serde names, optional omission, and OOXML round-trip behavior as durable contracts rather than implementation details.
- Calls out the public API leak through `WorkbookWebPublishing.target_screen_size` and `WorkbookSheetPackageInfo.visibility`, matching the existing `HashAlgorithm` re-export pattern.
- Recognizes that workbook identity is durable state and should not silently accept unknown schema/version combinations.
- Provides concrete regression-test ideas for most local issues, especially `ext_lst_raw`, identity validation, and the `WorkbookSheetPackageInfo::default()` guard.
- Includes useful sequencing notes and flags cross-folder follow-ups instead of pretending the folder is isolated.

Major gaps or risks

- The `WorkbookWebPublishing` OOXML conversion step is factually wrong unless the plan first adds or identifies a structured OOXML `CT_WebPublishing` type. A plan that keeps `ooxml_types` out of scope should instead specify domain enum encapsulation plus parser/Yrs/writer conversion helpers, or explicitly broaden scope to add the missing OOXML type.
- "Stop leaking `ooxml_types`" is underspecified. Re-exporting `TargetScreenSize` is a small compatibility change; introducing a domain-owned enum is a wire/API decision that ripples into parser, writer, Yrs schema, tests, and compute export.
- The identity reconciliation objective crosses a dependency boundary. `domain-types` should not depend on `compute-document`; the plan needs to state where conversion lives and whether the folder deliverable is only documentation/validation helpers.
- The `DescribeSchema` objective is too speculative. Current evidence suggests bridge output treats `WorkbookProtection` as an external unknown, and `compute/api/src/workbook/protection.rs` is a separate stub, so deriving schemas for all workbook types may be unnecessary or wrong.
- Scope and sequencing conflict in places: "all additions go in `tests.rs`" is not enough for bugs whose production path runs through compute hydration/export and parser/writer code.
- Minor factual issue: the plan says there are 11 files in scope but lists and the folder contains 10 files.

Contract and verification assessment

The plan's contract framing is good: loss-free `OOXML -> domain -> OOXML` and `domain -> JSON/Yrs -> domain`, camelCase serde, option omission, spec defaults, and identity stability are the right invariants.

The verification gates need tightening. A domain serde test with `ext_lst_raw = Some(...)` is necessary but not sufficient; the production regression should also cover import hydration to Yrs and export back to `ParseOutput` with the raw extension present. `WorkbookWebPublishing` needs parser/writer or Yrs-schema coverage once the actual conversion target is corrected. The proposed "cargo build of the parser and compute-core" gate is weaker than the repo's verification standard; implementers should run the relevant package tests plus `cargo test -p domain-types` and `cargo clippy -p domain-types`, with bridge codegen/tests only if `DescribeSchema` becomes part of the accepted contract.

Concrete changes that would raise the rating

- Rewrite objective 1 around the actual OOXML surface: either add a scoped cross-folder task for a structured `CT_WebPublishing` type, or remove the impossible `From<ooxml_types::web_publish::WebPublishing>` requirement and specify parser/Yrs/writer conversions against the existing attributes.
- Split deliverables into explicit "domain-only", "parser/Yrs/export follow-up", "compute identity boundary", and "bridge decision" sections, each with its own owner and verification gate.
- Define the identity mapping contract without making `domain-types` depend on compute internals; put conversion in the layer that already depends on both types, or document that no automated conversion exists.
- Replace the blanket `DescribeSchema` instruction with a required evidence check: list exactly which workbook domain types appear in generated bridge output and whether unknown external declarations are acceptable.
- Add production-path tests for `WorkbookView.ext_lst_raw` through compute hydration/export and XLSX writer/readback, not just serde unit tests.
- Use precise package/check names for verification instead of generic builds, and include clippy for the crate changed.
