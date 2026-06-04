Rating: 8/10

# Review of Plan 079 — `domain-types/src/domain/drawings`

## Summary judgment

This is a strong, evidence-driven plan that correctly identifies the highest-value
problem in this folder — typed DrawingML primitives were landed with converters and
tests but never wired onto the production structs they were meant to replace — and
sequences a remediation that is shippable in independently-green steps. I verified the
core claims against source and they hold up unusually well: the five `floating_object`
anchor-prop structs do still carry `edit_as: Option<String>` plus the two
`client_data_*: Option<bool>` fields (`floating_object/ooxml.rs:30-34, 67-71, 102-106,
127-131, 170-174`); `audits.rs` does document `ClientDataFlags`/`EditAsKind` as
replacements for fields "previously floated on `PictureOoxmlProps`" / an
`Option<String>`; a consumer grep for `ClientDataFlags|EditAsKind|LineDashSpec|
HyperlinkRef` returns **zero** hits outside the drawings folder; the `raw_xml` /
`TODO(typed OOXML preservation)` markers exist at the cited lines in
`effect_properties.rs`, `blip_effect.rs`, `audits.rs`, and `text_body.rs`; the color.rs
"unknown token survives round-trip" model exists as described; and the `ooxml_types`
newtypes (`StAngle`, `StPositiveFixedPercentageDecimal`) the plan proposes reusing are
real and already imported by these converters. The diagnosis is accurate, not
aspirational.

The plan reads like someone who actually opened the files. Its main weakness is that its
single headline objective (Step 2) is not self-contained in this folder — it crosses
into `floating_object` and the xlsx parser — and a few verification gates lean on
corpus/test assets whose location is asserted but not pinned.

## Major strengths

- **Accurate, falsifiable diagnosis.** The "wired vs. staged-but-orphaned" split is real
  and backed by grep evidence I confirmed. Framing the work as preservation-fidelity +
  dead-code elimination (not feature work) is the right altitude for this crate.
- **Contract preservation is specified precisely.** The `ClientDataFlags` tri-state
  (`None` = absent ⇒ spec default `true`, vs `Some(true)` = explicit) is called out as
  load-bearing, and the existing `From` impls confirm the design depends on it
  (`unwrap_or(true)` on lowering). The "Default emits no JSON keys" invariant and the
  `DomainDrawingColor`/`DashStop` exceptions are correctly identified as allowlist items
  rather than failures.
- **Corpus-frequency gating for `raw_xml` is the correct discipline.** Refusing to type a
  subtree until it's shown to appear in the corpus, and requiring a dated rationale on
  retained passthroughs, is exactly right and resists spec-completionism.
- **Sequencing leaves the tree green at each step**, and the parallelization/dependency
  notes (color.rs before its dependents; effect_properties depends on effects; Step 6
  last) match the actual module graph.
- **Honest about scope and wire risk.** It flags the JSON-shape change on the WASM/API
  surface as the top hazard and proposes keeping enum tokens byte-identical to the old
  strings — the right mitigation.

## Major gaps or risks

- **The headline objective is not actually in-scope-deliverable here.** Step 2 — the
  step the plan itself names as "the single highest-value improvement" and the critical
  path — must edit `floating_object/ooxml.rs`, the parser elevation/lowering, and chart/
  slicer construction sites. The plan acknowledges this as a "coordinated follow-up," but
  that means the folder's stated top win cannot land from this queue item alone; it is
  gated on other folders' queue items. This is the biggest execution risk and the plan
  should state more bluntly that Steps 1, 3, 5 are the truly local deliverables and Step 2
  is a cross-team atomic change that may stall.
- **Corpus location and scanning method are under-specified.** Step 4's precondition
  ("scan the available `.xlsx` corpus/fixtures") and the Step 2 "WASM/API serialization
  tests for floating objects" are referenced abstractly. The implementer is left to
  locate both. For a plan this precise elsewhere, naming the corpus path and the relevant
  test module would materially de-risk Step 4 (whose entire scope is conditional on those
  counts).
- **Minor evidence imprecision on the lossy-fallback claim.** The plan cites
  `audits.rs ~L430` `unwrap_or_default()` as dropping an unknown pattern preset on write.
  At that line the `unwrap_or_default()` is on `Option<PresetPatternVal>` *absence*
  (None ⇒ empty string), not on an unrecognized token. The genuine round-trip-fidelity
  question is in the reverse direction (`PresetPatternVal::from_ooxml(&preset)` in
  `From<LineFill> for odraw::LineFill`), whose behavior on an unknown token determines
  whether the string survives. The concern is legitimate; the line-level pointer is
  slightly off and should point at `from_ooxml` rather than the `unwrap_or_default`.
- **Step 4's true scope is unknown until investigation**, by design. That's good
  practice, but it means the plan can't bound effort for its third objective — a reviewer/
  PM should treat Step 4 as a spike, not a committed deliverable.

## Contract and verification assessment

The contract section is the plan's strongest part and is largely verifiable against
source:

- The three module invariants are quoted accurately from `mod.rs:8-14`, and turning them
  into a shared `assert_drawing_primitive!` gate (Step 1) is genuinely additive — it
  catches future drift. The exception allowlist (DomainDrawingColor non-empty default,
  DashStop) is the right escape valve.
- The round-trip requirement ("never remove a `raw_xml` field without a fixture-backed
  round-trip test") is the correct hard gate and is stated as a regression bar, not a
  nice-to-have.
- The migration-compatibility gate (Step 2) correctly anticipates that `editAs` becomes
  an enum token and `clientData` becomes a nested object, and insists on token-value
  stability.

Weaknesses: the verification gates name suites and corpora ("the parser's drawing read/
write round-trip suite", "golden-file diff on a representative drawing-heavy workbook",
"WASM/API serialization tests for floating objects") without confirming they exist or
where. Given the task forbids running builds, the plan can't execute them — fine — but it
could at least cite the file paths so the implementer isn't searching. As written, the
no-op serialization proof and migration-compatibility check rest on assets taken on
faith.

## Concrete changes that would raise the rating

1. **Separate "local deliverables" from "cross-folder coordination" explicitly.** State
   that Steps 1/3/5/6 are fully landable within this folder and that Step 2 is a
   multi-folder atomic change blocked on the `floating_object` and parser queue items —
   so the value delivered by *this* item alone is unambiguous. (→ would address the top
   risk.)
2. **Pin the corpus path and the floating-object serialization test module** by name, and
   give the exact rg query for the five OOXML elements (`<a:effectDag>`, `<a:fillOverlay>`,
   `<a:prstShdw>`, `<a:clrChange>`, `<a:custGeom>`) so Step 4's precondition is mechanical.
3. **Correct the lossy-fallback pointer** to target `PresetPatternVal::from_ooxml` in the
   `From<LineFill> for odraw::LineFill` lowering (and confirm whether that function
   defaults unknown tokens), rather than the `unwrap_or_default()` on `Option` absence.
4. **Add a rollback/compat note for Step 2's wire change** — if an external API consumer
   already reads the flat `editAs`/`client_data_*` fields, name the migration mechanism
   (dual-emit window, schema version bump, or snapshot-fixture update) rather than only
   "treat as a coordinated documented change."
5. **Bound Step 4 as a spike** with an explicit decision checkpoint after the corpus scan,
   so it isn't mistaken for a committed deliverable.
