Rating: 8/10

Summary judgment

This is a strong plan for `file-io/ooxml/types/src`. It accurately treats `ooxml-types` as a public vocabulary and preservation contract rather than a parser/writer, and it is grounded in the actual shape of the folder: a large Rust crate with many public schema-shaped types, mixed enum token semantics, multiple raw extension representations, a coarse coverage manifest, and manual bridge generation. The proposed inventory, token-contract, validation, preservation-policy, bridge-generation, and consumer-integration tracks all address real production-path risks.

The rating is not higher because the plan is still more of an architectural program than an implementation contract. It names the right systems and categories, but several pieces need exact schemas, acceptance criteria, and migration boundaries before independent workers can implement them without creating API churn or subtly changing import/export recovery behavior.

Major strengths

- The scope is correctly bounded. It explicitly keeps XML parsing, writing, package graph closure, relationship remapping, MCE branch selection, and active-content security in `file-io/xlsx/parser` instead of overloading the type crate.
- The source assessment matches the codebase. `lib.rs` documents the crate as curated vocabulary, the existing coverage manifest is coarse, public type volume is large, enum conversion policies are inconsistent, raw payload fields vary between `ExtensionList`, `String`, `ext_lst_xml`, and `raw_*`, and bridge generation currently relies on manual source-file and newtype maps.
- The plan focuses on systematic category coverage rather than one-off fixes: all public declarations, all token enums, all raw fields, complete validation categories, and source-driven bridge exposure.
- It preserves important production contracts: stable public module paths, unconditional serde support, canonical OOXML token emission, owner-scoped raw replay, and no false whole-schema completeness claim.
- Verification is production-oriented. The gates include `cargo test -p ooxml-types`, clippy, bridge generation tests, parser/domain/compute consumers, real XLSX parse/write fixtures, and TypeScript consumer typechecking when generated declarations change.

Major gaps or risks

- The declaration inventory is underspecified. The plan lists row fields, but not the actual file format, ownership of generated vs hand-authored metadata, how re-exports are treated, how macro-generated newtypes are surfaced, or how skipped/internal public items are justified.
- The token-contract migration needs a sharper compatibility rule. The plan says to preserve current production behavior, but it does not require a pre-migration census of every enum's current unknown-token behavior or a golden diff that proves malformed-input recovery did not change accidentally.
- The validation layer is conceptually right but lacks a precise boundary. `OoxmlValidate` should define error paths, severity/recoverability, whether validation is recursive by default, and which parser/write call sites must be wired in each slice.
- Raw payload policy is a major improvement, but the plan does not define the policy schema or invalidation API tightly enough. Without that, wrappers could become documentation-only fields rather than machine-checkable edit-authority contracts.
- The bridge-generation work has high breakage potential. The plan calls for deterministic collision handling and consumer updates, but should explicitly require generated-output snapshots, import compatibility checks, and a migration policy for renamed TypeScript symbols.
- The work is very large. The parallelization notes are useful, but each worker slice still needs concrete deliverables and local definition-of-done criteria so the effort does not stall on an all-or-nothing inventory/token/validation redesign.

Contract and verification assessment

The plan's architectural contract is sound: `ooxml-types` remains dependency-light and public, parser/writer security and package semantics stay outside it, and strengthened type contracts are consumed by production import/export paths. This fits the repository's dependency direction and avoids test-only optimization or mock coverage.

The verification section is above average, especially because it includes parser/writer roundtrip fixtures and bridge consumer typechecking rather than only crate-local unit tests. It should be tightened by mapping each implementation slice to mandatory gates. For example, enum-token-only changes should require token inventory checks and `cargo test -p ooxml-types`; bridge-visible metadata changes should require the bridge generator test plus generated TypeScript consumer checks; parser/write validation hooks should require the relevant real XLSX roundtrip fixtures.

Concrete changes that would raise the rating

- Add a concrete inventory schema with example rows, ownership rules for generated vs hand-authored metadata, and explicit handling for re-exports, test modules, aliases, and macro-generated newtypes.
- Require an automated pre-migration enum census that records every public enum helper, canonical tokens, aliases, default behavior, `Other` preservation, and unknown-token behavior before any migration changes code.
- Define `OoxmlValidate` precisely: error type fields, path format, severity, recursive behavior, recovery-mode interaction, and the exact parser/writer boundary methods that must call it.
- Specify the raw preservation policy format and require tests proving every `ExtensionList`, `ext_lst_xml`, `Option<String>` extension, and `raw_*` field resolves to a policy ID.
- Break the plan into numbered implementation milestones with per-milestone changed files, acceptance criteria, and verification gates.
- Add bridge compatibility requirements: generated-output snapshot/golden tests, deterministic symbol-name policy examples, and a consumer import/typecheck matrix for any renamed or newly exposed OOXML type.
