# 056 — Unify and harden the `ooxml-types` OOXML vocabulary (strict parsing + derive-backed round-trip parity)

## Source folder and scope

- **Source folder:** `/Users/guangyuyang/Code/mog-all/mog/file-io/ooxml/types/src`
- **Crate:** `ooxml-types` (`mog/file-io/ooxml/types/Cargo.toml`), `publish = false`. Depends only on `serde` and the in-tree proc-macro crate `xml-derive` (`mog/file-io/xlsx/parser/xml-derive`). `dev-dependencies`: `serde_json`. The `serde` cargo feature is an intentional no-op (kept so downstream `features = ["serde"]` compiles).
- **In scope:** the ~160 `.rs` files under `src/` (~43.4k LOC) — the curated OOXML enums, structs, simple-type aliases, and their `from_ooxml` / `from_bytes` / `to_ooxml` / `as_str` conversion helpers; the shared `ExtensionList` and string aliases in `lib.rs`; and the coverage contract under `docs/ooxml-coverage/` (`manifest.json`, `check_inventory.py`). The conversion **idiom** itself — lenient vs strict parsing, derive vs hand-written — is the primary subject.
- **Out of scope (non-goals):** the `xml-derive` proc-macro crate's `XmlRead` / `XmlWrite` struct codegen beyond the `XmlEnum` path; the XLSX parser/writer that owns the round-trip contract (`mog/file-io/xlsx/parser/src/domain/*`, `.../write/*`, `.../output/*`); `domain_types`; introducing a full ECMA-376 object model; promoting the `String` simple-type aliases (`CellRef`, `Ref`, `Sqref`, `Formula`, …) to validated newtypes (large cross-crate surface — noted as a follow-on, not undertaken here); changing `ExtensionList` preservation policy.

This is a planning artifact in `mog-internal`. It references public source by path only and introduces no internal terminology into `mog/file-io/ooxml/types/src`.

## Current role of this folder in Mog

`ooxml-types` is the **shared OOXML vocabulary** for Mog's XLSX import/export. As `lib.rs` states, it is deliberately *not* a complete ECMA-376 object model and *not* an XML parser/writer — it is a curated set of enums/structs plus attribute-level `string ↔ enum` conversion helpers. The production parser/writer (the `owner` paths in `docs/ooxml-coverage/manifest.json`, all under `file-io/xlsx/parser/src/...`) is the source of truth for round-trip coverage; this crate supplies the typed vocabulary both the read and write paths share.

Observed facts from this pass:
- **235 enums** across the tree. Of these, only **21 files** use the `xml_derive::XmlEnum` derive macro; **~47 files** still hand-write `from_ooxml`/`to_ooxml`. By function count: **121 hand-written `fn from_ooxml`** vs **11 `fn from_ooxml_token`** (the strict, `Option`-returning form). 16 files return `Option<Self>` from some conversion. There are 4 hand-written `as_str`. There are **no** `impl FromStr`.
- The crate is consumed broadly: the XLSX parser calls `from_ooxml`/`from_bytes` at **575 sites** and `to_ooxml` at **421 sites** under `mog/file-io/xlsx/parser/src`. The vocabulary is load-bearing on both the read and write paths.
- **Two parsing semantics coexist, and the split is by accident of authorship, not by call-site safety.**
  - The `XmlEnum` derive (`xml-derive/src/xml_enum.rs`) generates **lenient** `from_bytes`/`from_ooxml` that *silently fall back to `Self::default()`* on any unknown token. Its own doc-comment (lines 77–84) flags the hazard: lenient fallback is appropriate for the external XLSX read path (Excel forward-compat), but "for *internal* read paths (Yrs, palette, domain conversions), use the strict equivalent … a dedicated round will extend strictness to every OOXML enum." **This plan is that round, executed in the vocabulary crate.**
  - Hand-written enums are inconsistent: most (e.g. `charts/enums/axis.rs` `AxisType::from_ooxml`, `AxisCrosses::from_ooxml`) silently default on unknown input; a minority (e.g. `styles/enums.rs` `UnderlineStyle::from_ooxml_token`) correctly return `Option` and document why silent defaulting would be a data-loss bug ("a `doubleAccounting` token must never silently become `none`").
- **Token form is duplicated in three places per enum** with no enforced parity: the `to_ooxml` match arms, the `from_ooxml` match arms, and (in 203 places) `#[serde(rename = "...")]` attributes. Hand-written enums can — and given 235 of them, eventually will — drift so that `from_ooxml(to_ooxml(x)) != x`, an alias is dropped, or the serde wire token diverges from the OOXML token.
- The crate has substantial test files (`*/tests.rs`, `423` round-trip mentions), but coverage is **per-enum and hand-authored**: there is no exhaustive, all-enums guard that every variant round-trips and that serde/OOXML tokens agree. New enums are not mechanically required to satisfy the invariant.
- `docs/ooxml-coverage/check_inventory.py` validates the manifest's *shape* (required fields, allowed categories, owner-path existence) and, when ECMA schemas are present, inventories top-level declarations. It does **not** connect the manifest to the actual enums/structs in this crate.

## Improvement objectives

1. **Make parsing strictness a deliberate, per-call-site choice instead of an authorship accident.** Every OOXML enum should expose *both* a strict constructor (returns `Option`/`Result`, never invents a default) and the existing lenient one, so internal/domain read paths can reject unknown tokens while the external XLSX read path keeps its forward-compat leniency. This directly discharges the hazard the `XmlEnum` macro doc-comment already flags.
2. **Collapse the 121 hand-written conversions onto the `XmlEnum` derive** (or an extended version of it), eliminating round-trip asymmetry, dropped aliases, and `to_ooxml`/`from_ooxml` drift as a *class* of bug rather than fixing instances.
3. **Enforce the round-trip and token-parity invariants mechanically** for every enum: `from_ooxml(to_ooxml(x)) == x` for all variants, every alias parses, and the `#[serde(rename)]` wire token equals `to_ooxml()` wherever both exist.
4. **Tie the coverage manifest to reality** by extending `check_inventory.py` so the contract map cannot silently diverge from the crate's actual typed surface.

## Production-path contracts and invariants to preserve or strengthen

- **Lenient external-read behavior must be preserved exactly where it is correct.** The XLSX *import* path deliberately tolerates Excel-newer tokens by falling back to default (macro doc-comment, lines 77–84). The strict variants are **additive**; the existing `from_ooxml`/`from_bytes` signatures and silent-default semantics must remain byte-for-byte unchanged for the 575 current call sites until each is individually audited and migrated. No call site changes semantics implicitly.
- **`to_ooxml` is the canonical write token.** It is called at 421 sites and feeds the XLSX writer. Its output strings are a wire contract and must not change. The round-trip invariant is defined as: the *primary* token emitted by `to_ooxml(x)` must parse back to `x` via the lenient and strict constructors; declared aliases must also parse to `x` but are never emitted.
- **Default selection is part of the contract.** Each enum's `#[default]` variant is what lenient parsing falls back to and what `from_bytes`/`from_ooxml` return on unknown input. Migrations to the derive must preserve the existing default variant exactly (several hand-written enums encode a spec-mandated default, e.g. `AxisCrosses::AutoZero`, `OnOff::Off`).
- **Serde wire form and OOXML token form must agree or be deliberately distinct.** Where an enum carries both `#[serde(rename = "tok")]` and `to_ooxml() == "tok"`, they must stay equal; the new parity test makes any future divergence a build failure. Where they intentionally differ, that must be explicit and documented, not incidental.
- **Aliases are union-type coverage, not decoration.** `OnOff` accepting `true|1|on` and `false|0|off`, `TrueFalseBlank` accepting the empty string, etc. are ECMA simple-type unions. Migrations must carry every existing alias arm across; the test harness asserts each alias still parses.
- **`#![allow(clippy::large_enum_variant)]` and "serde always on" stay.** Boxing choice-group variants would leak allocation policy into the shared vocabulary (lib.rs lines 22–24); serde derive remains unconditional with the no-op feature kept for downstream compat.
- **Closed-enum completeness claims remain honest.** Enums documented as covering the full ECMA value set (e.g. `ShapePreset` = all 187 `ST_ShapeType` values, per lib.rs line 17) must keep every variant through any migration; the strict constructor must accept exactly the documented set.

## Concrete implementation plan

### Phase 0 — Inventory and classify every enum (read-only, produces the worklist)
Mechanically enumerate all 235 enums and bucket each by current conversion shape:
- **(A) derive-based** (21 files) — already on `XmlEnum`, lenient only.
- **(B) hand-written lenient** — `from_ooxml` with a silent `_ => Self::default()` arm (the large majority; e.g. `charts/enums/*`, `print/enums.rs`, `styles/enums.rs` `PatternType`, `worksheet/*`).
- **(C) hand-written strict** — `from_ooxml_token`-style returning `Option` (11 functions; e.g. `UnderlineStyle`).
- **(D) mixed / irregular** — enums with `serde(rename)` but no helper, or `as_str` only, or non-unit variants the `XmlEnum` derive cannot express.
Record for each: variant set, default variant, aliases, serde renames, and whether `from_ooxml(to_ooxml(v)) == v` already holds (spot failures surface here). This worklist is the unit of parallel work and the migration checklist.

### Phase 1 — Extend `XmlEnum` to generate a strict constructor (the keystone change)
In `xml-derive/src/xml_enum.rs`, add generation of a strict sibling to the existing lenient methods, e.g.:
- `fn try_from_ooxml(s: &str) -> Option<Self>` and `fn try_from_bytes(bytes: &[u8]) -> Option<Self>` — same match arms (primary + aliases) but returning `None` instead of `Self::default()` on the fallthrough.
- Keep `from_ooxml`/`from_bytes`/`to_ooxml`/`as_str` unchanged so all 575 + 421 existing call sites compile and behave identically.

This makes strictness a one-line opt-in for every derived enum and removes the macro doc-comment's "audit the enum for a strict form" caveat as a standing TODO. (Editing `xml-derive` is in scope only for the `XmlEnum` path; `XmlRead`/`XmlWrite` are untouched.) Add macro-level unit tests in `xml-derive` for: alias parsing, strict `None` on unknown, lenient default on unknown, and round-trip of the primary token.

> Note: this plan edits production code in `xml-derive/src/xml_enum.rs` (a proc-macro that this crate's types depend on) and in `mog/file-io/ooxml/types/src`. The worker's hard constraint forbids me from *running* build/test commands; it does not forbid the plan from specifying production-path edits. All edits are confined to the keystone macro and the `ooxml-types` crate; consumer call sites in the XLSX parser are migrated in Phase 4 as a separate, owner-coordinated step.

### Phase 2 — Migrate hand-written enums onto the derive (buckets B, C, and convertible D)
For each enum whose variants are all unit variants, replace the hand-written `impl` block with `#[derive(..., xml_derive::XmlEnum)]` plus `#[xml("primary", alias = "...")]` attributes, carrying across:
- the exact primary token from the old `to_ooxml`,
- every alias arm from the old `from_ooxml`,
- the existing `#[default]` variant.
For bucket **C** (strict enums like `UnderlineStyle`): replace `from_ooxml_token` with the derive's generated `try_from_ooxml`, and update this crate's *internal* callers/tests to the new name (external consumers handled in Phase 4). Where an enum's strict-only intent must be preserved (no lenient default makes sense), document it and steer callers to `try_from_ooxml`.
For bucket **D** enums with **non-unit variants** (which `XmlEnum` cannot express — the macro errors on non-unit variants, `xml_enum.rs` lines 26–31): leave the hand-written conversion but make it conform to the round-trip and parity invariants, and add an explicit comment recording why it stays hand-written.
This is mechanical, file-local, and parallelizable across the module tree (charts, drawings, pivot, print, styles, tables, worksheet, themes).

### Phase 3 — Add the exhaustive invariant harness
Introduce a single test module (e.g. `src/conversion_invariants_tests.rs`, gated `#[cfg(test)]`) that, for every enum participating in OOXML conversion, asserts:
1. **Round-trip:** for each variant `v`, `from_ooxml(to_ooxml(v)) == v` and `try_from_ooxml(to_ooxml(v)) == Some(v)`.
2. **Alias coverage:** every declared alias parses to its variant under both lenient and strict forms.
3. **Strict rejection:** a sentinel unknown token yields `None` from `try_from_ooxml` and the `#[default]` from `from_ooxml`.
4. **Serde/OOXML parity:** where a variant has both `#[serde(rename = "t")]` and `to_ooxml() == "t"`, the strings are equal.
Because Rust enums can't be reflected at runtime, drive this with a small declarative macro (e.g. `assert_enum_invariants!(Type, [Type::A, Type::B, ...])`) so adding a new enum to the list is the cost of admission, and a `// add new OOXML enums here` anchor plus a doc note in `lib.rs` makes the requirement discoverable. Derived enums get this nearly for free; hand-written bucket-D enums are listed explicitly.

### Phase 4 — Migrate internal callers to strict where data loss is possible (coordinated with parser owner)
Audit the 575 lenient read-side call sites in the XLSX parser by *path*: external-import sites keep `from_ooxml`/`from_bytes` (forward-compat); internal/domain conversion sites (the "Yrs, palette, domain conversions" the macro names) move to `try_from_ooxml`/`try_from_bytes` and surface a typed unknown-token diagnostic instead of silently materializing a default. This phase edits files under `mog/file-io/xlsx/parser/src` and therefore must be sequenced with that folder's owner; it is the production payoff of Phases 1–3 but does not block them.

### Phase 5 — Tie the coverage manifest to the typed surface
Extend `docs/ooxml-coverage/check_inventory.py` so that, in addition to manifest-shape validation, it cross-checks that each manifest row categorized `typed_in_ooxml_types` maps to a module that actually exists under `src/` (and, where ECMA schemas are present, reconciles declared coverage against the schema inventory it already computes). Keep the "schemas optional in public checkouts" skip path intact. This prevents the contract map from drifting from the crate it describes.

## Tests and verification gates

- **Macro unit tests** (`xml-derive`): alias parse, strict `None` on unknown, lenient default on unknown, primary-token round-trip — added in Phase 1.
- **Exhaustive invariant harness** (Phase 3): round-trip, alias coverage, strict rejection, and serde/OOXML parity over the full enum list. This is the regression gate that makes the whole class of drift bugs a build failure.
- **Preserve existing per-module tests** under `*/tests.rs`; they must continue to pass unchanged (proves Phase 2 migrations are behavior-preserving). Any spot round-trip failure found in Phase 0 is fixed and gets a named regression test.
- **Manifest check** (Phase 5): `check_inventory.py` exits 0 with the strengthened cross-checks, and still skips cleanly when ECMA schemas are absent.
- **Verification commands (to be run by a human/CI, not by this planning worker):** `cargo test -p ooxml-types`, `cargo test -p xml-derive`, `cargo clippy -p ooxml-types`, and `python3 mog/file-io/ooxml/types/docs/ooxml-coverage/check_inventory.py`. Per worker constraints, this plan does not execute them.
- **Acceptance criteria:** (a) every unit-variant OOXML enum is derive-backed and exposes both lenient and strict constructors; (b) the invariant harness covers 100% of conversion enums and passes; (c) `to_ooxml` output strings are unchanged (diff the emitted token set before/after — write-path wire contract preserved); (d) no change to the 575 lenient call sites' behavior until their Phase-4 audit; (e) hand-written holdouts (non-unit variants) are documented and invariant-covered.

## Risks, edge cases, and non-goals

- **Silent write-token change is the highest risk.** A typo when transcribing a `to_ooxml` string into an `#[xml("...")]` attribute would corrupt every exported file using that variant. Mitigation: Phase-0 records the exact current token; Phase-3 round-trip + a before/after token-set diff catch any change; migrate one module at a time.
- **Non-unit variants block the derive.** `XmlEnum` only supports unit variants (`xml_enum.rs` lines 26–31). Choice-group enums with data payloads stay hand-written; they are explicitly enumerated in the invariant harness rather than forced into the macro.
- **Strict-default collisions.** A few enums use a spec-mandated default that is *also* a real token (e.g. `OnOff::Off`). The strict constructor must still return `None` for genuinely unknown tokens while lenient returns the default — the harness's "strict rejection" test pins this distinction.
- **Default-variant drift during migration.** Forgetting to carry `#[default]` would change lenient fallback for hundreds of call sites. Phase-0 records it; the derive requires `Default`; the harness asserts the unknown-token fallback equals the recorded default.
- **serde compatibility.** Migrating to the derive must not alter serialized form: where `#[serde(rename)]` exists it stays; the parity test guards equality with `to_ooxml`. The no-op `serde` feature and unconditional derives are preserved.
- **Phase 4 is a behavior change by design** (rejecting tokens that were previously swallowed). It is scoped to internal/domain read paths only, gated behind owner coordination, and surfaces a diagnostic rather than failing the whole import.
- **Non-goals:** newtype-wrapping the `String` simple-type aliases; a full ECMA object model; `XmlRead`/`XmlWrite` codegen changes; altering `ExtensionList` preservation policy; reducing scope to test-only patches or shims (explicitly disallowed).

## Parallelization notes and dependencies on other folders

- **Phase 1 (extend `XmlEnum`) is the keystone and gates Phases 2–4.** It touches `mog/file-io/xlsx/parser/xml-derive/src/xml_enum.rs` — a shared proc-macro crate; coordinate with any other in-flight work on that crate (`XmlRead`/`XmlWrite` are independent and untouched).
- **Phase 2 is embarrassingly parallel** once Phase 1 lands: the module subtrees (`charts/`, `drawings/`, `pivot/`, `print/`, `styles/`, `tables/`, `themes/`, `worksheet/`, `cond_format/`, and the top-level single-file modules) are independent and can be migrated by separate workers, each running the Phase-3 harness for its module.
- **Phase 3** depends on Phases 1–2 for the strict constructor and final variant tokens but its scaffolding (the `assert_enum_invariants!` macro) can be built in parallel.
- **Phase 4 depends on a sibling folder** owned elsewhere: `mog/file-io/xlsx/parser/src/{domain,write,output,pipeline}`. The `from_ooxml`/`from_bytes` → `try_from_*` migration there must be sequenced with that folder's owner and is the production payoff, not a prerequisite for the vocabulary-crate work.
- **No dependency** on `domain_types`, the runtime, or the SDK contracts surface; this crate sits below them in the dependency graph.
- **Blocked-plan note:** none — the folder exists and evidence is sufficient (235 enums, 121 lenient/11 strict hand-written conversions, 21 derived, 575 read + 421 write consumer sites, and the macro's own self-documented strictness TODO all directly support the plan above).
