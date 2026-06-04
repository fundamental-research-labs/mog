# 056 - File IO OOXML Types Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/file-io/ooxml/types/src`

Queue item: 56

Scope: the Rust `ooxml-types` crate source that defines Mog's curated OOXML vocabulary, schema-shaped structs/enums, DrawingML primitives, SpreadsheetML worksheet/workbook/style/table/pivot/print records, chart and ChartEx records, extension/preservation helpers, and string/token conversion helpers consumed by the production XLSX parser/writer, compute import/export, domain type conversions, and generated bridge TypeScript.

Files and integration points inspected:

- `file-io/ooxml/types/src/lib.rs`
- `file-io/ooxml/types/src/{workbook,worksheet,styles,shared_strings,comments,connections,external_links,doc_props,protection,calc_chain,chartsheet,custom_views,metadata,revisions,smart_tags,volatile,web_publish,xml_map}.rs`
- `file-io/ooxml/types/src/shared/*`
- `file-io/ooxml/types/src/styles/*`
- `file-io/ooxml/types/src/worksheet/*`
- `file-io/ooxml/types/src/cond_format/*`
- `file-io/ooxml/types/src/tables/*`
- `file-io/ooxml/types/src/print/*`
- `file-io/ooxml/types/src/themes/*`
- `file-io/ooxml/types/src/drawings/*`
- `file-io/ooxml/types/src/charts/*`
- `file-io/ooxml/types/src/chart_ex/mod.rs`
- `file-io/ooxml/types/src/pivot/*`
- `file-io/ooxml/types/docs/ooxml-coverage/{manifest.json,check_inventory.py}`
- `file-io/ooxml/types/Cargo.toml`
- `file-io/xlsx/parser/src/domain/*` consumers and writer boundaries
- `domain-types/src/domain/*` conversions and chart OOXML mirrors
- `compute/core/src/storage/*` import/export consumers
- `infra/rust-bridge/bridge-ts/tests/generate_ooxml_types.rs`

Scope this plan does not cover:

- Replacing `xlsx-parser` or moving XML scanning/writing into `ooxml-types`.
- Claiming full ECMA-376 schema completeness for every declaration.
- Adding compatibility shims, test-only models, alternate benchmark paths, or mock-only coverage.
- Changing package relationship, MCE branch selection, active-content security, or chart export authority logic outside the typed vocabulary contract.

## Current role of this folder in Mog

`file-io/ooxml/types/src` is a public Rust vocabulary crate. Its own module documentation states the core contract: serde derives are always available, conversion helpers operate at attribute/token level, scoped completeness is documented per closed enum, and `docs/ooxml-coverage/manifest.json` is a coarse ownership map rather than a declaration-by-declaration schema guarantee.

The folder is about 43K lines and roughly 780 public structs/enums/type aliases. It is not one narrow model; it is the common schema vocabulary for:

- SpreadsheetML workbook, worksheet, cell, view, table, filter, data validation, conditional formatting, style, print, shared string, metadata, connection, external link, pivot, slicer, timeline, sparkline, XML map, revision, web publish, protection, and document-property records.
- DrawingML colors, transforms, fills, lines, effects, geometry, preset shapes, spreadsheet drawing anchors/objects, text bodies, table styles, and 3D properties.
- Standard charts (`c:chartSpace`) and Microsoft ChartEx (`cx:chartSpace`) records, including raw replay/provenance fields for unsupported or extension-owned payloads.
- Shared newtypes for DrawingML units/ranges and simple string aliases for OOXML references/formulas.

Production consumers treat this folder as a contract:

- `file-io/xlsx/parser` parses/writes XML and uses these types as canonical typed records for many domains.
- `domain-types` converts selected OOXML records into durable domain state and, for charts, stores direct `ChartSpace` / `ChartExSpace` payloads.
- `compute-core` hydrates/imports and exports workbook state using these types for styles, formulas, sheet metadata, slicers, timelines, tables, conditional formats, chart definitions, and print settings.
- `compute-cf`, `compute-wire`, `compute-screenshot`, and `formula-types` depend on selected vocabulary types.
- `infra/rust-bridge/bridge-ts` generates TypeScript definitions from a manually enumerated subset of this source.

Observed strengths:

- The crate has a clean dependency profile: `serde` plus local `xml-derive`.
- Several modules already document production boundaries, especially ChartEx, pivots, sparklines, slicers, timelines, and `ExtensionList`.
- Many enums have `from_ooxml` / `to_ooxml` / `from_bytes` tests.
- DrawingML constrained newtypes already model important unit/range distinctions.
- The coverage manifest explicitly avoids false completeness claims and validates owner paths even when ECMA schema files are absent.

Observed improvement opportunities:

- Enum token policy is inconsistent across modules: some unknown values default silently, some return `Option`, some preserve `Other(String)`, and some use `xml_derive::XmlEnum`.
- XSD choice/cardinality constraints are mostly comments or local patterns, with only sparse debug-only checks.
- Raw extension fields use several representations (`ExtensionList`, `Option<String>`, `ext_lst_xml`, `Vec<ExtensionEntry>`, `raw_*` fields) without one owner/preservation policy registry.
- Generated TypeScript coverage is maintained by a manual source-file list and manual maps for macro-generated newtypes and collisions.
- The coverage manifest is coarse and not connected to the set of public Rust types, raw fields, enum token policies, or bridge exposure.
- Some high-risk composite types, especially chart groups/configs and preserve-only chart groups, carry duplicated or coupled state that should have explicit invariants.

## Improvement objectives

1. Make the crate's public vocabulary contract auditable: every public OOXML type should have schema family, owner, parse/write authority, bridge exposure, and preservation policy metadata.

2. Standardize enum/token conversion semantics without weakening production behavior: strict tokens remain strict, spec-default attributes keep defaulting behavior, alias tokens remain deliberate, and unknown-preserving enums carry raw values intentionally.

3. Promote XSD choice, required-field, range, cardinality, and internal consistency rules from comments into reusable type-local validation.

4. Make raw XML and extension preservation owner-scoped and machine-checkable so an `extLst` or raw group field never implies blanket edit-safe replay.

5. Replace manual bridge coverage with generated, collision-safe, source-of-truth-driven TypeScript generation for every intended public bridge type.

6. Keep `ooxml-types` as a vocabulary crate, not a parser/writer crate; parser/writer production paths should call into the strengthened contracts rather than reimplementing them.

7. Strengthen chart, drawing, style, conditional-format, table, pivot, slicer/timeline, and worksheet contracts as complete categories, not one-off fixes.

8. Preserve or deliberately coordinate public Rust and generated TypeScript API shape. If serialized domain storage shape changes, make it an intentional domain-types/compute migration rather than an accidental serde rename.

## Production-path contracts and invariants to preserve or strengthen

Layering:

- `ooxml-types` must not depend on `mog-internal`, compute, domain-types, parser implementation internals, or TypeScript packages.
- The crate remains a shared vocabulary and typed preservation helper; XML tree parsing, XML writing, package graph closure, relationship remapping, MCE branch selection, and active-content security policy remain in `file-io/xlsx/parser`.
- Public module paths such as `ooxml_types::worksheet::*`, `ooxml_types::charts::*`, `ooxml_types::drawings::*`, `ooxml_types::styles::*`, and `ooxml_types::pivot::*` remain stable unless all production consumers are updated in the same implementation.
- Serde support remains unconditional; the existing no-op `serde` feature remains harmless for downstream crates that still request it.

Token and default semantics:

- OOXML tokens are case-sensitive unless a schema or documented producer quirk explicitly defines aliases.
- Unknown token handling must be category-specific:
  - Data-corrupting enums use strict parse returning `None`/error and callers decide recovery.
  - Spec-default attributes may default only when the attribute is absent or when the current production parser deliberately treats malformed input as Excel-compatible fallback.
  - Unknown-preserving extension enums use `Other(String)` or equivalent raw token retention.
- `to_ooxml` must always emit canonical OOXML tokens, not aliases.
- `from_bytes`, `from_ooxml`, `as_str`, `to_ooxml`, and strict-token helpers must be generated or tested from one declaration of token metadata.

Schema and structural integrity:

- Required fields, optional fields, repeated fields, and choice groups should be representable and validated at the type boundary.
- Direct schema enums remain the preferred representation for true OOXML choice groups.
- Optional-field structs that model XSD choices must have validation that rejects mutually exclusive children when more than one is set.
- DrawingML newtypes keep range/unit safety. Lenient clamping is allowed only at parser recovery boundaries, not as a silent constructor default for trusted code.
- Chart type/group invariants must be explicit: `ChartGroup.chart_type`, `ChartTypeConfig` variant, group-level series/data-label authority, axis IDs, raw unknown chart fields, and preserve-only XML state must not conflict silently.
- Style/color definitions must preserve current semantic equality behavior and indexed-color defaults.

Preservation and raw XML:

- `ExtensionList` is a storage helper for owner-scoped replay; it is not a blanket claim that every `extLst` is edit-safe.
- Raw XML fields must record or link to an owner policy that states when replay is valid, when edits invalidate it, and whether relationships or content types must be closed by the parser/writer.
- ActiveX, credentials, external refresh behavior, VBA, unknown relationship-bearing payloads, and unsupported MCE `MustUnderstand` behavior remain security-reviewed parser/writer concerns.
- Unsupported chart groups, ChartEx payloads, drawing unknown objects, slicer/timeline payloads, and pivot cache/table preservation must not be exported as current after owner-invalidating edits.

Generated bridge:

- Generated `@mog/bridge-ts/generated/ooxml-types` output must include all and only intended bridge-visible types.
- TypeScript names must be collision-free by construction, not by scattered per-file renames.
- Macro-generated Rust newtypes must be visible to the bridge contract through explicit metadata, not manual ad hoc maps.

Coverage and claims:

- The coverage manifest must remain honest: it can claim typed vocabulary, typed domain ownership, parser sidecars, raw package passthrough, known unsupported drops, MCE helpers, and relationship infrastructure, but not whole-schema support unless backed by declaration-level evidence and parser/writer tests.
- Each module's owner and bridge exposure should be checkable without requiring local ECMA schema files; schema files, when available, should add deeper declaration inventory checks.

## Concrete implementation plan

### 1. Add a declaration-level OOXML type inventory

Create a source-owned inventory layer under `file-io/ooxml/types/docs/ooxml-coverage/` plus crate-local metadata modules. Keep `manifest.json` as the coarse feature contract, but add declaration-level rows generated or validated from the Rust source.

Each public type row should record:

- Rust path, module, kind (`struct`, `enum`, `type`, newtype).
- OOXML schema module and declaration name when known.
- Dialect: ECMA Strict, ECMA Transitional, MS x14/x15, ChartEx, VML, MCE, or OPC.
- Feature owner path in `file-io/xlsx/parser` or `domain-types`.
- Parser/writer status: typed read/write, read-only typed, write-only typed, raw sidecar, preserve-only, known dropped unsupported, or vocabulary-only.
- Bridge visibility: not exposed, semantic subset, raw OOXML bridge, or opaque.
- Raw/preservation policy ID if the type contains raw XML or extension payloads.

Extend `check_inventory.py` or add a sibling checker that:

- Validates every `pub struct`, `pub enum`, public alias, and macro-generated public newtype is represented.
- Validates every manifest owner path exists.
- Validates every bridge-visible type is included in bridge generation.
- Validates every raw field has a preservation policy.
- When schema files are present, reports unmatched schema declarations by schema module and feature row.

Do not use this inventory to claim complete schema support. Use it to prevent accidental silent omissions.

### 2. Standardize token enum declarations

Introduce a small crate-local enum contract abstraction, for example an `OoxmlToken` trait plus declarative macro or enhanced `xml_derive::XmlEnum` usage. The goal is one token table per enum.

The token declaration should support:

- Canonical token.
- Read aliases.
- Default variant.
- Parse policy: strict, default-on-unknown, preserve-other, or parser-recovery-only.
- Whether unknown fallback is allowed for missing attributes, malformed attributes, or both.
- Test metadata for roundtrip and alias behavior.

Systematically migrate enum families:

- `shared`, `worksheet`, `workbook`, `tables`, `styles`, `cond_format`, `print`, `drawings`, `charts`, `chart_ex`, `pivot`, `connections`, `external_links`, `mdx`, `ole`, `revisions`, `smart_tags`, `volatile`, and `web_publish`.
- Preserve existing public helper names where production callers use them, but route them to the centralized token contract.
- Add strict helpers where a currently lenient enum can corrupt data if used for required semantic fields.
- Keep documented aliases such as boolean aliases and ChartEx `paretoLine`/`pareto` behavior explicit in metadata.

Add crate-level tests that enumerate every token enum and assert:

- Every variant except unknown-preserving `Other` has a canonical token.
- `from_ooxml(to_ooxml(v)) == v` for all canonical variants.
- `from_bytes` and `from_ooxml` agree.
- Aliases parse only as documented and never serialize as aliases.
- Strict enums reject unknown tokens.
- Defaulting enums use the documented default and have a reason in inventory metadata.

### 3. Add type-local validation for schema constraints

Add an `OoxmlValidate` trait returning structured `OoxmlTypeError` values. Keep it type-local and dependency-light; it should not inspect package relationships or parse XML.

Implement validation in complete categories:

- Chart records: `ChartSpace`, `Chart`, `PlotArea`, `ChartGroup`, `ChartTypeConfig`, `LegendEntry`, axes, data labels, data tables, stock/up-down bars, surface bands, ChartEx layout/data references.
- Drawing records: fill choices, blip fill stretch/tile choice, line dash preset/custom choice, text body 3D choices, shape/object anchor choices, nonvisual property IDs, geometry adjustment names.
- Worksheet/table records: cell formula metadata, merge ranges, pane/view constraints, filter-column choices, sort state, data validation required formulas/operators, table column IDs/names/totals.
- Styles/conditional formats: color definitions, differential format shape, CF rule visual payload exclusivity, icon set/value object counts, data-bar extensions, number format IDs.
- Pivot records: cache source shape, shared item value choices, field/item references, area references, layout format definitions.
- Print/theme/protection/web/connection records: range/percent bounds, enum-default correctness, credential/refresh fields flagged for parser security policy.

For high-risk composite types, add constructors or builders that keep coupled fields synchronized. Charts are the priority: `ChartGroup` should expose a single authority for chart type/config/series/data labels, or validation must fail when duplicated fields diverge.

Parser and writer boundaries should call validation before accepting owner-safe typed state or emitting package parts. In strict tests, validation failures should be loud; in parser recovery mode, failures should attach diagnostics and prevent unsafe replay where appropriate.

### 4. Normalize extension and raw payload preservation

Create a preservation policy module that defines common typed wrappers for raw XML and extension payloads without taking over parser/writer ownership.

Each policy should state:

- Owner domain and owner path.
- Namespace/content type/relationship type when relevant.
- Whether the payload is semantic, inert replay, diagnostics-only, or known unsupported drop.
- Dirty invalidation triggers.
- Whether relationship closure is required before replay.
- Whether the payload is bridge-visible.

Map all raw fields to policies:

- `ExtensionList`
- chart `ExtensionEntry`, `raw_chart_group_xml`, `raw_chart_element_name`, `style_alternate_content`, empty `extLst` flags
- drawing unknown objects and extension lists
- worksheet/table/conditional-format `ext_lst_xml`
- slicer/timeline `ext_lst`, `nv_ext_lst`, unknown attributes
- theme object defaults raw XML
- pivot/table/cache extension lists

Where possible, converge field representation on shared wrappers. Where serialized shape is already stored by domain-types/compute, coordinate any shape change with those consumers and tests in the same implementation slice.

### 5. Make generated bridge coverage source-driven

Replace the manual source-file list in `infra/rust-bridge/bridge-ts/tests/generate_ooxml_types.rs` with a source-driven inventory produced from the declaration-level metadata.

The bridge generator should:

- Read all bridge-visible rows from the inventory.
- Include nested module files automatically, excluding tests and private-only modules by metadata.
- Map macro-generated newtypes through declared Rust metadata instead of hardcoded maps.
- Resolve duplicate TypeScript names through a deterministic naming policy, preferably module-qualified prefixes for non-canonical collisions.
- Emit diagnostics for skipped public types with reasons.
- Maintain a golden/snapshot output for `generated/ooxml-types.ts`.

Keep bridge output aligned with production consumers:

- `kernel/src/bridges/compute/compute-types.gen.ts`
- `types/objects/src/*` references to generated OOXML types
- `canvas/drawing/shapes/src/index.ts` shape preset export
- domain chart mirror types that serialize/deserialize OOXML payloads

### 6. Align parser/writer and domain conversion boundaries

After the crate-local contracts exist, update production consumers in focused slices:

- Parser read paths should use centralized token parsing and validation, not local token matches, for modules already modeled by `ooxml-types`.
- Writer paths should validate type-local constraints before serializing a part.
- Domain conversions should have exhaustive tests against `ooxml-types` enums and should stop duplicating token tables where the vocabulary crate already owns them.
- Chart type and ChartEx mappings should be audited as one category across `ooxml-types`, `domain-types`, parser chart extraction/reconstruction, chart core, and chart export.
- Style/color/theme conversions should share the canonical indexed palette and color scheme mapping behavior instead of copying token/name logic.

Do not move package graph, relationship, security, or edit-authority logic into `ooxml-types`. The type crate should expose enough validation metadata for those layers to make correct decisions.

### 7. Strengthen module-level tests as categories

Add table-driven tests generated from the inventory for all enum token contracts, simple-type range contracts, and raw payload policy declarations.

Then add focused module tests:

- `shared`: boolean aliases, percentage/string simple types, OPC relationship records.
- `worksheet`: cell/formula defaults, pane/view visibility, filter/date grouping, validation, ignored errors, merge ranges.
- `styles`: all format enums, colors, semantic color equality, default stylesheet pieces, table style types.
- `cond_format`: operators, time periods, CFVO values, icon sets, data bars, visual payload exclusivity.
- `drawings`: color choice/transform chains, fill/line/effect/text choice groups, anchor/object variants, preset shape completeness.
- `charts`: chart type/config/group sync, axes, series, data labels, ChartEx mappings, extension/preserve-only fields.
- `pivot`: shared item choices, cache/table source constraints, field references.
- `print/themes/slicers/timelines/connections`: default semantics, owner-scoped extensions, relationship-sensitive fields.

## Tests and verification gates

For the implementation work, run the smallest relevant gates first and broaden when contracts touch consumers:

- `python3 file-io/ooxml/types/docs/ooxml-coverage/check_inventory.py`
- New declaration inventory checker for `file-io/ooxml/types`
- `cargo test -p ooxml-types`
- `cargo clippy -p ooxml-types`
- `cargo test -p bridge-ts --test generate_ooxml_types`
- `cargo test -p xlsx-parser`
- `cargo test -p domain-types`
- `cargo test -p compute-core --test roundtrip_parse_output`
- `cargo test -p compute-core` when changes affect hydration/export storage paths beyond parser roundtrip fixtures.

Targeted parser/writer fixture gates should include real XLSX parse/write cycles for:

- Styles, shared strings, worksheet views, formulas, data validations, conditional formats, tables, print settings, merges, and hyperlinks.
- Charts including standard chart groups, combo charts, unknown/preserve-only chart groups, ChartEx chart families, and chart extensions.
- Drawings with anchors, pictures, shapes, text bodies, and unknown object preservation.
- Pivot caches/tables, slicers, timelines, sparklines, connections, and external links.

Bridge verification should confirm generated TypeScript compiles through the actual consuming TS packages, not only by inspecting emitted text. If TypeScript declarations change, run the relevant package typecheck plus repo `pnpm typecheck` unless a narrower explicit type gate is agreed for that implementation slice.

This planning worker did not run these gates because the queue constraints explicitly prohibit cargo, Rust, pnpm/npm/yarn, build, test, typecheck, or verification commands for this task.

## Risks, edge cases, and non-goals

Risks:

- OOXML schemas are large, and local ECMA schema files may be absent. Inventory checks must still validate source/owner/bridge contracts without schema files and deepen validation only when schemas are present.
- Centralizing enum behavior can accidentally change malformed-input recovery. Preserve current production behavior until each enum's strict/default/preserve policy is explicitly classified.
- Generated TypeScript name changes can break downstream imports. Use deterministic collision policy and update all generated bridge consumers in one slice.
- Raw XML wrappers can create a false sense of safety. Every raw payload must be tied to owner invalidation and relationship closure rules.
- Some current structs mirror parser convenience rather than exact XSD shape. Validation should make those deliberate flattened models safe instead of forcing noisy schema-object rewrites.
- Chart group/config duplication is high risk because parser reconstruction, domain chart storage, chart renderability, and export authority all touch it.

Edge cases to cover:

- Absent attribute vs malformed attribute vs unknown future token.
- Case-sensitive tokens and producer-specific aliases.
- Unknown-preserving variants with empty strings.
- Empty self-closing `extLst` vs absent `extLst` vs non-empty extension payloads.
- MCE `AlternateContent` style/chart payloads and non-standard producer ordering.
- Theme/indexed/auto/RGB colors with tint equivalence.
- 3D chart variants, of-pie, stock volume overlays, ChartEx layout aliases, and unknown chart groups.
- DrawingML percentage/angle/EMU units, clamped parse recovery, and trusted constructor behavior.
- Relationship-bearing raw payloads after user edits.

Non-goals:

- Generating a full ECMA-376 object model.
- Adding a second parser, writer, benchmark path, or test-only adapter.
- Supporting ActiveX, credentials, VBA execution, or arbitrary external refresh as typed editable features.
- Treating raw package replay as semantic support.
- Relaxing architecture by letting public `mog` code depend on `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the inventory format and token/validation contracts are defined.

Recommended parallel slices:

- Worker A: declaration inventory, manifest checker, and raw-field policy scanner for `file-io/ooxml/types`.
- Worker B: enum/token metadata migration for `shared`, `worksheet`, `workbook`, `tables`, `styles`, and `cond_format`.
- Worker C: DrawingML primitives/colors/fills/lines/text/effects validation and bridge metadata.
- Worker D: charts and ChartEx contracts, including `domain-types/src/domain/chart`, parser chart extraction/reconstruction, and chart export mappings.
- Worker E: pivot/slicer/timeline/sparkline/connections/external-link preservation policy and parser/writer boundary validation.
- Worker F: bridge-ts source-driven generation and generated TypeScript consumer updates.
- Worker G: parser/write integration tests and compute-core roundtrip gates.

Dependencies:

- Define the inventory schema before assigning module migrations so workers produce compatible metadata.
- Define token parse policy categories before enum migrations.
- Define `OoxmlValidate` error shape before parser/writer boundary integration.
- Bridge generation depends on inventory rows and macro-generated newtype metadata.
- Parser/writer integration depends on the type crate contracts but should remain in `file-io/xlsx/parser`.
- Domain chart and compute import/export updates should follow chart type contract changes to avoid storage/export drift.
