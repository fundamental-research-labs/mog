# Plan 079 — Land and close the typed DrawingML primitives in `domain-types/src/domain/drawings`

## Source folder and scope

- **Folder:** `mog/domain-types/src/domain/drawings`
- **Crate:** `mog-domain-types` (the shared Rust domain vocabulary; depends on `ooxml-types`, consumed by `xlsx-parser`, `floating_object`, `chart`, `slicer`, WASM bridge).
- **In scope:** the 24 files under this folder (≈7,300 LOC) and the public re-export surface in `mod.rs`. Concretely:

  | File | Role | LOC |
  |---|---|---|
  | `mod.rs` | barrel + module-level invariants doc | 73 |
  | `audits.rs` | "additive extension" typed primitives: `LineCap`/`LineJoin`/`PenAlignment`/`LineDashSpec`/`LineFill`/`Duotone`/`ClientDataFlags`/`EditAsKind`/`PresetShape`/`ShapeGeometry` | 692 |
  | `color.rs` | `DomainDrawingColor` + `ColorTransformSpec`/`ColorTransformKind` | 402 |
  | `drawing_fill.rs` | `DrawingFill` (solid/gradient/blip/pattern) | 526 |
  | `outline.rs` | `Outline`, `CompoundLine`, `LineEnd*` | 494 |
  | `text_body.rs` / `text_body_convert.rs` | `TextBody` paragraph/run model + ooxml converters | 749 / 864 |
  | `effects.rs` / `effect_properties.rs` / `blip_effect.rs` | effect primitives + `EffectListSpec`/`EffectProperties` + `BlipEffect` | 251 / 306 / 370 |
  | `scene.rs` / `shape_3d.rs` | `SceneSettings`, `Shape3DSettings`, camera/light/bevel | 339 / 266 |
  | `fill_mode.rs` / `source_rect.rs` / `compression.rs` / `black_white_mode.rs` | blip-fill modifiers | 346 / 175 / 127 / 184 |
  | `shape_style.rs` / `locking.rs` / `hyperlink.rs` / `transform.rs` / `manual_layout.rs` | style ref / lock flags / hyperlink ref / `Transform2D` / `ManualLayout` | 193 / 193 / 162 / 169 / 231 |
  | `group_shape.rs` / `ole_object.rs` / `vml_shape.rs` | `GroupShapeData`/`DrawingContent`, `OleObjectProperties`, `VmlShapeProps` | 100 / 55 / 41 |

- **Out of scope (other queue items, touched only as coordinated follow-ups):** the production structs that are *supposed* to carry these primitives — `mog/domain-types/src/domain/floating_object/{ooxml.rs,objects.rs,style.rs}` and `…/chart/*` — and the parser elevation/lowering code in `mog/file-io/xlsx/parser/**`. These consume the vocabulary and must move in lockstep with the wiring steps below; the *type definitions and converters* in this folder are the deliverable here, plus the minimal field-type changes on the consuming structs needed to make the typed primitives actually load on the production path.

## Current role of this folder in Mog

This folder is the **lossless domain-level mirror of the DrawingML primitives** (DrawingML = the `a:`/`xdr:` vocabulary shared by pictures, shapes, connectors, charts, OLE objects and form controls). Per `mod.rs`, every primitive here is meant to: (a) serialize camelCase, (b) have a `Default` that emits *no* JSON keys, and (c) ship `From<&ooxml_types::…>` / `From<domain> for ooxml_types::…` round-trip converters with unit tests. The point is that `floating_object`/`chart`/`slicer` can hold **typed** drawing state instead of `serde_json::Value` blobs or stringly-typed fields, so OOXML round-trip is lossless and the WASM/API surface is typed.

Two distinct populations live here, and they are in very different states of completion:

1. **Wired, load-bearing primitives** — `ManualLayout` (10+ chart/legend/axis/label consumers), `TextBody`, `GroupShapeData`/`DrawingContent`, `OleObjectProperties`, `VmlShapeProps`, `SceneSettings`, `Shape3DSettings`. These are referenced by production structs in `floating_object`/`chart` and are exercised on the real parse→domain→write path.

2. **Staged-but-orphaned primitives** — the entire `audits.rs` block. Grepping the consumers shows `LineDashSpec`, `ClientDataFlags`, `EditAsKind`, and `HyperlinkRef` have **zero** references outside this folder and its own tests. Critically, the production structs they were designed to replace still carry the *old* loose representation: `floating_object/ooxml.rs` defines, on **five** anchor-prop structs (`PictureOoxmlProps`, `ShapeOoxmlProps`, connector, group, graphic-frame), the fields

   ```rust
   pub edit_as: Option<String>,                       // should be Option<EditAsKind>
   pub client_data_locks_with_sheet: Option<bool>,    // should fold into ClientDataFlags
   pub client_data_prints_with_sheet: Option<bool>,
   ```

   `audits.rs`'s own doc says `ClientDataFlags` holds flags "previously floated on `PictureOoxmlProps`" and `EditAsKind` replaces a "`Option<String>`" — but that migration **was never completed**. The typed primitives were landed with converters and tests, then left disconnected. The result is dead-but-tested code on one side and un-typed, un-validated string/bool fields on the production path on the other.

**Core observation:** this folder's value proposition is "lossless *typed* preservation," but a large fraction of its surface is either (a) not attached to any production struct, or (b) attached but still bottoming out in `*_raw_xml` opaque escape hatches. The single highest-value improvement is to *finish landing* the staged primitives onto the production path and to *close* the deferred `raw_xml` holes that the corpus actually exercises — converting "we have a type for this" into "the type is the only representation, end to end."

## Improvement objectives

1. **Eliminate the orphaned/duplicated representation.** Migrate the five `floating_object` anchor-prop structs from `edit_as: Option<String>` + two `client_data_*: Option<bool>` fields to typed `Option<EditAsKind>` + `Option<ClientDataFlags>`, so `audits.rs`'s typed primitives become the single source of truth instead of dead code shadowed by a loose copy.
2. **Make the round-trip contract self-verifying.** The module doc *asserts* three invariants (camelCase serde, Default-emits-no-keys, full From/From round-trip) but only some files test them, and nothing checks them uniformly. Add a single shared test harness/macro that asserts the three invariants for *every* re-exported primitive, so a future primitive that violates them fails CI rather than silently drifting.
3. **Close the `raw_xml` escape hatches that the corpus exercises.** Type the deferred subtrees that are reachable in real spreadsheet drawings — prioritized by corpus frequency, not by spec completeness. Candidates with explicit `TODO(typed OOXML preservation)` markers: `EffectProperties::EffectDag`, `EffectListSpec::{fill_overlay_raw_xml, preset_shadow_raw_xml}`, `BlipEffect::ColorChange{raw_xml}`, `audits::ShapeGeometry::Custom{raw_xml}` (custGeom path tree). Each remaining `raw_xml` field must be justified by a documented corpus-frequency rationale, not left as an unbounded passthrough.
4. **Tighten lossiness in the converters.** Audit the `From` impls for silent narrowing — e.g. `LineFill::Pattern` lowering uses `unwrap_or_default()` on an unknown preset token (`audits.rs` ~L430), which can drop an unrecognized pattern name on write. Replace lossy fallbacks with token-preserving round-trip (mirror the `color.rs` "unknown token survives as its original string" pattern, which is the right model and should be applied consistently).
5. **Document and enforce the EMU/percentage unit contracts.** Many fields are raw integers on OOXML scales (`0..=100000` percentages, `60_000`ths-of-a-degree angles, EMU offsets). These units live only in doc comments today. Introduce/reuse the existing newtype wrappers (`StAngle`, `StPositiveFixedPercentageDecimal`, etc. already exist in `ooxml_types`) at the domain boundary, or at minimum centralize the unit constants, so callers cannot mix raw degrees with 60_000ths.

## Production-path contracts and invariants to preserve or strengthen

- **The three module invariants (preserve, and make enforced):**
  1. camelCase JSON for every primitive;
  2. `Default` emits **no** JSON keys (so absent OOXML elements stay absent on re-serialize — this is what makes diffs clean and round-trip lossless);
  3. bidirectional `From<&ooxml_types::…>` / `From<domain> for ooxml_types::…` with a round-trip test.

  These are currently prose in `mod.rs`. Objective 2 turns them into a uniformly-applied test gate. **Do not** weaken the Default-emits-nothing rule — it is load-bearing for byte-stable round-trip and for the WASM JSON surface.

- **Lossless round-trip is the hard contract.** Any change that makes an existing `From`/`From` pair non-round-tripping (e.g. typing `EffectDag` but dropping an attribute) is a regression even if it "compiles and serializes." Every newly-typed subtree must come with a parse→type→write round-trip test against a representative fixture before the `raw_xml` fallback is removed.

- **`ClientDataFlags` default semantics (preserve exactly):** OOXML spec defaults `fLocksWithSheet`/`fPrintsWithSheet` to `true` *when the element is absent*. The current `Option<bool>` design distinguishes "absent" (`None`) from "explicit true" (`Some(true)`); the typed `ClientDataFlags` preserves this via `Option<bool>` fields. The migration in Objective 1 must carry this tri-state forward unchanged — collapsing to a bare `bool` would silently rewrite files that omitted the attribute.

- **`OpaqueDrawingContent` is writer-only.** Per its doc, `DrawingContent::OpaqueUnknown` is preservation state and must **not** be surfaced as a supported object on the public bridge/API unless an explicit opaque-handle contract exists. Any new typing work must not accidentally promote opaque content into the typed/public surface.

- **Token-preserving fallbacks (strengthen).** `color.rs` already guarantees an unknown scheme/preset/system token survives round-trip as its raw string. Make this the *uniform* rule: `LineFill::Pattern` preset, `LineDashSpec::Preset` val, and any other `from_ooxml`/`to_ooxml` token pair must round-trip unknown tokens rather than defaulting them away.

## Concrete implementation plan

Sequenced so each step is independently shippable and leaves the tree green.

**Step 1 — Inventory & invariant test harness (no behavior change).**
- Add a `mod.rs`-level test module (or a small `assert_drawing_primitive!` macro) that, for each re-exported type, asserts: `Default` serializes to `{}` (or documents the explicit exception — e.g. `DashStop` legitimately emits `{"d":0,"sp":0}`, `DomainDrawingColor` has a non-empty default variant; these exceptions get an allowlist with a one-line rationale), and serde uses camelCase.
- This converts the prose invariants in `mod.rs` into a gate and immediately documents which types are intentional exceptions.

**Step 2 — Land `EditAsKind` + `ClientDataFlags` on the production structs (closes Objective 1).**
- In `floating_object/ooxml.rs`, replace on the five anchor-prop structs:
  - `edit_as: Option<String>` → `edit_as: Option<EditAsKind>`,
  - the two `client_data_*: Option<bool>` fields → `client_data: Option<ClientDataFlags>` (preserving the tri-state).
- Update the parser elevation (`xlsx/parser/**`) and any chart/slicer construction sites to populate the typed fields via the existing `From<&odraw::ClientData>` / `From<&odraw::EditAs>` converters, and the lowering/write path via the reverse `From`.
- Because this changes the serialized JSON shape (`editAs` value becomes an enum token; `clientData` nests two booleans), confirm whether any persisted/wire schema depends on the old flat fields. If the WASM/API surface serializes these, add the field rename to the migration notes and keep the camelCase tokens identical to the old string values (`twoCell`/`oneCell`/`absolute`) so the change is value-compatible.
- Delete the now-redundant loose fields only after all producers/consumers are migrated.

**Step 3 — Apply token-preserving fallbacks (Objective 4).**
- Audit every `to_ooxml`/`From<domain> for odraw::…` that uses `unwrap_or_default()` / `unwrap_or_else` on a parsed token (start with `LineFill::Pattern` preset at `audits.rs` ~L430, `LineDashSpec`). Where a token may be unknown, store and re-emit the original string instead of defaulting. Add a round-trip test with a deliberately-unknown token.

**Step 4 — Close high-frequency `raw_xml` holes (Objective 3), one PR per subtree.**
- For each of `EffectListSpec::fill_overlay_raw_xml`, `EffectListSpec::preset_shadow_raw_xml`, `EffectProperties::EffectDag`, `BlipEffect::ColorChange{raw_xml}`, `ShapeGeometry::Custom{raw_xml}`: confirm corpus frequency first (see Tests section). For the subtrees that actually appear, define a typed mirror following the established file conventions (camelCase, Default-empty, From/From, round-trip test), wire it through the converter, and remove the `raw_xml` field. For subtrees that are genuinely absent from the corpus, leave the `raw_xml` passthrough **but** replace the bare `TODO` with a dated rationale ("retained opaque: 0 occurrences in corpus as of <date>; revisit if drift detected") so deferral is a documented decision, not a silent gap.
- The `CT_CustomGeometry` path tree (`ShapeGeometry::Custom`) is the largest; if corpus shows it matters, type the move/line/cubic/arc path mini-language as its own sub-module rather than inflating `audits.rs`.

**Step 5 — Unit-typing pass (Objective 5).**
- Where domain fields are raw integers on OOXML scales, adopt the existing `ooxml_types` newtypes (`StAngle`, `StPositiveFixedPercentageDecimal`, EMU) at the conversion boundary, or introduce domain-local unit constants/aliases. Prefer reusing the `ooxml_types` newtypes the converters already touch over inventing parallel ones. Keep serde output numeric and unchanged.

**Step 6 — `audits.rs` decomposition (optional, low-risk cleanup).**
- `audits.rs` is 692 LOC mixing line, fill, anchor, and geometry concerns under a "this is staging" framing. Once Step 2 lands its types onto production, the "audit/staging" framing is stale. Split into cohesive files (`line.rs`, `geometry.rs`; fold `ClientDataFlags`/`EditAsKind` near the anchor types) and update `mod.rs` re-exports. Pure move; re-exports keep the public path stable.

## Tests and verification gates

> Per task constraints this plan does not run build/test commands; this section specifies the gates the implementer must satisfy.

- **Invariant gate (Step 1):** the new harness asserting camelCase + Default-empty for every re-exported primitive (with an explicit, rationaled exception allowlist) must pass. This is the new standing gate for the folder.
- **Round-trip gates (Steps 2–4):** for every typed primitive touched, a `domain → ooxml → domain` and `ooxml → domain → ooxml` equality test. Each removed `raw_xml` field must be replaced by a fixture-backed round-trip test proving the typed mirror is lossless for the real XML it used to passthrough.
- **Corpus-frequency evidence (Step 4 precondition):** before removing any `raw_xml` passthrough, scan the available `.xlsx` corpus/fixtures for the corresponding element (`<a:effectDag>`, `<a:fillOverlay>`, `<a:prstShdw>`, `<a:clrChange>`, `<a:custGeom>`) and record counts in the PR. Zero-occurrence subtrees keep the passthrough with a dated rationale; non-zero subtrees get typed.
- **Migration compatibility check (Step 2):** verify (via the WASM/API serialization tests for floating objects) that the `editAs`/`clientData` JSON shape change is intended and that token values are preserved; if any persisted document or snapshot test encodes the old flat fields, update or migrate those fixtures deliberately and call it out.
- **Whole-crate gates:** `mog-domain-types` and its downstream consumers (`xlsx-parser`, `chart`, `slicer`) must typecheck and pass their existing drawing/round-trip suites after each step. The parser's drawing read/write round-trip suite is the integration backstop for the elevation/lowering changes in Step 2.
- **No-op serialization proof:** golden-file diff on a representative drawing-heavy workbook (parse → write) must be byte-identical except for the deliberately-typed fields, confirming Default-emits-nothing was preserved.

## Risks, edge cases, and non-goals

- **Risk — JSON shape change leaking to the wire (Step 2).** The biggest hazard is that `editAs`/`client_data_*` are serialized on the WASM/API surface and an external consumer reads the flat fields. Mitigation: keep enum token values byte-identical to the old strings; treat the `client_data` nesting as a coordinated, documented schema change; gate on the floating-object serialization tests.
- **Risk — typing a `raw_xml` subtree non-losslessly.** Removing a passthrough before the typed mirror is proven lossless silently corrupts rare files. Mitigation: never remove a `raw_xml` field without a fixture-backed round-trip test; for zero-corpus subtrees, do not type at all — keep the (now-rationaled) passthrough.
- **Edge case — `ClientDataFlags` tri-state.** `None` (absent → spec default true) vs `Some(true)` (explicit) must survive the migration; collapsing to `bool` rewrites files.
- **Edge case — `DomainDrawingColor` default is a non-empty variant** (`SrgbClr{ val:"" }`), so it is a legitimate exception to "Default emits `{}`"; the invariant harness must allowlist it rather than fail.
- **Edge case — `large_enum_variant` allows.** `DrawingContent` and `EffectProperties` intentionally hold large inline variants (documented). Don't "fix" these by boxing — the comments explain the ownership rationale.
- **Non-goals:** rewriting the already-wired `TextBody`/`ManualLayout`/`GroupShapeData` types (they work and are load-bearing); changing the public re-export *paths* in `mod.rs` (Step 6 keeps them stable); promoting `OpaqueDrawingContent`/`Unknown` into the public typed surface; building a full DrawingML editor model. This is preservation-fidelity and dead-code-elimination work, not feature work. No compatibility shims or test-only patches — every step changes the production representation end to end.

## Parallelization notes and dependencies on other folders

- **Step 1 (invariant harness)** is self-contained in this folder and can land first, in parallel with everything else.
- **Step 2 (typed anchor fields)** is the only step that crosses folder boundaries: it must be coordinated with `mog/domain-types/src/domain/floating_object` (queue items for that folder) and `mog/file-io/xlsx/parser` (elevation/lowering). It is the critical-path dependency — do it as one atomic change spanning definition + producers + consumers, since the field-type change won't compile piecemeal.
- **Steps 3, 4, 5** are mostly local to this folder and parallelizable per-primitive (each `raw_xml` subtree / each converter is independent), with the caveat that `effect_properties.rs` depends on `effects.rs` and `floating_object::OuterShadowEffect`, and `audits.rs`/`drawing_fill.rs`/`outline.rs` all depend on `color.rs` — so a `color.rs` change must land before its dependents.
- **Step 6 (decomposition)** should land last to avoid churning the file layout under in-flight steps; it touches only `mod.rs` re-exports as the cross-cutting seam.
- **Shared dependency:** all converters depend on `ooxml_types::drawings`; if any new typed subtree needs an `ooxml_types` surface that doesn't exist yet (e.g. a typed `CT_EffectContainer`), that becomes a dependency on the `ooxml-types` crate and should be split into its own coordinated change.

---

### Evidence appendix (for the rater)

- `mod.rs:1-14` — the three stated module invariants (camelCase, Default-emits-nothing, From/From round-trip).
- `audits.rs:25-31, 487-502, 468-485` — `ClientDataFlags`/`EditAsKind` documented as replacing fields "previously floated on `PictureOoxmlProps`" / an `Option<String>`.
- `floating_object/ooxml.rs:29-34` (and the same triple at `:65-71, :100-106, :127-131, :170-174`) — production structs still carry `edit_as: Option<String>` + `client_data_locks_with_sheet/prints_with_sheet: Option<bool>`; the typed primitives were never wired in.
- Consumer grep: `LineDashSpec`, `ClientDataFlags`, `EditAsKind`, `HyperlinkRef` have **zero** references outside this folder/its tests.
- `raw_xml` deferral markers: `effect_properties.rs:66-75, 115-117`; `blip_effect.rs:63, 138`; `audits.rs:300-311`; `text_body.rs:557-569`.
- `audits.rs:~430` — `PatternFill` preset lowering via `from_ooxml(&preset)` / `unwrap_or_default()`, the lossy-fallback pattern to fix.
- `color.rs:8-12` — the token-preserving "unknown token survives round-trip" model to generalize.
